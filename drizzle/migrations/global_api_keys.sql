-- Migration: Convert apiKeys table from per-user to global (one key per provider)
-- Run this against your Supabase database before deploying the updated code.

-- Step 1: Remove duplicate keys, keeping only the most recently verified one per provider
DELETE FROM "apiKeys" a
USING "apiKeys" b
WHERE a.id < b.id
  AND a.provider = b.provider;

-- Step 2: Drop the userId foreign key constraint and column
ALTER TABLE "apiKeys" DROP CONSTRAINT IF EXISTS "apiKeys_userId_users_id_fk";
ALTER TABLE "apiKeys" DROP COLUMN IF EXISTS "userId";

-- Step 3: Add a unique constraint on provider (one global key per provider)
ALTER TABLE "apiKeys" ADD CONSTRAINT "apiKeys_provider_unique" UNIQUE ("provider");
