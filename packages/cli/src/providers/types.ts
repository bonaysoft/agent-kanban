import type { AgentRuntime, UsageInfo, UsageWindow } from "@agent-kanban/shared";

export type { AgentRuntime, UsageInfo, UsageWindow };

export interface ExecuteOpts {
  sessionId: string;
  cwd: string;
  env: Record<string, string>;
  taskContext: string;
  systemPromptFile?: string;
  model?: string;
  resume?: boolean;
}

export type AgentEvent =
  | { type: "message"; text: string }
  | { type: "result"; cost?: number; usage?: Record<string, any> }
  | { type: "rate_limit"; resetAt: string; rateLimitType?: string; utilization?: number }
  | { type: "error"; code?: string; detail: string };

export interface AgentHandle {
  events: AsyncIterable<AgentEvent>;
  abort(): Promise<void>;
  pid: number | null;
  send(message: string): Promise<void>;
}

export interface AgentProvider {
  readonly name: AgentRuntime;
  readonly label: string;
  execute(opts: ExecuteOpts): Promise<AgentHandle>;
  getUsage?(): Promise<UsageInfo | null>;
}
