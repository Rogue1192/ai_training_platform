-- ============================================================
-- Migration 0012: Trial management + video recording fields
-- ============================================================

-- Add trial management fields to campaigns table
ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "trialStatus" varchar(20) NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS "trialStartedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "trialExpiresAt" timestamp,
  ADD COLUMN IF NOT EXISTS "trialConvertedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "selectedPackage" varchar(50),
  ADD COLUMN IF NOT EXISTS "maxQueries" integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "maxLocations" integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "stripePaymentLinkUrl" varchar(500),
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" varchar(100),
  ADD COLUMN IF NOT EXISTS "stripePaymentLinkId" varchar(100);

-- Add before/after video recording fields to campaignQueryLocations table
ALTER TABLE "campaignQueryLocations"
  ADD COLUMN IF NOT EXISTS "beforeVideoChatgpt" text,
  ADD COLUMN IF NOT EXISTS "beforeVideoGoogleAi" text,
  ADD COLUMN IF NOT EXISTS "afterVideoChatgpt" text,
  ADD COLUMN IF NOT EXISTS "afterVideoGoogleAi" text,
  ADD COLUMN IF NOT EXISTS "beforeVideoRecordedAt" timestamp,
  ADD COLUMN IF NOT EXISTS "afterVideoRecordedAt" timestamp;

-- Update existing campaigns to have correct trial defaults
-- (existing campaigns are assumed to be paid/active, not trial)
UPDATE "campaigns"
  SET "trialStatus" = 'converted',
      "maxQueries" = COALESCE(
        (SELECT pt."maxQueries" FROM "packageTiers" pt WHERE pt.id = "campaigns"."packageTierId"),
        20
      ),
      "maxLocations" = COALESCE(
        (SELECT pt."maxLocations" FROM "packageTiers" pt WHERE pt.id = "campaigns"."packageTierId"),
        5
      )
  WHERE "trialStatus" = 'trial';
