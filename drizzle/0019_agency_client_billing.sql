-- Migration 0019: Agency client billing fields
-- Adds Stripe subscription tracking to the businesses table so each agency client
-- can have an associated Stripe subscription billed to the agency.

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "agencyPackageTier"    VARCHAR(50);
