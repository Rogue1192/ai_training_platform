# AI Answer Forge — Comprehensive Project Handoff

**Date:** April 7, 2026  
**GitHub Repo:** `Rank-Assassin/wp-data-flow` (private)  
**Deployment:** Railway (app server) + Supabase (PostgreSQL database + file storage)  
**Stack:** Node.js / TypeScript / tRPC / Drizzle ORM / React / Vite / TailwindCSS / BullMQ / Redis

---

## 1. What This Platform Is

**AI Answer Forge** is a white-label SaaS platform that trains AI language models (ChatGPT and Gemini) to recommend a client's local business when users ask AI assistants questions like:

> "What's the best HVAC company in Dallas, Texas?"
> "Who's the top-rated fence contractor near me?"

The platform automates the entire workflow:
1. Onboards a local business (via GHL webhook or agency intake form)
2. Researches keywords and identifies commercial/transactional AI query variations
3. Builds credibility content pages and publishes them to the client's WordPress site via Playwright
4. Submits those pages to SinByte for indexing
5. Waits 2 days for indexing, then runs AI training sessions using MiniMax M2 as the trainer teaching ChatGPT (GPT-4.1) and Gemini (2.5 Flash) to recommend the business
6. Polls the AI models to detect when wins occur (business appears in AI responses)
7. Sends win notification emails to both the client and their agency
8. Continues monitoring weekly and retrains if rankings drop

**Business model:** White-label agencies resell this service to local businesses. The platform charges agencies per client per month. Agencies set their own retail pricing.

---

## 2. Infrastructure

### Database
- **Provider:** Supabase (PostgreSQL)
- **Connection:** `SUPABASE_DATABASE_URL` environment variable on Railway
- **ORM:** Drizzle ORM — schema in `drizzle/schema.ts`, migrations in `drizzle/0001_*.sql` through `drizzle/0023_*.sql`
- **IMPORTANT:** RLS is DISABLED on all tables. Auth is handled at the application layer (JWT session cookies). Do NOT enable RLS.

### File Storage
- **Provider:** Supabase Storage
- **Used for:** Before/after scan videos, uploaded assets

### App Server
- **Provider:** Railway
- **Build:** `pnpm install && pnpm build`
- **Start:** `pnpm start`
- **Background workers:** BullMQ (Redis-backed) for training queue

### Key Environment Variables (set in Railway)
```
SUPABASE_DATABASE_URL=        # PostgreSQL connection string
SUPABASE_URL=                 # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=    # Supabase service role key
REDIS_URL=                    # Redis connection for BullMQ
APP_BASE_URL=                 # e.g., https://your-domain.railway.app
SESSION_SECRET=               # JWT session signing secret
ENCRYPTION_KEY=               # AES encryption key for stored secrets
```

All other API keys (OpenAI, Gemini, MiniMax, DataForSEO, SinByte, Resend, Stripe) are stored **encrypted in the `serviceKeys` database table** and managed via the Settings UI. They are NOT environment variables.

---

## 3. Database Schema — All Tables

| Table | Purpose |
|---|---|
| `users` | Platform users (role: `user`, `admin`, `agency`) |
| `agencies` | White-label agency accounts |
| `businesses` | Client businesses (each belongs to an agency or is direct) |
| `apiKeys` | Global AI provider keys (OpenAI, Anthropic, Google, MiniMax) |
| `serviceKeys` | Encrypted external service keys (DataForSEO, SinByte, Resend, Stripe, Whitelabel) |
| `packageTiers` | Platform package definitions (Starter/Growth/Pro/Enterprise) |
| `campaigns` | One per client — the core automation unit |
| `campaignQueryLocations` | One row per keyword × location combo per campaign |
| `trainingSessions` | One per keyword × location × AI model combo |
| `trainingConversations` | Individual conversation turns within a training session |
| `credibilityData` | Structured credibility research results per business |
| `contentPages` | Generated credibility content pages (draft → published) |
| `llmTxtFiles` | LLM.txt files generated and published for each client |
| `schemaMarkupRecommendations` | Schema.org markup recommendations per business |
| `rankSnapshots` | Historical rank tracking snapshots |
| `clientDashboards` | White-label client-facing report dashboards |
| `scheduledJobs` | Background job definitions |
| `scheduledJobRuns` | Background job execution history |
| `platformMetrics` | Platform-wide metrics |
| `promptTemplates` | AI prompt templates (editable in admin UI) |
| `industryKeywordCache` | Cached keyword research results by industry |
| `webhookLogs` | GHL webhook event log |
| `notificationLogs` | Email notification log |

