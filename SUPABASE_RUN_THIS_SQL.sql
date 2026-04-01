-- ============================================================
-- AI ANSWER FORGE — PENDING MIGRATIONS
-- Run this entire script in your Supabase SQL Editor (once).
-- It is safe to run multiple times — all statements use
-- IF EXISTS / IF NOT EXISTS guards.
-- ============================================================


-- ============================================================
-- STEP 1: DEDUPLICATE prompt_templates
-- Keeps the lowest ID (oldest) of each duplicate name+type pair
-- and deletes the rest. This cleans up the doubled prompts.
-- ============================================================
DELETE FROM "promptTemplates"
WHERE id NOT IN (
  SELECT MIN(id)
  FROM "promptTemplates"
  GROUP BY "templateName", "templateType"
);


-- ============================================================
-- STEP 2: Remove userId from promptTemplates
-- (Templates are global team resources, not per-employee)
-- ============================================================
ALTER TABLE "promptTemplates"
  DROP CONSTRAINT IF EXISTS "promptTemplates_userId_users_id_fk";

ALTER TABLE "promptTemplates"
  DROP COLUMN IF EXISTS "userId";


-- ============================================================
-- STEP 3: businesses.userId — cascade → set null
-- (Deleting an employee must NOT delete their client businesses)
-- ============================================================
ALTER TABLE "businesses"
  DROP CONSTRAINT IF EXISTS "businesses_userId_users_id_fk";

ALTER TABLE "businesses"
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_userId_users_id_fk"
  FOREIGN KEY ("userId") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;


-- ============================================================
-- STEP 4: trainingSessions.userId — cascade → set null
-- ============================================================
ALTER TABLE "trainingSessions"
  DROP CONSTRAINT IF EXISTS "trainingSessions_userId_users_id_fk";

ALTER TABLE "trainingSessions"
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "trainingSessions"
  ADD CONSTRAINT "trainingSessions_userId_users_id_fk"
  FOREIGN KEY ("userId") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;


-- ============================================================
-- STEP 5: scheduledJobs.userId — cascade → set null
-- ============================================================
ALTER TABLE "scheduledJobs"
  DROP CONSTRAINT IF EXISTS "scheduledJobs_userId_users_id_fk";

ALTER TABLE "scheduledJobs"
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "scheduledJobs"
  ADD CONSTRAINT "scheduledJobs_userId_users_id_fk"
  FOREIGN KEY ("userId") REFERENCES "public"."users"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;


-- ============================================================
-- STEP 6: campaigns.userId — cascade → set null
-- (Deleting an employee must NOT delete client campaigns)
-- ============================================================
ALTER TABLE "campaigns"
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "campaigns"
  DROP CONSTRAINT IF EXISTS "campaigns_userId_users_id_fk";

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_userId_users_id_fk"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL;


-- ============================================================
-- STEP 7: platformMetrics.userId — cascade → set null
-- ============================================================
ALTER TABLE "platformMetrics"
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "platformMetrics"
  DROP CONSTRAINT IF EXISTS "platformMetrics_userId_users_id_fk";

ALTER TABLE "platformMetrics"
  ADD CONSTRAINT "platformMetrics_userId_users_id_fk"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL;


-- ============================================================
-- STEP 8: apiKeys — convert from per-user to global
-- (One key per provider, shared by the whole team)
-- ============================================================

-- Remove duplicate keys, keeping only the most recently added per provider
DELETE FROM "apiKeys" a
USING "apiKeys" b
WHERE a.id < b.id
  AND a.provider = b.provider;

-- Drop the userId FK and column
ALTER TABLE "apiKeys"
  DROP CONSTRAINT IF EXISTS "apiKeys_userId_users_id_fk";

ALTER TABLE "apiKeys"
  DROP COLUMN IF EXISTS "userId";

-- Add unique constraint so only one key per provider can exist
ALTER TABLE "apiKeys"
  DROP CONSTRAINT IF EXISTS "apiKeys_provider_unique";

ALTER TABLE "apiKeys"
  ADD CONSTRAINT "apiKeys_provider_unique" UNIQUE ("provider");


-- ============================================================
-- DONE. All migrations applied.
-- ============================================================
