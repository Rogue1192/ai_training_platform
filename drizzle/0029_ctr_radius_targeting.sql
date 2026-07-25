-- CTR Module: Radius Targeting + ZIP Bias + Used Origins
-- Migration 0029 — adds to existing ctr_ tables, zero impact on AI Answer Forge

-- 1. Add radius targeting fields to ctr_campaigns
ALTER TABLE ctr_campaigns
  ADD COLUMN IF NOT EXISTS "centerLat"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "centerLng"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "centerAddress"   TEXT,
  ADD COLUMN IF NOT EXISTS "radiusMiles"     INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "useZipBias"      BOOLEAN NOT NULL DEFAULT false;

-- 2. Add radius targeting fields to ctr_drive_journeys
--    (drive journeys can override the campaign-level radius per journey)
ALTER TABLE ctr_drive_journeys
  ADD COLUMN IF NOT EXISTS "originLat"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "originLng"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "originZip"       VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "radiusOverride"  INTEGER;

-- 3. ZIP bias targets table — per campaign, optional weighted ZIP codes
CREATE TABLE IF NOT EXISTS ctr_zip_targets (
  id              SERIAL PRIMARY KEY,
  "campaignId"    INTEGER NOT NULL REFERENCES ctr_campaigns(id) ON DELETE CASCADE,
  "zipCode"       VARCHAR(10) NOT NULL,
  "city"          VARCHAR(100),
  "state"         VARCHAR(5),
  "centerLat"     DOUBLE PRECISION,   -- centroid of the ZIP (populated on save)
  "centerLng"     DOUBLE PRECISION,
  "weightPct"     NUMERIC(5,2) NOT NULL DEFAULT 0,  -- 0 = auto-distribute remaining
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ctr_zip_targets_campaign ON ctr_zip_targets("campaignId");

-- 4. Used origins table — prevents repeating the same origin within 7 days
CREATE TABLE IF NOT EXISTS ctr_used_origins (
  id              SERIAL PRIMARY KEY,
  "campaignId"    INTEGER NOT NULL REFERENCES ctr_campaigns(id) ON DELETE CASCADE,
  "sessionType"   VARCHAR(20) NOT NULL DEFAULT 'ctr',  -- 'ctr' | 'drive'
  "lat"           DOUBLE PRECISION NOT NULL,
  "lng"           DOUBLE PRECISION NOT NULL,
  "addressSnap"   TEXT,   -- reverse-geocoded address for display
  "usedAt"        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ctr_used_origins_campaign ON ctr_used_origins("campaignId");
CREATE INDEX IF NOT EXISTS idx_ctr_used_origins_used_at  ON ctr_used_origins("usedAt");

-- 5. Add originLat/originLng to ctr_sessions for GPS spoofing record
ALTER TABLE ctr_sessions
  ADD COLUMN IF NOT EXISTS "originLat"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "originLng"   DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "originZip"   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS "originAddr"  TEXT;
