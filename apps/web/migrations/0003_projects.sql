-- Agent Kanban v1.3: projects + resources, task project→project_id

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_projects_name ON projects(name);

CREATE TABLE project_resources (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK(type IN ('git_repo')),
  name        TEXT NOT NULL,
  uri         TEXT NOT NULL,
  config      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_project_resources_project ON project_resources(project_id);

-- Recreate tasks: replace project TEXT with project_id TEXT
CREATE TABLE tasks_v3 (
  id          TEXT PRIMARY KEY,
  column_id   TEXT NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  labels      TEXT,
  priority    TEXT CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  created_by  TEXT,
  assigned_to TEXT,
  result      TEXT,
  pr_url      TEXT,
  input       TEXT,
  depends_on  TEXT,
  created_from TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tasks_v3 (id, column_id, title, description, project_id, labels, priority, created_by, assigned_to, result, pr_url, input, depends_on, created_from, position, created_at, updated_at)
  SELECT id, column_id, title, description, NULL, labels, priority, created_by, assigned_to, result, pr_url, input, depends_on, created_from, position, created_at, updated_at FROM tasks;

DROP TABLE tasks;
ALTER TABLE tasks_v3 RENAME TO tasks;

CREATE INDEX idx_tasks_column ON tasks(column_id);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_created_from ON tasks(created_from);
