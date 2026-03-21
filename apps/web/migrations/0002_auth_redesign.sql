-- Auth redesign: Better Auth API key plugin + clean machine table
-- API key table is managed by @better-auth/api-key plugin

-- Recreate machines table without key_hash, rename owner_id to user_id
CREATE TABLE machines_new (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'offline',
  os                TEXT,
  version           TEXT,
  runtimes          TEXT,
  last_heartbeat_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO machines_new (id, user_id, name, status, os, version, runtimes, last_heartbeat_at, created_at)
  SELECT id, owner_id, name, status, os, version, runtimes, last_heartbeat_at, created_at FROM machines;

DROP TABLE machines;
ALTER TABLE machines_new RENAME TO machines;

CREATE INDEX idx_machines_user ON machines(user_id);

-- Update boards: rename owner_id to user_id
ALTER TABLE boards RENAME COLUMN owner_id TO user_id;
DROP INDEX idx_boards_owner;
DROP INDEX idx_boards_owner_name;
CREATE INDEX idx_boards_user ON boards(user_id);
CREATE UNIQUE INDEX idx_boards_user_name ON boards(user_id, name);

-- Update repositories: rename owner_id to user_id
ALTER TABLE repositories RENAME COLUMN owner_id TO user_id;
DROP INDEX idx_repositories_owner;
DROP INDEX idx_repositories_owner_url;
CREATE INDEX idx_repositories_user ON repositories(user_id);
CREATE UNIQUE INDEX idx_repositories_user_url ON repositories(user_id, url);
