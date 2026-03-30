# AI Answer Forge — Full Codebase Audit Report
**Date:** March 30, 2026  
**Auditor:** Manus  
**Scope:** Every file in the repository — schema, webhook, pipeline, training engines, routers, DB helpers, frontend, infrastructure

---

## How to Read This Report

Issues are grouped into four severity tiers:

| Tier | Label | Meaning |
|------|-------|---------|
| 🔴 | **CRITICAL** | Will cause runtime failures, data loss, or security breaches in production |
| 🟠 | **HIGH** | Will cause wrong behavior, silent data corruption, or broken features |
| 🟡 | **MEDIUM** | Inconsistencies, dead code, or logic gaps that will cause confusion or future bugs |
| 🟢 | **LOW** | Cleanup, naming, and polish items |

---

## SECTION 1 — CRITICAL BUGS (Fix Before Deploying)

### 🔴 BUG-001: `wpUsername` Is Stored Encrypted But Read Back Plaintext

**Files:** `server/webhookHandler.ts` (lines 238, 265), `server/wordpressPublisher.ts` (lines 349, 509)

**What happens:** The webhook handler encrypts `wpUsername` using `encryptWpCredentials()` before storing it in the `businesses` table. However, `wordpressPublisher.ts` reads `business.wpUsername` directly and passes it to Basic Auth **without decrypting it**. Only `wpPasswordEncrypted` is decrypted. This means every WordPress publish attempt will send a garbled encrypted string as the username and fail with a 401 authentication error.

**Proof:**
```ts
// webhookHandler.ts line 238 — encrypts the username:
if (payload.wpUsername) updateFields.wpUsername = encryptWpCredentials(payload.wpUsername);

// wordpressPublisher.ts line 349 — reads it back raw, no decrypt:
const credentials: WPCredentials = {
  siteUrl: business.wpAdminUrl,
  username: business.wpUsername,          // ← ENCRYPTED STRING, not plaintext
  appPassword: decrypt(business.wpPasswordEncrypted),  // ← correctly decrypted
};
```

**Fix:** Either (a) do not encrypt `wpUsername` — it is not a secret, only the password needs encryption — or (b) decrypt it in `wordpressPublisher.ts` the same way the password is decrypted. Option (a) is simpler and correct. Remove the `encryptWpCredentials()` call around `wpUsername` in `webhookHandler.ts` and the `storeWPCredentials()` function in `wordpressPublisher.ts`.

Also note: `webhookHandler.ts` uses its own local `encryptWpCredentials()` function (AES-256-CBC) while the rest of the app uses `server/encryption.ts` (AES-256-GCM with PBKDF2). These are **two different encryption formats** — `decrypt()` from `encryption.ts` cannot decrypt data encrypted by `encryptWpCredentials()`. This means even if you tried to decrypt the username, it would throw an error.

---

### 🔴 BUG-002: Two Incompatible Encryption Implementations

**Files:** `server/webhookHandler.ts` (lines 100–113), `server/encryption.ts`

**What happens:** `webhookHandler.ts` has its own inline `encryptWpCredentials()` function that uses AES-256-**CBC** with a raw key buffer. The app's canonical `server/encryption.ts` uses AES-256-**GCM** with PBKDF2 key derivation. Any data encrypted by the webhook handler cannot be decrypted by `decrypt()` from `encryption.ts`, and vice versa. This is a silent data corruption issue.

**Fix:** Delete `encryptWpCredentials()` from `webhookHandler.ts` entirely. Import and use `encrypt()` / `decrypt()` from `server/encryption.ts` for all credential storage. Since `wpUsername` is not a secret, just store it plaintext. Only `wpPassword` needs encryption, and it should use the canonical `encrypt()`.

---

### 🔴 BUG-003: `promptTemplates` Table Still Has `userId` FK — Prompt Generation Is Per-User, Not Global

**Files:** `drizzle/schema.ts` (line ~145), `server/db.ts` (lines 634–660), `server/promptGeneration.ts`, `server/trainingQueueV2.ts`

**What happens:** The `promptTemplates` table has a `userId` foreign key with `onDelete: cascade`. The `getActivePromptTemplates(userId, templateType)` function filters by `userId`. The `trainingQueueV2.ts` calls `generateCleanPromptAsync(basePrompt, businessInfo, session.userId)`, `generateSuggestivePromptAsync(..., session.userId)`, and `generateFollowUpPromptAsync(..., session.userId)` — all passing the session creator's `userId` to look up templates. This means:

