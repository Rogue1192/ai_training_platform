# AI Answer Forge — Comprehensive Codebase Audit

## Phase 1: Database Schema Audit

### Tables Found (17 total):
1. users
2. businesses
3. apiKeys
4. trainingSessions
5. trainingConversations
6. scheduledJobs
7. scheduledJobRuns
8. platformMetrics
9. promptTemplates
10. packageTiers
11. campaigns
12. campaignQueryLocations
13. credibilityData
14. contentPages
15. industryKeywordCache
16. rankSnapshots
17. clientDashboards
18. webhookLogs
19. notificationLogs
20. llmTxtFiles
21. schemaMarkupRecommendations

### Schema Issues Found:

#### ISSUE-001: trainingSessions.campaignId has no foreign key reference
- Line 147: `campaignId: integer("campaignId")` — no `.references()` to campaigns.id
- RISK: Orphaned campaign references, no cascade delete
- FIX: Add `.references(() => campaigns.id, { onDelete: "set null" })`

#### ISSUE-002: trainingSessions.campaignQueryLocationId has no foreign key reference
- Line 148: `campaignQueryLocationId: integer("campaignQueryLocationId")` — no `.references()`
- RISK: Orphaned query-location references
- FIX: Add `.references(() => campaignQueryLocations.id, { onDelete: "set null" })`

#### ISSUE-003: businesses.sourceWebhookId has no foreign key reference
- Line 91: `sourceWebhookId: integer("sourceWebhookId")` — no `.references()`
- RISK: Minor — just a reference ID, but inconsistent with other FK patterns
- NOTE: webhookLogs table exists, could reference it

#### ISSUE-004: campaigns.sourceWebhookId has no foreign key reference
- Line 321: `sourceWebhookId: integer("sourceWebhookId")` — no `.references()`
- Same issue as ISSUE-003

#### ISSUE-005: webhookLogs.businessId and webhookLogs.campaignId have no foreign key references
- Lines 489-490: No `.references()` on either
- RISK: Minor — these are backlinks for tracking, but inconsistent

### Schema Consistency Check:
- All timestamp columns use `timestamp()` consistently ✓
- All serial PKs use `serial("id").primaryKey()` consistently ✓
- All tables have `createdAt` with `.defaultNow().notNull()` ✓
- Enum usage is consistent ✓
- Type exports exist for all tables (Select + Insert) ✓
- JSON columns are properly typed as `json()` ✓

### Missing Indexes (Performance):
- campaignQueryLocations: No index on campaignId (will be slow for large datasets)
- rankSnapshots: No index on campaignId or queryLocationId
- contentPages: No index on campaignId or businessId
- credibilityData: No index on businessId or campaignId
- webhookLogs: No index on status or createdAt

### RLS Policies:
- NOTE: This app uses Supabase Postgres as the database but connects via direct connection string (SUPABASE_DATABASE_URL), not the Supabase client SDK for data access
- RLS policies need to be checked in Supabase dashboard directly
- The app uses server-side auth (JWT session cookies) not Supabase Auth RLS
- RISK: If RLS is enabled on tables but no policies exist, queries will return empty results
- RECOMMENDATION: Verify RLS is DISABLED on all tables since auth is handled at the application layer


## Phase 2: Webhook Handler Audit (webhookHandler.ts)

### ISSUE-006: Dashboard URL uses wrong path
- Line 257: `dashboardUrl: \`\${req.protocol}://\${req.get("host")}/dashboard/\${accessToken}\``
- But the actual route in App.tsx is `/report/:token` NOT `/dashboard/:token`
- RISK: **HIGH** — Every webhook response returns a broken dashboard URL to the GHL system
- FIX: Change to `/report/${accessToken}`

### ISSUE-007: SiteForge callback is a TODO stub
- Lines 311-315: The SiteForge Ultra callback handler is a stub with TODO comments
- It receives `publishedUrls`, `llmTxtUrl`, `schemaMarkup` but does nothing with them
- RISK: Medium — Scenario C clients (SiteForge Ultra) won't have their pipeline advanced
- FIX: Implement the callback to update content pages and advance campaign status

### ISSUE-008: No webhook authentication/verification
- Neither webhook endpoint validates a secret/signature
- RISK: Medium — Anyone who knows the URL can send fake webhooks
- RECOMMENDATION: Add a webhook secret header check (e.g., `x-webhook-secret`)

