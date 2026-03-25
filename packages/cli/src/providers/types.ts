export interface UsageWindow {
  utilization: number;
  resets_at: string;
}

export interface UsageInfo {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
  seven_day_sonnet?: UsageWindow;
  seven_day_opus?: UsageWindow;
  updated_at: string;
}

export interface SpawnOpts {
  sessionId: string;
  systemPromptFile?: string;
}

export type AgentEvent =
  | { type: "message"; text: string }
  | { type: "result"; cost?: number; usage?: Record<string, any> }
  | { type: "rate_limit"; resetAt: string }
  | { type: "error"; code?: string; detail: string };

export interface AgentProvider {
  readonly name: string;
  readonly label: string;
  readonly command: string;

  buildArgs(opts: SpawnOpts): string[];
  buildResumeArgs(sessionId: string): string[];
  parseEvent(raw: string): AgentEvent | null;
  buildInput(taskContext: string): string;
  getUsage?(): Promise<UsageInfo | null>;
}