- Templates created by Employee A will not be used when Employee B runs a training session.
- If the session creator's account is deleted, `onDelete: cascade` will **delete all their prompt templates**, destroying shared team data.
- The seeding logic in `routers.ts` seeds templates under `ctx.user.id`, so each employee gets their own copy of the defaults — leading to duplicates.

**Fix:** Remove `userId` from the `promptTemplates` table (make it global, like `apiKeys`). Update `getActivePromptTemplates` to not filter by `userId`. Update `promptGeneration.ts` to not accept or pass `userId`. Write a migration to drop the `userId` column.

---

### 🔴 BUG-004: `scheduledJobs` Table Has `userId` FK — Scheduled Jobs Are Per-User

**Files:** `drizzle/schema.ts`, `server/db.ts` (line 442), `server/routers.ts` (line 697)

**What happens:** The `scheduledJobs` table has `userId NOT NULL` with `onDelete: cascade`. When a scheduled job fires, `scheduler.ts` passes `session.userId` to `startTrainingSession`. If the user who created the job is deleted, all their scheduled jobs are deleted too. The router correctly uses `getAllScheduledJobs()` (team-wide) for listing, but `createScheduledJob` still stores `userId: ctx.user.id`. This is an inconsistency — jobs are listed team-wide but owned per-user.

**Fix:** Make `userId` nullable on `scheduledJobs` (or remove it). The scheduler should not depend on a specific user's ID to run jobs. The `startTrainingSession(sessionId, userId)` call in the scheduler should use the admin user's ID as a fallback, not the job creator's.

---

### 🔴 BUG-005: `getActivePromptTemplates` Is Still Called With `userId` in `trainingQueueV2.ts` After Global Refactor

**Files:** `server/trainingQueueV2.ts` (lines 163, 272, 314, 443), `server/promptGeneration.ts`

**What happens:** Even though the API key system was refactored to be global, the prompt template system was not. `trainingQueueV2.ts` passes `session.userId` to all three prompt generation functions. Since `getActivePromptTemplates` still filters by `userId`, a training session will only use templates created by the user who originally created the session — not the global team templates. This is a direct functional bug in the core training loop.

**Fix:** This is resolved by fixing BUG-003 above. Once `promptTemplates` is made global, remove the `userId` parameter from all prompt generation functions.

---

### 🔴 BUG-006: `aiProviderEnum` Does Not Include `perplexity` — Schema and Code Are Out of Sync

**Files:** `drizzle/schema.ts` (line 11), `server/aiProviders.ts`

**What happens:** The `aiProviderEnum` in the schema is defined as `["openai", "anthropic", "google"]`. Perplexity is mentioned in the HANDOFF.md as a required provider but is not in the enum, not in `callAI()`, and not in `getAvailableModels()`. If Perplexity is ever added to the frontend without updating the schema enum, Drizzle will reject the insert with a PostgreSQL enum violation error.

**Fix:** Add `"perplexity"` to `aiProviderEnum` in `schema.ts`. Add `callPerplexity()` to `aiProviders.ts`. Add Perplexity to `getAvailableModels()`. Add Perplexity to the Settings page UI. Write a migration to alter the enum.

---

### 🔴 BUG-007: `WEBHOOK_SECRET` Comparison Is Not Timing-Safe

**Files:** `server/webhookHandler.ts` (line 91)

**What happens:** The webhook secret is compared with `providedSecret !== configuredSecret` — a direct string equality check. This is vulnerable to timing attacks. An attacker can measure response time differences to brute-force the secret one character at a time.

**Fix:** Replace with `crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(configuredSecret))`.

---

## SECTION 2 — HIGH SEVERITY BUGS

### 🟠 BUG-008: `_core/llm.ts` Bypasses the App's API Key System

**Files:** `server/_core/llm.ts`

**What happens:** `invokeLLM()` reads `process.env.OPENAI_API_KEY` directly from the environment and hardcodes `model: "gpt-4o"`. It does not use the global API keys stored in the database. While `invokeLLM` is not currently called anywhere in the app's production code paths (only referenced in a comment in `AIChatBox.tsx`), it is a loaded gun — if any developer imports it, it will bypass the entire key management system and fail silently in production if `OPENAI_API_KEY` is not set as an env var.

