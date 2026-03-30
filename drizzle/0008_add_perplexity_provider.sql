-- BUG-006: Add perplexity to the ai_provider enum
-- PostgreSQL requires ALTER TYPE to add new enum values
ALTER TYPE ai_provider ADD VALUE IF NOT EXISTS 'perplexity';
