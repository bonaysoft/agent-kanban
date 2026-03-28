-- Add username field to agents for external-facing identity.
ALTER TABLE agents ADD COLUMN username TEXT;

-- Backfill: derive username from name (lowercase, spaces→hyphens)
UPDATE agents SET username = lower(replace(name, ' ', '-'));

-- For any agent where the derived username might be empty or still null,
-- fall back to agent-{first 8 chars of id}
UPDATE agents SET username = 'agent-' || substr(id, 1, 8) WHERE username IS NULL OR username = '';

-- Unique index scoped by owner
CREATE UNIQUE INDEX idx_agents_owner_username ON agents(owner_id, username);
