/**
 * Training Cycle Orchestrator
 *
 * Drives the full lifecycle for each keyword × location combo:
 *
 * INITIAL PHASE (runs 1–4):
 *   Run N fires → sessions for non-won providers start → sessions complete →
 *   nextPollAt = now + 24h → scheduler picks it up → LLM poll runs →
 *   wins extracted per provider (win emails sent, after video captured) →
 *   if ChatGPT won but Gemini/AI Overview didn't → next run fires remaining sessions only →
 *   if all three won → combo enters monitoring immediately →
 *   if runCount = 4 and still not fully won → enter monitoring
 *
 * MONITORING PHASE (weekly, indefinite):
 *   Every 7 days: LLM poll runs against ALL combos (won + non-won).
 *   - Won combo dropped out → single recovery run for dropped provider only →
 *     24h → poll → if back, return to monitoring
 *   - Non-won combo now appearing → win email, mark achieved for that provider
 *   - Non-won combo still not appearing → leave in monitoring
 */

import { getDb } from "./db";
import {
  campaignQueryLocations,
  trainingSessions,
  campaigns,
  businesses,
} from "../drizzle/schema";
import { eq, and, isNull, lte, or, inArray } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_INITIAL_RUNS = 4;
const POLL_DELAY_MS = 24 * 60 * 60 * 1000;        // 24 hours
const MONITORING_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CycleAdvanceResult {
  campaignId: number;
  combosPolled: number;
  newWins: number;
  runsStarted: number;
  combosEnteredMonitoring: number;
  recoveryRunsStarted: number;
  errors: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fire training sessions for a given combo, skipping providers that are already won.
 * wonProviders: set of providers to skip (already achieved).
 */
async function fireSessionsForCombo(
  qlId: number,
  campaignId: number,
  systemUserId: number,
  // wonProviders is keyed by targetAiProvider ("openai" | "google").
  // Note: both Gemini and AI Overview share provider "google", so we use
  // a separate wonSessionLabels set to skip AI Overview sessions independently.
  wonProviders: Set<"openai" | "google"> = new Set(),
  wonSessionLabels: Set<string> = new Set(),
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const { startTrainingSessionV2 } = await import("./trainingQueueV2");

  // Find all sessions for this combo (both ChatGPT and Gemini)
  const sessions = await db
    .select()
    .from(trainingSessions)
    .where(
      and(
        eq(trainingSessions.campaignQueryLocationId, qlId),
        eq(trainingSessions.campaignId, campaignId),
      ),
    );

  let started = 0;
  for (const session of sessions) {
    // Skip sessions for already-won providers
    const provider = session.targetAiProvider as "openai" | "google";
    // Determine the label from the trainingName (last " | "-delimited segment)
    const nameParts = (session.trainingName || "").split(" | ");
    const sessionLabel = nameParts[nameParts.length - 1] ?? "";
    const isAiOverview = sessionLabel === "AI Overview";

    // For AI Overview sessions, check wonSessionLabels; for others, check wonProviders
    if (isAiOverview && wonSessionLabels.has("AI Overview")) {
      console.log(`[CycleOrchestrator] Skipping session ${session.id} — AI Overview already won for ql#${qlId}`);
      continue;
    }
    if (!isAiOverview && wonProviders.has(provider)) {
      console.log(`[CycleOrchestrator] Skipping session ${session.id} — provider ${provider} already won for ql#${qlId}`);
      continue;
    }

    try {
      // Reset session for a fresh run
      const { updateTrainingSession } = await import("./db");
      await updateTrainingSession(session.id, {
        status: "paused",
        trainingPhase: "pending",
        currentProgress: 0,
        errorMessage: null,
        completedAt: null,
        updatedAt: new Date(),
      });
      await startTrainingSessionV2(session.id, systemUserId);
      started++;
    } catch (e: any) {
      console.warn(`[CycleOrchestrator] Could not start session ${session.id}: ${e.message}`);
    }
  }
  return started;
}

/**
 * Fire a recovery run for a combo that dropped out of results.
 * Only fires sessions for the providers that actually dropped (droppedProviders).
 */
async function fireRecoveryRunForCombo(
  ql: typeof campaignQueryLocations.$inferSelect,
  business: { id: number; name: string; businessType: string | null; location: string | null },
  systemUserId: number,
  droppedProviders: Set<"chatgpt" | "gemini" | "ai_overview">,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const { expandQueryToPrompts } = await import("./queryPromptExpander");
  const { createTrainingSession } = await import("./db");
  const { startTrainingSessionV2 } = await import("./trainingQueueV2");

  const expanded = expandQueryToPrompts({
    rawQuery: ql.searchQuery,
    businessName: business.name,
    businessType: business.businessType || "service provider",
    location: ql.location,
  });

  // Only fire sessions for providers that actually dropped
  const allTargets = [
    { provider: "openai" as const, model: "gpt-4.1", label: "ChatGPT", key: "chatgpt" as const },
    { provider: "google" as const, model: "gemini-2.5-flash", label: "Gemini", key: "gemini" as const },
    // AI Overview uses the same Gemini model but with search-query-style prompt framing
    { provider: "google" as const, model: "gemini-2.5-flash", label: "AI Overview", key: "ai_overview" as const },
  ];

  const targets = allTargets.filter((t) => droppedProviders.has(t.key));

  for (const target of targets) {
    try {
      const session = await createTrainingSession({
        userId: systemUserId,
        businessId: business.id,
        campaignId: ql.campaignId,
        campaignQueryLocationId: ql.id,
        trainingName: `[Recovery] ${business.name} | ${ql.location} | ${ql.searchQuery} | ${target.label}`,
        topic: `${business.name} — ${ql.searchQuery} — ${ql.location}`,
        targetAiProvider: target.provider as any,
        targetAiModel: target.model,
        influencerAiProvider: "minimax" as any,
        influencerAiModel: "MiniMax-M2.7",
        trainingPrompts: expanded.all,
        trainingGoal: `Recovery: re-establish ${business.name} for ${ql.searchQuery} in ${ql.location}`,
        iterations: 1, // Single recovery iteration
        currentProgress: 0,
        status: "paused" as any,
        isLegacy: false,
      });
      await startTrainingSessionV2(session.id, systemUserId);
    } catch (e: any) {
      console.warn(`[CycleOrchestrator] Recovery session error for ql#${ql.id}: ${e.message}`);
    }
  }
}

// ─── LLM Poll for a single combo ─────────────────────────────────────────────

interface PollResult {
  chatgptMentioned: boolean;
  geminiMentioned: boolean;
  aiOverviewMentioned: boolean;
}

async function pollCombo(
  ql: typeof campaignQueryLocations.$inferSelect,
  business: { name: string; website?: string | null; phone?: string | null; agencyId?: number | null },
  campaignId: number,
  businessId: number,
  campaignCreatedAt: Date,
): Promise<PollResult> {
  try {
    const { checkLLMVisibilityDirect } = await import("./dataforseoService");
    const { logDFSCost, DFS_COSTS } = await import("./costLogger");

    // Use the same direct LLM check method as the rank tracking engine and
    // baseline check — consistent measurement across the entire platform.
    const queryWithLocation = ql.location
      ? `${ql.searchQuery} in ${ql.location}`
      : ql.searchQuery;

    const mention = await checkLLMVisibilityDirect(
      queryWithLocation,
      business.name,
      business.agencyId ?? null,
      business.website ?? null,
      business.phone ?? null,
      {
        campaignId,
        businessId,
        campaignCreatedAt,
        operationType: 'training_poll',
      },
      business.location ?? null
    );
    // Cost logging is now handled inside checkLLMVisibilityDirect via costContext (real per-provider token costs)

    const chatgptMentioned = mention.llmResponses.chatgpt?.mentioned ?? false;
    const geminiMentioned = mention.llmResponses.gemini?.mentioned ?? false;
    const aiOverviewMentioned = mention.llmResponses.aiOverview?.mentioned ?? false;

    return {
      chatgptMentioned,
      // A Gemini "win" counts either Gemini-proper OR AI Overview — matching
      // how rankTrackingEngine and keywordResearchPipeline define a win.
      geminiMentioned: geminiMentioned || aiOverviewMentioned,
      aiOverviewMentioned,
    };
  } catch (e: any) {
    console.warn(`[CycleOrchestrator] Poll failed for ql#${ql.id}: ${e.message}`);
    return { chatgptMentioned: false, geminiMentioned: false, aiOverviewMentioned: false };
  }
}


// ─── Win processing ───────────────────────────────────────────────────────────

/**
 * Mark a single provider win for a combo.
 * Does NOT change trainingStatus — that is handled by the caller after checking
 * whether all providers are now won.
 */
async function processWin(
  ql: typeof campaignQueryLocations.$inferSelect,
  platform: "chatgpt" | "gemini" | "ai_overview",
  campaignId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();

  // Determine which rank column to update
  const rankColumn =
    platform === "chatgpt" ? "currentRankChatGPT" :
    platform === "gemini" ? "currentRankGemini" :
    "currentRankAIOverview"; // ai_overview

  // Update the per-provider rank — do NOT change trainingStatus here
  await db
    .update(campaignQueryLocations)
    .set({
      firstMentionedAt: ql.firstMentionedAt ?? now,
      [rankColumn]: "mentioned",
      lastRankCheckAt: now,
      updatedAt: now,
    })
    .where(eq(campaignQueryLocations.id, ql.id));

  // Win detected — logged internally. No per-query email is sent during training.
  // The consolidated visibility report email fires at the end of the 4-day sprint
  // (Day 4 rank check) and then weekly thereafter.
  console.log(`[CycleOrchestrator] Win recorded for ql#${ql.id} on ${platform} (no email — report fires at sprint end).`);
}

// ─── Main: advance all due polls for a campaign ───────────────────────────────

/**
 * Called by the scheduler every hour.
 * Processes all combos whose nextPollAt is in the past.
 */
export async function advanceCampaignCycle(
  campaignId: number,
  systemUserId: number,
): Promise<CycleAdvanceResult> {
  const db = await getDb();
  const result: CycleAdvanceResult = {
    campaignId,
    combosPolled: 0,
    newWins: 0,
    runsStarted: 0,
    combosEnteredMonitoring: 0,
    recoveryRunsStarted: 0,
    errors: [],
  };

  if (!db) {
    result.errors.push("Database not available");
    return result;
  }

  // Get campaign + business
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) { result.errors.push("Campaign not found"); return result; }

  // Defense-in-depth: skip archived or paused campaigns even if the scheduler
  // somehow selected them (e.g., race condition between archive and next tick).
  if (campaign.status === 'paused') {
    console.log(`[CycleOrchestrator] Campaign ${campaignId} is paused — skipping cycle advance`);
    return result;
  }

  const [business] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
  if (!business?.website) { result.errors.push("Business has no website"); return result; }

  if (business.isArchived) {
    console.log(`[CycleOrchestrator] Business ${business.id} ("${business.name}") is archived — skipping cycle advance for campaign ${campaignId}`);
    return result;
  }

  const now = new Date();

  // ── 1. Find combos with a due poll (initial training phase) ─────────────────
  const duePollCombos = await db
    .select()
    .from(campaignQueryLocations)
    .where(
      and(
        eq(campaignQueryLocations.campaignId, campaignId),
        lte(campaignQueryLocations.nextPollAt, now),
        or(
          eq(campaignQueryLocations.trainingStatus, "training"),
          eq(campaignQueryLocations.trainingStatus, "recovering"),
        ),
      ),
    );

  for (const ql of duePollCombos) {
    try {
      result.combosPolled++;
      const poll = await pollCombo(ql, business, campaignId, campaign.businessId, campaign.createdAt);

      // Determine new wins per provider
      const chatgptWon = poll.chatgptMentioned && ql.currentRankChatGPT !== "mentioned";
      const geminiWon = poll.geminiMentioned && ql.currentRankGemini !== "mentioned";
      const aiOverviewWon = poll.aiOverviewMentioned && (ql as any).currentRankAIOverview !== "mentioned";

      if (chatgptWon) {
        await processWin(ql, "chatgpt", campaignId);
        result.newWins++;
      }
      if (geminiWon) {
        await processWin(ql, "gemini", campaignId);
        result.newWins++;
      }
      if (aiOverviewWon) {
        await processWin(ql, "ai_overview", campaignId);
        result.newWins++;
      }

      // Determine the updated win state (accounting for wins just processed)
      const chatgptNowWon = poll.chatgptMentioned || ql.currentRankChatGPT === "mentioned";
      const geminiNowWon = poll.geminiMentioned || ql.currentRankGemini === "mentioned";
      const aiOverviewNowWon = poll.aiOverviewMentioned || (ql as any).currentRankAIOverview === "mentioned";
      const allWon = chatgptNowWon && geminiNowWon && aiOverviewNowWon;

      if (allWon) {
        // All three targets achieved — move to monitoring, no more training needed
        await db.update(campaignQueryLocations).set({
          trainingStatus: "monitoring",
          monitoringStartedAt: now,
          nextPollAt: new Date(now.getTime() + MONITORING_INTERVAL_MS),
          updatedAt: now,
        }).where(eq(campaignQueryLocations.id, ql.id));
        result.combosEnteredMonitoring++;
      } else {
        // At least one target still not won — continue training if runs remain
        const runCount = (ql.trainingRunCount ?? 0);

        // Build the set of already-won providers to skip in the next run.
        // wonProviders skips by provider (openai/google); wonSessionLabels skips
        // AI Overview specifically (since it shares the google provider with Gemini).
        const wonProviders = new Set<"openai" | "google">();
        const wonSessionLabels = new Set<string>();
        if (chatgptNowWon) wonProviders.add("openai");
        // Only skip all google sessions if BOTH Gemini AND AI Overview are won
        if (geminiNowWon && aiOverviewNowWon) wonProviders.add("google");
        if (aiOverviewNowWon) wonSessionLabels.add("AI Overview");

        if (runCount < MAX_INITIAL_RUNS) {
          // Fire next run — only for targets that haven't won yet
          const started = await fireSessionsForCombo(ql.id, campaignId, systemUserId, wonProviders, wonSessionLabels);
          result.runsStarted += started;

          await db.update(campaignQueryLocations).set({
            trainingRunCount: runCount + 1,
            trainingSessions: (ql.trainingSessions ?? 0) + 1,
            lastRunCompletedAt: now,
            nextPollAt: new Date(now.getTime() + POLL_DELAY_MS),
            updatedAt: now,
          }).where(eq(campaignQueryLocations.id, ql.id));
        } else {
          // Exhausted 4 runs — enter monitoring regardless of win state
          await db.update(campaignQueryLocations).set({
            trainingStatus: "monitoring",
            monitoringStartedAt: now,
            nextPollAt: new Date(now.getTime() + MONITORING_INTERVAL_MS),
            updatedAt: now,
          }).where(eq(campaignQueryLocations.id, ql.id));
          result.combosEnteredMonitoring++;
        }
      }
    } catch (e: any) {
      result.errors.push(`ql#${ql.id}: ${e.message}`);
    }
  }

  // ── 2. Find monitoring combos with a due weekly poll ────────────────────────
  const dueMonitoringCombos = await db
    .select()
    .from(campaignQueryLocations)
    .where(
      and(
        eq(campaignQueryLocations.campaignId, campaignId),
        eq(campaignQueryLocations.trainingStatus, "monitoring"),
        lte(campaignQueryLocations.nextPollAt, now),
      ),
    );

  for (const ql of dueMonitoringCombos) {
    try {
      result.combosPolled++;
      const poll = await pollCombo(ql, business, campaignId, campaign.businessId, campaign.createdAt);

      // Check for new wins (non-won combos that now appear)
      const chatgptWon = poll.chatgptMentioned && ql.currentRankChatGPT !== "mentioned";
      const geminiWon = poll.geminiMentioned && ql.currentRankGemini !== "mentioned";
      const aiOverviewWon = poll.aiOverviewMentioned && (ql as any).currentRankAIOverview !== "mentioned";

      if (chatgptWon) {
        await processWin(ql, "chatgpt", campaignId);
        result.newWins++;
      }
      if (geminiWon) {
        await processWin(ql, "gemini", campaignId);
        result.newWins++;
      }
      if (aiOverviewWon) {
        await processWin(ql, "ai_overview", campaignId);
        result.newWins++;
      }

      // Check for drop-outs (previously won, now not appearing)
      const chatgptDropped = ql.currentRankChatGPT === "mentioned" && !poll.chatgptMentioned;
      const geminiDropped = ql.currentRankGemini === "mentioned" && !poll.geminiMentioned;
      const aiOverviewDropped = (ql as any).currentRankAIOverview === "mentioned" && !poll.aiOverviewMentioned;

      if (chatgptDropped || geminiDropped || aiOverviewDropped) {
        // Build the set of dropped providers — only fire recovery for those
        const droppedProviders = new Set<"chatgpt" | "gemini" | "ai_overview">();
        if (chatgptDropped) droppedProviders.add("chatgpt");
        if (geminiDropped) droppedProviders.add("gemini");
        if (aiOverviewDropped) droppedProviders.add("ai_overview");

        await fireRecoveryRunForCombo(ql, business, systemUserId, droppedProviders);
        result.recoveryRunsStarted++;

        // Update rank status for dropped providers only
        const dropUpdates: Record<string, any> = {
          trainingStatus: "recovering",
          nextPollAt: new Date(now.getTime() + POLL_DELAY_MS),
          lastMonitoringPollAt: now,
          updatedAt: now,
        };
        if (chatgptDropped) dropUpdates.currentRankChatGPT = "not_mentioned";
        if (geminiDropped) dropUpdates.currentRankGemini = "not_mentioned";
        if (aiOverviewDropped) dropUpdates.currentRankAIOverview = "not_mentioned";

        await db.update(campaignQueryLocations).set(dropUpdates)
          .where(eq(campaignQueryLocations.id, ql.id));
      } else {
        // No drop-outs — schedule next weekly check
        await db.update(campaignQueryLocations).set({
          lastMonitoringPollAt: now,
          nextPollAt: new Date(now.getTime() + MONITORING_INTERVAL_MS),
          updatedAt: now,
        }).where(eq(campaignQueryLocations.id, ql.id));
      }
    } catch (e: any) {
      result.errors.push(`monitoring ql#${ql.id}: ${e.message}`);
    }
  }

  return result;
}

