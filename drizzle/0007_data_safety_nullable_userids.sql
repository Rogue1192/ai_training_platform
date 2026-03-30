-- Migration: Data Safety — Convert cascade-delete userId FKs to set null
-- BUG-013: trainingSessions.userId  (cascade → set null, NOT NULL removed)
-- BUG-014: businesses.userId        (cascade → set null, NOT NULL removed)
-- BUG-004: scheduledJobs.userId     (cascade → set null, NOT NULL removed)
-- BUG-003: promptTemplates.userId   (column removed entirely — templates are now global)
--
-- Run this against your Supabase/Railway PostgreSQL database before deploying this code.

-- ============================================================
-- 1. businesses.userId
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
-- 2. trainingSessions.userId
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
-- 3. scheduledJobs.userId
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
-- 4. promptTemplates.userId — remove column entirely (templates are now global)
-- ============================================================
-- Step 4a: Drop the FK constraint first
ALTER TABLE "promptTemplates"
  DROP CONSTRAINT IF EXISTS "promptTemplates_userId_users_id_fk";

-- Step 4b: Drop the column
ALTER TABLE "promptTemplates"
  DROP COLUMN IF EXISTS "userId";
