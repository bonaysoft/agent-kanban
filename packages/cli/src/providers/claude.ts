import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { SDKAssistantMessage, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createLogger } from "../logger.js";
import type { AgentEvent, AgentHandle, AgentProvider, ContentBlock, ExecuteOpts, UsageInfo, UsageWindow } from "./types.js";

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

/** Map a single SDK message to an AgentEvent (or null to skip). */
function mapContentBlock(block: SDKAssistantMessage["message"]["content"][number]): ContentBlock | null {
  switch (block.type) {
    case "thinking":
      return block.thinking ? { type: "thinking", text: block.thinking } : null;
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> };
    case "text":
      return block.text ? { type: "text", text: block.text } : null;
    default:
      return null;
  }
}

function mapToolResult(msg: SDKUserMessage): ContentBlock[] {
  const content = msg.message.content;
  if (typeof content === "string") return [];
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
      blocks.push({ type: "tool_result", tool_use_id: block.tool_use_id, output, error: block.is_error });
    }
  }
  return blocks;
}

/** Map a single SDK message to an AgentEvent (1:1). */
export function mapSDKMessage(msg: SDKMessage): AgentEvent | null {
  switch (msg.type) {
    case "rate_limit_event": {
      const info = msg.rate_limit_info;
      if (info.status === "rejected") {
        const resetAt = info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : new Date(Date.now() + 60 * 60 * 1000).toISOString();
        return { type: "rate_limit", resetAt, rateLimitType: info.rateLimitType, utilization: info.utilization };
      }
      if (info.status === "allowed_warning") {
        logger.warn(`Rate limit warning: ${info.rateLimitType} at ${((info.utilization ?? 0) * 100).toFixed(0)}%`);
      }
      return null;
    }

    case "assistant": {
      if (msg.error === "rate_limit") {
        return { type: "rate_limit", resetAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() };
      }
      if (msg.error) {
        return { type: "error", code: msg.error, detail: msg.error };
      }
      const blocks = (msg.message.content ?? []).map(mapContentBlock).filter((b): b is ContentBlock => b !== null);
      return blocks.length > 0 ? { type: "assistant", blocks } : null;
    }

    case "user": {
      const blocks = mapToolResult(msg);
      return blocks.length > 0 ? { type: "assistant", blocks } : null;
    }

    case "result": {
      const text = msg.subtype === "success" ? msg.result : undefined;
      return { type: "result", text, cost: msg.total_cost_usd || 0, usage: msg.usage as Record<string, any> };
    }

    default:
      return null;
  }
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
      },
    });

    const events = (async function* () {
      for await (const msg of q) {
        const event = mapSDKMessage(msg);
        if (event) yield event;
      }
    })();

    return Promise.resolve({
      events,
      pid: null,
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