### ISSUE-009: No automatic pipeline kickoff after campaign creation
- Lines 261-265: TODO comment says "kick off the automated pipeline here" but it's not implemented
- RISK: **HIGH** — After webhook creates a campaign, nothing happens automatically. The pipeline must be manually triggered from the admin UI.
- FIX: Import and call the pipeline orchestrator to auto-start after campaign creation

### ISSUE-010: WordPress credentials not encrypted on storage
- Line 43-45: `wpAdminUrl`, `wpUsername`, `wpPassword` are received in the webhook
- But they're never stored on the business record in the webhook handler
- The business creation (line 167-189) doesn't include WP credentials
- RISK: **HIGH** — WP credentials from webhook are silently dropped
- FIX: Encrypt and store WP credentials when creating/updating the business

### ISSUE-011: Business update on existing website doesn't update all fields
- Lines 156-163: When a business already exists (matched by website URL), only `businessType`, `contactEmail`, and `phone` are updated
- Missing: `contactName`, `certifications`, `awards`, `bbbRating`, `yearsInBusiness`, `competitors`, `clientType`
- RISK: Medium — Re-onboarding a client with updated info won't fully update their record

### ISSUE-012: No duplicate campaign check
- If the same business sends a webhook twice, it creates a second campaign
- RISK: Medium — Could lead to duplicate campaigns and wasted API calls
- RECOMMENDATION: Check if an active campaign already exists for the business


## Phase 3: Keyword Research Pipeline & DataForSEO Audit

### ISSUE-013: Error count increment has race condition
- keywordResearchPipeline.ts line 311-313: Fetches campaign twice to increment errorCount
- `(await getCampaignById(campaignId))?.errorCount` — two separate DB calls in one expression
- RISK: Low — unlikely to cause issues in practice, but wasteful and could lose increments under concurrency
- FIX: Use SQL increment `sql\`errorCount + 1\`` or fetch once

### ISSUE-014: Location parsing is fragile
- keywordResearchPipeline.ts line 252: `business.location.split(",")` assumes comma-separated
- But the webhook stores only `payload.locations[0]` as `business.location` (line 177 of webhookHandler.ts)
- RISK: **HIGH** — Only the first location from the webhook is stored on the business record. If a client has 3 locations, only 1 is used for keyword research.
- FIX: Store all locations (either as JSON array or comma-separated) on the business, or store them directly on the campaign

### ISSUE-015: checkRankForQueries doesn't use location parameter
- dataforseoService.ts line 422-426: The function receives query+location pairs but the LLM Mentions search doesn't filter by location
- The location is only used as a map key, not passed to the API
- RISK: Medium — Rank results may not be location-specific
- NOTE: This may be a DataForSEO API limitation — the LLM Mentions endpoint may not support location filtering per query

### ISSUE-016: LLM mention parsing only keeps last response per platform
- dataforseoService.ts lines 237-245: The for loop overwrites `llmResponses.chatgpt` on each iteration
- If there are multiple ChatGPT responses for the same keyword, only the last one is kept
- RISK: Low — Usually there's only one response per platform per keyword

### DataForSEO Service: OK
- Auth header construction is correct (Basic auth with base64 encoding) ✓
- Error handling checks status_code === 20000 ✓
- Timeout set to 120s (appropriate for slow endpoints) ✓
- Batch processing for AI volume (1000 per batch) ✓
- Domain cleaning (strips protocol and trailing slash) ✓

### Keyword Research Pipeline: OK
- Golden template cache check before API calls ✓
- Cache contribution after research ✓
- Package tier cap enforcement ✓
- Existing query-location skip logic ✓
- Error handling with campaign status update ✓


## Phase 4: Credibility Research Engine & Content Generation Engine Audit

### ISSUE-017: credibilityResearchEngine uses hardcoded model name
- Line 255: `const model = "claude-sonnet-4-5-20250929"` — hardcoded model string
- Not a bug, but if the model is deprecated/renamed, it'll need updating in multiple places
- RISK: Low — model names are stable for months

