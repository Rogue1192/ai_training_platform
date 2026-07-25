-- ============================================================
-- Migration 0030: CTR/AI Settings — credentials vault + profile pools
-- All new tables prefixed with ctr_ or ai_
-- Zero impact on existing AI Answer Forge tables
-- ============================================================

-- CloakBrowser Pro global config (one row per installation)
CREATE TABLE IF NOT EXISTS cloak_config (
  id              SERIAL PRIMARY KEY,
  license_key     TEXT,                          -- encrypted at app layer
  host_url        TEXT DEFAULT 'local',          -- 'local' or remote URL
  max_concurrent  INTEGER NOT NULL DEFAULT 5,
  humanize        BOOLEAN NOT NULL DEFAULT TRUE,
  headless        BOOLEAN NOT NULL DEFAULT FALSE,
  geoip           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Credentials vault
-- Passwords/tokens stored as text (encrypted at app layer via AES-256)
-- ============================================================

CREATE TABLE IF NOT EXISTS ctr_credentials (
  id              SERIAL PRIMARY KEY,
  label           TEXT NOT NULL,                 -- human-readable name e.g. "ChatGPT Account #1"
  platform        TEXT NOT NULL,                 -- 'chatgpt' | 'google' | 'proxy'
  email           TEXT,
  password_enc    TEXT,                          -- AES-256 encrypted
  extra_enc       TEXT,                          -- JSON blob for extra fields (proxy URL, session token, etc.) — encrypted
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AI Training Profile Pool
-- Profiles used exclusively for AI Answer Forge training sessions
-- (ChatGPT, Gemini, Perplexity, AI Overviews)
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_browser_profiles (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  cloak_profile_id      TEXT,                    -- CloakBrowser Manager profile UUID (if using Manager)
  fingerprint_seed      TEXT,                    -- random seed for fingerprint generation
  proxy_credential_id   INTEGER REFERENCES ctr_credentials(id) ON DELETE SET NULL,
  chatgpt_credential_id INTEGER REFERENCES ctr_credentials(id) ON DELETE SET NULL,
  google_credential_id  INTEGER REFERENCES ctr_credentials(id) ON DELETE SET NULL,  -- used for Gemini + AI Overviews
  timezone              TEXT DEFAULT 'America/New_York',
  locale                TEXT DEFAULT 'en-US',
  screen_width          INTEGER DEFAULT 1920,
  screen_height         INTEGER DEFAULT 1080,
  platform              TEXT DEFAULT 'Win32',
  authenticated_platforms TEXT[] DEFAULT '{}',   -- ['chatgpt','gemini','perplexity'] — platforms confirmed logged in
  status                TEXT NOT NULL DEFAULT 'idle',  -- 'idle' | 'active' | 'in_use' | 'error'
  current_campaign_id   INTEGER,                 -- which AI Answer Forge campaign is using it right now
  last_used_at          TIMESTAMPTZ,
  session_count         INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CTR Profile Pool
-- Profiles used exclusively for CTR campaigns and drive simulations
-- (GBP searches, clicks, direction requests)
-- ============================================================

CREATE TABLE IF NOT EXISTS ctr_browser_profiles (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT NOT NULL,
  cloak_profile_id      TEXT,                    -- CloakBrowser Manager profile UUID (if using Manager)
  fingerprint_seed      TEXT,
  proxy_credential_id   INTEGER REFERENCES ctr_credentials(id) ON DELETE SET NULL,
  google_credential_id  INTEGER REFERENCES ctr_credentials(id) ON DELETE SET NULL,  -- Google account for CTR searches
  timezone              TEXT DEFAULT 'America/New_York',
  locale                TEXT DEFAULT 'en-US',
  screen_width          INTEGER DEFAULT 1920,
  screen_height         INTEGER DEFAULT 1080,
  platform              TEXT DEFAULT 'Win32',
  google_authenticated  BOOLEAN NOT NULL DEFAULT FALSE,
  search_history_age_days INTEGER DEFAULT 0,     -- how many days of search history this profile has built up
  status                TEXT NOT NULL DEFAULT 'idle',  -- 'idle' | 'active' | 'in_use' | 'error'
  current_campaign_id   INTEGER REFERENCES ctr_campaigns(id) ON DELETE SET NULL,
  last_used_at          TIMESTAMPTZ,
  session_count         INTEGER NOT NULL DEFAULT 0,
  notes                 TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_ctr_credentials_platform ON ctr_credentials(platform);
CREATE INDEX IF NOT EXISTS idx_ai_browser_profiles_status ON ai_browser_profiles(status);
CREATE INDEX IF NOT EXISTS idx_ctr_browser_profiles_status ON ctr_browser_profiles(status);
CREATE INDEX IF NOT EXISTS idx_ctr_browser_profiles_campaign ON ctr_browser_profiles(current_campaign_id);
