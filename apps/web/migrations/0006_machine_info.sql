-- Add OS, version, and runtimes info to machines
ALTER TABLE machines ADD COLUMN os TEXT;
ALTER TABLE machines ADD COLUMN version TEXT;
ALTER TABLE machines ADD COLUMN runtimes TEXT;
