-- Migration 0021: Agency win email toggle
-- Adds a per-client flag so agencies can opt out of win notification emails
-- for specific clients without affecting the business contact's emails.
-- Defaults to TRUE so all existing agency clients continue to receive win emails.
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "agencyWinEmailsEnabled" BOOLEAN NOT NULL DEFAULT TRUE;
