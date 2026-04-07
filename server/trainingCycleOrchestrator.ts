/**
 * Training Cycle Orchestrator
 *
 * Drives the full lifecycle for each keyword × location combo:
 *
 * INITIAL PHASE (runs 1–4):
 *   Run N fires → sessions for non-won providers start → sessions complete →
 *   nextPollAt = now + 24h → scheduler picks it up → LLM poll runs →
 *   wins extracted per provider (win emails sent, after video captured) →
 *   if ChatGPT won but Gemini didn't → next run fires Gemini sessions only →
 *   if both won → combo enters monitoring immediately →
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
  wonProviders: Set<"openai" | "google"> = new Set(),
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
    if (wonProviders.has(provider)) {
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
  business: { name: string; businessType: string | null; location: string | null },
  systemUserId: number,
  droppedProviders: Set<"chatgpt" | "gemini">,
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
  ];

  const targets = allTargets.filter((t) => droppedProviders.has(t.key));

  for (const target of targets) {
    try {
      const session = await createTrainingSession({
        userId: systemUserId,
        businessId: ql.campaignId,
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
}

async function pollCombo(
  ql: typeof campaignQueryLocations.$inferSelect,
  websiteUrl: string,
): Promise<PollResult> {
  try {
    const { searchLLMMentions } = await import("./dataforseoService");
    const mentions = await searchLLMMentions(websiteUrl, {
      limit: 10,
      targetType: "domain",
    });
    const match = mentions.find(
      (m) => m.keyword.toLowerCase() === ql.searchQuery.toLowerCase(),
    );
    return {
      chatgptMentioned: match?.llmResponses?.chatgpt?.mentioned ?? false,
      geminiMentioned: match?.llmResponses?.gemini?.mentioned ?? false,
    };
  } catch (e: any) {
    console.warn(`[CycleOrchestrator] Poll failed for ql#${ql.id}: ${e.message}`);
    return { chatgptMentioned: false, geminiMentioned: false };
  }
}

// ─── After-video capture ──────────────────────────────────────────────────────

async function captureAfterVideo(
  ql: typeof campaignQueryLocations.$inferSelect,
  platform: "chatgpt" | "gemini",
): Promise<void> {
  // Only capture if not already captured
  const alreadyCaptured =
    platform === "chatgpt" ? ql.afterVideoChatgpt : ql.afterVideoGoogleAi;
  if (alreadyCaptured) return;

  try {
    const { recordWinVideo } = await import("./scanVideoRecorder");
    // scanVideoRecorder uses 'google_ai' for Gemini
    const scanPlatform = platform === "chatgpt" ? "chatgpt" : "google_ai";
    await recordWinVideo(ql.campaignId, ql.id, ql.searchQuery, ql.location, scanPlatform);
  } catch (e: any) {
    // Non-fatal — video capture failure should not block win processing
    console.warn(`[CycleOrchestrator] After-video capture failed for ql#${ql.id} on ${platform}: ${e.message}`);
  }
}

// ─── Win processing ───────────────────────────────────────────────────────────

/**
 * Mark a single provider win for a combo.
 * Does NOT change trainingStatus — that is handled by the caller after checking
 * whether both providers are now won.
 */
