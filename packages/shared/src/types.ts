// ─── Board ───

export type BoardType = "dev" | "ops";

export const BOARD_TYPES: readonly BoardType[] = ["dev", "ops"] as const;

export function isBoardType(value: string): value is BoardType {
  return BOARD_TYPES.includes(value as BoardType);
}

export interface Board {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  type: BoardType;
  visibility: "private" | "public";
  share_slug: string | null;
  created_at: string;
  updated_at: string;
}

export interface BoardWithTasks extends Board {
  tasks: Task[];
}

// ─── Task ───

export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "cancelled";

export interface Task {
  id: string;
  board_id: string;
  seq: number;
  status: TaskStatus;
  title: string;
  description: string | null;
  repository_id: string | null;
  labels: string[] | null;
  priority: Priority | null;
  created_by: string | null;
  assigned_to: string | null;
  result: string | null;
  pr_url: string | null;
  input: Record<string, unknown> | null;
  created_from: string | null;
  scheduled_at: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  blocked?: boolean;
  repository_name?: string;
  agent_name?: string;
  agent_public_key?: string | null;
  board_type?: BoardType;
}

export interface TaskWithMeta extends Task {
  duration_minutes: number | null;
  subtask_count: number;
  depends_on: string[];
}

export interface TaskWithNotes extends TaskWithMeta {
  notes: TaskAction[];
}

export type TaskActionType =
  | "created"
  | "claimed"
  | "moved"
  | "commented"
  | "completed"
  | "assigned"
  | "released"
  | "timed_out"
  | "cancelled"
  | "rejected"
  | "review_requested";

export type ActorType = "user" | "machine" | "agent:worker" | "agent:leader";

export interface TaskAction {
  id: string;
  task_id: string;
  actor_type: ActorType;
  actor_id: string;
  actor_name?: string | null;
  actor_public_key?: string | null;
  action: TaskActionType;
  detail: string | null;
  created_at: string;
}

export interface BoardAction extends TaskAction {
  agent_kind?: AgentKind | null;
}

export type Priority = "low" | "medium" | "high" | "urgent";

// ─── Machine ───

export type MachineStatus = "online" | "offline";

export interface UsageWindow {
  runtime: AgentRuntime;
  label: string;
  utilization: number;
  resets_at: string;
}

export interface UsageInfo {
  windows: UsageWindow[];
  updated_at: string;
}

export interface Machine {
  id: string;
  owner_id: string;
  name: string;
  status: MachineStatus;
  os: string;
  version: string;
  runtimes: string[];
  usage_info: UsageInfo | null;
  last_heartbeat_at: string | null;
  created_at: string;
}

export interface MachineWithAgents extends Machine {
  session_count: number;
  active_session_count: number;
}

// ─── Agent ───

export type AgentStatus = "online" | "offline";
export type AgentKind = "worker" | "leader";
export type AgentRuntime = "claude" | "codex" | "gemini";

export const AGENT_RUNTIMES: readonly AgentRuntime[] = ["claude", "codex", "gemini"] as const;

export const RUNTIME_LABELS: Record<AgentRuntime, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  gemini: "Gemini CLI",
};

const RUNTIME_ALIASES: Record<string, AgentRuntime> = {
  "claude-code": "claude",
  "codex-cli": "codex",
};

export function normalizeRuntime(runtime: string): AgentRuntime {
  return RUNTIME_ALIASES[runtime] ?? (runtime as AgentRuntime);
}

export interface Agent {
  id: string;
  owner_id: string;
  name: string;
  bio: string | null;
  soul: string | null;
  role: string | null;
  kind: AgentKind;
  handoff_to: string[] | null;
  runtime: AgentRuntime;
  model: string | null;
  skills: string[] | null;
  public_key: string;
  fingerprint: string;
  gpg_subkey_id: string | null;
  builtin: number;
  created_at: string;
  updated_at: string;
}

export interface AgentWithActivity extends Agent {
  status: AgentStatus;
  last_active_at: string | null;
  task_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_micro_usd: number;
}

// ─── Agent Session ───

export type AgentSessionStatus = "active" | "closed";

export interface AgentSession {
  id: string;
  agent_id: string;
  machine_id: string;
  status: AgentSessionStatus;
  public_key: string;
  delegation_proof: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_micro_usd: number;
  created_at: string;
  closed_at: string | null;
}

export interface AgentSessionWithMachine extends AgentSession {
  machine_name: string;
}

// ─── Repository ───

export interface Repository {
  id: string;
  owner_id: string;
  name: string;
  url: string;
  created_at: string;
  task_count?: number;
}

// ─── Message ───

export type SenderType = "user" | "agent";

export interface Message {
  id: string;
  task_id: string;
  sender_type: SenderType;
  sender_id: string;
  content: string;
  created_at: string;
}

// ─── API ───

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  repository_id?: string;
  labels?: string[];
  priority?: Priority;
  input?: Record<string, unknown>;
  board_id?: string;
  agent_id?: string;
  depends_on?: string[];
  created_from?: string;
  scheduled_at?: string;
}

export interface AssignTaskInput {
  agent_id: string;
}

export interface CompleteTaskInput {
  result?: string;
  pr_url?: string;
  agent_id?: string;
}

export interface CreateAgentInput {
  name: string;
  bio?: string;
  soul?: string;
  role?: string;
  kind?: AgentKind;
  handoff_to?: string[];
  runtime: AgentRuntime;
  model?: string;
  skills?: string[];
}

export interface CreateSessionInput {
  session_id: string;
  session_public_key: string;
}

export interface SessionUsageInput {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_micro_usd: number;
}

export interface CreateBoardInput {
  name: string;
  description?: string;
  type: BoardType;
}

export interface CreateRepositoryInput {
  name: string;
  url: string;
}
