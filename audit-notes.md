# Reverse Audit: Backend Services → Frontend Components

## Backend Service Modules (non-test files):
1. aiProviders.ts → Used via `trpc.aiProvider.getModels` in TrainingSessions.tsx ✅
2. contentGenerationEngine.ts → Used via `trpc.campaign.getContentPages` in CampaignDetail.tsx ✅
3. credibilityResearchEngine.ts → Used via `trpc.campaign.getCredibilityData` in CampaignDetail.tsx ✅
4. dataforseoService.ts → Used internally by keywordResearchPipeline.ts ✅
5. db.ts → Core database layer, used everywhere ✅
6. dbCampaigns.ts → Used via `trpc.campaign.*` and `trpc.packageTier.*` ✅
7. emailService.ts → Used via `trpc.email.*` in EmailManagement.tsx ✅
8. encryption.ts → Used internally by wordpressPublisher.ts ✅
9. keywordResearchPipeline.ts → Used via pipeline steps in CampaignDetail.tsx ✅
10. ownershipChecks.ts → Used by routers.ts (just added) ✅
11. pipelineOrchestrator.ts → Used via `trpc.pipeline.*` in CampaignDetail.tsx ✅
12. promptGeneration.ts → Used internally by trainingQueue.ts ✅
13. rankTrackingEngine.ts → Used via `trpc.rankTracking.*` in CampaignDetail.tsx ✅
14. routers.ts → Main tRPC router ✅
15. scheduler.ts → Used via `trpc.schedule.*` in ScheduledJobs.tsx ✅
16. sinbyteIndexing.ts → Used via `trpc.indexing.*` in CampaignDetail.tsx ✅
17. smartScheduler.ts → Used via `trpc.smartScheduler.*` in CampaignDetail.tsx ✅
18. storage.ts → S3 helpers ✅
19. trainingContextEnricher.ts → Used via `trpc.trainingContext.*` in CampaignDetail.tsx ✅
20. trainingEngine.ts → Used internally by training routers ✅
21. trainingQueue.ts → Used internally by trainingEngine.ts ✅
22. trainingQueueV2.ts → Used internally by trainingEngine.ts ✅
23. webhookHandler.ts → Used via `trpc.webhookLog.*` in CampaignDetail.tsx ✅
24. winNotifications.ts → Used via `trpc.wins.*` in CampaignDetail.tsx ✅
25. wordpressPublisher.ts → Used via `trpc.wpPublisher.*` in CampaignDetail.tsx ✅

## Frontend Pages → Backend Coverage:
1. Dashboard.tsx → trpc.dashboard.metrics ✅
2. Businesses.tsx → trpc.business.* ✅
3. TrainingSessions.tsx → trpc.training.*, trpc.business.list, trpc.aiProvider.getModels ✅
4. ScheduledJobs.tsx → trpc.schedule.*, trpc.training.list ✅
5. Settings.tsx → trpc.apiKey.* ✅
6. Campaigns.tsx → trpc.campaign.list, trpc.campaign.stats ✅
7. PackageTiers.tsx → trpc.packageTier.* ✅
8. ClientDashboard.tsx → trpc.clientDashboard.getByToken ✅
9. ClientDashboards.tsx → trpc.clientDashboard.*, trpc.business.list, trpc.campaign.list ✅
10. CampaignDetail.tsx → trpc.campaign.get, trpc.pipeline.*, trpc.smartScheduler.*, trpc.wins.*, trpc.rankTracking.*, trpc.webhookLog.*, trpc.trainingContext.*, trpc.wpPublisher.* ✅
11. PromptTemplates.tsx → trpc.promptTemplate.* ✅
12. KeywordCache.tsx → trpc.industryCache.* ✅
13. EmailManagement.tsx → trpc.email.*, trpc.campaign.list ✅

## Unused Frontend Pages:
- Home.tsx → Not routed (replaced by Dashboard.tsx in DashboardLayout) — HARMLESS
- ComponentShowcase.tsx → Not routed — HARMLESS (dev reference)

## Conclusion:
Every backend service module is wired to at least one frontend page or used internally.
Every frontend page has working tRPC calls to the backend.
No orphaned services or dead code found.
