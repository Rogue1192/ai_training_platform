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
- [x] Add SINBYTE_API_KEY secret (validated and working)

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
- [x] Set up Resend integration with my.aianswerforge.com domain
- [x] Build branded email template for visibility reports
- [x] Send visibility report to client via tRPC procedure

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

## Sprint 11: Enhanced Training Engine (ADDITIVE ONLY — existing prompts untouched)
- [x] Build trainingContextEnricher.ts — pure additive module, does NOT modify existing prompts
- [x] Enrich training context with credibility data (verified facts, confidence levels, source URLs)
- [x] Point training to real verifiable URLs as sources (published content pages)
- [x] Integrate content page URLs into training context
- [x] Build enriched system message with business info + credibility facts + published pages
- [x] Build source citation block for appending to suggestive prompts
- [x] Enrichment level detection (none → basic → moderate → full)
- [x] Campaign-level and session-level context retrieval
- [x] Add tRPC procedures (getEnrichmentStatus, getFullContext, getEnrichedSystemMessage, getSourceCitationBlock)

## Sprint 12: Smart Scheduling + Auto-Recovery
- [x] Build aggressive → moderate → maintenance mode transition
- [x] Build auto-recovery (detect ranking drop ≥15 points → escalate to aggressive)
- [x] Build sustained decline detection (3+ consecutive drops → auto-recovery)
- [x] Configurable aggressiveness per campaign (aggressive: 3/day, moderate: 1/day, maintenance: 1/week)
- [x] Mode recommendation engine with scoring thresholds (30 → moderate, 60 → maintenance)
- [x] Minimum day requirements before mode transitions (14 days → moderate, 30 days → maintenance)
- [x] Batch evaluation for all active campaigns
- [x] Trend analysis from rank snapshot history (improving/stable/declining)
- [x] Add tRPC procedures (getConfig, getAllConfigs, getCampaignStatus, getAllStatuses, getRecommendation, applyModeChange, checkAutoRecovery, evaluateAll)

## Sprint 13: Win Notifications
- [x] Build win detection (compare latest rank snapshots to previous per query-location)
- [x] Win types: new_mention, position_improvement, multi_platform, first_position
- [x] Significance levels: minor, moderate, major, breakthrough
- [x] Win report generation with summary and top wins
- [x] Admin notification via built-in notifyOwner system
- [x] Batch win check across all active campaigns
- [x] Client-friendly win formatting for dashboard display
- [x] Celebration messages per significance level
- [x] Add tRPC procedures (detectWins, getReport, checkAll, formatForClient)
- [x] Build branded win notification email template (Resend + my.aianswerforge.com)
- [x] Send win emails via tRPC procedure (sendCampaignWinEmails)
- [x] All 271 tests passing across 22 test files

## Sprint 14: Admin Dashboard Overhaul
- [x] Campaign Detail / Pipeline View page (/campaigns/:id)
- [x] Visual 8-step pipeline progress bar with step status indicators (completed/active/pending/error)
- [x] Pipeline step controls — run individual steps or full auto-pilot
- [x] Rank tracking display with visibility scores and before/after comparison
- [x] Training mode management (aggressive/moderate/maintenance) with mode switching
- [x] Content pages display with published URLs
- [x] Credibility data display with score and llm.txt status
- [x] Webhook log display with recent events
- [x] Win detection display with significance levels
- [x] Make campaign cards clickable to navigate to detail page
- [x] Build Prompt Templates management page (/prompts)
- [x] CRUD for prompt templates (create, edit, delete, toggle active/inactive)
- [x] Template type tabs (clean, suggestive, follow_up, category_based)
- [x] Template variable support ({{business_name}}, {{industry}}, {{location}}, {{website}}, {{service_area}})
- [x] Reset to defaults functionality
- [x] Add Prompts to sidebar navigation
- [ ] Industry keyword cache management UI (future)
- [ ] Manual query/location override per campaign (future)
- [x] All 296 tests passing across 24 test files

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