**Fix:** Either delete `_core/llm.ts` entirely (it is dead code), or rewrite `invokeLLM()` to call `callAI()` from `aiProviders.ts` using the global key from the database.

---

### 🟠 BUG-009: `supabase.ts` Logs the Full Supabase URL at Startup

**Files:** `server/_core/supabase.ts` (lines 5–7, 43)

**What happens:** At module load, the server logs the first 30 characters of `SUPABASE_URL` and the length of `SUPABASE_SERVICE_ROLE_KEY` to stdout. On Railway, stdout is visible in deployment logs. This leaks infrastructure details. The full URL is also logged on successful init (line 43).

**Fix:** Remove the startup `console.log` statements. A single `[Supabase] Initialized` or `[Supabase] NOT CONFIGURED` message is sufficient.

---

### 🟠 BUG-010: `supabaseAuth.ts` Logs Every Token Verification — Security Risk

**Files:** `server/_core/supabaseAuth.ts` (lines 11–67)

**What happens:** Every single API request logs the auth header presence, token length, user ID, email, and database upsert status to stdout. In production on Railway, this means every employee's user ID and email is logged on every API call. This is a significant information leak in production logs.

**Fix:** Remove all `console.log` statements from `supabaseAuth.ts`. Keep only `console.error` for actual failures.

---

### 🟠 BUG-011: `deleteAllPromptTemplates` Ignores the `userId` Parameter

**Files:** `server/db.ts` (line 731)

**What happens:** The function signature is `deleteAllPromptTemplates(_userId?: number)` — the parameter is prefixed with `_` indicating it is intentionally unused. The function deletes **all** prompt templates regardless of user. But `routers.ts` calls it as `deleteAllPromptTemplates(ctx.user.id)` in the `resetToDefaults` mutation, implying the intent was to delete only that user's templates. Since the function ignores the argument, it deletes every team member's templates — a destructive global operation triggered by any user clicking "Reset to Defaults."

**Fix:** Once BUG-003 is fixed (global templates), this function should simply delete all templates with no filter. But the UI should warn the user that this is a team-wide reset, not a personal one.

---

### 🟠 BUG-012: `seedDefaultPromptTemplates` Seeds Under a Specific `userId` — Creates Duplicates

**Files:** `server/db.ts` (line 929), `server/routers.ts` (line 1197)

**What happens:** `seedDefaultPromptTemplates(userId)` inserts default templates tagged with a specific user's ID. The router calls this on every `promptTemplate.list` query if no templates exist. If two employees hit the app before templates are seeded, they could both trigger seeding simultaneously, creating duplicate templates. The HANDOFF.md also notes "run dedup SQL to clean prompt template duplicates in DB" as a known issue.

**Fix:** After fixing BUG-003 (global templates), `seedDefaultPromptTemplates` should not take a `userId`. Use a database-level unique constraint on `(templateType, templateName)` to prevent duplicates, and use an upsert instead of insert.

---

### 🟠 BUG-013: `trainingSessions.userId` Has `onDelete: cascade` — Deleting a User Destroys All Their Training Sessions

**Files:** `drizzle/schema.ts`

**What happens:** The `trainingSessions` table has `userId NOT NULL REFERENCES users(id) ON DELETE CASCADE`. If an employee's account is deleted from Supabase, all training sessions they created are permanently deleted — including all conversation history, rank data, and campaign progress linked to those sessions. Since this is an internal team tool where sessions belong to the business, not the employee, this is wrong.

**Fix:** Change `onDelete: "cascade"` to `onDelete: "set null"` on `trainingSessions.userId`. Make `userId` nullable. Sessions should survive employee account deletion.

---

### 🟠 BUG-014: `businesses.userId` Has `onDelete: cascade` — Deleting a User Destroys All Their Businesses

**Files:** `drizzle/schema.ts`

**What happens:** Same problem as BUG-013. The `businesses` table has `userId NOT NULL REFERENCES users(id) ON DELETE CASCADE`. Deleting any employee's account would cascade-delete all businesses (and by further cascade, all campaigns, content pages, rank snapshots, etc.) that were created by that employee. This would destroy all client data.

**Fix:** Change to `onDelete: "set null"` and make `userId` nullable on `businesses`. The business belongs to the company, not the employee.

---

### 🟠 BUG-015: OpenAI Model List Is Outdated — Missing GPT-4.1 and o-series

**Files:** `server/aiProviders.ts` (line ~95)