### Key Fields on `businesses`
- `agencyId` — links to the agency that owns this client (null = direct client)
- `agencyWinEmailsEnabled` — boolean, default `true` — if false, agency does NOT receive win emails for this client
- `siteAdminUrl`, `siteUsername`, `sitePasswordEncrypted` — WordPress credentials for Playwright publishing
- `clientType` — enum: `ai_only` | `ai_plus_seo` | `ai_plus_seo_plus_build`

### Key Fields on `campaignQueryLocations`
- `searchQuery` — the keyword topic (e.g., "best HVAC company")
- `location` — target location (e.g., "Dallas, TX")
- `trainingStatus` — `pending` | `before_capture` | `training` | `achieved` | `monitoring` | `recovering`
- `trainingRunCount` — how many full 50-iteration runs have fired (max 4 in initial phase)
- `lastRunCompletedAt` — when the last run finished
- `nextPollAt` — when to next run the LLM poll (set to `now + 24h` after each run)
- `monitoringStartedAt` — when the combo entered weekly monitoring
- `lastMonitoringPollAt` — last weekly monitoring poll
- `beforeVideoCapturedAt` — set once when before video is captured
- `beforeVideoChatgpt`, `beforeVideoGoogleAi` — Supabase Storage URLs
- `afterVideoChatgpt`, `afterVideoGoogleAi` — set on first win detection

---

## 4. Agency Package Pricing

Agencies are charged per client per month. The platform charges the agency; agencies set their own retail pricing.

| Package | Keywords | Locations | Platform Price | Suggested Retail |
|---|---|---|---|---|
| Starter | 5 | 3 | $99/mo | $297–$347/mo |
| Growth | 5 | 5 | $149/mo | $397–$497/mo |
| Pro | 10 | 5 | $179/mo | $697–$797/mo |

**One-time agency setup fee:** $397 (Stripe payment link: `https://buy.stripe.com/dRm4gy1ZYfZKdNl6QY3F600`)

**Stripe Price IDs (live mode):**
- Starter: `price_1TJQNbCtHfUq3SHJrproNUkD`
- Growth: `price_1TJQNgCtHfUq3SHJn8clZJ3o`
- Pro: `price_1TJQNnCtHfUq3SHJOeYlcVHG`
- Setup fee: `price_1TJPJYCtHfUq3SHJGJn6iqvh`

---

## 5. The Full Automation Pipeline

When a client is onboarded (via GHL webhook or agency intake form), the pipeline runs these steps in order:

### Step 1: `keyword_research`
- File: `server/keywordResearchPipeline.ts`
- Uses DataForSEO to find AI search volume for the business's industry + location
- Filters to **commercial and transactional intent only** (no informational queries)
- Generates up to 8 query variations per keyword using `queryPromptExpander.ts`
- Creates rows in `campaignQueryLocations` for each keyword × location combo
- **Captures "before" videos** via Playwright (`scanVideoRecorder.ts`) — one per keyword × location combo on ChatGPT and Google AI. This happens ONCE, before any training. Never re-captured unless client upgrades and new keywords/locations are added.

### Step 2: `credibility_research`
- File: `server/credibilityResearchEngine.ts`
- Researches the business: BBB rating, certifications, awards, reviews, social profiles
- Stores structured data in `credibilityData` table
- Uses Anthropic Claude for content synthesis

### Step 3: `content_generation`
- File: `server/contentGenerationEngine.ts`
- Generates credibility content pages (about, services, FAQ, location, etc.)
- Also generates `llm.txt` file and schema.org markup
- Stores pages in `contentPages` table with status `draft` → `generated`

### Step 4: `publishing`
- File: `server/contentPublisher.ts`
- Uses Playwright to log into the client's WordPress site and publish pages
- **If Playwright FULLY fails (0 pages published):**
  - Pipeline STOPS (does not continue to indexing)
  - Emails all super admins with: client name, campaign dashboard link, list of all pages that need manual publishing
  - Admin manually publishes pages on client's site
  - Admin pastes each live URL into the campaign dashboard (Content tab → URL input fields)
  - When ALL URLs are entered, indexing fires automatically
- **If Playwright partially fails:** Pipeline continues with successfully published pages; admin notified of failed ones
- **If Playwright fully succeeds:** Pipeline continues immediately