## CRITICAL CONSTRAINT
- [x] DO NOT modify existing prompt generation (generateCleanPromptAsync, generateSuggestivePromptAsync, generateFollowUpPromptAsync, selectRandomPrompt)
- [x] DO NOT modify existing V2 training queue logic (trainingQueueV2.ts)
- [x] DO NOT modify existing training engine router (trainingEngine.ts)
- [x] Sprint 11 is ADDITIVE ONLY — enrich context, don't rewrite prompts

## Industry Keyword Cache Management UI
- [x] Build Industry Keyword Cache management page (/keyword-cache)
- [x] View all cached industries with keyword counts, client counts, and lock progress
- [x] View cached keywords per industry with AI search volume, search volume, intent, and frequency
- [x] Lock/unlock golden templates per industry (with auto-select top keywords)
- [x] Override/edit cached keywords (add, remove, reorder) with edit mode
- [x] Toggle between All Keywords and Golden Template view
- [x] Refresh/reset cache for an industry (clears golden template, resets client count)
- [x] Delete cache entirely for an industry
- [x] Configurable lock threshold (2, 3, 5, 10 clients)
- [x] Sortable keyword table (by keyword name, AI volume, frequency)
- [x] Summary stats cards (industries cached, golden templates, total keywords, total clients)
- [x] Detail view stats (total keywords, golden keywords, total AI volume, clients/threshold, avg frequency)
- [x] Search/filter industries
- [x] Add Keyword Cache to sidebar navigation with Database icon
- [x] tRPC procedures: lock, unlock, updateKeywords, updateLockThreshold, delete, refresh
- [x] Write 18 tests for keyword cache management
- [x] All 314 tests passing across 25 test files

## Resend Email Integration (my.aianswerforge.com) — COMPLETED
- [x] Install Resend SDK dependency (resend 6.9.4)
- [x] Add RESEND_API_KEY secret (validated, my.aianswerforge.com verified)
- [x] Build Resend email service module (server/emailService.ts)
- [x] Build branded Win Notification email template (dark theme, score gauge, win cards, significance badges)
- [x] Build branded Visibility Report email template (score, platform breakdown, before/after comparison)
- [x] Build Welcome/Onboarding email template (5-step campaign process overview)
- [x] Build Campaign Milestone email template (custom milestone + next step)
- [x] Build test email function (sendTestEmail)
- [x] Wire win notifications to auto-send emails (sendCampaignWinEmails)
- [x] Wire visibility reports to auto-send emails (sendCampaignVisibilityReport)
- [x] Add tRPC procedures: sendTest, sendWinNotification, sendVisibilityReport, sendWelcome, sendMilestone, previewWinEmail, previewVisibilityReport
- [x] Build admin Email Management page (/emails) with send, preview, and test tabs
- [x] Add Emails to sidebar navigation with Mail icon
- [x] contactEmail field already exists on businesses table
- [x] Write 13 tests for email service (mocked Resend, preview HTML, error handling)
- [x] All 328 tests passing across 27 test files

## CRITICAL: Remove ALL Manus Dependencies — Standalone Railway + Supabase App
- [ ] Audit every file for Manus references (OAuth, LLM proxy, notifications, storage, URLs)
- [ ] Replace Manus OAuth with standalone JWT auth (Supabase Auth or custom)
- [ ] Replace invokeLLM (Manus proxy) with direct API calls via existing aiProviders.ts
- [ ] Replace notifyOwner (Manus notification) with Resend email notifications
- [ ] Replace Manus S3 storage helpers with Supabase Storage
- [ ] Remove all manus.space URL references
- [ ] Remove all BUILT_IN_FORGE_* env var dependencies
- [ ] Remove VITE_APP_ID, OAUTH_SERVER_URL, VITE_OAUTH_PORTAL_URL dependencies
- [ ] Clean server/_core files of Manus-specific code
- [ ] Make app fully deployable on Railway + Supabase with zero Manus ties
- [ ] Verify TypeScript compiles clean
- [ ] Run all tests and verify they pass

