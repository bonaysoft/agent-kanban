// Gemini CLI provider — handles Gemini CLI spawning and event parsing
import { readFileSync } from "node:fs";
import { createLogger } from "../logger.js";
import type { AgentEvent, AgentProvider, SpawnOpts } from "./types.js";

const logger = createLogger("gemini");

function readSystemPrompt(filePath?: string): string {
  if (!filePath) return "";
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

export const geminiProvider: AgentProvider = {
  name: "gemini",
  label: "Gemini CLI",
  command: "gemini",

  buildArgs(opts: SpawnOpts): string[] {
    const systemPrompt = readSystemPrompt(opts.systemPromptFile);
    const args = ["--prompt", systemPrompt, "--output-format", "stream-json", "--yolo"];
    return args;
  },

  buildResumeArgs(_sessionId: string): string[] {
    logger.warn("Gemini CLI does not support resume by session ID — resuming latest session");
    return ["--resume", "latest", "--prompt", "", "--output-format", "stream-json", "--yolo"];
  },

  parseEvent(raw: string): AgentEvent | null {
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
      return {
        type: "result",
        usage: event.stats,
      };
    }

    if (event.type === "error" || event.status === "error") {
      const detail = event.message || event.error || JSON.stringify(event);
      return { type: "error", detail: String(detail) };
    }

    return null;
  },

  buildInput(taskContext: string): string {
    return taskContext;
  },
};
