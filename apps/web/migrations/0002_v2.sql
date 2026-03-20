-- Agent Kanban v2: agent status, task dependencies, origin tracking, expanded actions

ALTER TABLE agents ADD COLUMN status TEXT NOT NULL DEFAULT 'idle';

ALTER TABLE tasks ADD COLUMN depends_on TEXT;
ALTER TABLE tasks ADD COLUMN created_from TEXT;

CREATE INDEX idx_tasks_created_from ON tasks(created_from);

-- Recreate task_logs with expanded CHECK constraint (SQLite can't ALTER CHECK)
CREATE TABLE task_logs_v2 (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    TEXT,
  action      TEXT NOT NULL CHECK(action IN ('created', 'claimed', 'moved', 'commented', 'completed', 'assigned', 'released', 'timed_out')),
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO task_logs_v2 (id, task_id, agent_id, action, detail, created_at)
  SELECT id, task_id, agent_id, action, detail, created_at FROM task_logs;

DROP TABLE task_logs;
ALTER TABLE task_logs_v2 RENAME TO task_logs;

CREATE INDEX idx_task_logs_task ON task_logs(task_id);
