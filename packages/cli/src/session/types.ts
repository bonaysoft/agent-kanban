import type { AgentRuntime } from "@agent-kanban/shared";
import type { WorkspaceInfo } from "../types.js";

export type SessionStatus = "active" | "rate_limited" | "in_review";

export interface SessionFile {
  type: "worker" | "leader";
  agentId: string;
  sessionId: string;
  pid: number;
  runtime: AgentRuntime;
  startedAt: number;
  apiUrl: string;
  privateKeyJwk: JsonWebKey;
  // worker fields
  taskId?: string;
  workspace?: WorkspaceInfo;
  status?: SessionStatus;
  model?: string;
  gpgSubkeyId?: string | null;
  agentUsername?: string;
  agentName?: string;
}

export interface SessionFilter {
  type?: "worker" | "leader";
  status?: SessionStatus;
}
