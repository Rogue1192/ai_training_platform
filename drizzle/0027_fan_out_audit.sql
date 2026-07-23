-- Migration 0027: Fan-Out Audit feature
-- Adds a new pipeline step that runs ChatGPT query fan-out analysis before credibility research.
-- The audit captures what ChatGPT searches when verifying a business entity, identifies gaps
-- where the business's claims can't be independently verified, and surfaces a URL task list
-- for the ops team to resolve before content generation.

-- Add fan_out_audit status to campaign_status enum
ALTER TYPE campaign_status ADD VALUE IF NOT EXISTS 'fan_out_audit' AFTER 'baseline_check';

-- Add fan-out audit tracking columns to campaigns
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "fanOutAuditCompletedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "fanOutGapList" json;
-- fanOutGapList shape: Array<{
--   id: string,
--   query: string,           -- The fan-out query ChatGPT ran
--   category: string,        -- 'bbb' | 'license' | 'certification' | 'review' | 'longevity' | 'other'
--   claim: string,           -- What the business claims
--   verificationUrl?: string, -- URL ops team fills in
--   status: 'gap' | 'resolved' | 'not_applicable',
--   notes?: string
-- }>
