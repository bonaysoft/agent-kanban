-- Add "In Review" and "Cancelled" columns to existing boards, expand task_logs actions

-- Add new columns to every existing board
INSERT INTO columns (id, board_id, name, position)
  SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
         b.id, 'In Review', 2
  FROM boards b
  WHERE NOT EXISTS (SELECT 1 FROM columns c WHERE c.board_id = b.id AND c.name = 'In Review');

INSERT INTO columns (id, board_id, name, position)
  SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
         b.id, 'Cancelled', 4
  FROM boards b
  WHERE NOT EXISTS (SELECT 1 FROM columns c WHERE c.board_id = b.id AND c.name = 'Cancelled');

-- Shift existing column positions: Done moves from 2 → 3
UPDATE columns SET position = 3 WHERE name = 'Done';
UPDATE columns SET position = 4 WHERE name = 'Cancelled';

-- Recreate task_logs with expanded CHECK constraint (SQLite can't ALTER CHECK)
CREATE TABLE task_logs_v3 (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_id    TEXT,
  action      TEXT NOT NULL CHECK(action IN ('created', 'claimed', 'moved', 'commented', 'completed', 'assigned', 'released', 'timed_out', 'cancelled', 'review_requested')),
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO task_logs_v3 (id, task_id, agent_id, action, detail, created_at)
  SELECT id, task_id, agent_id, action, detail, created_at FROM task_logs;

DROP TABLE task_logs;
ALTER TABLE task_logs_v3 RENAME TO task_logs;

CREATE INDEX idx_task_logs_task ON task_logs(task_id);
