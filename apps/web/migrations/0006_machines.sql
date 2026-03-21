-- Machines table: one row per daemon instance (api_key = machine identity)
CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY,              -- same as api_keys.id
  name TEXT NOT NULL,               -- hostname or user-provided
  status TEXT NOT NULL DEFAULT 'online',  -- online / offline
  last_heartbeat_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
