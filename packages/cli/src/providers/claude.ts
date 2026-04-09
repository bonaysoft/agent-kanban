import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { SubtaskStatus } from "@agent-kanban/shared";
import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "../logger.js";
import type { AgentEvent, AgentHandle, AgentProvider, ContentBlock, ExecuteOpts, UsageInfo, UsageWindow } from "./types.js";

const SUBTASK_STATUSES: readonly SubtaskStatus[] = ["completed", "failed", "stopped"] as const;

function coerceSubtaskStatus(raw: unknown): SubtaskStatus {
  return (SUBTASK_STATUSES as readonly string[]).includes(raw as string) ? (raw as SubtaskStatus) : "stopped";
}

const logger = createLogger("claude");

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const USAGE_API = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 5 * 60 * 1000;

const CLAUDE_WINDOW_LABELS: Record<string, string> = {
  five_hour: "5-Hour",
  seven_day: "7-Day",
  seven_day_sonnet: "7-Day Sonnet",
  seven_day_opus: "7-Day Opus",
};

let cachedUsage: UsageInfo | null = null;
let cachedAt = 0;
let cachedToken: string | null = null;

function parseToken(raw: string): string | null {
  const creds = JSON.parse(raw);
  return creds.claudeAiOauth?.accessToken || null;
}

function readOAuthToken(): string | null {
  if (cachedToken) return cachedToken;
  try {
    if (platform() === "darwin") {
      const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', { stdio: ["pipe", "pipe", "pipe"] })
        .toString()
        .trim();
      cachedToken = parseToken(raw);
    } else {
      cachedToken = parseToken(readFileSync(CREDENTIALS_PATH, "utf-8"));
    }
    return cachedToken;
  } catch {
    return null;
  }
}

/** Stamp `parent_id` onto a block only when set, to keep wire format clean. */
function withParent<T extends ContentBlock>(block: T, parentId: string | null | undefined): T {
  return parentId ? ({ ...block, parent_id: parentId } as T) : block;
}

/** Map a single SDK message to an AgentEvent (or null to skip). */
function mapContentBlock(block: SDKAssistantMessage["message"]["content"][number], parentId: string | null | undefined): ContentBlock | null {
  switch (block.type) {
    case "thinking":
      return block.thinking ? withParent({ type: "thinking", text: block.thinking }, parentId) : null;
    case "tool_use":
      return withParent({ type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> }, parentId);
    case "text":
      return block.text ? withParent({ type: "text", text: block.text }, parentId) : null;
    default:
      return null;
  }
}

function mapToolResult(msg: SDKUserMessage): ContentBlock[] {
  const content = msg.message.content;
  if (typeof content === "string") return [];
  const parentId = msg.parent_tool_use_id;
  const blocks: ContentBlock[] = [];
  for (const block of content) {
    if (block.type === "tool_result") {
      let output: string | undefined;
      if (typeof block.content === "string") {
        output = block.content;
      } else if (Array.isArray(block.content)) {
        output = block.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");
      }
      blocks.push(withParent({ type: "tool_result", tool_use_id: block.tool_use_id, output, error: block.is_error }, parentId));
    }
  }
  return blocks;
}

/**
 * Map SDK system task_* messages → our subtask.* events.
 * SDK subtypes: task_started | task_progress | task_notification.
 */
function mapTaskSystemMessage(msg: any): AgentEvent | null {
  const tid = msg.tool_use_id;
  if (!tid) return null;
  switch (msg.subtype) {
    case "task_started":
      return { type: "subtask.start", tool_use_id: tid, description: msg.description, kind: msg.task_type };
    case "task_progress":
      return {
        type: "subtask.progress",
        tool_use_id: tid,
        summary: msg.summary,
        last_tool: msg.last_tool_name,
        tokens: msg.usage?.total_tokens,
        duration_ms: msg.usage?.duration_ms,
      };
    case "task_notification":
      return {
        type: "subtask.end",
        tool_use_id: tid,
        status: coerceSubtaskStatus(msg.status),
        summary: msg.summary,
        tokens: msg.usage?.total_tokens,
        duration_ms: msg.usage?.duration_ms,
      };
    default:
      return null;
  }
}

