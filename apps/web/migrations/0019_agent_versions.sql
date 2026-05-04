ALTER TABLE agents ADD COLUMN version TEXT NOT NULL DEFAULT 'latest';
ALTER TABLE agents ADD COLUMN soul_sha1 TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_agents_username;
CREATE UNIQUE INDEX idx_agents_username_version ON agents(username, version);
