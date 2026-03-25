import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createLogger } from "../logger.js";
import type { AgentEvent, AgentProvider, SpawnOpts, UsageInfo } from "./types.js";

const logger = createLogger("claude");

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const USAGE_API = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_CODES = new Set(["rate_limit_error", "overloaded_error"]);

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

function detectError(event: any): { code?: string; detail: string } | null {
  if (event.type !== "error" && !event.error) return null;

  let code: string | undefined;
  if (event.error && typeof event.error === "object") {
    code = event.error.type;
  }

  let detail: string | undefined;
  if (event.type === "assistant" && Array.isArray(event.message?.content)) {
    const textBlock = event.message.content.find((e: any) => e.type === "text" && e.text);
    if (textBlock?.text) detail = textBlock.text;
  }
  if (!detail) {
    detail = event.error?.message || (event.error !== "unknown" ? event.error : undefined) || event.message || JSON.stringify(event);
  }

  return { code, detail: String(detail) };
}

export const claudeProvider: AgentProvider = {
  name: "claude",
  label: "Claude Code",
  command: "claude",

  buildArgs(opts: SpawnOpts): string[] {
    const args = [
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
      "--session-id",
      opts.sessionId,
    ];
    if (opts.systemPromptFile) {
      args.push("--system-prompt-file", opts.systemPromptFile);
    }
    if (opts.model) {
      args.push("--model", opts.model);
    }
    return args;
  },

  buildResumeArgs(sessionId: string, model?: string): string[] {
    const args = [
      "--resume",
      sessionId,
      "--print",
      "--verbose",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
    ];
    if (model) {
      args.push("--model", model);
    }
    return args;
  },

  parseEvent(raw: string): AgentEvent | null {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return null;
    }

    // rate_limit_event
    if (event.type === "rate_limit_event") {
      const info = event.rate_limit_info;
      if (info && info.status !== "allowed") {
        const resetAt = new Date(info.resetsAt * 1000).toISOString();
        return { type: "rate_limit", resetAt };
      }
      return null;
    }

    // Error detection (covers all CLI error shapes)
    const err = detectError(event);
    if (err) {
      if (err.code && RATE_LIMIT_CODES.has(err.code)) {
        const resetAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
        return { type: "rate_limit", resetAt };
      }
      return { type: "error", code: err.code, detail: err.detail };
    }

    // Assistant message
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      const texts: string[] = [];
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) texts.push(block.text);
      }
      if (texts.length > 0) {
        return { type: "message", text: texts.join("\n") };
      }
    }

    // Result
    if (event.type === "result") {
      return {
        type: "result",
        cost: event.total_cost_usd || 0,
        usage: event.usage,
      };
    }

    return null;
  },

  buildInput(taskContext: string): string {
    return JSON.stringify({
      type: "user",
      message: { role: "user", content: taskContext },
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
      cachedUsage = {
        ...(data.five_hour && { five_hour: data.five_hour }),
        ...(data.seven_day && { seven_day: data.seven_day }),
        ...(data.seven_day_sonnet && { seven_day_sonnet: data.seven_day_sonnet }),
        ...(data.seven_day_opus && { seven_day_opus: data.seven_day_opus }),
        updated_at: new Date().toISOString(),
      };
      cachedAt = Date.now();
      return cachedUsage;
    } catch (err: any) {
      logger.warn(`Failed to fetch usage: ${err.message}`);
      return cachedUsage;
    }
  },
};
