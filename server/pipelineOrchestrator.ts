/**
 * Pipeline Orchestrator
 * 
 * Connects all AI Answer Forge sprint services into a single automated pipeline.
 * When a GHL webhook creates a campaign, the orchestrator can run the full flow:
 * 
 * 1. Keyword Research — auto-generates queries; pauses at query_review for admin approval
 * 2. Baseline Check — fires automatically after query approval; captures Day-0 AI visibility snapshot
 * 3. Credibility Research — auto-runs after baseline
 * 4. Content Generation — auto-runs after credibility research
 * 5. Publishing — pauses here if content URLs are missing; auto-advances if all URLs already present
 * 6. Indexing — submits live URLs to Monkey Indexer; scheduler advances to training after submission
 * 7. V3 Sprint Training — 4-day sprint; scheduler fires each day automatically
 * 
 * The orchestrator tracks progress per campaign and can resume from any step
 * if a previous step failed. It also supports running individual steps manually.
 */

import { getDb } from "./db";
import { campaigns, businesses } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ============= Types =============

export type PipelineStep = 
  | "keyword_research"
  | "query_review"
  | "credibility_research"
  | "content_generation"
  | "publishing"
  | "indexing"
  | "baseline_check"
  | "fan_out_audit"
  | "training";

export interface PipelineStepResult {
  step: PipelineStep;
  success: boolean;
  message: string;
  data?: any;
  duration?: number; // ms
  nextStep?: PipelineStep;
}

export interface PipelineStatus {
  campaignId: number;
  businessName: string;
  currentStep: PipelineStep;
  completedSteps: PipelineStep[];
  pendingSteps: PipelineStep[];
  lastError?: string;
  startedAt?: string;
  lastActivityAt?: string;
}

// ============= Step Definitions =============

const PIPELINE_STEPS: PipelineStep[] = [
  "keyword_research",
  "baseline_check",
  "fan_out_audit",
  "credibility_research",
  "content_generation",
  "publishing",
  "indexing",
  "training",
];

/**
 * Map campaign status to pipeline step
 */
function statusToStep(status: string): PipelineStep {
  const mapping: Record<string, PipelineStep> = {
    pending: "keyword_research",
    keyword_research: "keyword_research",
    query_review: "credibility_research",  // query_review pauses before credibility_research
    fan_out_audit: "fan_out_audit",
    credibility_research: "credibility_research",
    content_generation: "content_generation",
    publishing: "publishing",
    indexing: "indexing",
    baseline_check: "baseline_check",
    training: "training",
    monitoring: "training",
    paused: "training",
    error: "keyword_research", // Will determine actual step from timestamps
  };
  return mapping[status] || "keyword_research";
}

/**
 * Determine the next step based on what's been completed
 */
export function determineNextStep(campaign: any): PipelineStep {
  if (!campaign.keywordResearchCompletedAt) return "keyword_research";
  if (!campaign.baselineCheckCompletedAt) return "baseline_check";
  if (!campaign.fanOutAuditCompletedAt) return "fan_out_audit";
  if (!campaign.credibilityResearchCompletedAt) return "credibility_research";
  if (!campaign.contentGenerationCompletedAt) return "content_generation";
  if (!campaign.publishingCompletedAt) return "publishing";
  if (!campaign.indexingSubmittedAt) return "indexing";
  return "training";
}

/**
 * Get the list of completed steps for a campaign
 */
export function getCompletedSteps(campaign: any): PipelineStep[] {
  const completed: PipelineStep[] = [];
  if (campaign.keywordResearchCompletedAt) completed.push("keyword_research");
  if (campaign.baselineCheckCompletedAt) completed.push("baseline_check");
  if (campaign.fanOutAuditCompletedAt) completed.push("fan_out_audit");
  if (campaign.credibilityResearchCompletedAt) completed.push("credibility_research");
  if (campaign.contentGenerationCompletedAt) completed.push("content_generation");
  if (campaign.publishingCompletedAt) completed.push("publishing");
  if (campaign.indexingSubmittedAt) completed.push("indexing");
  if (campaign.trainingStartedAt) completed.push("training");
  return completed;
}

// ============= Step Executors =============

