# Audit Fix List — Prioritized by Breakage Risk

## CRITICAL (Will crash or silently corrupt data)

1. **sinbyteIndexing.ts L248, L316**: Column 'indexingSubmittedAt' and 'indexingVerifiedAt' may not exist in schema — verify
2. **contentGenerationEngine.ts L432**: generateAndSavePage returns undefined on AI parse failure, caller doesn't check — silent content generation failure
3. **emailService.ts L930**: process.env.APP_BASE_URL undefined — runtime error in email links
4. **smartScheduler.ts L129**: Unsafe db! non-null assertion — crash if DB unavailable
5. **smartScheduler.ts L375, L400**: applyCampaignModeChange and sendAdminNotification called but not defined — crash
6. **trainingQueue.ts L394**: job.id accessed without null check in failed event handler — crash
7. **trainingQueueV2.ts L388, L625**: Critical errors swallowed, sessions not marked as failed
8. **promptGeneration.ts L93, L183, L243, L303**: Empty template arrays cause undefined access — crash

## HIGH (Likely to cause problems)

9. **scheduler.ts L600, L610, L621**: getTrainingSessionById returns null, no null check — crash
10. **contentGenerationEngine.ts L307**: Campaign updatedAt not set on update
11. **storage.ts L67**: getPublicUrl result not checked for errors
12. **trainingQueue.ts L167**: basePrompt can be undefined, function expects string

## FALSE POSITIVES (from parallel audit — these are wrong)
- trainingEngine.ts "orphaned references" to db.ts, trainingQueue.ts, trainingQueueV2.ts — these DO exist in same directory
- pipelineOrchestrator.ts "orphaned references" — these use dynamic imports which DO resolve at runtime
- webhookHandler.ts "import from ./dbCampaigns doesn't exist" — it DOES exist
- dataforseoService.ts L346 "syntax error" — likely false positive from audit agent
