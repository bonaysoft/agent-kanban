// ─── Board ───

export interface Board {
  id: string;
  owner_id: string;
  name: string;
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
  project_id: string | null;
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
  project_name?: string;
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
  key_hash: string;
  name: string;
  status: MachineStatus;
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

// ─── Project ───

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectResource {
  id: string;
  project_id: string;
  type: string;
  name: string;
  uri: string;
  config: string | null;
  created_at: string;
}

export interface ProjectWithResources extends Project {
  resources: ProjectResource[];
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

export interface CreateBoardInput {
  name: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  project_id?: string;
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

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface CreateResourceInput {
  type: string;
  name: string;
  uri: string;
  config?: string;
}