**What happens:** `getAvailableModels("openai")` returns `["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"]`. As of early 2026, GPT-4.1, GPT-4.1-mini, GPT-4.1-nano, and o3/o4-mini are available. `gpt-4-turbo` and `gpt-3.5-turbo` are deprecated. Users will be selecting from an outdated list.

**Fix:** Update to `["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o3", "o4-mini"]`.

---

### 🟠 BUG-016: Google Gemini Model List Is Outdated — Missing Gemini 2.5

**Files:** `server/aiProviders.ts`

**What happens:** `getAvailableModels("google")` returns `["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"]`. Gemini 2.5 Flash and 2.5 Pro are available and significantly better. `gemini-1.5-pro` and `gemini-1.5-flash` are being deprecated.

**Fix:** Update to `["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]`.

---

### 🟠 BUG-017: `ENV.openaiApiKey` Is Defined in `env.ts` But Never Used — Implies a Hardcoded Key Path

**Files:** `server/_core/env.ts`

**What happens:** `env.ts` exports `openaiApiKey: process.env.OPENAI_API_KEY`. This is only used by the dead `_core/llm.ts`. The rest of the app correctly reads API keys from the database. Having this in `env.ts` creates confusion and implies that an `OPENAI_API_KEY` env var is needed on Railway, which it is not.

**Fix:** Remove `openaiApiKey` and `googleMapsApiKey` from `env.ts`. Remove `_core/llm.ts` (see BUG-008).

---

## SECTION 3 — MEDIUM SEVERITY ISSUES

### 🟡 BUG-018: `getCampaignsByUserId`, `getCampaignStats`, `getCampaignsWithBusinessInfo` Are Dead Code

**Files:** `server/dbCampaigns.ts` (lines 123, 165, 535)

**What happens:** These three per-user functions exist in `dbCampaigns.ts` but are never called anywhere in the production code paths. The router correctly uses `getAllCampaignsWithBusinessInfo()` and `getAllCampaignStats()`. The per-user versions are dead code from the original per-user design.

**Fix:** Delete `getCampaignsByUserId`, `getCampaignStats`, and `getCampaignsWithBusinessInfo` from `dbCampaigns.ts`.

---

### 🟡 BUG-019: `getScheduledJobsByUserId` and `getScheduledJobRunsByUserId` Are Dead Code

**Files:** `server/db.ts` (lines 347, 421)

**What happens:** Same as above — per-user versions of scheduled job queries that are never called. The router uses `getAllScheduledJobs()`.

**Fix:** Delete these two functions.

---

### 🟡 BUG-020: `getTodayMetrics(userId)` and `getPromptTemplates(userId)` Are Dead Code

**Files:** `server/db.ts` (lines 518, 583)

**What happens:** Per-user versions of metrics and prompt template queries. The router uses `getAllTodayMetrics()` and `getAllPromptTemplates()`. These are never called.

**Fix:** Delete these two functions.

---

### 🟡 BUG-021: `hasPromptTemplates(userId)` Is Dead Code

**Files:** `server/db.ts` (line 745)

**What happens:** Per-user version of the "has any templates" check. The router uses `hasAnyPromptTemplates()`. Never called.

**Fix:** Delete this function.

---

### 🟡 BUG-022: `Home.tsx` Is a Dead Scaffold Page

**Files:** `client/src/pages/Home.tsx`

**What happens:** `Home.tsx` is a leftover scaffold template page that imports `useAuth` from `@/_core/hooks/useAuth` and `Streamdown` from a streaming library. It is not used anywhere in `App.tsx` routing — `Dashboard.tsx` is used instead. It contains placeholder text and example code.

**Fix:** Delete `Home.tsx`.

---

### 🟡 BUG-023: `ComponentShowcase.tsx` Is Dead Scaffold Code

**Files:** `client/src/pages/ComponentShowcase.tsx`

**What happens:** A UI component showcase page that is not registered in any route in `App.tsx`. It is dead scaffolding.

**Fix:** Delete `ComponentShowcase.tsx`.

---

### 🟡 BUG-024: Seven Dead `_core` Server Modules

**Files:** `server/_core/imageGeneration.ts`, `server/_core/map.ts`, `server/_core/notification.ts`, `server/_core/oauth.ts`, `server/_core/sdk.ts`, `server/_core/voiceTranscription.ts`, `server/_core/dataApi.ts`

