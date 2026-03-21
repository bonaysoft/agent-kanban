// ─── Board ───

export interface Board {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
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
  status: TaskStatus;
  title: string;
  description: string | null;
  repository_id: string | null;
  labels: string | null;
  priority: Priority | null;
  created_by: string | null;
  assigned_to: string | null;
  result: string | null;
  pr_url: string | null;
  input: string | null;
  created_from: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  blocked?: boolean;
  repository_name?: string;
  agent_name?: string;
}

export interface TaskWithMeta extends Task {
  duration_minutes: number | null;
  subtask_count: number;
  depends_on: string[];
}

export interface TaskWithLogs extends TaskWithMeta {
  logs: TaskLog[];
}

export interface TaskLog {
  id: string;
  task_id: string;
  agent_id: string | null;
  action: TaskAction;
  detail: string | null;
  created_at: string;
}

export type Priority = "low" | "medium" | "high" | "urgent";

export type TaskAction =
  | "created"
  | "claimed"
  | "moved"
  | "commented"
  | "completed"
  | "assigned"
  | "released"
  | "timed_out"
  | "cancelled"
  | "review_requested";

// ─── Machine ───

export type MachineStatus = "online" | "offline";

export interface Machine {
  id: string;
  owner_id: string;
  name: string;
  status: MachineStatus;
  os: string | null;
  version: string | null;
  runtimes: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
}

export interface MachineWithAgents extends Machine {
  agent_count: number;
  active_agent_count: number;
}

// ─── Agent ───

export type AgentStatus = "idle" | "working" | "offline";

export interface Agent {
  id: string;
  machine_id: string;
  name: string;
  role_id: string | null;
  status: AgentStatus;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_micro_usd: number;
  created_at: string;
}

export interface AgentWithActivity extends Agent {
  last_active_at: string | null;
  task_count: number;
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

export type MessageRole = "human" | "agent";

export interface Message {
  id: string;
  task_id: string;
  agent_id: string;
  role: MessageRole;
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
}

export interface AssignTaskInput {
  agent_id: string;
}

export interface CompleteTaskInput {
  result?: string;
  pr_url?: string;
  agent_id?: string;
}

export interface CreateBoardInput {
  name: string;
  description?: string;
}

export interface CreateRepositoryInput {
  name: string;
  url: string;
}
