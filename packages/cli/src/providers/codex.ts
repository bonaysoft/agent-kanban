import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import type { AgentEvent, AgentHandle, AgentProvider, ContentBlock, ExecuteOpts, UsageInfo, UsageWindow } from "./types.js";
import { parseRetryAfterMs, UsageFetchError } from "./types.js";

const AUTH_PATH = join(homedir(), ".codex", "auth.json");
const USAGE_API = "https://chatgpt.com/backend-api/wham/usage";

function readAccessToken(): string | null {
  try {
    const auth = JSON.parse(readFileSync(AUTH_PATH, "utf-8"));
    return auth.tokens?.access_token || auth.access_token || null;
  } catch {
    return null;
  }
}

/** Per 1M tokens, OpenAI pricing */
const CODEX_PRICING: Record<string, { input: number; cached_input: number; output: number }> = {
  o3: { input: 2.0, cached_input: 0.5, output: 8.0 },
  "o4-mini": { input: 1.1, cached_input: 0.275, output: 4.4 },
  "gpt-4.1": { input: 2.0, cached_input: 0.5, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, cached_input: 0.1, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, cached_input: 0.025, output: 0.4 },
  "codex-mini-latest": { input: 1.5, cached_input: 0.375, output: 6.0 },
};

const RESET_RE = /try again at (.+)/i;
const QUOTA_RE = /quota exceeded|usage limit/i;
function parseRateLimitReset(msg: string): string | null {
  const match = RESET_RE.exec(msg);
  if (!match) {
    return QUOTA_RE.test(msg) ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null;
  }
  const cleaned = match[1].replace(/(\d+)(st|nd|rd|th)/g, "$1").replace(/\.$/, "");
  const ms = Date.parse(cleaned);
  return Number.isNaN(ms) ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : new Date(ms).toISOString();
}

function calcCost(model: string, inputTokens: number, cachedInputTokens: number, outputTokens: number): number {
  const price = CODEX_PRICING[model] ?? CODEX_PRICING.o3;
  return (inputTokens * price.input + cachedInputTokens * price.cached_input + outputTokens * price.output) / 1_000_000;
}

/** Map a single Codex thread event to an AgentEvent (or null to skip). */
export function mapThreadEvent(event: ThreadEvent, model = "o3"): AgentEvent | null {
  switch (event.type) {
    case "item.completed": {
      const item = event.item;
      if (item.type === "agent_message" && item.text) {
        return { type: "message", blocks: [{ type: "text", text: item.text }] };
      }
      if (item.type === "command_execution") {
        return {
          type: "message",
          blocks: [{ type: "tool_use", id: item.id ?? `codex-${Date.now()}`, name: "command", input: { command: item.command } }],
        };
      }
      if (item.type === "file_change") {
        const files = item.changes.map((c) => `${c.kind} ${c.path}`).join(", ");
        return { type: "message", blocks: [{ type: "tool_use", id: item.id ?? `codex-${Date.now()}`, name: "file_change", input: { files } }] };
      }
      if (item.type === "reasoning" && item.text) {
        return { type: "message", blocks: [{ type: "thinking", text: item.text }] };
      }
      return null;
    }

    case "turn.completed": {
      const { input_tokens, cached_input_tokens, output_tokens } = event.usage;
      const cost = calcCost(model, input_tokens ?? 0, cached_input_tokens ?? 0, output_tokens ?? 0);
      return {
        type: "turn.end",
        cost,
        usage: {
          input_tokens: input_tokens ?? 0,
          output_tokens: output_tokens ?? 0,
          cache_read_input_tokens: cached_input_tokens ?? 0,
          cache_creation_input_tokens: 0,
        },
      };
    }

    case "turn.failed": {
      const msg = String(event.error?.message || JSON.stringify(event));
      const resetAt = parseRateLimitReset(msg);
      if (resetAt) return { type: "turn.rate_limit", status: "rejected", resetAt };
      return { type: "turn.error", detail: msg };
    }

    case "error": {
      const detail = String(event.message || JSON.stringify(event));
      const resetAt = parseRateLimitReset(detail);
      if (resetAt) return { type: "turn.rate_limit", status: "rejected", resetAt };
      return { type: "turn.error", detail };
    }

    default:
      return null;
  }
}

