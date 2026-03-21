-- Track token usage and cost per agent session
ALTER TABLE agents ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN cache_read_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agents ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0;
