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

/**
 * Uniform contract for every agent provider — SDK-based or process-based.
 *
 * Iterator termination semantics (both providers must conform):
 *   - Normal completion: iterator ends cleanly, no throw
 *   - Crash / internal failure: iterator throws (classified at boundary)
 *   - External abort(): iterator ends cleanly (abort is idempotent)
 *
 * Provider internals (process spawning, pipes, signals, zombie reaping,
 * abort idempotency) are fully encapsulated inside the provider. The daemon
 * layer never touches OS process concepts.
 */
export interface AgentHandle {
  events: AsyncIterable<AgentEvent>;
  abort(): Promise<void>;
  send(message: string): Promise<void>;
}

export interface AgentProvider {
  readonly name: AgentRuntime;
  readonly label: string;
  execute(opts: ExecuteOpts): Promise<AgentHandle>;
  getUsage?(): Promise<UsageInfo | null>;
}