/**
 * Run a single pipeline step for a campaign
 */
export async function runPipelineStep(
  campaignId: number,
  step: PipelineStep,
  userId: number
): Promise<PipelineStepResult> {
  const startTime = Date.now();
  
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get campaign and business info
  const campaignResults = await db.select().from(campaigns)
    .where(eq(campaigns.id, campaignId)).limit(1);
  const campaign = campaignResults[0];
  if (!campaign) throw new Error("Campaign not found");
  
  const { getBusinessById } = await import("./db");
  const business = await getBusinessById(campaign.businessId);
  if (!business) throw new Error("Business not found");
  
  console.log(`[Pipeline] Running step "${step}" for campaign ${campaignId} (${business.name})`);
  
  try {
    let result: PipelineStepResult;
    
    switch (step) {
      case "keyword_research": {
        const { runCampaignKeywordResearch } = await import("./keywordResearchPipeline");
        const kwResult = await runCampaignKeywordResearch(campaignId);
        // After keyword research, pause for query review unless queries were pre-set
        const { updateCampaign } = await import('./dbCampaigns');
        await updateCampaign(campaignId, { status: 'query_review' });
        result = {
          step,
          success: true,
          message: `Keyword research complete. Found ${kwResult.queryLocationsCreated || 0} query-location combinations. Paused for query review.`,
          data: kwResult,
          nextStep: "credibility_research",
        };
        break;
      }
      
      case "fan_out_audit": {
        // ── Fan-Out Audit ─────────────────────────────────────────────────────
        // Runs after baseline_check. Calls the OpenAI Responses API to capture
        // what ChatGPT searches when verifying this business entity, then builds
        // a gap list of claims that can't be independently verified.
        // The pipeline PAUSES here so ops can fill in verification URLs before
        // content generation bakes them into copy, schema, and llm.txt.
        if (!campaign.baselineCheckCompletedAt) {
          throw new Error(
            "Baseline check must be completed before running the Fan-Out Audit."
          );
        }
        let auditResult: any = null;
        let unresolvedCount = 0;
        try {
          const { runFanOutAudit } = await import("./fanOutAuditEngine");
          auditResult = await runFanOutAudit(campaignId);
          unresolvedCount = auditResult.gapList.filter((g: any) => g.status === "gap").length;
          // Notify ops team if there are gaps to resolve
          if (unresolvedCount > 0) {
            try {
              const { notifyOwner } = await import("./_core/notification");
              const adminUrl = `${process.env.APP_BASE_URL ?? ""}/campaigns/${campaignId}`;
              await notifyOwner({
                title: `Fan-Out Audit: ${unresolvedCount} Verification Gap${unresolvedCount !== 1 ? "s" : ""} — ${business.name}`,
                content: [
                  `ChatGPT ran ${auditResult.fanOutQueries.length} queries when researching ${business.businessType ?? "contractors"} in ${business.location ?? "your area"}.`,
                  "",
                  auditResult.auditSummary,
                  "",
                  `Action required: Open the campaign and go to the Fan-Out Audit tab to add verification URLs for each open gap.`,
                  `Campaign: ${adminUrl}`,
                ].join("\n"),
              });
            } catch (emailErr: any) {
              console.error("[Pipeline] Failed to send fan-out audit notification:", emailErr.message);
            }
          }
        } catch (auditErr: any) {
          // Fan-out audit is non-blocking. If OpenAI key is missing or the API
          // call fails, log the error and auto-advance to credibility_research.
          // Ops can run the audit manually later from the Fan-Out Audit tab.
          console.warn(`[Pipeline] Fan-out audit skipped for campaign ${campaignId}: ${auditErr.message}`);
          await updateCampaign(campaignId, {
            fanOutAuditCompletedAt: new Date(),
            fanOutGapList: [],
          } as any);
          result = {
            step,
            success: true,
            message: `Fan-out audit skipped (${auditErr.message}). Pipeline continuing to credibility research — run the audit manually from the Fan-Out Audit tab when ready.`,
            nextStep: "credibility_research",
          };
          break;
        }
        result = {
          step,
          success: true,
          message: `Fan-out audit complete. ${auditResult.fanOutQueries.length} queries captured, ${unresolvedCount} verification gap${unresolvedCount !== 1 ? "s" : ""} found. ${unresolvedCount > 0 ? "Ops team notified — add verification URLs before proceeding to credibility research." : "All claims verifiable — ready for credibility research."}`,
          data: {
            fanOutQueryCount: auditResult.fanOutQueries.length,
            gapCount: auditResult.gapList.length,
            unresolvedCount,
            clientMentioned: auditResult.clientMentioned,
            winnerEntity: auditResult.winnerEntity,
          },
          // nextStep intentionally omitted — pipeline pauses here for ops URL entry
          // (or auto-advances if no gaps)
          nextStep: unresolvedCount === 0 ? "credibility_research" : undefined,
        };
        break;
      }

      case "credibility_research": {
        // ── Baseline + Fan-Out Audit gates ────────────────────────────────────
        // Credibility research must NOT run until both the baseline check AND
        // the fan-out audit have been completed (all gaps resolved or N/A).
        if (!campaign.baselineCheckCompletedAt) {
          throw new Error(
            "Baseline visibility check must be completed before running credibility research. " +
            "Run the Baseline step first to capture a clean pre-content AI visibility snapshot."
          );
        }
        // Fan-out audit is non-blocking — pipeline auto-advances even if audit was skipped.
        // If fanOutAuditCompletedAt is null, credibility research can still run.
        // Check that all gaps are resolved
        const gapList = (campaign.fanOutGapList as any[]) ?? [];
        const openGaps = gapList.filter((g: any) => g.status === "gap");
        if (openGaps.length > 0) {
          throw new Error(
            `${openGaps.length} fan-out verification gap${openGaps.length !== 1 ? "s" : ""} still need URLs. ` +
            "Resolve all gaps in the Fan-Out Audit tab before running credibility research."
          );
        }
        const { runCredibilityResearch } = await import("./credibilityResearchEngine");
        // Parse pre-supplied credibility URLs from the business record (BBB, certs, etc.)
        let parsedCredibilityUrls: Array<{ label: string; url: string }> | undefined;
        try {
          const raw = (business as any).credibilityUrls;
          if (raw) parsedCredibilityUrls = JSON.parse(raw);
        } catch { /* ignore parse errors */ }
        const credResult = await runCredibilityResearch({
          userId,
          businessId: campaign.businessId,
          campaignId,
          businessName: business.name,
          websiteUrl: business.website || "",
          industry: business.businessType || "",
          location: business.location || "",
          credibilityUrls: parsedCredibilityUrls,
        });

        // ── License / certification URL resolution ────────────────────────────
        // Attempt to resolve each verificationUrl from a generic search-form page
        // to a direct result page for this specific business. Facts that cannot
        // be resolved automatically get a lookupFlag so the agency knows to
        // update the link manually before publishing.
        let licenseResolutionSummary = "";
        try {
          const { resolveAllLicenseUrls } = await import("./licenseVerificationService");
          const licenseStats = await resolveAllLicenseUrls(credResult.facts, business.name);
          licenseResolutionSummary = ` License lookups: ${licenseStats.resolved} resolved, ${licenseStats.flagged} flagged for manual review.`;
        } catch (licErr: any) {
          console.warn("[Pipeline] License verification step failed (non-fatal):", licErr.message);
        }

        result = {
          step,
          success: true,
          message: `Credibility research complete. Score: ${credResult.overallScore}/100, ${credResult.facts.length} facts found, ${credResult.suggestedPages.length} pages suggested.${licenseResolutionSummary}`,
          data: { score: credResult.overallScore, factCount: credResult.facts.length },
          nextStep: "content_generation",
        };
        break;
      }
      
      case "content_generation": {
        const { getCredibilityDataForCampaign } = await import("./credibilityResearchEngine");
        const credData = await getCredibilityDataForCampaign(campaignId);
        if (!credData) {
          throw new Error("Credibility research must be completed first");
        }
        
        const { generateAllContentPages } = await import("./contentGenerationEngine");
        // Load resolved fan-out gap items so content generation can embed verification URLs
        const fanOutGapList = ((campaign as any).fanOutGapList as any[] ?? []).filter(
          (g: any) => g.status === "resolved" && g.verificationUrl
        );
        const contentResult = await generateAllContentPages({
          userId,
          businessId: campaign.businessId,
          campaignId,
          businessName: business.name,
          websiteUrl: business.website || "",
          industry: business.businessType || "",
          location: business.location || "",
          credibilityResult: credData.researchResults as any,
          campaignScope: (campaign as any).campaignScope ?? "local",
          fanOutGapList,
        });


        result = {
          step,
          success: true,
          message: `Content generation complete. Generated ${contentResult.totalPages} pages.`,
          data: { totalPages: contentResult.totalPages },
          nextStep: "publishing",
        };
        break;
      }
      
      case "publishing": {
        // Check if all publishable content pages already have URLs entered.
        // If yes: set publishingCompletedAt and let the pipeline continue to indexing.
        // If no: send the team notification email and pause here — pipeline resumes
        //        automatically when setContentPageUrl enters the last missing URL.
        const { contentPages: cpTable } = await import("../drizzle/schema");
        const { eq: eqOp, isNull: isNullOp, notInArray: notInArrayOp } = await import("drizzle-orm");
        const NON_PUBLISHABLE_TYPES = ["llm_txt", "schema_package", "schema_audit", "schema_delivery"];
        const allPages = await db.select().from(cpTable).where(eqOp(cpTable.campaignId, campaignId));
        const publishablePages = allPages.filter(p => !NON_PUBLISHABLE_TYPES.includes(p.pageType));
        const missingUrlPages = publishablePages.filter(p => !p.publishedUrl);

        if (missingUrlPages.length === 0 && publishablePages.length > 0) {
          // All URLs present — auto-advance: set publishingCompletedAt and continue pipeline
          await db.update(campaigns).set({
            publishingCompletedAt: new Date(),
            status: "indexing",
            updatedAt: new Date(),
          }).where(eq(campaigns.id, campaignId));
          result = {
            step,
            success: true,
            message: `All ${publishablePages.length} content URL(s) already present — publishing complete, advancing to indexing.`,
            data: { pageCount: publishablePages.length, autoAdvanced: true },
            nextStep: "indexing",
          };
        } else {
          // URLs missing — notify team and pause
          const pageCount = publishablePages.length;
          const adminUrl = `${process.env.APP_BASE_URL ?? ""}/campaigns/${campaignId}`;
          try {
            const { notifyOwner } = await import("./_core/notification");
            await notifyOwner({
              title: `Content Ready for Publishing: ${business.name}`,
              content: [
                `${pageCount} credibility page(s) have been generated for ${business.name} and are ready to be copied into the client's website.`,
                "",
                "Action required:",
                "1. Open the campaign in the dashboard (link below).",
                "2. Go to the Content tab — each page shows its placement instructions and a Copy button.",
                "3. Paste the content into the correct page on the client's site.",
                "4. Enter the live URL for each page in the dashboard.",
                "5. Indexing will start automatically once all URLs are saved.",
                "",
                `Campaign: ${adminUrl}`,
              ].join("\n"),
            });
          } catch (emailErr: any) {
            console.error("[Pipeline] Failed to send content-ready notification:", emailErr.message);
          }
          await db.update(campaigns).set({
            status: "publishing",
            updatedAt: new Date(),
          }).where(eq(campaigns.id, campaignId));
          result = {
            step,
            success: true,
            message: `Content ready for publishing. ${pageCount} page(s) generated — team notified. Enter live URLs in the Content tab to trigger indexing.`,
            data: { pageCount, waitingForUrls: true },
            // nextStep intentionally omitted — pipeline pauses here until admin enters URLs
          };
        }
        break;
      }
      
      case "indexing": {
        // ── Indexing gate (URL-only) ──────────────────────────────────────────────────────────────────────
        // Only requires all content pages to have a publishedUrl.
        // llm.txt and schema are NOT required here — they can be added before or
        // after URL submission. The Indexing stage won't show "complete" on the
        // pipeline bar until llm.txt + schema are also verified, but we submit
        // to Monkey Indexer immediately to maximise indexing lead time.
        try {
          const { enforceIndexingGate } = await import("./contentVerifier");
          await enforceIndexingGate({
            campaignId,
            websiteUrl: business.website || "",
          });
        } catch (gateErr: any) {
          // Set campaign status back to 'publishing' so the UI shows the warning
          await db.update(campaigns)
            .set({ status: "publishing", updatedAt: new Date() })
            .where(eq(campaigns.id, campaignId));
          throw gateErr;
        }

        const { submitCampaignForIndexing } = await import("./monkeyIndexer");
        const indexResult = await submitCampaignForIndexing({
          campaignId,
          businessName: business.name,
        });
        result = {
          step,
          success: indexResult.submitted,
          message: indexResult.submitted
            ? `Submitted ${indexResult.urlsSubmitted} URLs to Monkey Indexer. Credits remaining: ${indexResult.creditsRemaining ?? "?"}. Verification in 3-4 days.`
            : `Indexing submission failed: ${indexResult.error}`,
          data: indexResult,
          nextStep: "training",
        };
        break;
      }
      
      case "baseline_check": {
        // ── Idempotency guard ─────────────────────────────────────────────────
        // If baselineCheckCompletedAt is already set, the baseline has already
        // run and its snapshots are in the DB. Re-running would overwrite the
        // clean-slate data with fresh (potentially different) results, breaking
        // the before/after comparison. Skip silently and advance.
        if (campaign.baselineCheckCompletedAt) {
          console.log(`[Pipeline] baseline_check already completed for campaign ${campaignId} at ${campaign.baselineCheckCompletedAt.toISOString()} — skipping to avoid overwriting baseline data`);
          result = {
            step,
            success: true,
            message: `Baseline check already completed at ${campaign.baselineCheckCompletedAt.toISOString()} — skipped (idempotent).`,
            nextStep: "credibility_research",
          };
          break;
        }
        // ── V6: Generate conversational questions before baseline ─────────────
        // For V6 campaigns, MiniMax generates natural conversational questions
        // (e.g. "Who is the most trusted AC repair company in Chino Hills, CA?")
        // and stores them in campaignQueryLocations + trainingQueries.
        // The baseline then runs on those exact stored questions.
        if (campaign.trainingVersion === "v6") {
          console.log(`[Pipeline] V6 campaign ${campaignId} — generating conversational questions before baseline`);
          const { generateV6Questions } = await import("./v6QuestionGenerator");
          await generateV6Questions(campaignId);
          console.log(`[Pipeline] V6 question generation complete for campaign ${campaignId}`);
        }
        const { runCampaignBaselineCheck } = await import("./keywordResearchPipeline");
        const baselineResult = await runCampaignBaselineCheck(campaignId);
        result = {
          step,
          success: true,
          message: `Baseline rank check complete. ${baselineResult.snapshotsCreated || 0} rank snapshots recorded.`,
          data: baselineResult,
          nextStep: "credibility_research",
        };
        break;
      }
      
      case "training": {
        // ── Training gate (full: URLs + llm.txt + schema) ──────────────────────────────────────────────────────────────────────
        // Hard gate: ALL THREE must pass before training starts.
        // enforcePublishingGate is an alias for enforceTrainingGate.
        try {
          const { enforcePublishingGate } = await import("./contentVerifier");
          await enforcePublishingGate({
            campaignId,
            websiteUrl: business.website || "",
          });
        } catch (gateErr: any) {
          await db.update(campaigns)
            .set({ status: "publishing", updatedAt: new Date() })
            .where(eq(campaigns.id, campaignId));
          throw gateErr;
        }

        // Apply aggressive training mode via smart scheduler
        const { applyCampaignModeChange } = await import("./smartScheduler");
        try {
          await applyCampaignModeChange(campaignId, "aggressive", "Pipeline auto-start: beginning aggressive training");
        } catch (e: any) {
          console.log(`[Pipeline] Smart scheduler mode change skipped: ${e.message}`);
        }

        // ── Seed trainingQueries from campaignQueryLocations (idempotent guard) ───────
        // trainingQueries must exist before the sprint runs. They are normally seeded
        // at approveQueryReview, but campaigns that bypassed query_review (e.g. those
        // created via createManual or fast-tracked through the pipeline) may arrive
        // here without any trainingQueries rows. This guard ensures they are always
        // present before the sprint schedule fires.
        try {
          const { trainingQueries: tqTable } = await import("../drizzle/schema");
          const { getQueryLocationsByCampaignId } = await import("./dbCampaigns");
          const { count: countTQ } = await import("drizzle-orm");
          const existing = await db.select({ n: countTQ() }).from(tqTable).where(eq(tqTable.campaignId, campaignId));
          const alreadySeeded = Number(existing[0]?.n ?? 0) > 0;
          if (!alreadySeeded) {
            const queryLocations = await getQueryLocationsByCampaignId(campaignId);
            const uniqueQueries = Array.from(new Set(queryLocations.map((q: any) => q.searchQuery).filter(Boolean))) as string[];
            for (let i = 0; i < uniqueQueries.length; i++) {
              await db.insert(tqTable).values({
                campaignId,
                businessId: campaign.businessId,
                phraseText: uniqueQueries[i],
                phraseVariations: [uniqueQueries[i]],
                sortOrder: i + 1,
                isActive: true,
                lockedAt: new Date(),
              });
            }
            console.log(`[Pipeline] Seeded ${uniqueQueries.length} trainingQueries for campaign ${campaignId} (was missing — bypassed query_review)`);
          }
        } catch (seedErr: any) {
          console.error(`[Pipeline] trainingQueries seeding failed (non-fatal): ${seedErr.message}`);
        }

        // ── V3: Create 4-day sprint schedule ──────────────────────────────────────
        // checkV3SprintRuns fires Day 1 on its next 30-min tick.
        const { createSprintSchedule } = await import("./trainingWorkerV3");

        // Idempotency: only create the sprint schedule if no day runs exist yet
        const { trainingDayRuns: tdrCheck } = await import("../drizzle/schema");
        const existingRuns = await db.select({ id: tdrCheck.id })
          .from(tdrCheck)
          .where(eq(tdrCheck.campaignId, campaignId))
          .limit(1);

        let trainingMessage: string;
        if (existingRuns.length === 0) {
          await createSprintSchedule(campaignId);
          trainingMessage = `V3 sprint schedule created (4 training days). Day 1 will fire on the next scheduler tick (within 30 minutes).`;
        } else {
          trainingMessage = `Sprint schedule already exists for campaign ${campaignId} — training continuing.`;
        }
        
        // Update campaign status
        await db.update(campaigns).set({
          status: "training",
          trainingStartedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(campaigns.id, campaignId));
        
        result = {
          step,
          success: true,
          message: trainingMessage,
        };
        break;
      }
      
      default:
        throw new Error(`Unknown pipeline step: ${step}`);
    }
    
    result.duration = Date.now() - startTime;
    // Clear any stale error from previous failed attempts on this step
    await db.update(campaigns).set({
      lastError: null,
      errorCount: 0,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));
    console.log(`[Pipeline] ✓ Step "${step}" completed in ${result.duration}ms: ${result.message}`);
    return result;
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    // Update campaign with error
    await db.update(campaigns).set({
      status: "error",
      lastError: `Step "${step}" failed: ${error.message}`,
      errorCount: (campaign.errorCount || 0) + 1,
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));
    
    console.error(`[Pipeline] ✗ Step "${step}" failed after ${duration}ms: ${error.message}`);
    
    return {
      step,
      success: false,
      message: error.message,
      duration,
    };
  }
}

/**
 * Run the full pipeline for a campaign from the current step forward
 * 
 * This is the main "auto-pilot" function. It determines where the campaign
 * is in the pipeline and runs each remaining step sequentially.
 * 
 * Stops on:
 * - Any step failure
 * - Indexing verification (needs 3-4 day wait)
 * - Training step (needs separate configuration)
 */
export async function runFullPipeline(
  campaignId: number,
  userId: number,
  options?: {
    stopAfterStep?: PipelineStep;  // Stop after this step
    skipSteps?: PipelineStep[];     // Skip these steps
  }
): Promise<{
  stepsRun: PipelineStepResult[];
  stoppedAt: PipelineStep;
  reason: "completed" | "failed" | "waiting" | "stopped" | "manual_stop";
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const campaignResults = await db.select().from(campaigns)
    .where(eq(campaigns.id, campaignId)).limit(1);
  const campaign = campaignResults[0];
  if (!campaign) throw new Error("Campaign not found");
  
  const nextStep = determineNextStep(campaign);
  const stepIndex = PIPELINE_STEPS.indexOf(nextStep);
  const remainingSteps = PIPELINE_STEPS.slice(stepIndex);
  
  const stepsRun: PipelineStepResult[] = [];
  
  for (const step of remainingSteps) {
    // Check if we should skip this step
    if (options?.skipSteps?.includes(step)) {
      console.log(`[Pipeline] Skipping step "${step}" (configured to skip)`);
      continue;
    }
    
    // Run the step
    const result = await runPipelineStep(campaignId, step, userId);
    stepsRun.push(result);
    
    // Stop on failure
    if (!result.success) {
      return { stepsRun, stoppedAt: step, reason: "failed" };
    }
    
    // Stop after keyword_research for query review
    if (step === "keyword_research") {
      return { stepsRun, stoppedAt: step, reason: "stopped" };
    }

    // Stop after publishing if URLs are still missing — pipeline resumes automatically
    // when setContentPageUrl enters the last URL.
    if (step === "publishing" && result.data?.waitingForUrls) {
      return { stepsRun, stoppedAt: step, reason: "waiting" };
    }

    // Stop after indexing submission — training kickoff is handled by the scheduler
    // (checkPendingTrainingKickoffs) once indexingSubmittedAt is set.
    if (step === "indexing") {
      return { stepsRun, stoppedAt: step, reason: "waiting" };
    }
    
    // Stop if user requested stop after this step
    if (options?.stopAfterStep === step) {
      return { stepsRun, stoppedAt: step, reason: "manual_stop" };
    }
    
    // Stop at training (needs separate configuration)
    if (step === "training") {
      return { stepsRun, stoppedAt: step, reason: "completed" };
    }
  }
  
  return { stepsRun, stoppedAt: remainingSteps[remainingSteps.length - 1] || "training", reason: "completed" };
}

/**
 * Get the full pipeline status for a campaign
 */
export async function getPipelineStatus(campaignId: number): Promise<PipelineStatus | null> {
  const db = await getDb();
  if (!db) return null;
  
  const campaignResults = await db.select().from(campaigns)
    .where(eq(campaigns.id, campaignId)).limit(1);
  const campaign = campaignResults[0];
  if (!campaign) return null;
  
  const { getBusinessById } = await import("./db");
  const business = await getBusinessById(campaign.businessId);
  
  const completedSteps = getCompletedSteps(campaign);
  const nextStep = determineNextStep(campaign);
  const nextStepIndex = PIPELINE_STEPS.indexOf(nextStep);
  const pendingSteps = PIPELINE_STEPS.slice(nextStepIndex);
  
  return {
    campaignId,
    businessName: business?.name || "Unknown",
    currentStep: nextStep,
    completedSteps,
    pendingSteps,
    lastError: campaign.lastError || undefined,
    startedAt: campaign.createdAt?.toISOString(),
    lastActivityAt: campaign.updatedAt?.toISOString(),
  };
}

/**
 * Export pipeline steps for UI display
 */
export function getPipelineStepLabels(): Array<{ step: PipelineStep; label: string; description: string }> {
  return [
    { step: "keyword_research", label: "Keyword Research", description: "Discover AI search queries and volumes using DataForSEO" },
    { step: "baseline_check", label: "Baseline Visibility Report", description: "Measure clean-slate AI visibility before any content is added" },
    { step: "credibility_research", label: "Credibility Research", description: "Research business credentials, awards, and trust signals" },
    { step: "content_generation", label: "Content Generation", description: "Generate optimized content pages for AI citation" },
    { step: "publishing", label: "Content Publishing", description: "Copy generated content pages to client website and enter live URLs" },
    { step: "indexing", label: "Indexing Submission", description: "Submit URLs to Monkey Indexer for fast Google indexing" },
    { step: "training", label: "AI Training", description: "Train AI models to cite the business" },
  ];
}
