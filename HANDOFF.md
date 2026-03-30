# AI Answer Forge — Comprehensive Handoff Document

**Last Updated:** March 30, 2026  
**Project Name:** ai_training_platform  
**Product Name:** AI Answer Forge  
**Owner:** Rogue Business Marketing  

---

## 1. What This App Does

AI Answer Forge is an **internal team tool** (NOT a SaaS product) that automates getting businesses ranked in AI search results (ChatGPT, Gemini, Perplexity, Claude, etc.). The core workflow:

1. A new client is onboarded via GHL (GoHighLevel) webhook → creates a business + campaign
2. The **automated pipeline** runs: keyword research → credibility research → content generation → WordPress publishing → Google indexing → rank checking → AI training
3. **AI Training** is the core feature: the system prompts AI providers (OpenAI, Google, Anthropic, Perplexity) with suggestive prompts to influence them to mention the client's business in AI-generated answers
4. The platform tracks wins (when an AI starts mentioning the business) and sends email notifications

**Critical context:** This is a shared internal tool. ALL employees see ALL data. There are NO per-user restrictions on viewing businesses, campaigns, or training sessions. Any logged-in employee can work on any client's data.

---

## 2. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| **Frontend** | React 19 + Tailwind CSS 4 + shadcn/ui | Dark theme, electric blue palette |
| **Backend** | Express 4 + tRPC 11 | All API calls go through tRPC procedures |
| **Database** | PostgreSQL (Supabase) | Connected via Drizzle ORM, SSL required |
| **Auth** | Supabase Auth | Email/password login, optional 2FA (TOTP) |
| **Queue** | BullMQ + Redis | Training jobs run through Redis queues |
| **Email** | Resend | Sends from `@my.aianswerforge.com` |
| **AI Providers** | OpenAI, Google (Gemini), Anthropic, Perplexity | Direct API calls via `aiProviders.ts` |
| **SEO Data** | DataForSEO | Keyword research, AI keyword volumes, LLM mentions |
| **Indexing** | SinByte | Submits published URLs for fast Google indexing |
| **Publishing** | WordPress REST API | Publishes content pages to client WordPress sites |
| **Storage** | Supabase Storage | Bucket: `aaf-storage` |
| **Hosting** | Railway (target) | Currently on Manus for dev, deploying to Railway |
| **Encryption** | AES-256-GCM | API keys encrypted at rest with ENCRYPTION_KEY |

---

## 3. Environment Variables Required

These must be set on Railway (or wherever you deploy):

