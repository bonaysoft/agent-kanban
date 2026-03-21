-- Agent Kanban v2 schema
-- Auth tables (user, session, account, verification) managed by better-auth

-- Projects
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_projects_owner_name ON projects(owner_id, name);

-- Boards (1:1 with project)
CREATE TABLE boards (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_boards_project ON boards(project_id);

-- Repositories
CREATE TABLE repositories (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_repositories_project ON repositories(project_id);

-- Machines
CREATE TABLE machines (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  key_hash          TEXT NOT NULL,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'online',
  last_heartbeat_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_machines_owner ON machines(owner_id);

-- Agents
CREATE TABLE agents (
  id                    TEXT PRIMARY KEY,
  machine_id            TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  role_id               TEXT,
  status                TEXT NOT NULL DEFAULT 'idle',
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd        INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_agents_machine ON agents(machine_id);

-- Tasks
CREATE TABLE tasks (
  id           TEXT PRIMARY KEY,
  board_id     TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'todo'
               CHECK(status IN ('todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  title        TEXT NOT NULL,
  description  TEXT,
  repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
  labels       TEXT,
  priority     TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  created_by   TEXT,
  assigned_to  TEXT REFERENCES agents(id) ON DELETE SET NULL,
  result       TEXT,
  pr_url       TEXT,
  input        TEXT,
  created_from TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_board ON tasks(board_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_repository ON tasks(repository_id);
CREATE INDEX idx_tasks_created_from ON tasks(created_from);

-- Task dependencies (DAG)
CREATE TABLE task_dependencies (
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on),
  CHECK(task_id != depends_on)
);
CREATE INDEX idx_task_deps_depends ON task_dependencies(depends_on);

-- Task logs
CREATE TABLE task_logs (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    TEXT REFERENCES agents(id) ON DELETE SET NULL,
  action      TEXT NOT NULL CHECK(action IN (
    'created', 'claimed', 'moved', 'commented', 'completed',
    'assigned', 'released', 'timed_out', 'cancelled', 'review_requested'
  )),
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_task_logs_task ON task_logs(task_id);

-- Messages
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK(role IN ('human', 'agent')),
  content     TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_task ON messages(task_id, created_at);
