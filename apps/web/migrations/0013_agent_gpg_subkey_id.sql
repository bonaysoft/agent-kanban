-- GPG subkey ID assigned to each agent for commit signing.
ALTER TABLE agents ADD COLUMN gpg_subkey_id TEXT;
