import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Codex, type ThreadEvent } from "@openai/codex-sdk";
import { createLogger } from "../logger.js";
import type { AgentEvent, AgentHandle, AgentProvider, ExecuteOpts, UsageInfo, UsageWindow } from "./types.js";

const logger = createLogger("codex");

const AUTH_PATH = join(homedir(), ".codex", "auth.json");
const USAGE_API = "https://chatgpt.com/backend-api/wham/usage";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedUsage: UsageInfo | null = null;
let cachedAt = 0;

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
        return { type: "assistant", blocks: [{ type: "text", text: item.text }] };
      }
      if (item.type === "command_execution") {
        return {
          type: "assistant",
          blocks: [{ type: "tool_use", id: item.id ?? `codex-${Date.now()}`, name: "command", input: { command: item.command } }],
        };
      }
      if (item.type === "file_change") {
        const files = item.changes.map((c) => `${c.kind} ${c.path}`).join(", ");
        return { type: "assistant", blocks: [{ type: "tool_use", id: item.id ?? `codex-${Date.now()}`, name: "file_change", input: { files } }] };
      }
      if (item.type === "reasoning" && item.text) {
        return { type: "assistant", blocks: [{ type: "thinking", text: item.text }] };
      }
      return null;
    }

    case "turn.completed": {
      const { input_tokens, cached_input_tokens, output_tokens } = event.usage;
      const cost = calcCost(model, input_tokens ?? 0, cached_input_tokens ?? 0, output_tokens ?? 0);
      return {
        type: "result",
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
      if (resetAt) return { type: "rate_limit", status: "rejected", resetAt };
      return { type: "error", detail: msg };
    }

    case "error": {
      const detail = String(event.message || JSON.stringify(event));
      const resetAt = parseRateLimitReset(detail);
      if (resetAt) return { type: "rate_limit", status: "rejected", resetAt };
      return { type: "error", detail };
    }

    default:
      return null;
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
      for await (const event of streamed.events) {
        const mapped = mapThreadEvent(event, model);
        if (mapped) yield mapped;
      }
    })();

    return {
      events,
      // In-process SDK — see claude.ts for rationale.
      pid: process.pid,
      async abort() {
        abortController.abort();
      },
      async send() {
        throw new Error("Codex multi-turn send not implemented");
      },
    };
  },

  async getUsage(): Promise<UsageInfo | null> {
    if (cachedUsage && Date.now() - cachedAt < CACHE_TTL_MS) {
      return cachedUsage;
    }

    const token = readAccessToken();
    if (!token) return cachedUsage;

    try {
      const res = await fetch(USAGE_API, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        logger.warn(`Codex usage API returned ${res.status}`);
        return cachedUsage;
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
      cachedUsage = { windows, updated_at: new Date().toISOString() };
      cachedAt = Date.now();
      return cachedUsage;
    } catch (err: any) {
      logger.warn(`Failed to fetch Codex usage: ${err.message}`);
      return cachedUsage;
    }
  },
};
