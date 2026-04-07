/**
 * Training Cycle Orchestrator
 *
 * Drives the full lifecycle for each keyword × location combo:
 *
 * INITIAL PHASE (runs 1–4):
 *   Run N fires → all sessions for this combo start → sessions complete →
 *   nextPollAt = now + 24h → scheduler picks it up → LLM poll runs →
 *   wins extracted (removed from rotation, win emails sent, after video captured) →
 *   if runCount < 4 AND combo not achieved → Run N+1 fires immediately →
 *   repeat until runCount = 4 or all combos achieved
 *
 * MONITORING PHASE (weekly, indefinite):
 *   After run 4, non-achieved combos enter monitoring.
 *   Every 7 days: LLM poll runs against ALL combos (won + non-won).
 *   - Won combo dropped out → single recovery run → 24h → poll → if back, leave it
 *   - Non-won combo now appearing → win email, mark achieved
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
 * Fire all paused training sessions for a given campaignQueryLocationId.
 * Resets the session to paused+pending so it runs a fresh 50-iteration cycle.
 */
async function fireSessionsForCombo(
  qlId: number,
  campaignId: number,
  systemUserId: number,
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
 * Fire a single-iteration recovery run for a combo that dropped out of results.
 * Creates a temporary 1-iteration session rather than resetting the full 50-run session.
 */
async function fireRecoveryRunForCombo(
  ql: typeof campaignQueryLocations.$inferSelect,
  business: { name: string; businessType: string | null; location: string | null },
  systemUserId: number,
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

  const sessionTargets = [
    { provider: "openai" as const, model: "gpt-4.1", label: "ChatGPT" },
    { provider: "google" as const, model: "gemini-2.5-flash", label: "Gemini" },
  ];

  for (const target of sessionTargets) {
    try {
      const session = await createTrainingSession({
        userId: systemUserId,
        businessId: ql.campaignId, // will be overridden below — use campaignId to look up
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

  // Update combo status to achieved
  await db
    .update(campaignQueryLocations)
    .set({
      trainingStatus: "achieved",
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

  // ── 1. Find combos with a due poll (initial phase) ──────────────────────────
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

      // Re-fetch to get updated status
      const [refreshed] = await db.select().from(campaignQueryLocations).where(eq(campaignQueryLocations.id, ql.id)).limit(1);
      const isAchieved = refreshed?.trainingStatus === "achieved";

      if (isAchieved) {
        // Both platforms won — move to monitoring
        await db.update(campaignQueryLocations).set({
          trainingStatus: "monitoring",
          monitoringStartedAt: now,
          nextPollAt: new Date(now.getTime() + MONITORING_INTERVAL_MS),
          updatedAt: now,
        }).where(eq(campaignQueryLocations.id, ql.id));
        result.combosEnteredMonitoring++;
      } else {
        const runCount = (ql.trainingRunCount ?? 0);
        if (runCount < MAX_INITIAL_RUNS) {
          // Fire the next run immediately
          const started = await fireSessionsForCombo(ql.id, campaignId, systemUserId);
          result.runsStarted += started;

          await db.update(campaignQueryLocations).set({
            trainingRunCount: runCount + 1,
            trainingSessions: (ql.trainingSessions ?? 0) + 1,
            lastRunCompletedAt: now,
            nextPollAt: new Date(now.getTime() + POLL_DELAY_MS),
            updatedAt: now,
          }).where(eq(campaignQueryLocations.id, ql.id));
        } else {
          // Exhausted 4 runs — enter monitoring
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

      const wasAchieved =
        ql.currentRankChatGPT === "mentioned" || ql.currentRankGemini === "mentioned";

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
      const chatgptDropped =
        ql.currentRankChatGPT === "mentioned" && !poll.chatgptMentioned;
      const geminiDropped =
        ql.currentRankGemini === "mentioned" && !poll.geminiMentioned;

      if (chatgptDropped || geminiDropped) {
        // Fire a single recovery run
        await fireRecoveryRunForCombo(ql, business, systemUserId);
        result.recoveryRunsStarted++;

        await db.update(campaignQueryLocations).set({
          trainingStatus: "recovering",
          [chatgptDropped ? "currentRankChatGPT" : "currentRankGemini"]: "not_mentioned",
          nextPollAt: new Date(now.getTime() + POLL_DELAY_MS), // 24h after recovery run
          lastMonitoringPollAt: now,
          updatedAt: now,
        }).where(eq(campaignQueryLocations.id, ql.id));
      } else {
        // Still present (or still not present) — schedule next weekly check
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

      const started = await fireSessionsForCombo(ql.id, campaignId, systemUserId);
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
