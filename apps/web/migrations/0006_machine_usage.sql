-- Add usage_info column to machines (JSON blob from Anthropic OAuth Usage API)
ALTER TABLE machines ADD COLUMN usage_info TEXT;
