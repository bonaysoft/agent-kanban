-- Agent Kanban v1 schema

CREATE TABLE boards (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE columns (
  id          TEXT PRIMARY KEY,
  board_id    TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL
);

CREATE INDEX idx_columns_board ON columns(board_id);

CREATE TABLE api_keys (
  id          TEXT PRIMARY KEY,
  key_hash    TEXT NOT NULL,
  name        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE agents (
  id          TEXT PRIMARY KEY,
  machine_id  TEXT NOT NULL REFERENCES api_keys(id),
  name        TEXT NOT NULL,
  role_id     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_agents_machine ON agents(machine_id);
CREATE UNIQUE INDEX idx_agents_machine_name ON agents(machine_id, name);

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  column_id   TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  project     TEXT,
  labels      TEXT,
  priority    TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  created_by  TEXT,
  assigned_to TEXT,
  result      TEXT,
  pr_url      TEXT,
  input       TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tasks_column ON tasks(column_id);
CREATE INDEX idx_tasks_project ON tasks(project);

CREATE TABLE task_logs (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    TEXT,
  action      TEXT NOT NULL CHECK(action IN ('created', 'claimed', 'moved', 'commented', 'completed')),
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_task_logs_task ON task_logs(task_id);