async function processWin(
  ql: typeof campaignQueryLocations.$inferSelect,
  platform: "chatgpt" | "gemini",
  campaignId: number,
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();

  // Capture after video (non-blocking)
  captureAfterVideo(ql, platform).catch(() => {});

  // Update the per-provider rank — do NOT change trainingStatus here
  await db
    .update(campaignQueryLocations)
    .set({
      firstMentionedAt: ql.firstMentionedAt ?? now,
      [platform === "chatgpt" ? "currentRankChatGPT" : "currentRankGemini"]: "mentioned",
      lastRankCheckAt: now,
      updatedAt: now,
    })
    .where(eq(campaignQueryLocations.id, ql.id));

  // Send win email
  try {
    const { sendCampaignWinEmails } = await import("./emailService");
    await sendCampaignWinEmails(
      campaignId,
      [
        {
          platform,
          query: ql.searchQuery,
          location: ql.location,
          message: `Now appearing in ${platform === "chatgpt" ? "ChatGPT" : "Gemini"} results for "${ql.searchQuery}" in ${ql.location}.`,
          significance: "breakthrough" as const,
          beforeVideoChatgpt: ql.beforeVideoChatgpt ?? undefined,
          beforeVideoGoogleAi: ql.beforeVideoGoogleAi ?? undefined,
          afterVideoChatgpt: platform === "chatgpt" ? (ql.afterVideoChatgpt ?? undefined) : undefined,
          afterVideoGoogleAi: platform === "gemini" ? (ql.afterVideoGoogleAi ?? undefined) : undefined,
        },
      ],
      100, // currentScore placeholder — will be recalculated by sendCampaignWinEmails
      null, // previousScore
    );
  } catch (e: any) {
    console.warn(`[CycleOrchestrator] Win email failed for ql#${ql.id}: ${e.message}`);
  }
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

  const [business] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
  if (!business?.website) { result.errors.push("Business has no website"); return result; }

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
      const poll = await pollCombo(ql, business.website);

      // Determine new wins per provider
      const chatgptWon = poll.chatgptMentioned && ql.currentRankChatGPT !== "mentioned";
      const geminiWon = poll.geminiMentioned && ql.currentRankGemini !== "mentioned";

      if (chatgptWon) {
        await processWin(ql, "chatgpt", campaignId);
        result.newWins++;
      }
      if (geminiWon) {
        await processWin(ql, "gemini", campaignId);
        result.newWins++;
      }

      // Determine the updated win state (accounting for wins just processed)
      const chatgptNowWon = poll.chatgptMentioned || ql.currentRankChatGPT === "mentioned";
      const geminiNowWon = poll.geminiMentioned || ql.currentRankGemini === "mentioned";
      const bothWon = chatgptNowWon && geminiNowWon;

      if (bothWon) {
        // Both providers achieved — move to monitoring, no more training needed
        await db.update(campaignQueryLocations).set({
          trainingStatus: "monitoring",
          monitoringStartedAt: now,
          nextPollAt: new Date(now.getTime() + MONITORING_INTERVAL_MS),
          updatedAt: now,
        }).where(eq(campaignQueryLocations.id, ql.id));
        result.combosEnteredMonitoring++;
      } else {
        // At least one provider still not won — continue training if runs remain
        const runCount = (ql.trainingRunCount ?? 0);

        // Build the set of already-won providers to skip in the next run
        const wonProviders = new Set<"openai" | "google">();
        if (chatgptNowWon) wonProviders.add("openai");
        if (geminiNowWon) wonProviders.add("google");

        if (runCount < MAX_INITIAL_RUNS) {
          // Fire next run — only for providers that haven't won yet
          const started = await fireSessionsForCombo(ql.id, campaignId, systemUserId, wonProviders);
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
      const poll = await pollCombo(ql, business.website);

      // Check for new wins (non-won combos that now appear)
      const chatgptWon = poll.chatgptMentioned && ql.currentRankChatGPT !== "mentioned";
      const geminiWon = poll.geminiMentioned && ql.currentRankGemini !== "mentioned";

      if (chatgptWon) {
        await processWin(ql, "chatgpt", campaignId);
        result.newWins++;
      }
      if (geminiWon) {
        await processWin(ql, "gemini", campaignId);
        result.newWins++;
      }

      // Check for drop-outs (previously won, now not appearing)
      const chatgptDropped = ql.currentRankChatGPT === "mentioned" && !poll.chatgptMentioned;
      const geminiDropped = ql.currentRankGemini === "mentioned" && !poll.geminiMentioned;

      if (chatgptDropped || geminiDropped) {
        // Build the set of dropped providers — only fire recovery for those
        const droppedProviders = new Set<"chatgpt" | "gemini">();
        if (chatgptDropped) droppedProviders.add("chatgpt");
        if (geminiDropped) droppedProviders.add("gemini");

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

      // Fire both providers on Run 1 (nothing is won yet)
      const started = await fireSessionsForCombo(ql.id, campaignId, systemUserId, new Set());
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