**What happens:** None of these scaffold modules are imported anywhere in the app's production code. They are dead code from the Manus scaffold template. They add noise, increase build size, and could confuse future developers into thinking the app has image generation, maps, OAuth, or voice transcription capabilities.

**Fix:** Delete all seven files.

---

### 🟡 BUG-025: `storage.ts` Uses `VITE_SUPABASE_URL` on the Server Side

**Files:** `server/storage.ts` (line 6)

**What happens:** `getSupabaseStorageClient()` reads `process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL`. The `VITE_` prefix is a Vite convention for **client-side** environment variables. On the server (Railway), `VITE_SUPABASE_URL` will not be set unless explicitly added. This creates an inconsistency — the rest of the server uses `SUPABASE_URL`.

**Fix:** Remove the `VITE_SUPABASE_URL` fallback from `server/storage.ts`. Only use `SUPABASE_URL` on the server.

---

### 🟡 BUG-026: `emailService.ts` and `routers.ts` Use `VITE_APP_BASE_URL` as a Server-Side Fallback

**Files:** `server/emailService.ts` (lines 930, 985), `server/routers.ts` (line 1758), `server/routers.ts` (line 1792)

**What happens:** Same issue as BUG-025. Server-side code falls back to `process.env.VITE_APP_BASE_URL`. This variable is for the Vite client bundle, not the Node.js server process. Dashboard URLs in emails may be empty strings if `APP_BASE_URL` is not set.

**Fix:** Remove all `|| process.env.VITE_APP_BASE_URL` fallbacks from server-side code. Only `APP_BASE_URL` should be used on the server.

---

### 🟡 BUG-027: `ENV.ownerOpenId` Is Defined But Never Used

**Files:** `server/_core/env.ts`

**What happens:** `ownerOpenId: process.env.OWNER_OPEN_ID` is exported from `env.ts` but is never imported or used anywhere in the codebase. This is dead scaffold code.

**Fix:** Remove `ownerOpenId` from `env.ts`.

---

### 🟡 BUG-028: `ENV.googleMapsApiKey` Is Defined But Never Used

**Files:** `server/_core/env.ts`

**What happens:** Same as BUG-027. `googleMapsApiKey` is a scaffold remnant. The app does not use Google Maps.

**Fix:** Remove `googleMapsApiKey` from `env.ts`.

---

### 🟡 BUG-029: `ENV.cookieSecret` Is Named Misleadingly — It Is the JWT/Supabase Secret

**Files:** `server/_core/env.ts`

**What happens:** `cookieSecret: process.env.JWT_SECRET` is named `cookieSecret` but the actual env var is `JWT_SECRET`. The app uses Supabase Bearer tokens, not cookies. This name is misleading and the variable is only used as a fallback encryption key in `encryption.ts`.

**Fix:** Rename to `jwtSecret` or just remove it from `env.ts` since `encryption.ts` reads `JWT_SECRET` directly.

---

### 🟡 BUG-030: `schedule.create` Router Still Stores `userId: ctx.user.id` on Scheduled Jobs

**Files:** `server/routers.ts` (line 697)

**What happens:** Even though scheduled jobs are listed team-wide, new jobs are created with the creator's `userId`. This is inconsistent with the team-wide philosophy and creates the cascade-delete risk described in BUG-004.

**Fix:** After fixing BUG-004 (making `userId` nullable on `scheduledJobs`), change the router to not pass `userId` when creating scheduled jobs, or pass the admin user's ID.

---

### 🟡 BUG-031: `restartConversation` Creates New Session With `userId: ctx.user.id` — Breaks Ownership Consistency

**Files:** `server/routers.ts` (line 450)

**What happens:** When restarting a completed training session, the new session is created with the restarting employee's `userId`, not the original creator's. This means the session history is split between users. Since sessions are team-wide, this `userId` assignment is arbitrary and inconsistent.

**Fix:** After fixing BUG-013 (making `trainingSessions.userId` nullable), either set `userId` to null on restarted sessions or use the admin user's ID.

---

### 🟡 BUG-032: `pipelineOrchestrator.ts` Passes `userId` to Training Session Creation — Same Inconsistency

**Files:** `server/pipelineOrchestrator.ts` (lines 127, 166, 193, 311, 321)

**What happens:** The pipeline orchestrator accepts a `userId` parameter and passes it when creating training sessions during the automated pipeline. This `userId` is the employee who triggered the pipeline run, not a meaningful business concept. If that employee is later deleted, the cascade will destroy the training sessions.

