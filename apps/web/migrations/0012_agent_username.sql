-- Add username field to agents table for external-facing identity.
-- Used for email (username@mails.agent-kanban.dev) and git commit identity.
-- Username is unique per owner (two different tenants may have agents with the same username).
ALTER TABLE agents ADD COLUMN username TEXT;

-- Backfill: lowercase name, spaces→hyphens.
UPDATE agents SET username = lower(replace(name, ' ', '-'))
WHERE username IS NULL;

-- Safety net: any row whose name produced a NULL or invalid username gets a stable fallback.
UPDATE agents SET username = 'agent-' || substr(id, 1, 8)
WHERE username IS NULL OR username = '';

CREATE UNIQUE INDEX idx_agents_owner_username ON agents (owner_id, username) WHERE username IS NOT NULL;