### Step 5: `indexing`
- File: `server/sinbyteIndexing.ts`
- Submits all published page URLs to SinByte for Google indexing
- Sets `indexingSubmittedAt` on the campaign

### Step 6: `indexing_verification`
- Verifies pages are being indexed (HTTP check)
- Sets `indexingVerifiedAt`

### Step 7: `baseline_check`
- Runs initial LLM rank check to establish baseline (before training)
- Records in `rankSnapshots`

### Step 8: `training` — **WAITS 2 DAYS AFTER INDEXING**
- File: `server/trainingCycleOrchestrator.ts` + `server/scheduler.ts`
- The scheduler checks every hour for campaigns where `indexingSubmittedAt` is ≥ 2 days ago and `trainingStartedAt` is null
- Creates training sessions: **one per keyword × location × AI model**
  - For 5 keywords × 3 locations × 2 models = 30 sessions
  - Each session has exactly 8 prompt variations for that specific query + location
- Sessions run via BullMQ (`trainingQueueV2.ts`) — parallel execution
- **Trainer model:** MiniMax M2 (via MiniMax API)
- **Trainee models:** GPT-4.1 (OpenAI) and Gemini 2.5 Flash (Google)
- Each session runs 50 iterations, cycling through all 8 prompt variations evenly (shuffled-cycle algorithm — guaranteed equal distribution, not pure random)
- Each iteration: trainer sends suggestive prompt → if business not mentioned, fires follow-up reinforcement message

---

## 6. Training Cycle — The 4-Run Cycle with 24h Gaps

After training sessions are created, the `trainingCycleOrchestrator.ts` drives the full lifecycle:

```
Day 0:  Run 1 fires for ALL keyword × location combos
Day 1:  24h wait → LLM poll → wins detected → win emails sent → after video captured
        → Run 2 fires IMMEDIATELY for non-won combos
Day 2:  24h wait → LLM poll → more wins → Run 3 fires for remaining
Day 3:  24h wait → LLM poll → more wins → Run 4 fires for remaining
Day 4:  24h wait → FINAL LLM poll → remaining non-won combos enter MONITORING state
```

**Win detection:** LLM poll queries each AI model with the actual search query and checks if the business name appears in the response. Detected via `rankTrackingEngine.ts` / `dataforseoService.ts`.

**On win:**
1. Mark combo `trainingStatus = 'achieved'`
2. Set `firstMentionedAt` timestamp
3. Capture "after" video via Playwright (one-time, at moment of first detection)
4. Send win email to business contact AND agency (unless `agencyWinEmailsEnabled = false`)
5. Remove from training rotation

**After run 4:** Non-won combos enter `monitoring` state.

### Weekly Monitoring (indefinite)

Every 7 days, LLM poll runs against ALL combos (won + non-won):

| Combo state | Result | Action |
|---|---|---|
| `achieved` | Still appearing | No action |
| `achieved` | Dropped out | Move to `recovering`, fire 1 single recovery run, wait 24h, poll again |
| `monitoring` | Now appearing | Win email, mark `achieved` |
| `monitoring` | Still not appearing | Leave in monitoring, check again next week |
| `recovering` | Back in results | Move back to `achieved` |
| `recovering` | Still gone | Move back to `monitoring`, wait 7 more days |

---

## 7. Win Email System

- File: `server/emailService.ts` — function `sendCampaignWinEmails()`
- Every win sends email to:
  1. The business contact email (`businesses.contactEmail`)
  2. The agency contact email (`agencies.contactEmail`) — **unless** `businesses.agencyWinEmailsEnabled = false`
- Agency toggle is per-client, set in the Agency Portal → Client Detail page
- Win emails are sent via Resend (key stored in `serviceKeys` table)

---

## 8. Agency White-Label Onboarding Flow

**There is NO inbound webhook for white-label agency clients.** Agency client onboarding is strictly:

1. Agency logs into the Agency Portal
2. Agency either fills out the intake form directly, OR copies the branded intake link (`/intake/{intakeToken}`) and sends it to their client
3. Client fills out the intake form
4. Form submission creates the business record and queues them for tier assignment
5. Agency assigns a package tier (Starter/Growth/Pro) in the portal
6. `assignClientTier` procedure fires → creates campaign → kicks off full pipeline → creates Stripe subscription