**Fix:** After fixing BUG-013, remove `userId` from the pipeline orchestrator's training session creation calls.

---

## SECTION 4 — LOW SEVERITY / CLEANUP

### 🟢 BUG-033: `AIChatBox.tsx` Component Is Not Used in Any Page

**Files:** `client/src/components/AIChatBox.tsx`

**What happens:** This component imports `Streamdown` and references `invokeLLM` in a comment. It is not imported or used in any page. Dead scaffold code.

**Fix:** Delete `AIChatBox.tsx`.

---

### 🟢 BUG-034: `Map.tsx` Component Is Not Used

**Files:** `client/src/components/Map.tsx`

**What happens:** A map component from the scaffold. Not used anywhere.

**Fix:** Delete `Map.tsx`.

---

### 🟢 BUG-035: `ManusDialog.tsx` Component Exists — Manus Scaffold Remnant

**Files:** `client/src/components/ManusDialog.tsx`

**What happens:** A dialog component from the Manus scaffold. Not used anywhere in the app.

**Fix:** Delete `ManusDialog.tsx`.

---

### 🟢 BUG-036: `drizzle/relations.ts` May Be Out of Sync With Schema

**Files:** `drizzle/relations.ts`

**What happens:** The relations file defines Drizzle ORM relations for joins. After the `apiKeys` table was changed (removed `userId`), the relations file may still reference the old `userId` relation on `apiKeys`. This does not cause runtime errors but will cause incorrect TypeScript types and confuse Drizzle Studio.

**Fix:** Regenerate `relations.ts` by running `pnpm drizzle-kit generate` after all schema changes are finalized.

---

### 🟢 BUG-037: `DEPRECATED_MODEL_MAP` in `aiProviders.ts` Contains Incorrect Claude Model Names

**Files:** `server/aiProviders.ts`

**What happens:** The deprecated model map contains `"claude-sonnet-4-5-20250929"` and `"claude-haiku-4-5-20251001"` as replacement targets. These model names use an unusual naming convention (`4-5` instead of `4.5`). The actual Anthropic API model IDs use dots: `claude-sonnet-4-5` may not be a valid API identifier. This should be verified against the current Anthropic API documentation.

**Fix:** Verify current Anthropic model IDs against `https://docs.anthropic.com/en/docs/about-claude/models` and update accordingly.

---

### 🟢 BUG-038: `global_api_keys.sql` Migration Is in the Wrong Directory

**Files:** `drizzle/migrations/global_api_keys.sql`

**What happens:** The migration SQL file for the global API key refactor was placed in `drizzle/migrations/` as a raw SQL file. Drizzle Kit manages migrations in the `drizzle/` root directory using numbered files (e.g., `0007_...sql`). A raw SQL file in a subdirectory will not be picked up by `drizzle-kit migrate` and must be run manually.

**Fix:** Either rename it to follow the Drizzle numbering convention (`0007_global_api_keys.sql`) and place it in the `drizzle/` root, or document clearly that it must be run manually via `psql`.

---

### 🟢 BUG-039: Webhook Auth Uses Simple String Comparison Instead of HMAC

**Files:** `server/webhookHandler.ts`

**What happens:** The webhook secret verification compares a shared secret directly. The HANDOFF.md mentions "HMAC-SHA256 signature verification" but the actual implementation is just a plain string comparison of a shared secret (fixed in BUG-007 above). True HMAC-SHA256 would sign the request body, not just pass a static secret. This is a security downgrade from what was documented.

**Fix (optional enhancement):** Implement proper HMAC-SHA256 body signing: GHL sends `X-GHL-Signature: sha256=<hmac>`, and the server verifies with `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')`. This requires reading the raw request body before JSON parsing.

---

## SECTION 5 — ENVIRONMENT VARIABLES REQUIRED ON RAILWAY

The following env vars must be set on Railway for the app to function. This is the complete list based on the actual code:

