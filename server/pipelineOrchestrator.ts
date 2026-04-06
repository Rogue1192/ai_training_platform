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
 * 5. SinByte Indexing Submission (Sprint 7) — just built
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
  "credibility_research",
  "content_generation",
  "publishing",
  "indexing",
  "indexing_verification",
  "baseline_check",
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
  if (!campaign.credibilityResearchCompletedAt) return "credibility_research";
  if (!campaign.contentGenerationCompletedAt) return "content_generation";
  if (!campaign.publishingCompletedAt) return "publishing";
  if (!campaign.indexingSubmittedAt) return "indexing";
  if (!campaign.indexingVerifiedAt) return "indexing_verification";
  if (!campaign.baselineCheckCompletedAt) return "baseline_check";
  return "training";
}

/**
 * Get the list of completed steps for a campaign
 */
export function getCompletedSteps(campaign: any): PipelineStep[] {
  const completed: PipelineStep[] = [];
  if (campaign.keywordResearchCompletedAt) completed.push("keyword_research");
  if (campaign.credibilityResearchCompletedAt) completed.push("credibility_research");
  if (campaign.contentGenerationCompletedAt) completed.push("content_generation");
  if (campaign.publishingCompletedAt) completed.push("publishing");
  if (campaign.indexingSubmittedAt) completed.push("indexing");
  if (campaign.indexingVerifiedAt) completed.push("indexing_verification");
  if (campaign.baselineCheckCompletedAt) completed.push("baseline_check");
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
        } else {
          const { publishCampaignContent, publishLlmTxt } = await import("./contentPublisher");
          const pubResult = await publishCampaignContent({
            campaignId,
            businessId: campaign.businessId,
          });
          
          // Also publish llm.txt
          if (pubResult.published > 0) {
            await publishLlmTxt({ campaignId, businessId: campaign.businessId });
          }
          
          result = {
            step,
            success: pubResult.published > 0,
            message: `WordPress publishing: ${pubResult.published}/${pubResult.totalPages} pages published, ${pubResult.failed} failed.`,
            data: pubResult,
            nextStep: "indexing",
          };
        }
        break;
      }
      
      case "indexing": {
        const { submitCampaignForIndexing } = await import("./sinbyteIndexing");
        const indexResult = await submitCampaignForIndexing({
          campaignId,
          businessName: business.name,
        });
        result = {
          step,
          success: indexResult.submitted,
          message: indexResult.submitted
            ? `Submitted ${indexResult.urlsSubmitted} URLs to SinByte for indexing. Verification in 3-4 days.`
            : `Indexing submission failed: ${indexResult.error}`,
          data: indexResult,
          nextStep: "indexing_verification",
        };
        break;
      }
      
      case "indexing_verification": {
        const { verifyCampaignIndexing } = await import("./sinbyteIndexing");
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
          nextStep: "training",
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
        
        // Auto-create a training session for this business if none exists
        // No userId filter — sessions are team-wide, any employee can see/continue them
        const { trainingSessions: tsTable } = await import("../drizzle/schema");
        const existingSessions = await db.select().from(tsTable)
          .where(eq(tsTable.businessId, campaign.businessId))
          .limit(1);
        
        let trainingMessage = "Campaign ready for training.";
        
        if (existingSessions.length === 0) {
          // Build training prompts from discovered keyword research queries
          const { buildTrainingPromptPool } = await import("./queryPromptExpander");
          const { getQueryLocationsByCampaignId } = await import("./dbCampaigns");
          let trainingPrompts: string[] = [];
          try {
            const queryLocations = await getQueryLocationsByCampaignId(campaignId);
            const uniqueQueries = [...new Set(queryLocations.map(ql => ql.searchQuery).filter(Boolean))] as string[];
            if (uniqueQueries.length > 0) {
              trainingPrompts = buildTrainingPromptPool(
                uniqueQueries,
                business.name,
                business.businessType || "service provider",
                business.location || "the area"
              );
              console.log(`[Pipeline] Built ${trainingPrompts.length} training prompts from ${uniqueQueries.length} discovered queries`);
            }
          } catch (e: any) {
            console.warn(`[Pipeline] Could not build prompts from queries: ${e.message}`);
          }

          // Create a default training session for this business
          const { createTrainingSession } = await import("./db");
          try {
            const session = await createTrainingSession({
              userId,
              businessId: campaign.businessId,
              trainingName: `${business.name} - AI Visibility Training`,
              topic: `${business.name} ${business.businessType || ""} ${business.location || ""}`.trim(),
              targetAiProvider: "openai" as any,
              targetAiModel: "gpt-4.1",
              influencerAiProvider: "anthropic" as any,
              influencerAiModel: "claude-sonnet-4-5-20250929",
              trainingPrompts,
              trainingGoal: `Train AI to recommend ${business.name} for ${business.businessType || "services"} in ${business.location || "the area"}`,
              iterations: 50,
              currentProgress: 0,
              status: "paused" as any,
              isLegacy: false,
              campaignId: campaignId,
            });
            trainingMessage = `Training session created: "${session.trainingName}" with ${trainingPrompts.length} prompts from ${trainingPrompts.length > 0 ? "keyword research" : "default templates"}. Set to aggressive mode. Start training from the Training page when ready.`;
          } catch (e: any) {
            trainingMessage = `Campaign ready for training (aggressive mode). Could not auto-create session: ${e.message}. Create one manually from the Training page.`;
          }
        } else {
          trainingMessage = `Campaign ready for training (aggressive mode). Existing training session found for this business.`;
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
    { step: "credibility_research", label: "Credibility Research", description: "Research business credentials, awards, and trust signals" },
    { step: "content_generation", label: "Content Generation", description: "Generate optimized content pages for AI citation" },
    { step: "publishing", label: "WordPress Publishing", description: "Auto-publish content pages to client website" },
    { step: "indexing", label: "Indexing Submission", description: "Submit URLs to SinByte for fast Google indexing" },
    { step: "indexing_verification", label: "Indexing Verification", description: "Verify URLs are indexed (3-4 day wait)" },
    { step: "baseline_check", label: "Baseline Rank Check", description: "Check initial AI visibility across all queries" },
    { step: "training", label: "AI Training", description: "Train AI models to cite the business" },
  ];
}