/** Map a single SDK message to an AgentEvent (1:1, used for history fallback). */
export function mapSDKMessage(msg: SDKMessage): AgentEvent | null {
  switch (msg.type) {
    case "rate_limit_event": {
      const info = msg.rate_limit_info;
      if (info.status === "rejected" || info.status === "allowed") {
        const resetAt = info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : undefined;
        const overage = info.overageStatus
          ? {
              status: info.overageStatus as "allowed" | "rejected",
              resetAt: info.overageResetsAt ? new Date(info.overageResetsAt * 1000).toISOString() : undefined,
            }
          : undefined;
        return {
          type: "turn.rate_limit",
          status: info.status,
          resetAt,
          rateLimitType: info.rateLimitType,
          isUsingOverage: info.isUsingOverage,
          overage,
        };
      }
      if (info.status === "allowed_warning") {
        logger.warn(`Rate limit warning: ${info.rateLimitType} at ${((info.utilization ?? 0) * 100).toFixed(0)}%`);
      }
      return null;
    }

    case "assistant": {
      if (msg.error === "rate_limit") {
        return { type: "turn.rate_limit", status: "rejected", resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
      }
      if (msg.error) {
        const contentText = (msg.message?.content ?? [])
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join(" ")
          .slice(0, 500);
        const detail = contentText || msg.error;
        return { type: "turn.error", code: msg.error, detail };
      }
      const parentId = msg.parent_tool_use_id;
      const blocks = (msg.message.content ?? []).map((b) => mapContentBlock(b, parentId)).filter((b): b is ContentBlock => b !== null);
      return blocks.length > 0 ? { type: "message", blocks } : null;
    }

    case "user": {
      const blocks = mapToolResult(msg);
      return blocks.length > 0 ? { type: "message", blocks } : null;
    }

    case "result": {
      const text = msg.subtype === "success" ? msg.result : undefined;
      return { type: "turn.end", text, cost: msg.total_cost_usd || 0, usage: msg.usage as Record<string, any> };
    }

    case "system":
      return mapTaskSystemMessage(msg);

    default:
      return null;
  }
}

/** Map a stream_event's content_block to a ContentBlock (or null to skip). */
function mapStreamBlock(block: { type: string; [k: string]: unknown }, parentId: string | null | undefined): ContentBlock | null {
  switch (block.type) {
    case "tool_use":
      return withParent(
        { type: "tool_use", id: block.id as string, name: block.name as string, input: block.input as Record<string, unknown> },
        parentId,
      );
    case "thinking":
      return block.thinking ? withParent({ type: "thinking", text: block.thinking as string }, parentId) : null;
    case "text":
      return block.text ? withParent({ type: "text", text: block.text as string }, parentId) : null;
    default:
      return null;
  }
}

/**
 * Streaming mapper: yields fine-grained events for real-time UI.
 * One turn.start per query() call. Blocks stream in between.
 * turn.end emitted when SDK yields `result`.
 */
export function* mapSDKMessageStream(msg: SDKMessage, turnOpen: { value: boolean }): Generator<AgentEvent> {
  if (msg.type === "stream_event") {
    const partial = msg as SDKPartialAssistantMessage;
    const evt = partial.event;
    if (evt.type === "content_block_start") {
      const block = mapStreamBlock(evt.content_block as unknown as { type: string; [k: string]: unknown }, partial.parent_tool_use_id);
      if (!block) return;

      // Only open a main turn for non-subtask blocks. Subtask blocks belong to
      // their parent Task tool card, not the main agent stream.
      if (!block.parent_id && !turnOpen.value) {
        yield { type: "turn.start" };
        turnOpen.value = true;
      }
      yield { type: "block.start", block };
    }
    return;
  }

  if (msg.type === "assistant") {
    const assistantMsg = msg as SDKAssistantMessage;
    if (assistantMsg.error) {
      if (turnOpen.value) {
        turnOpen.value = false;
      }
      const event = mapSDKMessage(msg);
      if (event) yield event;
      return;
    }

    // Internal API round-trip complete — emit block.done for each finalized block
    const parentId = assistantMsg.parent_tool_use_id;
    const blocks = (assistantMsg.message.content ?? []).map((b) => mapContentBlock(b, parentId)).filter((b): b is ContentBlock => b !== null);

    const hasMainBlock = blocks.some((b) => !b.parent_id);
    if (!turnOpen.value && hasMainBlock) {
      yield { type: "turn.start" };
      turnOpen.value = true;
    }

    for (const block of blocks) {
      yield { type: "block.done", block };
    }
    return;
  }

  if (msg.type === "user") {
    // Tool results — emit block.done, turn stays open (more API calls may follow)
    const blocks = mapToolResult(msg as SDKUserMessage);
    for (const block of blocks) {
      yield { type: "block.done", block };
    }
    return;
  }

  if (msg.type === "result") {
    // Turn complete — emit turn.end with cost
    turnOpen.value = false;
    const text = (msg as any).subtype === "success" ? (msg as any).result : undefined;
    yield { type: "turn.end", text, cost: (msg as any).total_cost_usd || 0, usage: (msg as any).usage };
    return;
  }

  // Everything else (rate_limit_event, etc.) — delegate
  const event = mapSDKMessage(msg);
  if (event) yield event;
}

export const claudeProvider: AgentProvider = {
  name: "claude",
  label: "Claude Code",

  execute(opts: ExecuteOpts): Promise<AgentHandle> {
    const systemPrompt = opts.systemPromptFile ? readFileSync(opts.systemPromptFile, "utf-8") : undefined;
    const abortController = new AbortController();

    const q = query({
      prompt: opts.taskContext,
      options: {
        sessionId: opts.resume ? undefined : opts.sessionId,
        resume: opts.resume ? opts.sessionId : undefined,
        cwd: opts.cwd,
        env: opts.env,
        systemPrompt,
        model: opts.model,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        abortController,
        includePartialMessages: true,
      },
    });

    const events = (async function* () {
      const turnOpen = { value: false };
      for await (const msg of q) {
        yield* mapSDKMessageStream(msg, turnOpen);
      }
    })();

    return Promise.resolve({
      events,
      // In-process SDK — no child process. Report daemon pid so liveness checks
      // (isPidAlive) treat sessions as alive while this daemon is running, and
      // correctly identify them as stale only after a daemon restart.
      pid: process.pid,
      async abort() {
        q.close();
      },
      async send(message: string) {
        const userMsg = async function* () {
          yield {
            type: "user" as const,
            message: { role: "user" as const, content: message },
            parent_tool_use_id: null,
          };
        };
        await q.streamInput(userMsg());
      },
    });
  },

  async getUsage(): Promise<UsageInfo | null> {
    if (cachedUsage && Date.now() - cachedAt < CACHE_TTL_MS) {
      return cachedUsage;
    }

    const token = readOAuthToken();
    if (!token) return cachedUsage;

    try {
      const res = await fetch(USAGE_API, {
        headers: {
          Authorization: `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        logger.warn(`Usage API returned ${res.status}`);
        return cachedUsage;
      }

      const data = (await res.json()) as Record<string, { utilization: number; resets_at: string }>;
      const windows: UsageWindow[] = Object.entries(CLAUDE_WINDOW_LABELS)
        .filter(([key]) => data[key])
        .map(([key, label]) => ({ runtime: "claude", label, ...data[key] }));
      cachedUsage = { windows, updated_at: new Date().toISOString() };
      cachedAt = Date.now();
      return cachedUsage;
    } catch (err: any) {
      logger.warn(`Failed to fetch usage: ${err.message}`);
      return cachedUsage;
    }
  },
};