| Variable | Required | Used By |
|----------|----------|---------|
| `DATABASE_URL` | ✅ Yes | `server/db.ts` — PostgreSQL connection |
| `SUPABASE_URL` | ✅ Yes | `server/_core/supabase.ts` — Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | `server/_core/supabase.ts` — Auth |
| `SUPABASE_DATABASE_URL` | Optional | `server/db.ts` — overrides `DATABASE_URL` |
| `ENCRYPTION_KEY` | ✅ Yes | `server/encryption.ts` — API key encryption |
| `JWT_SECRET` | Optional | `server/encryption.ts` — fallback only |
| `WEBHOOK_SECRET` | ✅ Yes | `server/webhookHandler.ts` — GHL webhook auth |
| `REDIS_HOST` | ✅ Yes | `server/_core/index.ts` — training queue |
| `REDIS_PORT` | Optional | Defaults to 6379 |
| `RESEND_API_KEY` | ✅ Yes | `server/emailService.ts` — email sending |
| `SINBYTE_API_KEY` | ✅ Yes | `server/sinbyteIndexing.ts` — URL indexing |
| `DATAFORSEO_LOGIN` | ✅ Yes | `server/dataforseoService.ts` — keyword research |
| `DATAFORSEO_PASSWORD` | ✅ Yes | `server/dataforseoService.ts` — keyword research |
| `APP_BASE_URL` | ✅ Yes | `server/emailService.ts` — dashboard URLs in emails |
| `ADMIN_NOTIFICATION_EMAIL` | ✅ Yes | `server/emailService.ts` — win notifications |
| `NODE_ENV` | ✅ Yes | Set to `production` on Railway |
| `PORT` | Optional | Railway sets this automatically |
| `OPENAI_API_KEY` | ❌ Not needed | Only used by dead `_core/llm.ts` — remove that file |
| `OWNER_OPEN_ID` | ❌ Not needed | Dead scaffold variable |
| `GOOGLE_MAPS_API_KEY` | ❌ Not needed | Dead scaffold variable |
| `VITE_SUPABASE_URL` | ❌ Not needed on server | Client-only, remove server fallbacks |
| `VITE_APP_BASE_URL` | ❌ Not needed on server | Client-only, remove server fallbacks |

---

## SECTION 6 — PRIORITIZED FIX ORDER

Fix these in order. Each group can be done in one commit.

**Commit 1 — Data Safety (Do First)**
1. BUG-013: Change `trainingSessions.userId` to `onDelete: set null`, make nullable
2. BUG-014: Change `businesses.userId` to `onDelete: set null`, make nullable
3. BUG-004: Change `scheduledJobs.userId` to `onDelete: set null`, make nullable
4. Write migration SQL for all three schema changes

**Commit 2 — WordPress Publishing (Fixes Broken Core Feature)**
1. BUG-001: Fix `wpUsername` — do not encrypt it, just store plaintext
2. BUG-002: Delete `encryptWpCredentials()` from `webhookHandler.ts`, use `encrypt()` from `encryption.ts` for `wpPassword` only

**Commit 3 — Global Prompt Templates (Fixes Broken Training Loop)**
1. BUG-003: Remove `userId` from `promptTemplates` table, write migration
2. BUG-005: Update `promptGeneration.ts` to remove `userId` parameter
3. BUG-012: Update `seedDefaultPromptTemplates` to not take `userId`
4. BUG-011: Fix `deleteAllPromptTemplates` to be a clean global delete with a UI warning

**Commit 4 — Security Fixes**
1. BUG-007: Replace string comparison with `crypto.timingSafeEqual` in webhook auth
2. BUG-009: Remove startup logging of Supabase URL from `supabase.ts`
3. BUG-010: Remove verbose per-request logging from `supabaseAuth.ts`

**Commit 5 — Model Updates**
1. BUG-006: Add Perplexity to schema enum, `aiProviders.ts`, and Settings UI
2. BUG-015: Update OpenAI model list
3. BUG-016: Update Google Gemini model list
4. BUG-037: Verify and fix Claude model IDs

**Commit 6 — Dead Code Removal**
1. BUG-008 / BUG-017: Delete `_core/llm.ts`, remove `openaiApiKey` from `env.ts`
2. BUG-018–021: Delete dead per-user DB functions
3. BUG-022–023: Delete `Home.tsx`, `ComponentShowcase.tsx`
4. BUG-024: Delete 7 dead `_core` server modules
5. BUG-033–035: Delete `AIChatBox.tsx`, `Map.tsx`, `ManusDialog.tsx`
6. BUG-027–029: Clean up `env.ts`

**Commit 7 — Env Var Consistency**
1. BUG-025: Remove `VITE_SUPABASE_URL` from `server/storage.ts`
2. BUG-026: Remove `VITE_APP_BASE_URL` from all server files
3. BUG-038: Move migration SQL to correct location

---

*End of Audit Report — 39 issues documented across 4 severity tiers*
