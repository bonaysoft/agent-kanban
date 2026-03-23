-- Add 'rejected' to task_logs action CHECK constraint
-- SQLite doesn't support ALTER CHECK, so recreate the table

CREATE TABLE task_logs_new (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    TEXT,
  session_id  TEXT,
  action      TEXT NOT NULL CHECK(action IN (
    'created', 'claimed', 'moved', 'commented', 'completed',
    'assigned', 'released', 'timed_out', 'cancelled', 'rejected', 'review_requested'
  )),
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO task_logs_new SELECT * FROM task_logs;
DROP TABLE task_logs;
ALTER TABLE task_logs_new RENAME TO task_logs;

CREATE INDEX idx_task_logs_task_id ON task_logs(task_id);
CREATE INDEX idx_task_logs_created_at ON task_logs(created_at);
