export interface Board {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Column {
  id: string;
  board_id: string;
  name: string;
  position: number;
}

export interface Task {
  id: string;
  column_id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  labels: string | null; // JSON array stored as TEXT
  priority: Priority | null;
  created_by: string | null;
  assigned_to: string | null;
  result: string | null;
  pr_url: string | null;
  input: string | null; // JSON object stored as TEXT
  depends_on: string | null; // JSON array of task IDs stored as TEXT
  created_from: string | null; // Parent task ID
  position: number;
  created_at: string;
  updated_at: string;
  blocked?: boolean; // Computed, not stored
  project_name?: string; // Joined from projects table
}

export interface TaskWithMeta extends Task {
  column_name: string;
  duration_minutes: number | null;
  agent_name: string | null;
}

export interface TaskLog {
  id: string;
  task_id: string;
  agent_id: string | null;
  action: TaskAction;
  detail: string | null;
  created_at: string;
}

export type AgentStatus = "idle" | "working" | "offline";

export interface Agent {
  id: string;
  machine_id: string;
  name: string;
  role_id: string | null;
  status: AgentStatus;
  created_at: string;
}

export interface AgentWithActivity extends Agent {
  last_active_at: string | null;
  task_count: number;
}

export interface ApiKey {
  id: string;
  key_hash: string;
  name: string | null;
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

export interface BoardWithColumns extends Board {
  columns: ColumnWithTasks[];
}

export interface ColumnWithTasks extends Column {
  tasks: Task[];
}

export interface TaskWithLogs extends Task {
  logs: TaskLog[];
  duration_minutes: number | null;
}

export type MessageRole = "human" | "agent";

export interface Message {
  id: string;
  task_id: string;
  agent_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

export interface Project {
  id: string;
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

export interface ClaimTaskInput {
  agent_id?: string;
}

export interface CompleteTaskInput {
  result?: string;
  pr_url?: string;
  agent_id?: string;
}

export interface CreateBoardInput {
  name: string;
}
