-- Auth redesign: remove key_hash from machines (auth handled by Better Auth API key plugin)

CREATE TABLE machines_new (
  id                TEXT PRIMARY KEY,
  owner_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'offline',
  os                TEXT,
  version           TEXT,
  runtimes          TEXT,
  last_heartbeat_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO machines_new (id, owner_id, name, status, os, version, runtimes, last_heartbeat_at, created_at)
  SELECT id, owner_id, name, status, os, version, runtimes, last_heartbeat_at, created_at FROM machines;

DROP TABLE machines;
ALTER TABLE machines_new RENAME TO machines;

CREATE INDEX idx_machines_owner ON machines(owner_id);
