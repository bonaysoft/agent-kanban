import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type BashArgs, type GlobArgs, type GrepArgs, type ReadArgs, ToolName, type WriteArgs } from "@agent-kanban/shared";
import { spawnAgent } from "./spawnHelper.js";
import type { AgentEvent, AgentHandle, AgentProvider, ContentBlock, ExecuteOpts, HistoryEvent } from "./types.js";

const OAUTH_CREDS_PATH = join(homedir(), ".gemini", "oauth_creds.json");
const GEMINI_TMP_DIR = join(homedir(), ".gemini", "tmp");

/** Per 1M tokens, paid tier pricing */
const GEMINI_PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-3-flash-preview": { input: 0.5, output: 3.0 },
  "gemini-3.1-pro-preview": { input: 2.0, output: 12.0 },
  "gemini-3.1-flash-lite-preview": { input: 0.25, output: 1.5 },
};

function readSystemPrompt(filePath?: string): string {
  if (!filePath) return "";
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function buildPrompt(opts: ExecuteOpts): string {
  return [readSystemPrompt(opts.systemPromptFile), opts.taskContext].filter(Boolean).join("\n\n");
}

export function parseEvent(raw: string): AgentEvent | null {
  const event = parseJsonEvent(raw);
  if (!event) return null;

  if (event.type === "message" && event.role === "assistant") {
    return liveMessageEvent(event);
  }

  if (event.type === "tool_use") {
    const normalized = normalizeGeminiTool(event.tool_name ?? "tool", event.parameters ?? {});
    if (!normalized) return null;
    return {
      type: "message",
      blocks: [
        {
          type: "tool_use",
          id: event.tool_id ?? `${event.tool_name ?? "gemini"}-${event.timestamp ?? "tool"}`,
          name: normalized.name,
          input: normalized.input,
        },
      ],
    };
  }

  if (event.type === "tool_result") {
    return {
      type: "message",
      blocks: [
        {
          type: "tool_result",
          tool_use_id: event.tool_id ?? "",
          output: textFromContent(event.output ?? event.result ?? event.content) || String(event.status ?? "done"),
          error: event.status === "error",
        },
      ],
    };
  }

  if (event.type === "result") {
    let cost = 0;
    if (event.stats?.models) {
      for (const [model, usage] of Object.entries(event.stats.models)) {
        const pricing = GEMINI_PRICING[model];
        if (pricing) {
          const u = usage as { input_tokens: number; output_tokens: number };
          cost += (u.input_tokens * pricing.input + u.output_tokens * pricing.output) / 1_000_000;
        }
      }
    }
    return { type: "turn.end", cost, usage: event.stats };
  }

  if (event.type === "error" || event.status === "error") {
    const source = event.message || event.error;
    const detail = typeof source === "object" ? JSON.stringify(source) : String(source || JSON.stringify(event));
    return { type: "turn.error", detail };
  }

  return null;
}

function liveMessageEvent(event: any): AgentEvent | null {
  const blocks: ContentBlock[] = [];
  if (event.content) blocks.push({ type: "text", text: String(event.content) });

  for (const toolCall of event.toolCalls ?? event.tool_calls ?? []) {
    const normalized = normalizeGeminiTool(toolCall.name ?? toolCall.function?.name ?? "tool", toolCall.args ?? toolCall.function?.arguments ?? {});
    if (!normalized) continue;
    const id = toolCall.id ?? `${event.id ?? "gemini-live"}-tool`;
    blocks.push({ type: "tool_use", id, name: normalized.name, input: normalized.input });
    const result = toolCall.result ?? toolCall.response;
    if (result) blocks.push({ type: "tool_result", tool_use_id: id, output: textFromContent(result) || JSON.stringify(result) });
  }

  return blocks.length > 0 ? { type: "message", blocks } : null;
}

export function parseSessionId(raw: string): string | null {
  const event = parseJsonEvent(raw);
  return typeof event?.session_id === "string" ? event.session_id : null;
}

function parseJsonEvent(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    const jsonStart = raw.indexOf("{");
    if (jsonStart === -1) return null;
    return JSON.parse(raw.slice(jsonStart));
  }
}

export function buildArgs(opts: ExecuteOpts): string[] {
  const args = ["--prompt", buildPrompt(opts), "--output-format", "stream-json", "--yolo", "--skip-trust"];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  return args;
}

export function buildResumeArgs(sessionId: string, model?: string, prompt = ""): string[] {
  const args = ["--resume", sessionId, "--prompt", prompt, "--output-format", "stream-json", "--yolo", "--skip-trust"];
  if (model) {
    args.push("--model", model);
  }
  return args;
}

export function resolveGeminiCommand(env: NodeJS.ProcessEnv = process.env): string {
  if (!env.VOLTA_HOME) return "gemini";
  const voltaPackageBin = join(env.VOLTA_HOME, "tools", "image", "packages", "@google", "gemini-cli", "bin", "gemini");
  return existsSync(voltaPackageBin) ? voltaPackageBin : "gemini";
}

function findGeminiSessionFiles(sessionId: string): string[] {
  const shortId = sessionId.slice(0, 8);
  const matches: string[] = [];
  try {
    for (const project of readdirSync(GEMINI_TMP_DIR)) {
      const chatsDir = join(GEMINI_TMP_DIR, project, "chats");
      let files: string[];
      try {
        files = readdirSync(chatsDir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(`-${shortId}.jsonl`)) continue;
        const path = join(chatsDir, file);
        if (isGeminiSessionFile(path, sessionId)) matches.push(path);
      }
    }
  } catch {
    return [];
  }
  return matches.sort();
}

