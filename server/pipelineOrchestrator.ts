/**
 * Pipeline Orchestrator
 * 
 * Connects all AI Answer Forge sprint services into a single automated pipeline.
 * When a GHL webhook creates a campaign, the orchestrator can run the full flow:
 * 
 * 1. Keyword Research (Sprint 3) — already built
 * 2. Credibility Research (Sprint 4) — already built
 * 3. Content Generation (Sprint 5) — already built
 * 4. WordPress Publishing (Sprint 6) — just built
 * 5. Monkey Indexer Indexing Submission — replaces SinByte
 * 6. Wait 3-4 days for indexing
 * 7. Baseline Rank Check (Sprint 3) — already built
 * 8. Training kickoff (Sprint 11 — future)
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
  | "credibility_research"
  | "content_generation"
  | "publishing"
  | "indexing"
  | "indexing_verification"
  | "baseline_check"
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
  "credibility_research",
  "content_generation",
  "publishing",
  "indexing",
  "indexing_verification",
  "training",
];

/**
 * Map campaign status to pipeline step
 */
function statusToStep(status: string): PipelineStep {
  const mapping: Record<string, PipelineStep> = {
    pending: "keyword_research",
    keyword_research: "keyword_research",
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
  if (!campaign.credibilityResearchCompletedAt) return "credibility_research";
  if (!campaign.contentGenerationCompletedAt) return "content_generation";
  if (!campaign.publishingCompletedAt) return "publishing";
  if (!campaign.indexingSubmittedAt) return "indexing";
  if (!campaign.indexingVerifiedAt) return "indexing_verification";
  return "training";
}

/**
 * Get the list of completed steps for a campaign
 */
export function getCompletedSteps(campaign: any): PipelineStep[] {
  const completed: PipelineStep[] = [];
  if (campaign.keywordResearchCompletedAt) completed.push("keyword_research");
  if (campaign.baselineCheckCompletedAt) completed.push("baseline_check");
  if (campaign.credibilityResearchCompletedAt) completed.push("credibility_research");
  if (campaign.contentGenerationCompletedAt) completed.push("content_generation");
  if (campaign.publishingCompletedAt) completed.push("publishing");
  if (campaign.indexingSubmittedAt) completed.push("indexing");
  if (campaign.indexingVerifiedAt) completed.push("indexing_verification");
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
        result = {
          step,
          success: true,
          message: `Keyword research complete. Found ${kwResult.queryLocationsCreated || 0} query-location combinations.`,
          data: kwResult,
          nextStep: "credibility_research",
        };
        break;
      }
      
      case "credibility_research": {
        const { runCredibilityResearch } = await import("./credibilityResearchEngine");
        const credResult = await runCredibilityResearch({
          userId,
          businessId: campaign.businessId,
          campaignId,
          businessName: business.name,
          websiteUrl: business.website || "",
          industry: business.businessType || "",
          location: business.location || "",
        });
        result = {
          step,
          success: true,
          message: `Credibility research complete. Score: ${credResult.overallScore}/100, ${credResult.facts.length} facts found, ${credResult.suggestedPages.length} pages suggested.`,
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
        const contentResult = await generateAllContentPages({
          userId,
          businessId: campaign.businessId,
          campaignId,
          businessName: business.name,
          websiteUrl: business.website || "",
          industry: business.businessType || "",
          location: business.location || "",
          credibilityResult: credData.researchResults as any,
        });
        // Fire outbound webhook to companion platform — ONLY for clients where we are building
        // their website (useWebhookForContent = true). For clients with their own existing site,
        // Playwright handles publishing in the next step.
        if (business.useWebhookForContent) {
          try {
            const { sendCredibilityWebhook } = await import("./credibilityWebhook");
            const webhookResult = await sendCredibilityWebhook({
              campaignId,
              businessId: campaign.businessId,
            });
            if (webhookResult.sent) {
              console.log(`[Pipeline] Credibility webhook sent successfully.`);
            } else {
              console.log(`[Pipeline] Credibility webhook skipped: ${webhookResult.error}`);
            }
          } catch (webhookErr: any) {
            console.warn(`[Pipeline] Credibility webhook error (non-fatal): ${webhookErr.message}`);
          }
        }

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
        // Check client type — only publish to WP for ai_only and ai_plus_seo
        if (campaign.clientType === "ai_plus_seo_plus_build") {
          // For new builds, skip WP publishing — content will be used in SiteForge Ultra
          await db.update(campaigns).set({
            status: "indexing",
            publishingCompletedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(campaigns.id, campaignId));
          
          result = {
            step,
            success: true,
            message: "Skipped WordPress publishing — client is Scenario C (new SiteForge Ultra build). Content stored for handoff.",
            nextStep: "indexing",
          };
        } else if (business.useWebhookForContent) {
          // Content was already delivered via outbound webhook in the content_generation step.
          // Skip Playwright entirely and move straight to indexing.
          await db.update(campaigns).set({
            status: "indexing",
            publishingCompletedAt: new Date(),
            updatedAt: new Date(),
          }).where(eq(campaigns.id, campaignId));

          result = {
            step,
            success: true,
            message: "Skipped Playwright publishing — content delivered via outbound webhook to website builder platform.",
            nextStep: "indexing",
          };
        } else {
          // Manual-copy workflow: content is already generated and stored in the DB.
          // Notify the team that pages are ready to be copied into the client's site.
          const { contentPages: cpTable } = await import("../drizzle/schema");
          const { eq: eqOp } = await import("drizzle-orm");
          const pages = await db.select().from(cpTable).where(eqOp(cpTable.campaignId, campaignId));
          const pageCount = pages.filter(p => p.pageType !== "llm_txt").length;
          const adminUrl = `${process.env.APP_BASE_URL ?? ""}/campaigns/${campaignId}`;
          try {
            const { notifyOwner } = await import("./_core/notification");
            await notifyOwner({
              title: `Content Ready for Manual Publishing: ${business.name}`,
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
          // Mark publishing complete — the pipeline continues; URL entry happens async via the UI.
          await db.update(campaigns).set({
            status: "publishing",
            updatedAt: new Date(),
          }).where(eq(campaigns.id, campaignId));
          result = {
            step,
            success: true,
            message: `Content ready for manual publishing. ${pageCount} page(s) generated — team notified. Enter live URLs in the Content tab to trigger indexing.`,
            data: { pageCount },
            // nextStep intentionally omitted — pipeline pauses here until admin enters URLs
          };
        }
        break;
      }
      
      case "indexing": {
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
          nextStep: "indexing_verification",
        };
        break;
      }
      
      case "indexing_verification": {
        const { verifyCampaignIndexing } = await import("./monkeyIndexer");
        const verifyResult = await verifyCampaignIndexing(campaignId);
        result = {
          step,
          success: verifyResult.verified,
          message: verifyResult.verified
            ? `Indexing verified: ${verifyResult.accessibleUrls}/${verifyResult.totalUrls} URLs accessible.`
            : `Indexing not yet verified: ${verifyResult.accessibleUrls}/${verifyResult.totalUrls} URLs accessible. ${verifyResult.inaccessibleUrls.length} still pending.`,
          data: verifyResult,
          nextStep: verifyResult.verified ? "baseline_check" : "indexing_verification",
        };
        break;
      }
      
      case "baseline_check": {
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
        // Apply aggressive training mode via smart scheduler
        const { applyCampaignModeChange } = await import("./smartScheduler");
        try {
          await applyCampaignModeChange(campaignId, "aggressive", "Pipeline auto-start: beginning aggressive training");
        } catch (e: any) {
          console.log(`[Pipeline] Smart scheduler mode change skipped: ${e.message}`);
        }

        // ── Create one training session per keyword × location × AI model ──────────
        // Each session has exactly 8 prompt variations for that specific query+location.
        // This keeps context windows tight and token costs low vs. one giant pooled session.
        const { trainingSessions: tsTable, campaignQueryLocations: cqlTable } = await import("../drizzle/schema");
        const { expandQueryToPrompts } = await import("./queryPromptExpander");
        const { createTrainingSession } = await import("./db");

        // Fetch all query-location combos for this campaign
        const queryLocations = await db.select().from(cqlTable)
          .where(eq(cqlTable.campaignId, campaignId));

        // Check which ql+label combinations already have sessions.
        // This is TARGET-LEVEL idempotency: a combo that already has ChatGPT and
        // Gemini sessions will still get an AI Overview session created on re-runs,
        // and a new 4th target added in future can be backfilled the same way.
        // We key by qlId + trainingName suffix (last segment after " | ") so that
        // Gemini and AI Overview — which share the same model — are distinguished.
        const existingSessionKeys = new Set(
          (await db.select({
            qlId: tsTable.campaignQueryLocationId,
            name: tsTable.trainingName,
          }).from(tsTable)
            .where(eq(tsTable.campaignId, campaignId)))
            .filter(r => r.qlId != null && r.name != null)
            .map(r => {
              // Extract the label segment: last " | "-delimited part of the name
              const parts = (r.name as string).split(" | ");
              const label = parts[parts.length - 1] ?? "";
              return `${r.qlId}::${label}`;
            })
        );

        const sessionTargets = [
          { provider: "openai" as const, model: "gpt-4.1", label: "ChatGPT" },
          { provider: "google" as const, model: "gemini-2.5-flash", label: "Gemini" },
          // AI Overview uses the same Gemini model but with search-query-style prompt
          // framing so the model learns to surface the business in Google AI Overview.
          // Distinguished by the "AI Overview" label in trainingName.
          { provider: "google" as const, model: "gemini-2.5-flash", label: "AI Overview" },
        ];

        let sessionsCreated = 0;
        let sessionsSkipped = 0;

        for (const ql of queryLocations) {
          // (idempotency is now checked per-target below)

          // Build 8 prompt variations scoped to this specific query + location
          const expanded = expandQueryToPrompts({
            rawQuery: ql.searchQuery,
            businessName: business.name,
            businessType: business.businessType || "service provider",
            location: ql.location,
          });
          const prompts = expanded.all; // max 8 variations

          const trainingGoal = `Train AI to recommend ${business.name} for ${ql.searchQuery} in ${ql.location}`;
          const topic = `${business.name} — ${ql.searchQuery} — ${ql.location}`;

          for (const target of sessionTargets) {
            // Skip this specific ql+label combo if a session already exists
            const sessionKey = `${ql.id}::${target.label}`;
            if (existingSessionKeys.has(sessionKey)) {
              sessionsSkipped++;
              continue;
            }
            try {
              await createTrainingSession({
                userId,
                businessId: campaign.businessId,
                campaignId,
                campaignQueryLocationId: ql.id,
                trainingName: `${business.name} | ${ql.location} | ${ql.searchQuery} | ${target.label}`,
                topic,
                targetAiProvider: target.provider as any,
                targetAiModel: target.model,
                influencerAiProvider: "minimax" as any,
                influencerAiModel: "MiniMax-M2.7",
                trainingPrompts: prompts,
                trainingGoal,
                iterations: 50,
                currentProgress: 0,
                status: "paused" as any,
                isLegacy: false,
              });
              sessionsCreated++;
            } catch (e: any) {
              console.warn(`[Pipeline] Could not create ${target.label} session for ql#${ql.id}: ${e.message}`);
            }
          }

          // Mark this combo as ready for its first training run (only if at least
          // one session was created — avoids resetting status on fully-skipped combos)
          if (sessionsCreated > 0) {
            await db.update(cqlTable).set({
              trainingStatus: "training",
              updatedAt: new Date(),
            }).where(eq(cqlTable.id, ql.id));
          }
        }

        // ── Bootstrap the training cycle (fire Run 1) ─────────────────────────
        // Without this the sessions created above stay `paused` forever. The
        // hourly cycle-advancer (checkTrainingCycleAdvances → advanceCampaignCycle)
        // only picks up combos whose nextPollAt is in the past, but nextPollAt
        // starts NULL and is ONLY set inside the cycle itself. startInitialTrainingCycle
        // is the one place that fires Run 1 and seeds nextPollAt = now + 24h so the
        // scheduler can take over for runs 2–4. It was defined but never called.
        try {
          const { startInitialTrainingCycle } = await import("./trainingCycleOrchestrator");
          const kickoff = await startInitialTrainingCycle(campaignId, userId);
          console.log(`[Pipeline] Initial training cycle bootstrapped: ${kickoff.combosStarted} combo(s) started Run 1`);
          if (kickoff.errors.length) {
            console.warn(`[Pipeline] Initial cycle kickoff errors:`, kickoff.errors);
          }
        } catch (e: any) {
          console.warn(`[Pipeline] Failed to bootstrap initial training cycle: ${e.message}`);
        }

        const totalCombos = queryLocations.length;
        let trainingMessage: string;
        if (sessionsCreated > 0) {
          trainingMessage = `Created ${sessionsCreated} training sessions across ${totalCombos} keyword×location combos (3 targets each: ChatGPT, Gemini, AI Overview). ${sessionsSkipped > 0 ? `${sessionsSkipped} target sessions already existed and were skipped.` : ""} Training cycle will start automatically — Run 1 fires immediately, then 24h LLM polls between runs 2–4.`;
        } else if (sessionsSkipped === totalCombos * 3) {
          trainingMessage = `All ${totalCombos} keyword×location combos already have training sessions (ChatGPT, Gemini, AI Overview). Training cycle continuing.`;
        } else {
          trainingMessage = `Campaign ready for training (aggressive mode). Could not auto-create sessions — create them manually from the Training page.`;
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
    
    // Stop after indexing submission (need to wait 3-4 days)
    if (step === "indexing") {
      return { stepsRun, stoppedAt: step, reason: "waiting" };
    }
    
    // Stop after indexing verification if not yet verified
    if (step === "indexing_verification" && result.nextStep === "indexing_verification") {
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
    { step: "publishing", label: "WordPress Publishing", description: "Auto-publish content pages to client website" },
    { step: "indexing", label: "Indexing Submission", description: "Submit URLs to Monkey Indexer for fast Google indexing" },
    { step: "indexing_verification", label: "Indexing Verification", description: "Verify published URLs are accessible (auto-advances within minutes)" },
    { step: "training", label: "AI Training", description: "Train AI models to cite the business" },
  ];
}