/**
 * Kick off Run 1 for a campaign — called by the scheduler 2 days after indexing submission.
 * Sets nextPollAt = now + 24h for each combo so the poll fires the next day.
 */
export async function startInitialTrainingCycle(
  campaignId: number,
  systemUserId: number,
): Promise<{ combosStarted: number; errors: string[] }> {
  const db = await getDb();
  const errors: string[] = [];
  if (!db) return { combosStarted: 0, errors: ["Database not available"] };

  const queryLocations = await db
    .select()
    .from(campaignQueryLocations)
    .where(
      and(
        eq(campaignQueryLocations.campaignId, campaignId),
        eq(campaignQueryLocations.trainingStatus, "training"),
      ),
    );

  let combosStarted = 0;
  const now = new Date();

  for (const ql of queryLocations) {
    try {
      // Only start if this combo hasn't had a run yet
      if ((ql.trainingRunCount ?? 0) > 0) continue;

      // Fire all three targets on Run 1 (nothing is won yet): ChatGPT, Gemini, AI Overview
      const started = await fireSessionsForCombo(ql.id, campaignId, systemUserId, new Set(), new Set());
      if (started > 0) {
        await db.update(campaignQueryLocations).set({
          trainingRunCount: 1,
          trainingSessions: (ql.trainingSessions ?? 0) + 1,
          lastRunCompletedAt: now,
          nextPollAt: new Date(now.getTime() + POLL_DELAY_MS),
          updatedAt: now,
        }).where(eq(campaignQueryLocations.id, ql.id));
        combosStarted++;
      }
    } catch (e: any) {
      errors.push(`ql#${ql.id}: ${e.message}`);
    }
  }

  return { combosStarted, errors };
}
