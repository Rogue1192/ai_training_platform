-- Migration 0022: Remove competitor tracking, no schema change needed for inbound webhook secret
-- (inboundWebhookSecret is stored in serviceKeys.metadata JSON, no column change required)

-- Drop the competitors column from businesses table
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "competitors";
