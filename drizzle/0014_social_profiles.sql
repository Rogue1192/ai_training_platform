-- Migration 0014: Add social profile fields to businesses table
-- These are discovered automatically during the credibility research phase
-- and included in the schema.org sameAs array for maximum SEO benefit.

ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "facebookUrl"   VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "instagramUrl"  VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "linkedinUrl"   VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "twitterUrl"    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "youtubeUrl"    VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "tiktokUrl"     VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "yelpUrl"       VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "googleMapsUrl" VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "bbbUrl"        VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "angiesUrl"     VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "thumbtackUrl"  VARCHAR(500),
  ADD COLUMN IF NOT EXISTS "houzzUrl"      VARCHAR(500);