/** Map a Codex ThreadItem to a ContentBlock. */
function mapItemToBlock(item: { id?: string; type: string; [k: string]: any }): ContentBlock | null {
  switch (item.type) {
    case "agent_message":
      return item.text ? { type: "text", text: item.text } : null;
    case "command_execution":
      return { type: "tool_use", id: item.id ?? `codex-${Date.now()}`, name: "command", input: { command: item.command } };
    case "file_change": {
      const files = item.changes?.map((c: any) => `${c.kind} ${c.path}`).join(", ") ?? "";
      return { type: "tool_use", id: item.id ?? `codex-${Date.now()}`, name: "file_change", input: { files } };
    }
    case "mcp_tool_call":
      return { type: "tool_use", id: item.id ?? `codex-${Date.now()}`, name: item.name ?? "mcp_tool", input: item.arguments ?? {} };
    case "web_search":
      return { type: "tool_use", id: item.id ?? `codex-${Date.now()}`, name: "web_search", input: { query: item.query ?? "" } };
    case "reasoning":
      return item.text ? { type: "thinking", text: item.text } : null;
    default:
      return null;
  }
}

/**
 * Streaming mapper for Codex: uses native turn/item lifecycle events.
 * - turn.started → turn.start
 * - item.started → block.start (tool shows loading)
 * - item.completed → block.done (result fills in)
 * - turn.completed → turn.end { cost }
 * - turn.failed/error → turn.error / turn.rate_limit
 */
export function* mapThreadEventStream(event: ThreadEvent, model: string, turnOpen: { value: boolean }): Generator<AgentEvent> {
  if (event.type === "turn.started") {
    if (!turnOpen.value) {
      yield { type: "turn.start" };
      turnOpen.value = true;
    }
    return;
  }

  if (event.type === "item.started") {
    if (!turnOpen.value) {
      yield { type: "turn.start" };
      turnOpen.value = true;
    }
    const block = mapItemToBlock(event.item);
    if (block) yield { type: "block.start", block };
    return;
  }

  if (event.type === "item.completed") {
    if (!turnOpen.value) {
      yield { type: "turn.start" };
      turnOpen.value = true;
    }
    const block = mapItemToBlock(event.item);
    if (block) yield { type: "block.done", block };
    return;
  }

  if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "error") {
    turnOpen.value = false;
    const mapped = mapThreadEvent(event, model);
    if (mapped) yield mapped;
    return;
  }
}

export const codexProvider: AgentProvider = {
  name: "codex",
  label: "Codex CLI",

  async execute(opts: ExecuteOpts): Promise<AgentHandle> {
    const model = opts.model ?? "o3";

    const codex = new Codex({ env: opts.env });
    const threadOpts = {
      model: opts.model,
      workingDirectory: opts.cwd,
      sandboxMode: "danger-full-access" as const,
      approvalPolicy: "never" as const,
    };
    const thread = opts.resume ? codex.resumeThread(opts.sessionId, threadOpts) : codex.startThread(threadOpts);

    const abortController = new AbortController();
    const streamed = await thread.runStreamed(opts.taskContext, { signal: abortController.signal });

    const events = (async function* () {
      const turnOpen = { value: false };
      for await (const event of streamed.events) {
        yield* mapThreadEventStream(event, model, turnOpen);
      }
    })();

    let aborted = false;
    return {
      events,
      async abort() {
        if (aborted) return;
        aborted = true;
        abortController.abort();
      },
      async send() {
        throw new Error("Codex multi-turn send not implemented");
      },
    };
  },

  async fetchUsage(): Promise<UsageInfo | null> {
    const token = readAccessToken();
    if (!token) return null;

    let res: Response;
    try {
      res = await fetch(USAGE_API, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new UsageFetchError(`codex usage request failed: ${(err as Error).message}`, { cause: err });
    }

    if (!res.ok) {
      throw new UsageFetchError(`codex usage API returned ${res.status}`, {
        status: res.status,
        retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
      });
    }

    type RateLimitWindow = { used_percent: number; reset_at: number; limit_window_seconds: number };
    const data = (await res.json()) as { rate_limit?: { primary_window?: RateLimitWindow; secondary_window?: RateLimitWindow } };
    const rl = data.rate_limit;
    const windowLabel = (secs: number) => (secs <= 18000 ? "5-Hour" : "Weekly");
    const windows: UsageWindow[] = [];
    if (rl?.primary_window) {
      windows.push({
        runtime: "codex",
        label: windowLabel(rl.primary_window.limit_window_seconds),
        utilization: rl.primary_window.used_percent,
        resets_at: new Date(rl.primary_window.reset_at * 1000).toISOString(),
      });
    }
    if (rl?.secondary_window) {
      windows.push({
        runtime: "codex",
        label: windowLabel(rl.secondary_window.limit_window_seconds),
        utilization: rl.secondary_window.used_percent,
        resets_at: new Date(rl.secondary_window.reset_at * 1000).toISOString(),
      });
    }
    return { windows, updated_at: new Date().toISOString() };
  },
};