## Comprehensive Codebase Audit (Mission-Critical)
- [x] CRITICAL: Add ownership verification to wpPublisher router (5 procedures)
- [x] CRITICAL: Add ownership verification to indexing router (4 procedures)
- [x] CRITICAL: Add ownership verification to pipeline router (getStatus)
- [x] CRITICAL: Add ownership verification to rankTracking router (3 procedures)
- [x] CRITICAL: Add ownership verification to clientDashboard router (create, list, toggleActive)
- [x] CRITICAL: Add ownership verification to trainingContext router (4 procedures)
- [x] CRITICAL: Add ownership verification to smartScheduler router (7 procedures)
- [x] CRITICAL: Add ownership verification to wins router (4 procedures)
- [x] CRITICAL: Add ownership verification to email router (6 procedures)
- [x] CRITICAL: Fix pipeline training step stub (now auto-applies aggressive mode + auto-creates training session)
- [x] HIGH: Verify dynamic imports are properly awaited (all checked, all correct)
- [x] Reverse audit: backend services → frontend components (all 25 services wired, all 13 pages connected)
- [x] Audit Supabase RLS policies (RLS disabled — correct for this architecture, all access control at app layer)
- [x] Final Manus dependency verification (only _core framework files reference Manus — correct, these are platform-provided)
- [x] Run all tests and TypeScript compile check (27 test files, 328 tests, 0 TS errors)

## Standalone Audit — Remove Manus Dependencies (ACTUAL TASK)
- [x] REVERT: Remove all ownership checks — this is an internal team tool, all employees share access
- [x] Delete ownershipChecks.ts module
- [x] Revert clientDashboard.list to show all dashboards (not filtered by user)
- [x] Revert test files to original expectations
- [x] AUDIT: Identify all Manus platform dependencies in _core files (10 files need changes, 13 already standalone)
- [x] REPLACE: Manus OAuth with standalone auth (sdk.ts rewritten, oauth.ts stubbed, Supabase Auth is sole auth)
- [x] REPLACE: Manus LLM proxy with direct OpenAI API calls (llm.ts rewritten)
- [x] REPLACE: Manus storage proxy — already uses Supabase Storage directly
- [x] REPLACE: imageGeneration.ts — rewritten to use OpenAI DALL-E directly
- [x] REPLACE: voiceTranscription.ts — rewritten to use OpenAI Whisper directly
- [x] REPLACE: dataApi.ts — rewritten as standalone stub (app uses DataForSEO)
- [x] REPLACE: map.ts — rewritten to use Google Maps API directly
- [x] REPLACE: Map.tsx frontend — rewritten to use Google Maps JS API directly
- [x] REPLACE: Manus notification system — already uses Resend directly
- [x] REMOVE: All remaining Manus references and env vars (env.ts cleaned, manusTypes.ts deleted, zero Manus refs in codebase)
- [x] VERIFY: App runs standalone without any Manus services
- [x] Run all tests and TypeScript compile check (328 tests passing, 0 TS errors)

## Bug Fixes from Comprehensive Code Audit
- [x] FIX: promptGeneration.ts — empty template arrays crash (3 async functions)
- [x] FIX: smartScheduler.ts — unsafe db! assertions (8 locations, all null-guarded)
- [x] FIX: trainingQueue.ts — undefined basePrompt crash (safe fallback added)
- [x] FIX: Remove all remaining userId filters from list operations (team-shared tool)
- [x] FIX: Comprehensive line-by-line code audit — 18 modules audited in parallel

## Database-to-Code Audit (Schema vs Code Consistency)
- [x] Read full schema and build column/table reference map
- [x] Cross-reference every db.ts query against schema columns (all clean)
- [x] Cross-reference every dbCampaigns.ts query against schema columns (all clean)
- [x] Cross-reference every router procedure against schema and db helpers
- [x] Cross-reference all service modules against schema (12 modules audited in parallel)
- [x] Fix all mismatches found (3 real bugs fixed: scheduleType enum, trainingQueue missing fields, credibilityEngine dead fields)
- [x] Run tests and compile check (328 tests passing, 0 TS errors)

## User-Reported Issues
- [ ] BUG: All prompts doubled up in admin Prompts section
- [ ] BUG: AI model lists are outdated — missing Gemini 2.5/2.5 Flash, possibly outdated GPT and Claude models
- [ ] Sweep for other basic issues across the platform