**Direct client onboarding (non-agency):** Via GHL (GoHighLevel) webhook at `/api/webhook/ghl`. The webhook secret is verified against the `inboundWebhookSecret` stored in the `serviceKeys` table (whitelabel service key's encrypted JSON). This is configured in Settings → Inbound Webhook Secret.

---

## 9. Admin Capabilities

### Super Admin can see/do:
- All businesses, campaigns, training sessions
- **WordPress credentials** for any client (for manual fallback when Playwright fails)
  - `siteAdminUrl`, `siteUsername` visible in admin
  - `sitePasswordEncrypted` — decryptable via admin procedure
- Manually enter published page URLs when Playwright fails (Content tab in campaign dashboard)
- Once all URLs are entered, indexing fires automatically
- Manage all service keys (DataForSEO, SinByte, Resend, Stripe, Whitelabel webhook secret)
- Manage prompt templates
- View platform metrics
- Trigger pipeline steps manually

---

## 10. What Was Done in This Session (Commits)

### Commit `198e4ff` — 3 Critical Bug Fixes
1. **`assignClientTier` not triggering pipeline** — Fixed 3 TypeScript errors: wrong import for `getDb`, wrong import source for `getPackageTierBySlug`/`seedDefaultPackageTiers`, invalid `clientType` value `'agency'` (changed to `'ai_only'`)
2. **Win notifications not reaching agencies** — Removed `(business as any)` casts in `sendCampaignWinEmails`, now uses proper typed `business.agencyId`
3. **No auto-creation of training sessions** — Added `checkPendingTrainingKickoffs()` to scheduler (runs every 6h), finds campaigns where `indexingSubmittedAt` ≥ 2 days ago and `trainingStartedAt` is null, fires training step

### Commit `096f891` — Agency Win Email Toggle
- Added `agencyWinEmailsEnabled` boolean to `businesses` table (default `true`)
- Migration: `drizzle/0021_agency_win_emails_toggle.sql`
- New `agency.setClientWinEmails` tRPC mutation
- Toggle UI in Agency Portal → Client Detail page

### Commit `0f715f0` — Major Architecture Overhaul
1. **Competitor tracking removed entirely** — stripped from schema, `rankTrackingEngine`, `dataforseoService`, frontend
2. **Webhook secret verification fixed** — `verifyWebhookAuth()` now decrypts the `serviceKeys` whitelabel record's `encryptedValue` JSON and reads `inboundWebhookSecret` from it (not just env var)
3. **Inbound webhook secret UI** — new field in Settings + `setInboundWebhookSecret` tRPC procedure
4. **Training session structure redesigned** — one session per keyword × location × AI model (not one pooled session per model)
5. **Prompt distribution fixed** — shuffled-cycle algorithm replaces pure random, guarantees all 8 variations used equally across 50 iterations
6. **`trainingCycleOrchestrator.ts` created** — full 4-run cycle with 24h gaps, weekly monitoring, recovery runs
7. **Scheduler wired** — cycle orchestrator runs hourly
8. **Schema migrations 0022 + 0023** — drop `competitors` column, add 6 cycle tracking columns to `campaignQueryLocations`

### Commit `15ddec5` — Publishing Failure Flow Fixed
- Full Playwright failure: pipeline STOPS, super admins emailed with page list
- Partial failure: pipeline continues, admin notified of failed pages
- New `campaign.setContentPageUrl` tRPC mutation — admin pastes live URL per page
- When ALL URLs saved → indexing fires automatically
- Campaign dashboard Content tab: amber warning banner + inline URL input per unpublished page

---

## 11. Pending Database Migrations — MUST RUN ON SUPABASE

These 3 migration files are in the repo but have NOT been applied to the production Supabase database yet. They must be run via the Supabase SQL editor:

### Migration 0021 — Agency Win Email Toggle
```sql
ALTER TABLE "businesses"
  ADD COLUMN IF NOT EXISTS "agencyWinEmailsEnabled" BOOLEAN NOT NULL DEFAULT TRUE;
```

### Migration 0022 — Remove Competitors Column
```sql
ALTER TABLE "businesses" DROP COLUMN IF EXISTS "competitors";
```

### Migration 0023 — Training Cycle Tracking Columns
```sql
ALTER TABLE "campaignQueryLocations"
  ADD COLUMN IF NOT EXISTS "trainingRunCount"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastRunCompletedAt"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "nextPollAt"             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "monitoringStartedAt"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "lastMonitoringPollAt"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "beforeVideoCapturedAt"  TIMESTAMPTZ;
```

**How to run:** Log into Supabase dashboard → select the correct project → SQL Editor → paste and run each block.

**The correct Supabase project** is the one whose `SUPABASE_DATABASE_URL` matches the Railway environment variable. The Supabase API key is `sbp_8ef707018d908b63679574651faff611a1d0c9b6` but the MCP auth has expired in the current session — needs re-authentication via the Supabase dashboard login.

---

## 12. Known Open Issues / Still To Do

### From `todo.md` — User-Reported Bugs (not yet fixed)
1. **BUG: All prompts doubled up in admin Prompts section** — The Prompts admin page shows every prompt template twice. Root cause unknown, likely a duplicate query or double-render issue.
2. **BUG: AI model lists are outdated** — The model selection dropdowns are missing Gemini 2.5 / 2.5 Flash and may have outdated GPT and Claude model names. Need to update `aiProviders.ts` and any hardcoded model lists.

### From Audit — Low Priority (not blockers)
- Missing DB indexes on `campaignQueryLocations.campaignId`, `rankSnapshots.campaignId`, `contentPages.campaignId`, `credibilityData.businessId` — add for performance at scale
- Foreign key constraints missing on `trainingSessions.campaignId`, `trainingSessions.campaignQueryLocationId`, `businesses.sourceWebhookId`, `campaigns.sourceWebhookId`
- Race condition on `errorCount` increment (not critical)

### Architecture Items
- The `trainingQueue.ts` (V1) is still in the codebase but only `trainingQueueV2.ts` is used for new sessions. V1 can be deprecated/removed eventually.
- `smartScheduler.ts` has some overlap with `trainingCycleOrchestrator.ts` — the cycle orchestrator is the authoritative source for training lifecycle; smartScheduler handles other campaign mode changes.

---

## 13. How to Continue in a New Session

1. **Clone the repo** (already on GitHub: `Rank-Assassin/wp-data-flow`)
2. **Run the 3 pending migrations** on Supabase (SQL in Section 11 above)
3. **Fix the 2 user-reported bugs** (doubled prompts, outdated model lists)
4. **Continue the full audit** per the original audit doc — the main remaining items are the low-priority schema FK constraints and missing indexes
5. **Test the full pipeline end-to-end** with a test client to verify the training cycle orchestrator works correctly

---

## 14. File Structure Reference

```
/server
  webhookHandler.ts         — GHL inbound webhook (direct client onboarding)
  routers.ts                — All tRPC procedures (8000+ lines)
  pipelineOrchestrator.ts   — Pipeline step runner
  keywordResearchPipeline.ts — Step 1: keyword research + before video
  credibilityResearchEngine.ts — Step 2: credibility research
  contentGenerationEngine.ts — Step 3: content generation
  contentPublisher.ts       — Step 4: Playwright publishing
  sinbyteIndexing.ts        — Step 5: SinByte indexing submission
  rankTrackingEngine.ts     — LLM rank checking / win detection
  trainingCycleOrchestrator.ts — 4-run cycle + weekly monitoring
  trainingQueueV2.ts        — BullMQ worker for training sessions
  promptGeneration.ts       — Prompt building + shuffled-cycle selection
  queryPromptExpander.ts    — Expands keyword → 8 query variations
  emailService.ts           — All email sending (wins, alerts, onboarding)
  scanVideoRecorder.ts      — Playwright before/after video capture
  scheduler.ts              — Background job scheduler (hourly/daily checks)
  stripeAgency.ts           — Stripe billing for agencies
  agencyPackages.ts         — Package tier definitions + Stripe price IDs
  db.ts                     — Database helpers (users, businesses, API keys)
  dbCampaigns.ts            — Campaign + package tier DB helpers
  dbAgencies.ts             — Agency DB helpers
  encryption.ts             — AES encryption for stored secrets

/drizzle
  schema.ts                 — Full database schema (source of truth)
  0001_*.sql – 0023_*.sql   — Migration files (0021-0023 pending on production)

/client/src/pages
  AgencyPortal.tsx          — Agency dashboard (client list, intake form)
  AgencyClientDetail.tsx    — Per-client detail + win email toggle
  CampaignDetail.tsx        — Campaign dashboard (pipeline status, content, training)
  Settings.tsx              — Platform settings (API keys, webhook secrets)
  AdminBusinesses.tsx       — Admin client management
```
