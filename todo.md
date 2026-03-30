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
- [x] Build credibility research module using Claude Sonnet (Anthropic API direct)
- [x] Research and verify credibility claims from onboarding data (10 categories: certifications, awards, BBB, warranties, team, reviews, years in business, insurance, community, differentiators)
- [x] Expand credibility facts with context (confidence levels, verification URLs, sources)
- [x] Store structured credibility data per business (credibilityData table)
- [x] Generate llm.txt content from credibility facts
- [x] Generate schema markup recommendations
- [x] Add tRPC procedures (runCredibilityResearch, getCredibilityData)
- [x] Write 30 vitest tests for credibility + content engines

## Sprint 5: Content Generation Engine
- [x] Deep research optimal content generation prompt for AI citation
- [x] Write initial content generation prompt template (H1 → summary → bullets → 600-800 word expansion → FAQ → interlinks)
- [x] Build content generation module using Claude Sonnet (Anthropic API direct)
- [x] Generate multiple dedicated pages dynamically based on credibility data (8 page types: certifications, warranties, awards, team, FAQ, pricing, service area, about)
- [x] Generate content in proven format: H1 → summary → bullets → 600-800 word expansion → FAQ
- [x] Add contextual interlinking between generated pages
- [x] Build llm.txt generator (integrated into credibility research)
- [x] Build schema markup generator using Claude Haiku (cost optimization)
- [x] Page type determination logic (auto-selects pages based on available credibility data)
- [x] Add tRPC procedures (runContentGeneration, getContentPages, regenerateContentPage, getContentGenerationPrompt, getPageTypeConfigs)
- [x] All 192 tests passing across 19 test files

## Sprint 6: WordPress Auto-Publisher
- [x] Build WordPress REST API client (replaced Puppeteer approach — REST API is more reliable and doesn't need a headless browser)
- [x] Build WordPress Application Password authentication (Basic Auth)
- [x] Build WP connection testing (validates REST API access + user permissions)
- [x] Build page creation automation (title, content, slug, excerpt, publish/draft/pending)
- [x] Build page update for existing slugs (avoids duplicates)
- [x] Build llm.txt publishing as WordPress page at /llm-txt
- [x] Build schema markup injection (JSON-LD appended to page content)
- [x] Build bulk campaign publishing (publishes all content pages sequentially)
- [x] Build WP credential storage (encrypted in businesses table)
- [x] Handle SiteForge Ultra Scenario C (skips WP publishing, stores content for handoff)
- [x] Add tRPC procedures (testConnection, storeCredentials, publishCampaign, publishLlmTxt, getPublishedUrls)

## Sprint 7: Indexing & Verification
- [x] Integrate SinByte API for URL indexing submission (sinbyte.com — the actual service name)
- [x] Build batch URL submission to SinByte with drip-feed support
- [x] Build indexing task status checking
- [x] Build indexing history retrieval
- [x] Build campaign-level indexing submission (auto-collects published URLs)
- [x] Build indexing verification (HTTP HEAD checks after 3-4 day wait, 80% threshold)
- [x] Store published URLs in contentPages table for training reference
- [x] Add tRPC procedures (submitCampaign, verifyCampaign, getHistory, getTaskStatus)
- [ ] Add SINBYTE_API_KEY secret (Casey providing tomorrow)

## Pipeline Orchestrator (connects all sprints)
- [x] Build full pipeline orchestrator connecting Sprints 3-7
- [x] 8-step pipeline: keyword_research → credibility_research → content_generation → publishing → indexing → indexing_verification → baseline_check → training
- [x] Auto-detect next step from campaign timestamps
- [x] Run individual steps or full auto-pilot mode
- [x] Auto-pause at indexing (3-4 day wait) and training (needs config)
- [x] Error tracking with campaign error count
- [x] Pipeline status API for UI display
- [x] Step labels with descriptions for UI
- [x] Add tRPC procedures (getStatus, getStepLabels, runStep, runFull)
- [x] All 231 tests passing across 20 test files

## Sprint 8: Rank Tracking Engine
- [x] Integrate DataForSEO LLM Mentions API (already in dataforseoService.ts)
- [x] Integrate DataForSEO LLM Responses API (ChatGPT + Gemini)
- [x] Integrate DataForSEO Google AI Mode SERP API
- [x] Build comprehensive rank check across all query×location combos
- [x] Store rank snapshots with historical data
- [x] Build visibility scoring system (ChatGPT 40%, Gemini 30%, AI Overview 30%)
- [x] Position-weighted scoring (pos 1 = 100, pos 2 = 85, pos 3 = 75, etc.)
- [x] Trend analysis with historical comparison
- [x] Win detection (new mentions, improved positions)
- [x] Add tRPC procedures (runCheck, getReport, getTrends)

## Sprint 9: Initial Visibility Report + Email
- [x] Build visibility report generation (generateCampaignRankReport)
- [x] Report includes: current score, baseline score, before/after comparison, recent wins, query details, trends
- [ ] Set up Resend integration with ai-answer-forge.com domain (future sprint)
- [ ] Build branded email template for visibility reports (future sprint)
- [ ] Send initial report to client automatically after baseline check (future sprint)

## Sprint 10: Client Dashboard (Iframe)
- [x] Build private-link dashboard with unique non-guessable URL token (/report/:token)
- [x] Show current rankings across all query×location combos (query details table)
- [x] Show historical trend data and recent wins (trend chart + win cards)
- [x] Show overall visibility score (animated gauge with glow effects)
- [x] Make dashboard iframe-embeddable (no login, no chrome, standalone page)
- [x] Hide all training machinery from client view
- [x] Red-to-green gradient scoring (invisible → barely visible → emerging → growing → strong → dominating)
- [x] Animated visibility gauge with score counter animation
- [x] Before/after comparison cards with progress bars
- [x] Platform breakdown radial chart (ChatGPT, Gemini, AI Overview)
- [x] Area chart with trend lines per platform
- [x] Win celebration cards with platform icons
- [x] Responsive dark theme design
- [x] Admin management page (create/toggle/copy links, view access stats)
- [x] clientDashboards table with access tracking

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

## Sprint 8-10 Enhanced Requirements (Client-Facing Visual Excellence)
- [x] Sprint 8: Build comprehensive rank tracking using DataForSEO LLM Mentions + LLM Responses + Google AI Mode SERP
- [x] Sprint 8: Store rank snapshots with full historical data for trend analysis
- [x] Sprint 9: Build visibility report generation with dramatic before/after visual contrast
- [x] Sprint 9: Red-to-green gradient rank cards showing the improvement journey
- [x] Sprint 9: Animated visibility score gauges
- [x] Sprint 9: Sparkline trend charts per query showing rank progression
- [x] Sprint 9: "Wins" callouts with celebration styling
- [x] Sprint 9: Before/after comparison panels with maximum visual contrast
- [x] Sprint 10: Build client dashboard (iframe-embeddable, no login required)
- [x] Sprint 10: Overall visibility score — dim/barely-visible when low, bright/glowing when high
- [x] Sprint 10: Historical trend data with animated charts
- [x] Sprint 10: Make dashboard visually stunning to minimize churn in first 1-2 months
- [x] All 249 tests passing across 21 test files