### ISSUE-018: credibilityData orderBy is ascending, should be descending for "latest"
- credibilityResearchEngine.ts line 342: `.orderBy(credibilityData.createdAt)` — ascending order
- The function name `getCredibilityDataForBusiness` implies getting the latest, but it returns the OLDEST
- Same issue on line 356: `getCredibilityDataForCampaign`
- RISK: **HIGH** — If credibility research is run twice, the OLD data is returned instead of the latest
- FIX: Change to `desc(credibilityData.createdAt)`

### ISSUE-019: contentGenerationEngine regenerateContentPage uses dynamic imports
- Lines 588-601: `await import("../drizzle/schema")` used inline multiple times
- This is unnecessary — `businesses` is already imported at the top of the file, but `credibilityData` is NOT
- The `businesses` table IS imported at line 18 via `contentPages, campaigns` but NOT `businesses` or `credibilityData`
- Wait — checking line 18: only `contentPages, campaigns` are imported from schema
- RISK: Medium — Dynamic imports work but are slower and harder to tree-shake
- FIX: Add `businesses, credibilityData` to the static imports at the top

### ISSUE-020: contentPages status enum mismatch
- contentGenerationEngine.ts line 449: stores `status: "generated"`
- contentGenerationEngine.ts line 469: stores `status: "failed"`
- Schema line defines: `status: text("status").default("draft")`
- No enum validation — any string can be stored. The schema uses text, not enum.
- RISK: Low — No runtime error, but no type safety on status values

### ISSUE-021: Content page publishedUrl set to undefined instead of null
- updateContentPageStatus line 553: `publishedUrl: publishedUrl || undefined`
- Drizzle may not properly handle `undefined` vs `null` for nullable columns
- RISK: Medium — Could leave stale publishedUrl values when status changes to "failed"
- FIX: Use `null` instead of `undefined` for nullable fields

### ISSUE-022: credibilityResearchEngine sets campaign status directly
- Line 320-324: Sets `status: "content_generation"` directly on the campaign
- But the pipeline orchestrator also manages status transitions
- RISK: Medium — If the orchestrator is used, the status gets set twice (once by the engine, once by the orchestrator). Not harmful but redundant.

### Credibility Research Engine: Mostly OK
- JSON parsing with markdown code block stripping ✓
- Error handling for parse failures ✓
- llm.txt generation from facts ✓
- Database storage of results ✓
- Confidence filtering for llm.txt (excludes "low") ✓

### Content Generation Engine: Mostly OK
- Sequential page generation (avoids rate limits) ✓
- Schema markup uses cheaper Haiku model ✓
- Failed pages stored with error message ✓
- Page type determination logic is sound ✓
- Regeneration function works with custom prompts ✓


## Phase 5: WordPress Publisher, SinByte Indexing, Pipeline Orchestrator Audit

### ISSUE-023: WordPress publisher does NOT filter by status "generated" properly
- wordpressPublisher.ts line 369: `p.status === "generated"` — string comparison on text column
- This is correct behavior but relies on status strings being consistent across all engines
- Content generation stores "generated", "failed", "draft" — all consistent
- RISK: Low — works correctly

### ISSUE-024: WordPress llm.txt published as HTML page, not actual text file
- wordpressPublisher.ts line 515: Wraps in `<pre>` tag and publishes as a WordPress page at /llm-txt
- AI crawlers looking for /llm.txt will NOT find it at /llm-txt (different URL)
- The comment says "recommend the client add a redirect from /llm.txt to this page" but this is never automated
- RISK: **MEDIUM** — llm.txt won't be discoverable at the standard /llm.txt path. Needs either a redirect plugin or a different approach.

### ISSUE-025: SinByte API response parsing may be fragile
- sinbyteIndexing.ts line 110: `response.data?.id || response.data?.task_id` — tries two field names
- sinbyteIndexing.ts line 179: `Array.isArray(response.data) ? response.data : response.data?.results || []`
- This is defensive coding, which is good, but we haven't validated the actual SinByte API response format
- RISK: Low — defensive parsing handles most cases

### ISSUE-026: verifyCampaignIndexing checks HTTP accessibility, NOT Google indexing
- sinbyteIndexing.ts line 300: Uses `axios.head(url)` to check if URLs are accessible
- This only checks if the WordPress page is live, NOT if Google has indexed it
- True indexing verification would require checking `site:url` in Google or using Google Search Console API
- RISK: **MEDIUM** — The "verification" step is really just "are the pages still up" check, not actual indexing verification. This is acceptable for the MVP but should be noted.

