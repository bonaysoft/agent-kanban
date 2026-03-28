-- GPG subkey per agent — derived from owner's root key, used for git commit signing.
ALTER TABLE agents ADD COLUMN gpg_subkey_id TEXT;
ALTER TABLE agents ADD COLUMN gpg_subkey_fingerprint TEXT;