### Critical — App Won't Work Without These
| Variable | Purpose |
|----------|---------|
| `SUPABASE_DATABASE_URL` or `DATABASE_URL` | PostgreSQL connection string (Supabase pooler URL) |
| `JWT_SECRET` | Session cookie signing / encryption fallback |
| `ENCRYPTION_KEY` | AES-256 encryption for stored API keys. **MUST be same across all environments** |
| `SUPABASE_URL` | Supabase project URL (e.g., `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side Supabase admin key |
| `VITE_SUPABASE_URL` | Same as SUPABASE_URL, exposed to frontend |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon/public key for frontend auth |

### Required for Core Features
| Variable | Purpose |
|----------|---------|
| `REDIS_HOST` | Redis host for BullMQ training queue |
| `REDIS_PORT` | Redis port (default: 6379) |
| `REDIS_PASSWORD` | Redis password |
| `DATAFORSEO_LOGIN` | DataForSEO API login |
| `DATAFORSEO_PASSWORD` | DataForSEO API password |
| `RESEND_API_KEY` | Resend email API key |
| `SINBYTE_API_KEY` | SinByte indexing API key |

### Optional
| Variable | Purpose |
|----------|---------|
| `APP_BASE_URL` or `VITE_APP_BASE_URL` | Production URL for email links (e.g., `https://app.aianswerforge.com`) |
| `OPENAI_API_KEY` | Only needed if using the `_core/llm.ts` helper (app uses per-business keys instead) |
| `GOOGLE_MAPS_API_KEY` | Only if using the Map component (not currently used) |
| `ADMIN_NOTIFICATION_EMAIL` or `OWNER_EMAIL` | Where admin notifications go via Resend |

### NOT Needed (Manus-specific, removed)
These were Manus platform variables and are **no longer used**:
- `BUILT_IN_FORGE_API_KEY`, `BUILT_IN_FORGE_API_URL`
- `VITE_FRONTEND_FORGE_API_KEY`, `VITE_FRONTEND_FORGE_API_URL`
- `VITE_APP_ID`, `OAUTH_SERVER_URL`, `VITE_OAUTH_PORTAL_URL`
- `OWNER_OPEN_ID`, `OWNER_NAME`

---

## 4. Database Schema (All Tables)

The database uses PostgreSQL via Drizzle ORM. Schema file: `drizzle/schema.ts`

### Core Tables

**users** — Employee accounts (synced from Supabase Auth)
- `id` (serial PK), `openId` (text, unique — Supabase user UUID), `email`, `name`, `role` (enum: admin/user), `loginMethod`, `lastSignedIn`, `createdAt`

**businesses** — Client businesses being promoted
- `id` (serial PK), `userId` (FK→users), `name`, `website`, `industry`, `description`, `targetAudience`, `uniqueSellingPoints`, `competitors` (json), `locations` (json), `contactEmail`, `contactName`, `contactPhone`, `yearsInBusiness`, `certifications`, `bbbRating`, `awards`, `createdAt`, `updatedAt`

**campaigns** — One campaign per business per package tier
- `id` (serial PK), `userId` (FK→users), `businessId` (FK→businesses), `campaignName`, `status` (enum: pending/keyword_research/credibility_research/content_generation/publishing/indexing/indexing_verification/baseline_check/training/active/paused/completed/error), `clientType` (enum: ai_only/ai_plus_seo/ai_plus_seo_plus_build/maintenance), `packageTierId` (FK→packageTiers), `pipelineStep`, `pipelineStartedAt`, `pipelineLastActivity`, `pipelineError`, `createdAt`, `updatedAt`

**apiKeys** — Per-business encrypted AI provider API keys
- `id` (serial PK), `userId` (FK→users), `provider` (enum: openai/google/anthropic/perplexity), `encryptedKey` (text), `label`, `isActive`, `lastUsedAt`, `createdAt`

### Keyword & Research Tables

**keywordCache** — Cached keyword research results from DataForSEO
- `id`, `campaignId`, `keyword`, `searchVolume`, `competition`, `cpc`, `searchIntent`, `monthlySearches` (json), `source`, `createdAt`

**aiKeywordCache** — AI-specific keyword volume data
- `id`, `campaignId`, `keyword`, `aiSearchVolume`, `monthlyTrend` (json), `source`, `createdAt`

**llmMentionCache** — LLM mention tracking (does ChatGPT/Gemini/etc mention the business?)
- `id`, `campaignId`, `keyword`, `aiSearchVolume`, `monthlyTrend` (json), `llmResponses` (json), `source`, `createdAt`

**credibilityData** — Business credibility research results
- `id`, `campaignId`, `dataType` (enum), `dataValue` (json), `source`, `confidence`, `createdAt`

### Content Tables

**contentPages** — Generated content pages for WordPress publishing
- `id`, `campaignId`, `title`, `slug`, `content` (text — full HTML), `metaDescription`, `targetKeywords` (json), `status` (enum: draft/review/approved/published/rejected), `publishedUrl`, `publishedAt`, `wordpressPostId`, `indexingTaskId`, `indexingStatus`, `indexingSubmittedAt`, `indexingVerifiedAt`, `interlinkTargets` (json), `createdAt`, `updatedAt`

**wpCredentials** — WordPress site credentials (encrypted)
- `id`, `businessId`, `siteUrl`, `username`, `encryptedPassword`, `isActive`, `lastTestedAt`, `createdAt`

### Training Tables

**trainingSessions** — AI training session configurations
- `id`, `userId`, `businessId`, `targetAi` (enum: chatgpt/gemini/perplexity/claude), `influencerAi` (enum: chatgpt/gemini/perplexity/claude), `status` (enum: pending/in_progress/completed/paused/error), `iterations`, `completedIterations`, `trainingGoal`, `trainingPrompts` (json), `results` (json), `currentPhase` (enum: pending/baseline/training/evaluation/completed), `baselineMentionRate`, `currentMentionRate`, `influenceScore`, `baselineCompleted`, `trainingCompleted`, `evaluationCompleted`, `retryInterval`, `errorMessage`, `createdAt`, `updatedAt`

**trainingConversations** — Individual prompt/response pairs from training
- `id`, `sessionId` (FK→trainingSessions), `prompt`, `response` (text), `aiProvider`, `model`, `mentioned` (boolean), `mentionContext`, `responseTime`, `conversationType` (enum: baseline/training/evaluation), `promptType` (enum: clean/suggestive/follow_up), `businessMentionedUnprompted` (boolean), `mentionConfidence` (real), `createdAt`

**trainingContext** — Enriched context for training prompts
- `id`, `businessId`, `contextType` (enum), `content` (text), `source`, `confidence`, `isActive`, `createdAt`, `updatedAt`

### Scheduling Tables

**scheduledJobs** — Recurring training job schedules
- `id`, `userId`, `sessionId` (FK→trainingSessions), `scheduleType` (enum: hourly/daily/weekly/monthly/custom), `timeOfDay`, `dayOfWeek`, `dayOfMonth`, `timezone`, `isActive`, `nextRunAt`, `lastRunAt`, `createdAt`, `updatedAt`

**scheduledJobRuns** — History of every scheduled job execution
- `id`, `jobId` (FK→scheduledJobs), `sessionId`, `status` (enum: pending/running/completed/failed/skipped), `startedAt`, `completedAt`, `result` (json), `error`

### Other Tables

**packageTiers** — Service package definitions (ai_only, ai_plus_seo, etc.)
- `id`, `name`, `slug`, `description`, `features` (json), `maxKeywords`, `maxContentPages`, `includesTraining`, `includesPublishing`, `isActive`, `createdAt`

**campaignQueryLocations** — Geographic targeting for campaigns
- `id`, `campaignId`, `location`, `isActive`, `createdAt`

**webhookLogs** — Incoming webhook request logs
- `id`, `source`, `eventType`, `payload` (json), `status`, `error`, `processedAt`, `createdAt`

**platformMetrics** — Daily platform-wide metrics
- `id`, `userId`, `metricType`, `metricValue`, `metadata` (json), `recordedAt`

**clientDashboards** — Client-facing dashboard configurations
- `id`, `campaignId`, `businessId`, `accessToken`, `isActive`, `settings` (json), `createdAt`

**wins** — Detected AI mention wins
- `id`, `campaignId`, `businessId`, `aiProvider`, `keyword`, `query`, `snippet`, `url`, `detectedAt`, `notified`, `createdAt`

**rankSnapshots** — Historical rank tracking data
- `id`, `campaignId`, `keyword`, `aiProvider`, `mentioned`, `position`, `snippet`, `checkedAt`

---

## 5. File Structure — Server Side

### Core Framework Files (`server/_core/`)
These are infrastructure files. Most have been cleaned of Manus dependencies.

| File | Purpose | Status |
|------|---------|--------|
| `index.ts` | Server entry point. Starts Express, tRPC, webhook routes, training workers, scheduler | **Working** |
| `context.ts` | tRPC context — extracts Supabase user from Bearer token | **Working** |
| `supabaseAuth.ts` | Verifies Supabase JWT tokens, syncs user to DB | **Working** |
| `supabase.ts` | Supabase client config (server-side, service role key) | **Working** |
| `env.ts` | Environment variable exports | **Working** — cleaned of Manus vars |
| `trpc.ts` | tRPC router/procedure definitions | **Working** |
| `cookies.ts` | Cookie utilities | **Working** |
| `vite.ts` | Vite dev server + static file serving | **Working** |
| `notification.ts` | Admin notifications via Resend email | **Working** — standalone |
| `systemRouter.ts` | System tRPC routes (notifyOwner) | **Working** |
| `llm.ts` | LLM helper — **rewritten to use OpenAI directly** | **Working** but NOT used by the app (app uses `aiProviders.ts` instead) |
| `imageGeneration.ts` | Image gen — **rewritten to use DALL-E** | **Dead code** — nothing in the app uses this |
| `voiceTranscription.ts` | Voice transcription — **rewritten to use Whisper** | **Dead code** — nothing in the app uses this |
| `dataApi.ts` | Data API stub | **Dead code** — app uses DataForSEO directly |
| `map.ts` | Google Maps helper | **Dead code** — Map component not used |
| `sdk.ts` | Session manager — **rewritten as standalone JWT** | **Working** but auth goes through Supabase now |
| `oauth.ts` | OAuth stub — **redirects to /login** | **Working** — Manus OAuth fully removed |

### Application Server Files (`server/`)

| File | Purpose | Status |
|------|---------|--------|
| `routers.ts` | **Main tRPC router** — ALL API procedures (~1900 lines) | **Working** — see known issues below |
| `db.ts` | Database helper functions (users, businesses, API keys, training, scheduling, metrics, prompts) | **Working** |
| `dbCampaigns.ts` | Campaign-specific DB helpers (CRUD, content pages, WP creds, package tiers, webhooks, wins, ranks) | **Working** |
| `aiProviders.ts` | **Core AI integration** — calls OpenAI, Google Gemini, Anthropic, Perplexity directly | **Working** — see model list issue below |
| `encryption.ts` | AES-256-GCM encryption for API keys | **Working** |
| `storage.ts` | Supabase Storage helpers (upload/download) | **Working** |
| `webhookHandler.ts` | GHL webhook intake — creates businesses + campaigns from onboarding payloads | **Working** |
| `pipelineOrchestrator.ts` | Automated pipeline — runs all steps from keyword research to training | **Working** |
| `dataforseoService.ts` | DataForSEO API client — keyword research, AI volumes, LLM mentions | **Working** |
| `credibilityResearchEngine.ts` | Researches business credibility data using AI | **Working** — cleaned dead field refs |
| `contentGenerationEngine.ts` | Generates SEO content pages using AI | **Working** |
| `wpPublisher.ts` | Publishes content to WordPress via REST API | **Working** |
| `sinbyteIndexing.ts` | Submits URLs to SinByte for Google indexing | **Working** |
| `rankTrackingEngine.ts` | Checks AI provider rankings for keywords | **Working** |
| `trainingEngine.ts` | V1 training engine — runs training iterations | **Working** |
| `trainingQueue.ts` | V1 BullMQ training queue worker | **Working** |
| `trainingQueueV2.ts` | V2 phase-based training (baseline → training → evaluation) | **Working** |
| `promptGeneration.ts` | Generates clean, suggestive, and follow-up prompts for training | **Working** — fixed empty template crash |
| `trainingContextEnricher.ts` | Enriches training context with credibility data | **Working** |
| `scheduler.ts` | Cron-like scheduler for recurring training jobs | **Working** |
| `smartScheduler.ts` | Adaptive scheduling — adjusts frequency based on performance | **Working** — fixed null db guards |
| `emailService.ts` | Branded email templates via Resend | **Working** |
| `winDetection.ts` | Detects when AI providers start mentioning a business | **Working** |

---

## 6. File Structure — Frontend

### Pages (`client/src/pages/`)

| File | Route | Purpose |
|------|-------|---------|
| `Home.tsx` | `/` | Dashboard — campaign overview, metrics, recent activity |
| `Login.tsx` | `/login` | Email/password login with Supabase Auth |
| `Businesses.tsx` | `/businesses` | Business management — add/edit/view client businesses |
| `CampaignDetail.tsx` | `/campaigns/:id` | Single campaign view — pipeline status, content, training |
| `Training.tsx` | `/training` | Training session management — create, monitor, results |
| `Settings.tsx` | `/settings` | API key management, user settings |
| `PromptTemplates.tsx` | `/prompts` | Prompt template management for training |
| `Scheduling.tsx` | `/scheduling` | Scheduled job management — create/edit recurring training |
| `ContentPages.tsx` | `/content` | Content page review and management |
| `RankTracking.tsx` | `/rank-tracking` | AI ranking reports and trends |
| `Wins.tsx` | `/wins` | Win detection — when AI starts mentioning businesses |
| `TwoFactorSetup.tsx` | `/2fa-setup` | 2FA enrollment (TOTP) |
| `TwoFactorVerify.tsx` | `/2fa-verify` | 2FA verification during login |

### Key Client Files

| File | Purpose |
|------|---------|
| `client/src/App.tsx` | Route definitions, DashboardLayout wrapper |
| `client/src/lib/trpc.ts` | tRPC client setup with Supabase Bearer token injection |
| `client/src/lib/supabase.ts` | Supabase client (frontend, anon key) |
| `client/src/const.ts` | App constants |
| `client/src/index.css` | Theme — dark navy + electric blue OKLCH palette |
| `client/index.html` | HTML shell — Inter + Space Grotesk fonts |

---

## 7. Known Issues — MUST FIX

### 7a. CRITICAL: Doubled-Up Prompts
**File:** `server/db.ts` — `seedDefaultPromptTemplates()` and `deleteAllPromptTemplates()`  
**Problem:** The seed function was checking per-user (`hasPromptTemplates(userId)`) but the list function returns ALL templates globally. If multiple employees log in, or if "Reset to Defaults" is clicked, templates get duplicated.  
**Status:** Partially fixed — `seedDefaultPromptTemplates` now checks globally with `hasAnyPromptTemplates()` and `deleteAllPromptTemplates` now deletes ALL templates (not per-user). **But existing duplicate data in the database needs to be cleaned up manually** — run a SQL query to deduplicate.  
**Fix needed:** Run SQL to delete duplicate prompt templates from the database.

### 7b. CRITICAL: Outdated AI Model Lists
**File:** `server/aiProviders.ts` — `getAvailableModels()` function  
**Current model lists (as of this doc):**
- **OpenAI:** `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`
- **Anthropic:** `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, `claude-opus-4-5-20251101`
- **Google:** `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`

**Problems:**
- Google Gemini is missing `gemini-2.5-pro` and `gemini-2.5-flash` — Google uses Gemini 2.5 in AI Mode. Without these models, training against Gemini will use the wrong model.
- OpenAI may need `gpt-4.1`, `gpt-4.1-mini`, `o3-mini`, `o4-mini` or whatever the latest models are
- `gpt-4-turbo` and `gpt-3.5-turbo` are legacy and should probably be removed or moved to bottom of list

**Also:** The `AIProvider` type only includes `openai | anthropic | google` but the schema has `perplexity` as a valid provider. The `callAI()` function will throw "Unsupported AI provider: perplexity" if someone tries to train against Perplexity. A `callPerplexity()` function needs to be added.

**Fix needed:** 
1. Update model lists in `getAvailableModels()` to include latest models
2. Add Perplexity API support to `callAI()` — Perplexity uses an OpenAI-compatible API at `https://api.perplexity.ai/chat/completions`
3. Update the `AIProvider` type to include `perplexity`

### 7c. MEDIUM: `_core/llm.ts`, `imageGeneration.ts`, `voiceTranscription.ts` are dead code
**Problem:** These files exist but nothing in the app imports or uses them. They were part of the Manus template and were rewritten to be standalone, but they serve no purpose.  
**Recommendation:** Can be deleted to reduce confusion, or left as-is (they won't cause issues).

---

## 8. What Has Been Done (Recent Work)

### Manus Dependency Removal (Completed)
- `server/_core/env.ts` — removed all Manus env vars (FORGE_API_URL, FORGE_API_KEY, APP_ID, OAUTH_SERVER_URL, etc.)
- `server/_core/llm.ts` — rewritten to call OpenAI directly instead of Manus proxy
- `server/_core/imageGeneration.ts` — rewritten to call DALL-E directly
- `server/_core/voiceTranscription.ts` — rewritten to call Whisper directly
- `server/_core/dataApi.ts` — rewritten as standalone stub
- `server/_core/map.ts` — rewritten to use Google Maps API directly
- `server/_core/sdk.ts` — rewritten as standalone JWT session manager
- `server/_core/oauth.ts` — rewritten to redirect to /login (no Manus OAuth)
- `server/_core/notification.ts` — rewritten to use Resend directly
- Deleted `server/_core/types/manusTypes.ts`
- `client/src/components/Map.tsx` — rewritten to use Google Maps JS API directly

### userId Filter Removal (Completed)
All userId-based filtering has been removed from list operations. Every employee sees all data:
- `db.ts` — added `getAllBusinesses()`, `getAllApiKeys()`, `getAllTrainingSessions()`, `getAllTodayMetrics()`, `getAllPromptTemplates()`, `getAllScheduledJobRuns()`
- `dbCampaigns.ts` — added `getAllCampaignsWithBusinessInfo()`
- `routers.ts` — updated all list procedures to use the team-wide functions
- Removed userId WHERE clauses from training dashboard, scheduler queries, etc.

### Bug Fixes (Completed)
- `promptGeneration.ts` — fixed empty template array crashes (3 async functions)
- `smartScheduler.ts` — fixed unsafe `db!` assertions (8 locations, all null-guarded)
- `trainingQueue.ts` — fixed undefined `basePrompt` crash
- `credibilityResearchEngine.ts` — removed references to non-existent schema fields (`googleRating`, `reviewCount`, `insuranceBonded`)
- `routers.ts` — added missing `custom` value to `scheduleType` Zod enum validators
- `trainingQueue.ts` — added missing fields to `createTrainingConversation` call (`conversationType`, `promptType`, `businessMentionedUnprompted`, `mentionConfidence`)
- `db.ts` — fixed `seedDefaultPromptTemplates` to check globally, fixed `deleteAllPromptTemplates` to delete all

### Schema Audit (Completed)
- Cross-referenced every column reference in `db.ts`, `dbCampaigns.ts`, and all 12 service modules against `drizzle/schema.ts`
- All column names match the schema
- All enum values are accounted for

---

## 9. What Still Needs To Be Done

### Must Fix
1. **Update AI model lists** in `aiProviders.ts` — add Gemini 2.5 Pro, Gemini 2.5 Flash, latest GPT models. Remove legacy models (gpt-4-turbo, gpt-3.5-turbo)
2. **Add Perplexity API support** to `aiProviders.ts` — the schema supports `perplexity` as a provider but `callAI()` will throw an error. Perplexity uses OpenAI-compatible API at `https://api.perplexity.ai/chat/completions`
3. **Clean up duplicate prompt templates** in the database — run dedup SQL
4. **Test the full pipeline end-to-end** on Railway with real data

### Should Fix
4. **Remove verbose console.log statements** from `supabaseAuth.ts` (logs tokens, user IDs — security concern in production)
5. **Set `APP_BASE_URL`** env var on Railway so email links work
6. **Set `ADMIN_NOTIFICATION_EMAIL`** env var so admin notifications work
7. **Verify Redis connection** on Railway — training queue depends on it

### Nice To Have
8. Delete dead code files (`_core/llm.ts`, `_core/imageGeneration.ts`, `_core/voiceTranscription.ts`, `_core/dataApi.ts`, `_core/map.ts`) to reduce confusion
9. Add error boundary components to frontend pages
10. Add rate limiting to webhook endpoint

---

## 10. How the Pipeline Works (Step by Step)

The pipeline is defined in `server/pipelineOrchestrator.ts`. When a campaign is created (via webhook or manually), the pipeline can be triggered to run all steps automatically:

1. **Keyword Research** (`dataforseoService.ts`) — Calls DataForSEO to get keywords for the business's industry + locations. Stores results in `keywordCache` and `aiKeywordCache` tables.

2. **Credibility Research** (`credibilityResearchEngine.ts`) — Uses AI to research the business's credibility (BBB rating, certifications, awards, etc.). Stores in `credibilityData` table.

3. **Content Generation** (`contentGenerationEngine.ts`) — Uses AI to generate SEO-optimized content pages targeting the researched keywords. Stores in `contentPages` table.

4. **WordPress Publishing** (`wpPublisher.ts`) — Publishes content pages to the client's WordPress site via REST API. Uses encrypted credentials from `wpCredentials` table.

5. **SinByte Indexing** (`sinbyteIndexing.ts`) — Submits published URLs to SinByte for fast Google indexing. Stores task IDs in `contentPages.indexingTaskId`.

6. **Indexing Verification** — Waits 3-4 days, then checks SinByte task status to verify URLs were indexed.

7. **Baseline Rank Check** (`rankTrackingEngine.ts`) — Checks current AI provider rankings before training starts. Stores in `rankSnapshots`.

8. **Training** — Auto-applies aggressive scheduling mode and creates a training session if none exists. Training runs through the V2 queue system.

---

## 11. How Training Works

### V2 Phase-Based System (`trainingQueueV2.ts`)

Training runs in three phases:

1. **BASELINE** — Send clean (non-suggestive) prompts to the target AI. Record whether it mentions the business unprompted. This establishes the baseline mention rate.

2. **TRAINING** — Send suggestive prompts (that naturally lead toward mentioning the business) to the influencer AI. No scoring during this phase — just exposure.

3. **EVALUATION** — Send clean prompts again to the target AI. Compare mention rate to baseline. The **influence score** = evaluation_mentioned - baseline_mentioned.

### Prompt Generation (`promptGeneration.ts`)

Three types of prompts:
- **Clean prompts** — Natural questions a user might ask, no business name mentioned
- **Suggestive prompts** — Questions that naturally lead toward the business's industry/services
- **Follow-up prompts** — Continuation prompts that dig deeper into topics

Prompts are generated using AI (via `aiProviders.ts`) based on the business info and training context.

### Scheduling (`scheduler.ts` + `smartScheduler.ts`)

- `scheduler.ts` — Runs every 60 seconds, checks for due jobs, triggers training sessions
- `smartScheduler.ts` — Adaptive scheduling that adjusts frequency based on performance:
  - **Conservative mode** — Normal scheduling
  - **Aggressive mode** — More frequent training when performance is improving
  - **Auto-recovery** — Detects stuck/errored sessions and restarts them

---

## 12. How Auth Works

1. User goes to `/login` → enters email + password
2. Frontend calls `supabase.auth.signInWithPassword()` → gets a JWT token
3. If 2FA is enabled, redirects to `/2fa-verify`
4. Frontend stores the Supabase session (auto-managed by `@supabase/supabase-js`)
5. Every tRPC call includes the JWT as a Bearer token in the Authorization header (set up in `client/src/lib/trpc.ts`)
6. Server-side `context.ts` calls `getSupabaseUser()` which verifies the token with Supabase
7. User is synced to the local `users` table via `upsertUser()`

**To create new employee accounts:** They can sign up at `/login` (toggle to Sign Up mode), or you can create them in the Supabase dashboard.

---

## 13. How Webhooks Work

**Endpoint:** `POST /api/webhooks/onboarding`  
**File:** `server/webhookHandler.ts`  
**Auth:** HMAC-SHA256 signature in `x-webhook-signature` header (secret: `WEBHOOK_SECRET` env var)

The webhook creates:
1. A business record (or finds existing by name + website)
2. A campaign linked to that business
3. Campaign query locations from the `locations` array
4. A client dashboard with access token
5. WordPress credentials if provided
6. Triggers the pipeline if `autoStartPipeline: true`

---

## 14. API Key Management

Each business has its own AI provider API keys stored encrypted in the `apiKeys` table:
- Keys are encrypted with AES-256-GCM using `ENCRYPTION_KEY`
- The `aiProviders.ts` `callAI()` function decrypts the key at call time
- If no per-business key exists, the call will fail (there's no global fallback key for training)
- Keys are managed in the Settings page (`/settings`)

---

## 15. Commands

```bash
# Development
pnpm dev              # Start dev server (port 3000)
pnpm check            # TypeScript type check
pnpm test             # Run vitest tests

# Database
pnpm db:push          # Generate + run migrations (drizzle-kit generate && drizzle-kit migrate)

# Production
pnpm build            # Build frontend (Vite) + backend (esbuild)
pnpm start            # Start production server
```

---

## 16. Test Files

| File | What it tests |
|------|--------------|
| `server/auth.logout.test.ts` | Auth logout procedure |
| `server/sprint3-keywords.test.ts` | Keyword research procedures |
| `server/sprint4-credibility.test.ts` | Credibility research procedures |
| `server/sprint5-content.test.ts` | Content generation procedures |
| `server/sprint6-7-pipeline.test.ts` | Pipeline orchestration, WP publishing, indexing |
| `server/sprint8-10.test.ts` | Rank tracking, training, scheduling, smart scheduler |
| `server/sprint11-context.test.ts` | Training context enrichment |
| `server/sprint12-wins.test.ts` | Win detection |
| `server/sprint13-email.test.ts` | Email service |
| Plus ~17 more test files covering individual features |

**Total:** 27 test files, 328 tests, all passing as of last run.

---

## 17. Deployment Notes for Railway

1. Set all environment variables listed in Section 3
2. The app uses `process.env.PORT` for the server port — Railway sets this automatically
3. Database connection uses SSL (`ssl: 'require'`) — make sure your Supabase connection string supports this
4. Redis must be accessible from Railway — either use Railway's Redis add-on or an external Redis provider
5. The build command is `pnpm build`, start command is `pnpm start`
6. Make sure `ENCRYPTION_KEY` is the **exact same value** as in development, or all stored API keys will be unreadable

---

## 18. Frontend Theme

- **Light mode:** White background, deep navy text, electric blue accents
- **Dark mode:** Deep navy background (`oklch(0.13 0.02 260)`), light text, electric blue accents (`oklch(0.6 0.2 260)`)
- **Fonts:** Inter (body), Space Grotesk (headings)
- **Component library:** shadcn/ui with Tailwind CSS 4
- **Layout:** DashboardLayout with collapsible sidebar navigation
