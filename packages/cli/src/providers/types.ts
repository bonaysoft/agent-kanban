import type { AgentEvent, AgentRuntime, ContentBlock, UsageInfo, UsageWindow } from "@agent-kanban/shared";

export type { AgentEvent, AgentRuntime, ContentBlock, UsageInfo, UsageWindow };

export interface ExecuteOpts {
  sessionId: string;
  cwd: string;
  env: Record<string, string>;
  taskContext: string;
  systemPromptFile?: string;
  model?: string;
  resume?: boolean;
}

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
