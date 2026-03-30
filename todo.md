# AI Answer Forge — Build TODO

## Sprint 1: Foundation (Rebrand + Schema + Package Tiers)
- [x] Update database schema with new tables (campaigns, packageTiers, credibilityData, industryKeywordCache, contentPages, rankSnapshots, clientDashboards, webhookLogs)
- [x] Push database migration
- [x] Rebrand platform: title, login page, sidebar header → "AI Answer Forge"
- [x] Update color theme to match AI Answer Forge branding
- [x] Add Google Font (Inter + Space Grotesk) to index.html
- [x] Build package tier CRUD (backend procedures)
- [x] Build package tier management UI in admin dashboard
- [x] Build campaign management backend (create, list, update campaigns)
- [x] Build campaign management UI page
- [x] Add Campaigns nav item to sidebar

## Sprint 2: Webhook Intake + Campaign Auto-Creation
- [x] Build webhook intake endpoint (POST /api/webhooks/onboarding)
- [x] Validate and parse GHL webhook payload
- [x] Auto-create business record from webhook data
- [x] Auto-create campaign from webhook data + package tier
- [x] Build query×location matrix from package tier caps
- [x] Store WordPress credentials (encrypted) for Scenarios A & B
- [x] Build webhook log table and admin UI for monitoring incoming webhooks
- [x] Add campaign status pipeline tracking (which phase each campaign is in)
- [x] Write vitest tests for webhook handler, package tier CRUD, campaign management
- [x] Fix existing tests broken by schema changes
- [x] All 152 tests passing

## Sprint 3: DataForSEO Keyword Research + Industry Cache
- [x] Integrate DataForSEO Keywords For Site API
- [x] Integrate DataForSEO Keyword Suggestions API (via Keywords For Site)
- [x] Integrate DataForSEO AI Keyword Search Volume API
- [x] Integrate DataForSEO LLM Mentions API (for rank tracking)
- [x] Build industry keyword cache system (store, analyze overlap, lock golden templates)
- [x] Build keyword research pipeline (check cache → run API → save to cache → select top queries)
- [x] Build baseline rank check pipeline
- [x] Add tRPC procedures for keyword research and baseline check triggers
- [x] Fix AI Keyword Search Volume response parsing (nested items structure)
- [x] Write vitest tests for DataForSEO integration (all 162 tests passing)
- [ ] Build admin UI for industry cache management (view, refresh, override)
- [ ] Add backend controls for query cap per package tier

## Sprint 4: Credibility Research Engine
- [ ] Build credibility research module using Claude Haiku (Anthropic API direct)
- [ ] Research and verify credibility claims from onboarding data
- [ ] Expand credibility facts with context (rarity, significance)
- [ ] Store structured credibility data per business

## Sprint 5: Content Generation Engine
- [ ] Deep research optimal content generation prompt for AI citation
- [ ] Write initial content generation prompt template (Casey reviews)
- [ ] Build content generation module using Claude Sonnet (Anthropic API direct)
- [ ] Generate multiple dedicated pages dynamically based on credibility data
- [ ] Generate content in proven format: H1 → summary → bullets → 600-800 word expansion
- [ ] Add contextual interlinking between generated pages
- [ ] Build llm.txt generator
- [ ] Build schema markup analyzer and generator

## Sprint 6: WordPress Auto-Publisher
- [ ] Install and configure Puppeteer for headless browser automation
- [ ] Build WordPress login automation
- [ ] Build page creation automation (title, content, permalink, publish)
- [ ] Build llm.txt upload to website root
- [ ] Build schema markup injection
- [ ] Add error handling with fallback to manual workflow (email team)
- [ ] Build SiteForge Ultra webhook handoff for Scenario C

## Sprint 7: Indexing & Verification
- [ ] Integrate SendByte API for URL indexing submission
- [ ] Build 3-4 day waiting period with verification check
- [ ] Store content URLs in campaign record for training reference

## Sprint 8: Rank Tracking Engine
- [ ] Integrate DataForSEO LLM Mentions API
- [ ] Integrate DataForSEO LLM Responses API (ChatGPT + Gemini)
- [ ] Integrate DataForSEO Google AI Mode SERP API
- [ ] Build comprehensive rank check across all query×location combos
- [ ] Store rank snapshots with historical data

## Sprint 9: Initial Visibility Report + Email
- [ ] Set up Resend integration with ai-answer-forge.com domain
- [ ] Build Initial Visibility Report generation
- [ ] Build branded email template for visibility reports
- [ ] Send initial report to client automatically after baseline check

## Sprint 10: Client Dashboard (Iframe)
- [ ] Build private-link dashboard with unique non-guessable URL token
- [ ] Show current rankings across all query×location combos
- [ ] Show historical trend data and recent wins
- [ ] Show overall visibility score
- [ ] Make dashboard iframe-embeddable (no login, no chrome)
- [ ] Hide all training machinery from client view

## Sprint 11: Enhanced Training Engine
- [ ] Enrich training prompts with credibility data and content URLs
- [ ] Point training to real verifiable URLs as sources
- [ ] Integrate content page URLs into training context

## Sprint 12: Smart Scheduling + Auto-Recovery
- [ ] Build aggressive → maintenance mode transition
- [ ] Build auto-recovery (detect ranking drop → re-trigger training)
- [ ] Add configurable aggressiveness settings per campaign
- [ ] Add global default settings with per-campaign override

## Sprint 13: Win Notifications
- [ ] Build win detection (compare weekly rank checks to previous)
- [ ] Build branded win notification email template
- [ ] Send win emails automatically when new rankings achieved
- [ ] Update client dashboard with new wins

## Sprint 14: Admin Dashboard Overhaul
- [ ] Campaign pipeline view (which phase each campaign is in)
- [ ] Industry keyword cache management
- [ ] Manual query/location override per campaign
- [ ] Training frequency controls
- [ ] Webhook monitoring log
- [ ] Auto-publish success/failure tracking

## Sprint 15: Testing & Hardening
- [ ] Write tests for all new endpoints
- [ ] Scale testing with concurrent campaigns
- [ ] Error handling and retry logic for all external APIs
- [ ] Rate limiting for DataForSEO and other APIs

---

## Previous Platform Items (Legacy)
- [x] Basic homepage layout
- [x] Navigation menu with sidebar
- [x] User authentication system (Supabase Auth)
- [x] Dashboard with metrics
- [x] Business CRUD
- [x] Training session CRUD
- [x] V2 phase-based training engine
- [x] BullMQ job queue
- [x] Scheduler with exact date/time
- [x] Prompt template system
- [x] API key management (OpenAI, Anthropic, Google)
- [x] Encryption for API keys
- [x] Staleness detection and recovery
- [x] Restart all error sessions
- [x] Searchable business/session filters
- [x] Edit schedule dialog
- [x] Logout fix
- [x] Model migration (deprecated models)
- [x] 2FA support

## Critical Fix: Database Tables
- [x] Verify all new tables exist in the actual database (not just in schema.ts)
- [x] Fix any missing tables by running proper migration
- [x] Confirm all 21 tables are accessible in Supabase Postgres
- [x] NOTE: webdev_execute_sql connects to TiDB (Manus managed DB), app uses Supabase Postgres — tables confirmed in correct DB

## DataForSEO Integration
- [x] Save DataForSEO API credentials (Basic Auth: email:password)
- [x] Verify DataForSEO API access works (both auth and Labs endpoints confirmed)

## Deployment Reminder
- [ ] When everything is built and ready: walk Casey through Railway deployment (set DATABASE_URL/SUPABASE_DATABASE_URL, run pnpm db:push, set all env vars)