### ISSUE-027: Pipeline orchestrator uses dynamic imports for every step
- pipelineOrchestrator.ts lines 151-286: Every step uses `await import("./module")`
- This is intentional to avoid circular dependencies and reduce initial load
- RISK: Low — works correctly, just slightly slower than static imports

### ISSUE-028: Pipeline orchestrator training step is a stub
- pipelineOrchestrator.ts line 297-311: Just sets status to "training" without actually starting training
- The comment says "Training orchestration will be configured separately"
- RISK: **MEDIUM** — The training step doesn't actually trigger the training queue. Need to wire this to trainingQueueV2.

### ISSUE-029: Pipeline runFullPipeline doesn't re-read campaign between steps
- pipelineOrchestrator.ts line 389: `runPipelineStep` is called in a loop, but the campaign data is only read once at the start
- Each step internally reads the campaign again, so this is fine for the step execution
- But the `determineNextStep` at line 375 only runs once — if a step modifies the campaign status, the loop doesn't re-evaluate
- RISK: Low — The loop runs steps sequentially and stops on failure, so the initial determination is sufficient

### ISSUE-030: statusToStep mapping missing "indexing_verification" status
- pipelineOrchestrator.ts line 73-87: The mapping doesn't include "indexing_verification" as a campaign status
- But the schema doesn't have "indexing_verification" as a status value either — it goes from "indexing" to "baseline_check"
- The `determineNextStep` function uses timestamps, not status, so this is fine
- RISK: Low — No actual bug

### WordPress Publisher: Solid
- Connection testing with permission check ✓
- Duplicate detection via slug lookup ✓
- Schema markup injection as JSON-LD ✓
- Encrypted credential storage ✓
- 1-second delay between publishes (respectful) ✓
- Dry run mode ✓

### SinByte Indexing: Solid
- API key from environment ✓
- Batch submission with drip-feed option ✓
- Task status checking ✓
- Campaign-level submission ✓
- 80% threshold for verification ✓

### Pipeline Orchestrator: Solid
- 8-step pipeline with clear progression ✓
- Auto-pause at indexing (3-4 day wait) ✓
- Error tracking with campaign error count ✓
- Resume from any step ✓
- Skip steps option ✓


## Phase 6: Rank Tracking Engine, Smart Scheduler, Win Notifications

### rankTrackingEngine.ts
**FINDING-R1 (MEDIUM)**: `searchLLMMentions` is called with `limit: 500` but the DataForSEO API may not support that limit value. Need to verify the API's max limit parameter.

**FINDING-R2 (LOW)**: `getLatestSnapshots` fetches ALL snapshots for a campaign ordered by date desc, then deduplicates in JS. For campaigns with many snapshots over time, this could be slow. Should use a SQL subquery with `DISTINCT ON` or `ROW_NUMBER()` to get only the latest per queryLocationId.

**FINDING-R3 (LOW)**: `getVisibilityTrends` groups by day using `toISOString().split("T")[0]` which is UTC-based. This is fine for consistency but worth noting.

**FINDING-R4 (MEDIUM)**: In `generateCampaignRankReport`, the competitor tracking section (lines 660-666) has an empty loop body — `competitorMap` is never populated. The `topCompetitors` array will always be empty. This is a stub that was never completed.

**FINDING-R5 (LOW)**: `recentWins` in `generateCampaignRankReport` only detects "new" and "improved" changes from baseline comparison, but doesn't detect wins from the most recent check-to-check comparison. The `detectWins` in `winNotifications.ts` does check-to-check comparison properly. These two win detection systems are slightly different — one compares to baseline, the other compares to previous check.

### smartScheduler.ts
**FINDING-S1 (MEDIUM)**: `recommendMode` at line 129 does `db!.select()` with a non-null assertion. If `getDb()` returns null (DB not available), this will throw an unhandled runtime error. Other functions in this file have the same pattern. Should add null check like other modules do.

**FINDING-S2 (LOW)**: `groupSnapshotsByCheck` uses `any[]` type for the snapshots parameter (line 254). Should be typed to the actual snapshot schema type for type safety.

