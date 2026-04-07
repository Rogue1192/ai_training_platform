-- Migration 0023: Add training cycle tracking fields to campaignQueryLocations
-- These fields drive the 4-run initial cycle (with 24h LLM polls between runs)
-- and the weekly monitoring phase.

ALTER TABLE "campaignQueryLocations"
  ADD COLUMN IF NOT EXISTS "trainingRunCount"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastRunCompletedAt"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "nextPollAt"             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "monitoringStartedAt"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "lastMonitoringPollAt"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "beforeVideoCapturedAt"  TIMESTAMPTZ;
