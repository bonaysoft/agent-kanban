import type { AgentRuntime, UsageInfo } from "@agent-kanban/shared";

export type { UsageInfo, UsageWindow } from "@agent-kanban/shared";

export interface SpawnOpts {
  sessionId: string;
  systemPromptFile?: string;
  model?: string;
}

export type AgentEvent =
  | { type: "message"; text: string }
  | { type: "result"; cost?: number; usage?: Record<string, any> }
  | { type: "rate_limit"; resetAt: string }
  | { type: "error"; code?: string; detail: string };

export interface AgentProvider {
  readonly name: AgentRuntime;
  readonly label: string;
  readonly command: string;

  buildArgs(opts: SpawnOpts): string[];
  buildResumeArgs(sessionId: string, model?: string): string[];
  parseEvent(raw: string): AgentEvent | null;
  buildInput(taskContext: string): string;
  getUsage?(): Promise<UsageInfo | null>;
}
