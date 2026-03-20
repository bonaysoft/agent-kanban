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
  project: string | null;
  labels: string | null; // JSON array stored as TEXT
  priority: Priority | null;
  created_by: string | null;
  assigned_to: string | null;
  result: string | null;
  pr_url: string | null;
  input: string | null; // JSON object stored as TEXT
  position: number;
  created_at: string;
  updated_at: string;
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

export interface Agent {
  id: string;
  machine_id: string;
  name: string;
  role_id: string | null;
  created_at: string;
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
  | "completed";

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

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  project?: string;
  labels?: string[];
  priority?: Priority;
  input?: Record<string, unknown>;
  board_id?: string;
  agent_name?: string;
}

export interface ClaimTaskInput {
  agent_name?: string;
}

export interface CompleteTaskInput {
  result?: string;
  pr_url?: string;
  agent_name?: string;
}

export interface CreateBoardInput {
  name: string;
}