function isGeminiSessionFile(path: string, sessionId: string): boolean {
  const firstLine = readFileSync(path, "utf-8").split("\n", 1)[0];
  const header = JSON.parse(firstLine);
  return header.sessionId === sessionId;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) return String((part as { text?: unknown }).text ?? "");
      return "";
    })
    .filter(Boolean)
    .join("");
}

function eventFromRecord(record: any, id: string): AgentEvent | null {
  if (record.type === "user") {
    const text = textFromContent(record.content);
    return text ? { type: "message.user", text } : null;
  }
  if (record.type !== "gemini") return null;

  const blocks: ContentBlock[] = [];
  const text = textFromContent(record.content);
  if (text) blocks.push({ type: "text", text });
  for (const toolCall of record.toolCalls ?? []) {
    const normalized = normalizeGeminiTool(toolCall.name ?? "tool", toolCall.args ?? {});
    if (!normalized) continue;
    blocks.push({ type: "tool_use", id: toolCall.id ?? `${id}-tool`, name: normalized.name, input: normalized.input });
    if (toolCall.result)
      blocks.push({
        type: "tool_result",
        tool_use_id: toolCall.id ?? "",
        output: textFromContent(toolCall.result) || JSON.stringify(toolCall.result),
      });
  }
  return blocks.length > 0 ? { type: "message", blocks } : null;
}

function normalizeGeminiTool(name: string, rawArgs: Record<string, unknown>): { name: string; input: Record<string, unknown> } | null {
  switch (name) {
    case "run_shell_command": {
      const args: BashArgs = {
        command: String(rawArgs.command ?? ""),
        description: rawArgs.description === undefined ? undefined : String(rawArgs.description),
      };
      return { name: ToolName.Bash, input: args };
    }
    case "read_file": {
      const args: ReadArgs = {
        filePath: String(rawArgs.file_path ?? rawArgs.path ?? ""),
        offset: rawArgs.offset as number | undefined,
        limit: rawArgs.limit as number | undefined,
      };
      return { name: ToolName.Read, input: args };
    }
    case "list_directory": {
      const args: ReadArgs = { filePath: String(rawArgs.dir_path ?? rawArgs.path ?? "") };
      return { name: ToolName.Read, input: args };
    }
    case "write_file": {
      const args: WriteArgs = { filePath: String(rawArgs.file_path ?? rawArgs.path ?? ""), content: String(rawArgs.content ?? "") };
      return { name: ToolName.Write, input: args };
    }
    case "glob": {
      const args: GlobArgs = { pattern: String(rawArgs.pattern ?? ""), path: rawArgs.path as string | undefined };
      return { name: ToolName.Glob, input: args };
    }
    case "search_file_content": {
      const args: GrepArgs = { pattern: String(rawArgs.pattern ?? ""), path: rawArgs.path as string | undefined };
      return { name: ToolName.Grep, input: args };
    }
    case "google_web_search":
    case "web_search":
      return { name: ToolName.WebSearch, input: { query: String(rawArgs.query ?? "") } };
    case "activate_skill":
    case "update_topic":
      return null;
    default:
      return { name, input: rawArgs };
  }
}

function readJsonlHistory(file: string): HistoryEvent[] {
  const messages = new Map<string, any>();
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line);
    if (typeof record.$rewindTo === "string") {
      let deleting = false;
      for (const id of Array.from(messages.keys())) {
        if (id === record.$rewindTo) deleting = true;
        if (deleting) messages.delete(id);
      }
    } else if (typeof record.id === "string") {
      messages.set(record.id, record);
    }
  }
  return historyFromRecords(Array.from(messages.values()));
}

function historyFromRecords(records: any[]): HistoryEvent[] {
  return records.flatMap((record, index) => {
    const id = record.id ?? `gemini-hist-${index + 1}`;
    const event = eventFromRecord(record, id);
    return event ? [{ id, event, timestamp: record.timestamp ?? new Date().toISOString() }] : [];
  });
}

/** @internal Exported for tests only. */
export function readGeminiHistory(sessionId: string): HistoryEvent[] {
  return findGeminiSessionFiles(sessionId).flatMap(readJsonlHistory);
}

export const geminiProvider: AgentProvider = {
  name: "gemini",
  label: "Gemini CLI",

  async checkAvailability() {
    return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || existsSync(OAUTH_CREDS_PATH)
      ? { status: "ready" }
      : { status: "unauthorized", detail: "Gemini CLI is not authenticated" };
  },

  async execute(opts: ExecuteOpts): Promise<AgentHandle> {
    if (opts.resume && !opts.resumeToken) throw new Error("gemini: resume requested but no resumeToken provided");

    let resumeToken = opts.resumeToken;
    const args = opts.resume ? buildResumeArgs(opts.resumeToken!, opts.model, opts.taskContext) : buildArgs(opts);
    const handle = spawnAgent({
      command: resolveGeminiCommand(opts.env),
      args,
      cwd: opts.cwd,
      env: opts.env,
      onLine(raw) {
        resumeToken = parseSessionId(raw) ?? resumeToken;
      },
      parseEvent,
    });

    return {
      ...handle,
      getResumeToken() {
        return resumeToken;
      },
    };
  },

  async getHistory(_sessionId, resumeToken): Promise<HistoryEvent[]> {
    if (!resumeToken) return [];
    return readGeminiHistory(resumeToken);
  },
};