**FINDING-S3 (LOW)**: `calculateTrend` requires `improvements >= 2` or `declines >= 2` to trigger non-stable. With only 3 data points (minimum), this means you need 2 out of 2 transitions to be in the same direction. This is reasonable but strict.

**FINDING-S4 (OK)**: Mode transition thresholds (30 for moderate, 60 for maintenance) are hardcoded constants. This is fine — they're well-documented and easy to adjust.

### winNotifications.ts
**FINDING-W1 (OK)**: Win detection compares the two most recent snapshots per query-location. This is correct behavior.

**FINDING-W2 (LOW)**: `generateWinReport` at line 211 does `campaign?.businessId || 0` — if campaign is null, it queries for business with id=0 which will return nothing. The function should return early if campaign is null (like `detectWins` does).

**FINDING-W3 (OK)**: Multi-platform win detection correctly counts platforms and compares current vs previous counts.

**FINDING-W4 (LOW)**: Win indentation inconsistency at lines 132-135 and 153-156 — `query` and `location` fields have different indentation than other fields. Cosmetic only, no functional impact.

### Cross-Module Consistency Check
- rankTrackingEngine and winNotifications both detect wins but use different approaches (baseline comparison vs check-to-check). This is intentional — one is for the report, one is for notifications.
- smartScheduler correctly reads `trainingAggressiveness` from campaigns table and writes it back.
- All three modules use consistent `getDb()` pattern (though smartScheduler uses `db!` non-null assertion).

## Phase 7: Training Context Enricher, Email Service, Notification System

### trainingContextEnricher.ts
**FINDING-T1 (OK)**: Pure additive module — does NOT modify existing prompts. Correct approach.

**FINDING-T2 (MEDIUM)**: `getTrainingContextForSession` at line 271 dynamically imports `getTrainingSessionById` from `./db`. Need to verify this function actually exists in `db.ts`. If it doesn't, this will throw at runtime.

**FINDING-T3 (LOW)**: `verifiedFacts` and `researchResults` are cast to `any[]` and `any` respectively (lines 99, 114). Should have proper type guards, but since these are JSON columns with unpredictable structure, `any` is acceptable here with the null checks in place.

**FINDING-T4 (OK)**: `buildEnrichedSystemMessage` correctly filters to high/medium confidence facts and limits to top 10. Good.

**FINDING-T5 (OK)**: `buildSourceCitationBlock` limits to 5 published pages. Good for prompt length management.

### emailService.ts
**FINDING-E1 (CRITICAL)**: Lines 930 and 984 hardcode the dashboard URL to `https://aitrainhub-ln7nmkz9.manus.space/report/`. This MUST be dynamic — it should use the actual deployed domain, not a hardcoded sandbox URL. When deployed to production, this URL will be wrong.

**FINDING-E2 (LOW)**: `getResend()` creates a singleton client. If the API key is changed at runtime (via secrets update), the old client persists until server restart. This is acceptable behavior but worth noting.

**FINDING-E3 (OK)**: All send functions have proper try/catch with error logging and return `EmailResult` with success/error. Good error handling.

**FINDING-E4 (OK)**: Email templates use table-based layout for platform breakdown (line 551) — good for email client compatibility.

