-- ============================================================
-- CTR MODULE MIGRATION
-- All tables prefixed with ctr_ — completely isolated from
-- AI Answer Forge tables. Zero modifications to existing tables.
-- ============================================================

-- GSC connections — one row per Google account the agency connects.
-- A single connected account can read multiple GSC properties.
CREATE TABLE IF NOT EXISTS "ctr_gsc_connections" (
  "id"                  SERIAL PRIMARY KEY,
  "userId"              INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "googleEmail"         VARCHAR(320) NOT NULL,
  "accessToken"         TEXT,
  "refreshToken"        TEXT,
  "tokenExpiresAt"      TIMESTAMP,
  "scopes"              TEXT,
  "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
  "lastSyncedAt"        TIMESTAMP,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- CTR campaigns — one per GBP listing being worked
CREATE TABLE IF NOT EXISTS "ctr_campaigns" (
  "id"                  SERIAL PRIMARY KEY,
  "userId"              INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "businessId"          INTEGER REFERENCES "businesses"("id") ON DELETE SET NULL,
  -- GBP / Maps identifiers
  "businessName"        VARCHAR(255) NOT NULL,
  "mapsUrl"             TEXT,
  "placeId"             VARCHAR(255),
  "address"             TEXT,
  "phone"               VARCHAR(50),
  -- GSC data source
  "gscConnectionId"     INTEGER REFERENCES "ctr_gsc_connections"("id") ON DELETE SET NULL,
  "gscSiteUrl"          VARCHAR(500),
  -- Campaign config
  "targetCountry"       VARCHAR(10) NOT NULL DEFAULT 'US',
  "targetCity"          VARCHAR(255),
  "status"              VARCHAR(50) NOT NULL DEFAULT 'active',  -- active | paused | completed
  "useRealBrowser"      BOOLEAN NOT NULL DEFAULT TRUE,          -- always true; headless never used
  -- Ramp calculator settings
  "rampMode"            VARCHAR(20) NOT NULL DEFAULT 'auto',    -- auto (GSC-driven) | manual
  "weeklyRampPct"       NUMERIC(5,2) NOT NULL DEFAULT 5.0,      -- % increase per week (3–7)
  "baselineClicksJson"  TEXT,   -- JSON: { "query": { clicks, impressions, ctr } }
  "lastGscPullAt"       TIMESTAMP,
  "notes"               TEXT,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Keywords per CTR campaign with per-keyword weight/ratio
CREATE TABLE IF NOT EXISTS "ctr_keywords" (
  "id"                  SERIAL PRIMARY KEY,
  "campaignId"          INTEGER NOT NULL REFERENCES "ctr_campaigns"("id") ON DELETE CASCADE,
  "keyword"             TEXT NOT NULL,
  "keywordType"         VARCHAR(20) NOT NULL DEFAULT 'primary',  -- primary | brand | local
  "weightPct"           NUMERIC(5,2) NOT NULL DEFAULT 33.33,     -- % of sessions for this keyword
  "baselineClicks"      INTEGER,       -- from GSC
  "baselineImpressions" INTEGER,       -- from GSC
  "baselineCtr"         NUMERIC(6,4),  -- from GSC
  "currentWeekTarget"   INTEGER,       -- calculated by ramp engine
  "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Individual CTR sessions (each = one simulated search + GBP click)
CREATE TABLE IF NOT EXISTS "ctr_sessions" (
  "id"                  SERIAL PRIMARY KEY,
  "campaignId"          INTEGER NOT NULL REFERENCES "ctr_campaigns"("id") ON DELETE CASCADE,
  "keywordId"           INTEGER REFERENCES "ctr_keywords"("id") ON DELETE SET NULL,
  "keyword"             TEXT NOT NULL,
  "sessionType"         VARCHAR(20) NOT NULL DEFAULT 'gmb_click',  -- gmb_click | direction | call | website
  "status"              VARCHAR(20) NOT NULL DEFAULT 'pending',     -- pending | running | completed | failed
  "browserType"         VARCHAR(20) NOT NULL DEFAULT 'real',        -- real (always)
  "proxyUsed"           VARCHAR(255),
  "durationSeconds"     INTEGER,
  "completedAt"         TIMESTAMP,
  "errorMessage"        TEXT,
  "scheduledFor"        TIMESTAMP,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Drive simulation journeys (GPS direction requests)
CREATE TABLE IF NOT EXISTS "ctr_drive_journeys" (
  "id"                  SERIAL PRIMARY KEY,
  "campaignId"          INTEGER NOT NULL REFERENCES "ctr_campaigns"("id") ON DELETE CASCADE,
  "journeyType"         VARCHAR(30) NOT NULL DEFAULT 'driving',   -- driving | transit | walking | cycling
  "customerPersona"     VARCHAR(50),   -- residential | commercial | emergency | maintenance
  "originAddress"       TEXT NOT NULL,
  "destinationAddress"  TEXT NOT NULL,
  "destinationPlaceId"  VARCHAR(255),
  "createCalendarEvent" BOOLEAN NOT NULL DEFAULT TRUE,
  "calendarEventTitle"  VARCHAR(255),
  "status"              VARCHAR(20) NOT NULL DEFAULT 'pending',
  "browserType"         VARCHAR(20) NOT NULL DEFAULT 'real',
  "proxyUsed"           VARCHAR(255),
  "completedAt"         TIMESTAMP,
  "errorMessage"        TEXT,
  "scheduledFor"        TIMESTAMP,
  "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Weekly ramp snapshots — one row per campaign per week for audit trail
CREATE TABLE IF NOT EXISTS "ctr_ramp_snapshots" (
  "id"                  SERIAL PRIMARY KEY,
  "campaignId"          INTEGER NOT NULL REFERENCES "ctr_campaigns"("id") ON DELETE CASCADE,
  "weekStartDate"       DATE NOT NULL,
  "weekNumber"          INTEGER NOT NULL,
  "targetSessions"      INTEGER NOT NULL,
  "completedSessions"   INTEGER NOT NULL DEFAULT 0,
  "gscClicksBefore"     INTEGER,
  "gscClicksAfter"      INTEGER,
  "rampPctApplied"      NUMERIC(5,2),
  "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"           TIMESTAMP NOT NULL DEFAULT NOW()
);
