import { readFileSync } from "node:fs";
import { createLogger } from "../logger.js";
import { spawnAgent } from "./spawnHelper.js";
import type { AgentEvent, AgentHandle, AgentProvider, ExecuteOpts } from "./types.js";

const logger = createLogger("gemini");

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

export function parseEvent(raw: string): AgentEvent | null {
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return null;
  }

  if (event.type === "message" && event.role === "assistant" && event.content) {
    return { type: "message", text: event.content };
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
    return { type: "result", cost, usage: event.stats };
  }

  if (event.type === "error" || event.status === "error") {
    const raw = event.message || event.error;
    const detail = typeof raw === "object" ? JSON.stringify(raw) : String(raw || JSON.stringify(event));
    return { type: "error", detail };
  }

  return null;
}

export function buildArgs(opts: ExecuteOpts): string[] {
  const systemPrompt = readSystemPrompt(opts.systemPromptFile);
  const args = ["--prompt", systemPrompt, "--output-format", "stream-json", "--yolo"];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  return args;
}

export function buildResumeArgs(model?: string): string[] {
  logger.warn("Gemini CLI does not support resume by session ID — resuming latest session");
  const args = ["--resume", "latest", "--prompt", "", "--output-format", "stream-json", "--yolo"];
  if (model) {
    args.push("--model", model);
  }
  return args;
}

export const geminiProvider: AgentProvider = {
  name: "gemini",
  label: "Gemini CLI",

  execute(opts: ExecuteOpts): Promise<AgentHandle> {
    const args = opts.resume ? buildResumeArgs(opts.model) : buildArgs(opts);
    return Promise.resolve(
      spawnAgent({
        command: "gemini",
        args,
        cwd: opts.cwd,
        env: opts.env,
        input: opts.taskContext,
        parseEvent,
      }),
    );
  },
};