**FINDING-E5 (LOW)**: `@import url()` for Google Fonts in email CSS (line 114) — many email clients block external CSS imports. The font stack has fallbacks (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`) so this is acceptable.

**FINDING-E6 (OK)**: `sendCampaignWinEmails` and `sendCampaignVisibilityReport` correctly check for `business.contactEmail` before attempting to send. Good null safety.

**FINDING-E7 (MEDIUM)**: Dynamic imports inside `sendCampaignWinEmails` and `sendCampaignVisibilityReport` (lines 907-912, 963-968) — these re-import `getDb`, `campaigns`, `businesses`, `clientDashboards`, and `eq` inside the function body. This works but is unusual. Should use static imports at the top of the file like all other modules. May cause issues with tree-shaking or module resolution.


## Phase 8: tRPC Router Audit (routers.ts — 1869 lines)

### Router Structure (20 routers total)
1. `auth` — login/logout/me (framework)
2. `business` — CRUD for businesses
3. `training` — training sessions CRUD + start/stop/restart
4. `dashboard` — metrics
5. `schedule` — scheduled jobs CRUD + run history
6. `aiProvider` — model listing
7. `packageTier` — package tier CRUD
8. `campaign` — campaigns + keyword research + credibility + content generation
9. `webhookLog` — webhook log listing
10. `industryCache` — keyword cache management
11. `promptTemplate` — prompt template CRUD
12. `wpPublisher` — WordPress publishing
13. `indexing` — SinByte indexing
14. `pipeline` — pipeline orchestrator
15. `rankTracking` — rank checks + reports + trends
16. `clientDashboard` — public dashboard + admin CRUD
17. `smartScheduler` — mode management + auto-recovery
18. `wins` — win detection + reports
19. `email` — email sending + previews
20. `trainingContext` — enrichment status + context

### ISSUES FOUND

#### CRITICAL-R1: Hardcoded dashboard URL in email router
- Lines 1773, 1806: `https://aitrainhub-ln7nmkz9.manus.space/report/...` is hardcoded
- This will break if the domain changes
- FIX: Use an environment variable or derive from request URL

#### CRITICAL-R2: Missing ownership check on wpPublisher procedures
- Line 1302-1354: `testConnection`, `storeCredentials`, `publishCampaign`, `publishLlmTxt`, `getPublishedUrls` do NOT verify `ctx.user.id` owns the business/campaign
- Any authenticated user could publish to any business's WordPress
- FIX: Add ownership verification

#### CRITICAL-R3: Missing ownership check on indexing procedures
- Lines 1358-1380: All `indexing.*` procedures lack user ownership verification
- Any authenticated user could submit/verify indexing for any campaign
- FIX: Add campaign ownership check

#### CRITICAL-R4: Missing ownership check on rankTracking procedures
- Lines 1420-1437: `runCheck`, `getReport`, `getTrends` don't verify ownership
- FIX: Add campaign ownership check

#### CRITICAL-R5: Missing ownership check on wins procedures
- Lines 1654-1680: All `wins.*` procedures lack ownership verification
- FIX: Add campaign ownership check

#### CRITICAL-R6: Missing ownership check on email procedures
- Lines 1694-1817: `sendWinNotification`, `sendVisibilityReport`, `sendWelcome`, `sendMilestone` don't verify the user owns the campaign
- FIX: Add campaign ownership check

#### CRITICAL-R7: Missing ownership check on trainingContext procedures
- Lines 1557-1589: `trainingContext.*` procedures don't verify the user owns the business
- FIX: Add business ownership check

#### CRITICAL-R8: Missing ownership check on smartScheduler procedures
- Lines 1607-1648: `getCampaignStatus`, `getRecommendation`, `applyModeChange` don't verify ownership
- `checkAutoRecovery` and `evaluateAll` are global operations — should be admin-only
- FIX: Add campaign ownership check; restrict global operations

#### MEDIUM-R1: wpPublisher.publishCampaign input may not match function signature
- Line 1337: Takes `dryRun` as optional boolean — need to verify the function accepts this

#### LOW-R1: Inconsistent error handling patterns
- Some procedures use `throw new Error(...)`, others could use `throw new TRPCError(...)` for proper HTTP status codes
- Not a bug, but TRPCError gives better client-side error handling



## Phase 10: Reverse Audit — Backend-to-Frontend Cross-Reference

### Cross-Reference: db.ts ↔ routers.ts ↔ schema.ts
- All 21 tables have corresponding CRUD functions in db.ts or dbCampaigns.ts ✓
- All db functions are imported and used in routers.ts ✓
- All schema types (Select + Insert) are exported and used ✓
- `getTrainingSessionById` exists in db.ts (line 285) — confirms FINDING-T2 is OK ✓

### Cross-Reference: Webhook → Pipeline → Services
- **CONFIRMED ISSUE-009**: Webhook creates campaign but does NOT trigger pipeline. The pipeline orchestrator exists and works, but the webhook doesn't call it.
- **CONFIRMED ISSUE-010**: WP credentials from webhook are silently dropped. The `businesses` table has `wpAdminUrl`, `wpUsername`, `wpAppPassword` columns (schema lines 86-88) but the webhook handler never sets them.
- **CONFIRMED ISSUE-006**: Dashboard URL in webhook response uses `/dashboard/` but App.tsx route is `/report/:token`.

### Cross-Reference: Pipeline Steps → Service Functions
Step 1 (keyword_research): Calls `runKeywordResearchPipeline` → uses DataForSEO → stores in campaignQueryLocations ✓
Step 2 (credibility_research): Calls `runCredibilityResearch` → uses Claude → stores in credibilityData ✓
Step 3 (content_generation): Calls `runContentGeneration` → uses Claude → stores in contentPages ✓
Step 4 (publishing): Calls `publishCampaignToWordPress` → uses WP REST API → updates contentPages ✓
Step 5 (indexing): Calls `submitCampaignForIndexing` → uses SinByte API → stores task IDs ✓
Step 6 (indexing_verification): Calls `verifyCampaignIndexing` → HTTP HEAD checks ✓
Step 7 (baseline_check): Calls `runBaselineRankCheck` → uses DataForSEO → stores rankSnapshots ✓
Step 8 (training): **STUB** — only sets status, doesn't trigger training queue ✓ (ISSUE-028 confirmed)

### Cross-Reference: Frontend Pages → tRPC Procedures
- Dashboard.tsx → `campaign.list`, `campaign.getStats`, `business.list` ✓
- Campaigns.tsx → `campaign.listWithBusiness`, `campaign.delete` ✓
- CampaignDetail.tsx → `campaign.getById`, `pipeline.getStatus`, `pipeline.runStep`, `pipeline.runFull`, `rankTracking.getReport`, `smartScheduler.getCampaignStatus`, `wins.detectWins`, `campaign.getContentPages`, `campaign.getCredibilityData`, `webhookLog.list` ✓
- ClientDashboard.tsx → `clientDashboard.getPublicReport` ✓
- ClientDashboards.tsx → `clientDashboard.listAll`, `clientDashboard.create`, `clientDashboard.toggle`, `business.list` ✓
- KeywordCache.tsx → `industryCache.list`, `industryCache.get`, `industryCache.lock`, `industryCache.unlock`, `industryCache.updateKeywords`, `industryCache.updateLockThreshold`, `industryCache.delete`, `industryCache.refresh` ✓
- PromptTemplates.tsx → `promptTemplate.list`, `promptTemplate.create`, `promptTemplate.update`, `promptTemplate.delete`, `promptTemplate.resetToDefaults` ✓
- EmailManagement.tsx → `email.sendTest`, `email.sendWinNotification`, `email.sendVisibilityReport`, `email.sendWelcome`, `email.sendMilestone`, `email.previewWinEmail`, `email.previewVisibilityReport`, `campaign.listWithBusiness` ✓

### Cross-Reference: Frontend tRPC Calls → Backend Procedure Names
All frontend tRPC calls match actual backend procedure names ✓
No orphaned or misspelled procedure references found ✓

### Cross-Reference: App.tsx Routes → Page Components
- `/` → Home.tsx ✓
- `/dashboard` → Dashboard.tsx ✓
- `/businesses` → Businesses.tsx ✓
- `/businesses/:id` → BusinessDetail.tsx ✓
- `/campaigns` → Campaigns.tsx ✓
- `/campaigns/:id` → CampaignDetail.tsx ✓
- `/training` → Training.tsx ✓
- `/training/:id` → TrainingDetail.tsx ✓
- `/settings` → Settings.tsx ✓
- `/keyword-cache` → KeywordCache.tsx ✓
- `/prompts` → PromptTemplates.tsx ✓
- `/client-dashboards` → ClientDashboards.tsx ✓
- `/emails` → EmailManagement.tsx ✓
- `/report/:token` → ClientDashboard.tsx ✓
All routes have corresponding page components ✓

### Cross-Reference: Sidebar Navigation → Routes
All sidebar nav items point to valid routes ✓
Icons are consistent (Lucide React) ✓

### Cross-Reference: Database Columns → Service Usage
- `businesses.wpAdminUrl` / `wpUsername` / `wpAppPassword` — Used by wordpressPublisher.ts ✓, but NOT set by webhookHandler.ts ✗ (ISSUE-010)
- `campaigns.trainingAggressiveness` — Used by smartScheduler.ts ✓, set by webhookHandler.ts ✓
- `campaigns.rankCheckFrequency` — Used by smartScheduler.ts ✓, set by webhookHandler.ts ✓
- `campaigns.errorCount` — Incremented by pipelineOrchestrator.ts ✓
- `campaigns.lastError` — Set by pipelineOrchestrator.ts ✓
- `campaigns.sourceWebhookId` — Set by webhookHandler.ts ✓
- `contentPages.publishedUrl` — Set by wordpressPublisher.ts ✓
- `contentPages.schemaMarkup` — Set by contentGenerationEngine.ts ✓
- `rankSnapshots.chatgptMentioned` / `geminiMentioned` / `aiOverviewMentioned` — Set by dataforseoService.ts ✓
- `clientDashboards.accessCount` — Incremented by getPublicReport procedure ✓

### Cross-Reference: Environment Variables
- `SINBYTE_API_KEY` — Used by sinbyteIndexing.ts ✓, set in secrets ✓
- `RESEND_API_KEY` — Used by emailService.ts ✓, set in secrets ✓
- `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` — Used by dataforseoService.ts ✓, set in secrets ✓
- `ENCRYPTION_KEY` — Used by wordpressPublisher.ts for WP credential encryption ✓, set in secrets ✓
- `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` — Used by trainingQueue.ts and trainingQueueV2.ts ✓
- `SUPABASE_DATABASE_URL` — Used by db.ts ✓

---

## SUMMARY: Issues by Severity

### CRITICAL (Must Fix Before Production)
| # | Issue | File | Description |
|---|-------|------|-------------|
| 006 | Dashboard URL wrong path | webhookHandler.ts:257 | Returns `/dashboard/` but route is `/report/` |
| 009 | No auto pipeline kickoff | webhookHandler.ts:261 | Campaign created but pipeline never starts |
| 010 | WP credentials dropped | webhookHandler.ts:167 | Webhook WP creds never stored on business |
| 014 | Only 1 location stored | webhookHandler.ts:177 | Multi-location clients lose locations |
| 018 | Credibility orderBy wrong | credibilityResearchEngine.ts:342 | Returns oldest data instead of latest |
| E1 | Hardcoded email domain | emailService.ts:930,984 | Sandbox URL hardcoded in email templates |
| R1 | Hardcoded email domain | routers.ts:1773,1806 | Same hardcoded URL in router |
| R2-R8 | Missing ownership checks | routers.ts (multiple) | 7 routers lack user ownership verification |

### HIGH (Should Fix)
| # | Issue | File | Description |
|---|-------|------|-------------|
| 007 | SiteForge callback stub | webhookHandler.ts:311 | Scenario C clients won't advance |
| 028 | Training step is stub | pipelineOrchestrator.ts:297 | Pipeline training step doesn't trigger queue |
| R4 | Competitor tracking empty | rankTrackingEngine.ts:660 | topCompetitors always empty array |

### MEDIUM (Should Address)
| # | Issue | File | Description |
|---|-------|------|-------------|
| 008 | No webhook auth | webhookHandler.ts | No secret verification on webhooks |
| 011 | Incomplete business update | webhookHandler.ts:156 | Re-onboarding misses fields |
| 012 | No duplicate campaign check | webhookHandler.ts | Same business can create duplicate campaigns |
| 021 | undefined vs null | contentGenerationEngine.ts:553 | Nullable field set to undefined |
| 024 | llm.txt wrong path | wordpressPublisher.ts:515 | Published at /llm-txt not /llm.txt |
| 026 | Indexing verification | sinbyteIndexing.ts:300 | Checks HTTP not Google indexing |
| S1 | db! non-null assertion | smartScheduler.ts:129 | Could throw if DB unavailable |
| E7 | Dynamic imports | emailService.ts:907 | Unusual import pattern |

### LOW (Nice to Have)
| # | Issue | File | Description |
|---|-------|------|-------------|
| 001-005 | Missing FK references | schema.ts | No foreign keys on some columns |
| 013 | Race condition | keywordResearchPipeline.ts:311 | Error count increment |
| 016 | Last response only | dataforseoService.ts:237 | Overwrites on multiple responses |
| 017 | Hardcoded model | credibilityResearchEngine.ts:255 | Model name hardcoded |
| 019 | Dynamic imports | contentGenerationEngine.ts:588 | Should be static imports |
| 020 | No status enum | contentPages | Text column instead of enum |
| Missing indexes | schema.ts | Performance indexes needed for scale |
