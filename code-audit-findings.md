# Comprehensive Code Audit Findings

## Schema Audit (drizzle/schema.ts)

### Issues Found:
1. **trainingSessions.campaignId** (line 147) — has NO foreign key constraint to campaigns.id. Should be `.references(() => campaigns.id, { onDelete: "set null" })`. This means orphaned training sessions can reference deleted campaigns without cleanup.

2. **trainingSessions.campaignQueryLocationId** (line 148) — has NO foreign key constraint to campaignQueryLocations.id. Same orphan risk.

3. **Comment says "TiDB compatibility"** (lines 14-20) — but the app uses PostgreSQL (Supabase). These varchar fields could be proper enums for better type safety: `trainingPhase`, `conversationType`, `promptType`, `promptTemplateType`. Not a bug, but a missed optimization.

### Schema Structure — Verified Correct:
- All foreign keys cascade correctly (cascade on delete for owned entities, set null for optional references)
- All timestamp fields have proper defaults
- All enum types are properly defined
- No duplicate or conflicting column names
- All table types are properly exported

## Files to Audit Next:
- server/db.ts — query helpers
- server/routers.ts — all procedures
- server/aiProviders.ts — direct API calls
- server/trainingQueue.ts — V1 worker
- server/trainingQueueV2.ts — V2 worker
- server/scheduler.ts — job scheduler
- server/webhookHandler.ts — webhook processing
- server/dataforseoService.ts — DataForSEO integration
- server/credibilityResearchEngine.ts — credibility research
- server/contentGenerationEngine.ts — content generation
- server/pipelineOrchestrator.ts — pipeline automation
- server/wpPublisher.ts — WordPress publishing
- server/sinbyteIndexing.ts — SinByte indexing
- server/rankTracker.ts — rank tracking
- server/trainingContextEnricher.ts — training context
- server/smartScheduler.ts — smart scheduling
- server/emailService.ts — email service
- All frontend pages


## Routers.ts Audit (1877 lines)

### Issues Found:

1. **auth.debug endpoint exposes sensitive info** (lines 20-65) — Returns Supabase config status, token details, and user info. This is a debug endpoint that should be removed or restricted in production. Not a blocker but a security concern.

2. **training.update checks userId ownership** (line 411) — `if (session.userId !== ctx.user.id)` — This is an ownership check that should be removed per the user's requirement that all employees share access. Same issue at line 448 (restartConversation).

3. **campaign.get checks userId ownership** (line 897) — `if (!campaign || campaign.userId !== ctx.user.id)` — Same pattern throughout the campaign router. These ownership checks need to be removed for shared team access.

4. **campaign.update checks userId** (line 919) — Same pattern.

5. **campaign.getQueryLocations checks userId** (line 931) — Same pattern.

6. **campaign.addQueryLocations checks userId** (line 952) — Same pattern.

7. **campaign.runKeywordResearch checks userId** (line 965) — Same pattern.

8. **campaign.runBaselineCheck checks userId** (line 977) — Same pattern.

9. **campaign.getRankSnapshots checks userId** (line 989) — Same pattern.

10. **campaign.runCredibilityResearch checks userId** (line 1000) — Same pattern.

11. **campaign.getCredibilityData checks userId** (line 1024) — Same pattern.

12. **campaign.runContentGeneration checks userId** (line 1036) — Same pattern.

13. **campaign.getContentPages checks userId** (line 1068) — Same pattern.

14. **promptTemplate.get checks userId** (line 1227) — Same pattern.

15. **promptTemplate.update checks userId** (line 1265) — Same pattern.

16. **promptTemplate.delete checks userId** (line 1280) — Same pattern.

17. **schedule.create checks session.userId** (line 698) — Same pattern.

18. **schedule.update checks job.userId** (line 747) — Same pattern.

19. **schedule.delete checks job.userId** (line 775) — Same pattern.

20. **schedule.runNow checks job.userId** (line 789) — Same pattern.

21. **schedule.getRunHistory checks job.userId** (line 807) — Same pattern.

### Summary:
There are ~20 userId ownership checks throughout the campaign, schedule, training, and prompt template routers that need to be removed for shared team access. The ownership checks I previously added to wpPublisher, indexing, etc. were already removed, but these original ones from the initial build still exist.


## dbCampaigns.ts Audit (638 lines)

### CRITICAL ISSUE:
1. **getCampaignsWithBusinessInfo(userId)** (line 535) — filters by `userId`. Since this is an internal team tool, it should return ALL campaigns, not just the logged-in user's. Same with **getCampaignStats(userId)** (line 165).
2. **campaign.list** in routers.ts calls `getCampaignsWithBusinessInfo(ctx.user.id)` — only shows the logged-in user's campaigns. Needs to show ALL.
3. **campaign.stats** in routers.ts calls `getCampaignStats(ctx.user.id)` — same issue.

### FIX NEEDED:
- Create `getAllCampaignsWithBusinessInfo()` and `getAllCampaignStats()` that don't filter by userId
- Or modify the existing functions to accept an optional userId parameter

## aiProviders.ts Audit (260 lines) — CLEAN
- All direct API calls to OpenAI, Anthropic, Google — no Manus dependencies
- Deprecated model mapping is good
- API key verification works correctly


## Remaining ctx.user.id Usage Audit

### Must change to show ALL (team-shared):
1. **business.list** (line 79): `getBusinessesByUserId(ctx.user.id)` — should show ALL businesses
2. **apiKey.list** (line 130): `getApiKeysByUserId(ctx.user.id)` — should show ALL API keys (team shares keys)
3. **training.list** (line 287): `getTrainingSessionsByUserId(ctx.user.id)` — should show ALL training sessions
4. **training.dashboard** (line 488-489): filters by userId — should show ALL in-progress
5. **training.retryAllErrors** (line 540-541): filters by userId — should retry ALL errors
6. **training.resumeAll** (line 629-630): filters by userId — should resume ALL
7. **training.stopAll** (line 651-652): filters by userId — should stop ALL
8. **training.metrics** (line 666): `getTodayMetrics(ctx.user.id)` — should show ALL metrics
9. **schedule.list** (line 674): `getScheduledJobsByUserId(ctx.user.id)` — should show ALL jobs
10. **schedule.getRunHistory** (line 808-809): `getScheduledJobRunsByUserId(ctx.user.id)` — should show ALL runs
11. **promptTemplate.list** (line 1207-1212): filters by userId — should show ALL templates

### OK to keep ctx.user.id (used for record creation, not filtering):
- business.create (line 96): userId for new business record — OK
- apiKey.save/upsert (lines 160, 200): userId for new key record — OK
- training.create (line 316): userId for new session record — OK
- training.restartConversation (line 453): userId for new session — OK
- schedule.create (line 709): userId for new job — OK
- campaign operations that pass userId to engines (lines 1005, 1048, 1074): used for record creation — OK
- promptTemplate.create (line 1240): userId for new template — OK
- pipeline.runStep/runFull (lines 1398, 1407): userId for pipeline execution — OK
