/**
 * Rank Tracking Engine (Sprint 8)
 * 
 * Enhanced rank tracking that builds on the existing DataForSEO integration.
 * Adds:
 * - Scheduled rank checks (weekly/biweekly per campaign config)
 * - Comprehensive visibility scoring (0-100)
 * - Historical trend analysis with comparison periods
 * - Win detection (new mentions, position improvements)
 * - Per-platform breakdown (ChatGPT, Gemini, AI Overview)
 */

import { getDb } from "./db";
import {
  campaigns,
  campaignQueryLocations,
  rankSnapshots,
  businesses,
  queryDropoffEvents,
} from "../drizzle/schema";
import { eq, and, desc, asc, gte, lte, sql } from "drizzle-orm";
import { checkRankForQueries, searchLLMMentions, checkLLMVisibilityDirect } from "./dataforseoService";
import { logDFSCost, DFS_COSTS } from "./costLogger";
import {
  getCampaignById,
  getQueryLocationsByCampaignId,
  createCampaignQueryLocations,
  createRankSnapshot,
  updateQueryLocation,
  updateCampaign,
} from "./dbCampaigns";

// ─── In-memory tracker for manual rank check runs ────────────────────────────
// Keyed by campaignId. Status is cleared/overwritten on each new manual run.
export type ManualCheckStatus = {
  status: "running" | "done" | "error";
  startedAt: string;
  completedAt?: string;
  snapshotsCreated?: number;
  winsDetected?: number;
  error?: string;
};
const _manualCheckRuns = new Map<number, ManualCheckStatus>();

export function getManualCheckStatus(campaignId: number): ManualCheckStatus | null {
  return _manualCheckRuns.get(campaignId) ?? null;
}

/**
 * Fire-and-forget wrapper for manual rank checks.
 * Returns immediately and runs the check in the background.
 * Poll getManualCheckStatus(campaignId) to track progress.
 */
export function startManualRankCheck(campaignId: number): { started: boolean; alreadyRunning: boolean } {
  const existing = _manualCheckRuns.get(campaignId);
  if (existing?.status === "running") {
    return { started: false, alreadyRunning: true };
  }
  const startedAt = new Date().toISOString();
  _manualCheckRuns.set(campaignId, { status: "running", startedAt });
  runScheduledRankCheck(campaignId)
    .then((result) => {
      _manualCheckRuns.set(campaignId, {
        status: "done",
        startedAt,
        completedAt: new Date().toISOString(),
        snapshotsCreated: result.snapshotsCreated,
        winsDetected: result.winsDetected.length,
      });
    })
    .catch((err: any) => {
      _manualCheckRuns.set(campaignId, {
        status: "error",
        startedAt,
        completedAt: new Date().toISOString(),
        error: err?.message ?? "Unknown error",
      });
    });
  return { started: true, alreadyRunning: false };
}

// ============= Types =============

export interface VisibilityScore {
  overall: number;           // 0-100 composite score
  chatgpt: number;           // 0-100 ChatGPT visibility
  gemini: number;            // 0-100 Gemini visibility
  aiOverview: number;        // 0-100 Google AI Overview visibility
  totalQueries: number;
  mentionedQueries: number;
}

export interface RankTrend {
  date: string;              // ISO date string
  overall: number;
  chatgpt: number;
  gemini: number;
  aiOverview: number;
  mentionedQueries: number;
}

export interface QueryRankDetail {
  queryLocationId: number;
  searchQuery: string;
  location: string;
  aiSearchVolume: number | null;
  // Current status
  chatgptMentioned: boolean;
  chatgptPosition: number | null;
  geminiMentioned: boolean;
  geminiPosition: number | null;
  aiOverviewMentioned: boolean;
  aiOverviewPosition: number | null;
  // Change from baseline
  chatgptChange: "new" | "improved" | "same" | "declined" | "lost" | "never";
  geminiChange: "new" | "improved" | "same" | "declined" | "lost" | "never";
  aiOverviewChange: "new" | "improved" | "same" | "declined" | "lost" | "never";
  // Metadata
  firstMentionedAt: string | null;
  lastCheckedAt: string | null;
}

export interface WinDetection {
  queryLocationId: number;
  searchQuery: string;
  location: string;
  platform: "chatgpt" | "gemini" | "aiOverview";
  winType: "new_mention" | "new_source_cited";
  previousValue: string;
  currentValue: string;
  detectedAt: string;
  firstMentionedAt: string | null; // When the business first appeared for this query-location
}

export interface CampaignRankReport {
  campaignId: number;
  businessName: string;
  businessWebsite: string;
  // Scores
  currentScore: VisibilityScore;
  baselineScore: VisibilityScore | null;
  previousScore: VisibilityScore | null; // Last check before current
  // Trends
  trends: RankTrend[];
  // Details
  queryDetails: QueryRankDetail[];
  // Wins
  recentWins: WinDetection[];
  // Metadata
  lastCheckAt: string | null;
  baselineCheckAt: string | null;
  totalChecks: number;
  isBaselineOnly: boolean; // true when sprint has not yet completed — hide bonus queries on client dashboard
}

// ============= Visibility Scoring =============

/**
 * Calculate a visibility score from rank snapshots.
 *
 * Scoring logic (mention-rate based — no position bonuses):
 * - Each query-location combo is worth equal weight
 * - Per platform: mentioned = 100 points, not mentioned = 0
 * - Platforms weighted: ChatGPT 40%, Gemini 30%, AI Overview 30%
 * - Score normalized to 0-100
 *
 * Rationale: LLMs are generative engines — the same query can yield different
 * results on each run. What matters is the probability of consistently appearing
 * (mention rate), not a hard position number.
 */
export function calculateVisibilityScore(
  snapshots: Array<{
    chatgptMentioned: boolean | null;
    chatgptPosition: number | null;
    geminiMentioned: boolean | null;
    geminiPosition: number | null;
    aiOverviewMentioned: boolean | null;
    aiOverviewPosition: number | null;
  }>,
  totalQueries: number
): VisibilityScore {
  if (totalQueries === 0) {
    return { overall: 0, chatgpt: 0, gemini: 0, aiOverview: 0, totalQueries: 0, mentionedQueries: 0 };
  }

  let chatgptMentionCount = 0;
  let geminiMentionCount = 0;
  let aiOverviewMentionCount = 0;
  let mentionedQueries = 0;
  for (const snap of snapshots) {
    let queryMentioned = false;
    if (snap.chatgptMentioned) { chatgptMentionCount++; queryMentioned = true; }
    if (snap.geminiMentioned)  { geminiMentionCount++;  queryMentioned = true; }
    if (snap.aiOverviewMentioned) { aiOverviewMentionCount++; queryMentioned = true; }
    if (queryMentioned) mentionedQueries++;
  }
  // Mention rate per platform (0-100)
  const chatgptNorm = Math.round((chatgptMentionCount / totalQueries) * 100);
  const geminiNorm  = Math.round((geminiMentionCount  / totalQueries) * 100);
  const aiOverviewNorm = Math.round((aiOverviewMentionCount / totalQueries) * 100);
  // Weighted overall: ChatGPT 40%, Gemini 30%, AI Overview 30%
  const overall = Math.round(chatgptNorm * 0.4 + geminiNorm * 0.3 + aiOverviewNorm * 0.3);
  return { overall, chatgpt: chatgptNorm, gemini: geminiNorm, aiOverview: aiOverviewNorm, totalQueries, mentionedQueries };
}

// ============= Rank Check Execution =============

/**
 * Run a scheduled rank check for a campaign.
 * Creates new snapshots and detects wins.
 */
export async function runScheduledRankCheck(campaignId: number): Promise<{
  success: boolean;
  snapshotsCreated: number;
  winsDetected: WinDetection[];
  currentScore: VisibilityScore;
  error?: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const campaign = await getCampaignById(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const businessResult = await db.select().from(businesses)
    .where(eq(businesses.id, campaign.businessId)).limit(1);
  const business = businessResult[0];
  if (!business?.website) throw new Error("Business has no website URL");

  // Defense-in-depth: never run rank checks for archived clients.
  // The scheduler selector already filters them out, but this guard catches
  // any direct calls or race conditions.
  if (business.isArchived) {
    console.log(`[Rank Tracking] Business ${business.id} ("${business.name}") is archived — skipping rank check for campaign ${campaignId}`);
    return { success: true, snapshotsCreated: 0, winsDetected: [], currentScore: calculateVisibilityScore([], 0) };
  }

  console.log(`[Rank Tracking] Running scheduled check for campaign ${campaignId} (${business.name})`);

  // Get all query-locations
  const queryLocations = await getQueryLocationsByCampaignId(campaignId);
  if (queryLocations.length === 0) {
    return { success: true, snapshotsCreated: 0, winsDetected: [], currentScore: calculateVisibilityScore([], 0) };
  }

  // Get previous snapshots for comparison (most recent per query-location)
  const previousSnapshots = await getLatestSnapshots(campaignId);

  // ── Direct real-time LLM check per query ─────────────────────────────────
  // Ask ChatGPT, Gemini, and AI Overview directly for each tracked query.
  // This is accurate and real-time regardless of DataForSEO index lag.
  console.log(`[Rank Tracking] Running direct LLM visibility checks for ${queryLocations.length} queries`);

  let snapshotsCreated = 0;
  const winsDetected: WinDetection[] = [];
  const newSnapshots: Array<{
    chatgptMentioned: boolean | null;
    chatgptPosition: number | null;
    geminiMentioned: boolean | null;
    geminiPosition: number | null;
    aiOverviewMentioned: boolean | null;
    aiOverviewPosition: number | null;
  }> = [];
  // Collect all mention results so the bonus-location detection block below
  // (which iterates over `mentions`) still works without changes.
  const mentions: import("./dataforseoService").DirectVisibilityResult[] = [];

  // Determine campaign scope — 'local' appends location, 'national'/'ecommerce' do not
  const campaignScope = (campaign as any).campaignScope ?? 'local';

  for (const ql of queryLocations) {
    const queryWithLocation =
      campaignScope === 'local' && ql.location
        ? `${ql.searchQuery} in ${ql.location}`
        : ql.searchQuery;

    const mention = await checkLLMVisibilityDirect(
      queryWithLocation,
      business.name,
      (business as any).agencyId ?? null,
      business.website ?? null,
      business.phone ?? null,
      {
        campaignId,
        businessId: (business as any).id,
        campaignCreatedAt: campaign.createdAt,
        operationType: 'rank_check',
      },
      (business as any).location ?? null
    );
    mentions.push(mention);

    const chatgptMentioned = mention.llmResponses.chatgpt?.mentioned || false;
    const chatgptPosition = mention.llmResponses.chatgpt?.position || null;
    const geminiMentioned = mention.llmResponses.gemini?.mentioned || false;
    const geminiPosition = mention.llmResponses.gemini?.position || null;
    const aiOverviewMentioned = mention.llmResponses.aiOverview?.mentioned || false;
    const aiOverviewPosition = mention.llmResponses.aiOverview?.position || null;

    // Create snapshot — isTracked=true because getQueryLocationsByCampaignId only returns isTargetLocation=true rows
    await createRankSnapshot({
      campaignId,
      queryLocationId: ql.id,
      chatgptMentioned,
      chatgptPosition,
      chatgptResponseSnippet: mention.llmResponses.chatgpt?.snippet || null,
      geminiMentioned,
      geminiPosition,
      geminiResponseSnippet: mention.llmResponses.gemini?.snippet || null,
      aiOverviewMentioned,
      aiOverviewPosition,
      aiOverviewResponseSnippet: mention.llmResponses.aiOverview?.snippet || null,
      sourcesCited: null,
      checkType: "scheduled",
      isTracked: true,
      checkedAt: new Date(),
    });

    newSnapshots.push({ chatgptMentioned, chatgptPosition, geminiMentioned, geminiPosition, aiOverviewMentioned, aiOverviewPosition });

    // Cost logging is now handled inside checkLLMVisibilityDirect via costContext (real per-provider token costs)

    // Detect wins by comparing to previous snapshot
    const prev = previousSnapshots.get(ql.id);
    if (prev) {
            // ChatGPT wins
      if (chatgptMentioned && !prev.chatgptMentioned) {
        winsDetected.push({
          queryLocationId: ql.id,
          searchQuery: ql.searchQuery,
          location: ql.location,
          platform: "chatgpt",
          winType: "new_mention",
          previousValue: "Not mentioned",
          currentValue: "Mentioned",
          detectedAt: new Date().toISOString(),
          firstMentionedAt: new Date().toISOString(),
        });
      }
      // Gemini wins
      if (geminiMentioned && !prev.geminiMentioned) {
        winsDetected.push({
          queryLocationId: ql.id,
          searchQuery: ql.searchQuery,
          location: ql.location,
          platform: "gemini",
          winType: "new_mention",
          previousValue: "Not mentioned",
          currentValue: "Mentioned",
          detectedAt: new Date().toISOString(),
          firstMentionedAt: new Date().toISOString(),
        });
      }
      // AI Overview wins
      if (aiOverviewMentioned && !prev.aiOverviewMentioned) {
        winsDetected.push({
          queryLocationId: ql.id,
          searchQuery: ql.searchQuery,
          location: ql.location,
          platform: "aiOverview",
          winType: "new_mention",
          previousValue: "Not mentioned",
          currentValue: "Mentioned",
          detectedAt: new Date().toISOString(),
          firstMentionedAt: new Date().toISOString(),
        });
      }

      // ── Drop-off detection ──────────────────────────────────────────────────
      // Only record a drop-off when the business WAS mentioned before and is
      // no longer mentioned now. Never fire for queries that were never mentioned.
      const db = await getDb();
      if (!db) continue;
      const dropoffPlatforms: Array<{ platform: string; wasMentioned: boolean; isMentioned: boolean }> = [
        { platform: "chatgpt",    wasMentioned: !!prev.chatgptMentioned,    isMentioned: chatgptMentioned },
        { platform: "gemini",     wasMentioned: !!prev.geminiMentioned,     isMentioned: geminiMentioned },
        { platform: "aiOverview", wasMentioned: !!prev.aiOverviewMentioned, isMentioned: aiOverviewMentioned },
      ];

      for (const { platform, wasMentioned, isMentioned } of dropoffPlatforms) {
        if (wasMentioned && !isMentioned) {
          // Check if there's already an open (unrecovered) drop-off event for this combo
          const existingDropoff = await db
            .select({ id: queryDropoffEvents.id })
            .from(queryDropoffEvents)
            .where(
              and(
                eq(queryDropoffEvents.campaignId, campaignId),
                eq(queryDropoffEvents.queryLocationId, ql.id),
                eq(queryDropoffEvents.platform, platform),
                sql`${queryDropoffEvents.recoveredAt} IS NULL`
              )
            )
            .limit(1);

          if (existingDropoff.length === 0) {
            // Record new drop-off event and flag re-optimization as initiated
            await db.insert(queryDropoffEvents).values({
              campaignId,
              queryLocationId: ql.id,
              platform,
              searchQuery: ql.searchQuery,
              location: ql.location,
              detectedAt: new Date(),
              reoptimizationInitiated: true,
              reoptimizationInitiatedAt: new Date(),
            });
            console.log(`[RankTracker] Drop-off detected: "${ql.searchQuery}" on ${platform} — re-optimization initiated`);
          }
        } else if (!wasMentioned && isMentioned) {
          // Recovery — mark any open drop-off events for this combo as recovered
          await db
            .update(queryDropoffEvents)
            .set({ recoveredAt: new Date() })
            .where(
              and(
                eq(queryDropoffEvents.campaignId, campaignId),
                eq(queryDropoffEvents.queryLocationId, ql.id),
                eq(queryDropoffEvents.platform, platform),
                sql`${queryDropoffEvents.recoveredAt} IS NULL`
              )
            );
        }
      }
    }

    // Update query-location with latest rank
    const isMentioned = chatgptMentioned || geminiMentioned || aiOverviewMentioned;
    await updateQueryLocation(ql.id, {
      currentRankChatGPT: chatgptMentioned ? "mentioned" : "not_mentioned",
      currentRankGemini: geminiMentioned ? "mentioned" : "not_mentioned",
      currentRankAIOverview: aiOverviewMentioned ? "mentioned" : "not_mentioned",
      lastRankCheckAt: new Date(),
      ...(isMentioned && !ql.firstMentionedAt ? { firstMentionedAt: new Date() } : {}),
    });

    snapshotsCreated++;
  }

  // ============= Bonus Location Detection =============
  // Check every mention returned by DataForSEO. If the keyword matches one of our tracked
  // queries but the location in the snippet is NOT one of the client's target locations,
  // we create a new campaignQueryLocation row tagged isTargetLocation=false so it shows
  // up in reporting as a bonus win.
  const targetLocations = new Set(
    queryLocations.map((ql) => ql.location.toLowerCase().trim())
  );
  const trackedQueries = new Set(
    queryLocations.map((ql) => ql.searchQuery.toLowerCase())
  );
  // Build a set of existing bonus combos so we don't double-insert
  const existingBonusCombos = new Set(
    queryLocations
      .filter((ql) => !ql.isTargetLocation)
      .map((ql) => `${ql.searchQuery.toLowerCase()}||${ql.location.toLowerCase().trim()}`)
  );

  const bonusToCreate: Parameters<typeof createCampaignQueryLocations>[0] = [];

  for (const mention of mentions) {
    // Only consider keywords that match one of our tracked queries
    if (!trackedQueries.has(mention.keyword.toLowerCase())) continue;
    const isMentioned =
      mention.llmResponses.chatgpt?.mentioned ||
      mention.llmResponses.gemini?.mentioned ||
      mention.llmResponses.aiOverview?.mentioned;
    if (!isMentioned) continue;

    // Extract city mentions from snippets — look for "City, ST" patterns
    const allSnippets = [
      mention.llmResponses.chatgpt?.snippet || "",
      mention.llmResponses.gemini?.snippet || "",
      mention.llmResponses.aiOverview?.snippet || "",
    ].join(" ");

    // Match patterns like "Phoenix, AZ" or "Phoenix, Arizona"
    const cityPattern = /\b([A-Z][a-zA-Z\s]+),\s*([A-Z]{2}|[A-Z][a-z]+)\b/g;
    let cityMatch: RegExpExecArray | null;
    while ((cityMatch = cityPattern.exec(allSnippets)) !== null) {
      const detectedLocation = cityMatch[0].trim();
      const normalizedDetected = detectedLocation.toLowerCase().trim();
      // Skip if it's already a target location
      if (targetLocations.has(normalizedDetected)) continue;
      const comboKey = `${mention.keyword.toLowerCase()}||${normalizedDetected}`;
      if (existingBonusCombos.has(comboKey)) continue;
      // New bonus location found!
      existingBonusCombos.add(comboKey); // prevent duplicates within this run
      bonusToCreate.push({
        campaignId,
        searchQuery: mention.keyword,
        location: detectedLocation,
        aiSearchVolume: null, // DirectVisibilityResult has no aiSearchVolume
        trainingStatus: "monitoring" as const, // bonus wins go straight to monitoring
        trainingSessions: 0,
        isTargetLocation: false,
        firstMentionedAt: new Date(),
        currentRankChatGPT: mention.llmResponses.chatgpt?.mentioned ? "mentioned" : null,
        currentRankGemini: mention.llmResponses.gemini?.mentioned ? "mentioned" : null,
        currentRankAIOverview: mention.llmResponses.aiOverview?.mentioned ? "mentioned" : null,
        lastRankCheckAt: new Date(),
      });
      // Also record as a win
      winsDetected.push({
        queryLocationId: -1, // will be updated after insert
        searchQuery: mention.keyword,
        location: detectedLocation,
        platform: mention.llmResponses.chatgpt?.mentioned ? "chatgpt" :
                  mention.llmResponses.gemini?.mentioned ? "gemini" : "aiOverview",
        winType: "new_mention",
        previousValue: "Not tracked (bonus location)",
        currentValue: "Mentioned (bonus win)",
        detectedAt: new Date().toISOString(),
        firstMentionedAt: new Date().toISOString(),
      });
      console.log(`[Rank Tracking] Bonus location detected: "${mention.keyword}" in ${detectedLocation} (not a target location)`);
    }
  }

  if (bonusToCreate.length > 0) {
    const created = await createCampaignQueryLocations(bonusToCreate);
    // Back-fill the queryLocationId on the bonus win entries
    for (let i = 0; i < created.length; i++) {
      const winIdx = winsDetected.findLastIndex((w) => w.queryLocationId === -1);
      if (winIdx !== -1) winsDetected[winIdx].queryLocationId = created[i].id;
    }
    // Write TWO snapshots per bonus row so detectWins() sees a null → mentioned
    // transition immediately (it requires at least 2 snapshots to compare).
    // Snapshot 1: all-null "before" state (1 minute in the past)
    // Snapshot 2: the actual current "after" state
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    for (let i = 0; i < created.length; i++) {
      const row = created[i];
      const src = bonusToCreate[i];
      // "Before" snapshot — nothing mentioned (bonus query, isTracked=false)
      await createRankSnapshot({
        campaignId,
        queryLocationId: row.id,
        chatgptMentioned: false,
        chatgptPosition: null,
        chatgptResponseSnippet: null,
        geminiMentioned: false,
        geminiPosition: null,
        geminiResponseSnippet: null,
        aiOverviewMentioned: false,
        aiOverviewPosition: null,
        aiOverviewResponseSnippet: null,
        sourcesCited: null,
        checkType: "scheduled",
        isTracked: false,
        checkedAt: oneMinuteAgo,
      });
      // "After" snapshot — the actual current mention state (bonus query, isTracked=false)
      await createRankSnapshot({
        campaignId,
        queryLocationId: row.id,
        chatgptMentioned: src.currentRankChatGPT === "mentioned",
        chatgptPosition: null,
        chatgptResponseSnippet: null,
        geminiMentioned: src.currentRankGemini === "mentioned",
        geminiPosition: null,
        geminiResponseSnippet: null,
        aiOverviewMentioned: src.currentRankAIOverview === "mentioned",
        aiOverviewPosition: null,
        aiOverviewResponseSnippet: null,
        sourcesCited: null,
        checkType: "scheduled",
        isTracked: false,
        checkedAt: new Date(),
      });
    }
    console.log(`[Rank Tracking] Created ${created.length} bonus location rows with before/after snapshots for immediate win detection`);
  }

  const currentScore = calculateVisibilityScore(newSnapshots, queryLocations.length);

  console.log(`[Rank Tracking] Check complete: ${snapshotsCreated} snapshots, ${winsDetected.length} wins (incl. ${bonusToCreate.length} bonus locations), score: ${currentScore.overall}/100`);

  return { success: true, snapshotsCreated, winsDetected, currentScore };
}

// ============= Data Retrieval =============

/**
 * Get the latest snapshot per query-location for a campaign
 */
async function getLatestSnapshots(campaignId: number): Promise<Map<number, typeof rankSnapshots.$inferSelect>> {
  const db = await getDb();
  if (!db) return new Map();

  // Only include tracked snapshots — bonus query snapshots (isTracked=false) MUST NEVER affect scoring
  const allSnapshots = await db.select().from(rankSnapshots)
    .where(and(
      eq(rankSnapshots.campaignId, campaignId),
      eq(rankSnapshots.isTracked, true)
    ))
    .orderBy(desc(rankSnapshots.checkedAt));

  const latest = new Map<number, typeof rankSnapshots.$inferSelect>();
  for (const snap of allSnapshots) {
    if (!latest.has(snap.queryLocationId)) {
      latest.set(snap.queryLocationId, snap);
    }
  }

  return latest;
}

/**
 * Get baseline snapshots for a campaign.
 *
 * Primary: snapshots with checkType = 'baseline' (set by runCampaignBaselineCheck).
 * Fallback: if none exist (e.g. campaigns created before the baseline checkType was
 * introduced, or where runScheduledRankCheck was called instead), use the earliest
 * scheduled snapshot per query-location as the de-facto baseline.
 */
async function getBaselineSnapshots(campaignId: number): Promise<Map<number, typeof rankSnapshots.$inferSelect>> {
  const db = await getDb();
  if (!db) return new Map();

  // Only include tracked snapshots — bonus query snapshots (isTracked=false) MUST NEVER affect baseline scoring
  // Try explicit baseline snapshots first
  const baselineSnaps = await db.select().from(rankSnapshots)
    .where(and(
      eq(rankSnapshots.campaignId, campaignId),
      eq(rankSnapshots.isTracked, true),
      eq(rankSnapshots.checkType, "baseline")
    ))
    .orderBy(asc(rankSnapshots.checkedAt));

  const baseline = new Map<number, typeof rankSnapshots.$inferSelect>();
  for (const snap of baselineSnaps) {
    if (!baseline.has(snap.queryLocationId)) {
      baseline.set(snap.queryLocationId, snap);
    }
  }

  // Fallback: use the earliest tracked snapshot per query-location
  if (baseline.size === 0) {
    const allSnaps = await db.select().from(rankSnapshots)
      .where(and(
        eq(rankSnapshots.campaignId, campaignId),
        eq(rankSnapshots.isTracked, true)
      ))
      .orderBy(asc(rankSnapshots.checkedAt));
    for (const snap of allSnaps) {
      if (!baseline.has(snap.queryLocationId)) {
        baseline.set(snap.queryLocationId, snap);
      }
    }
  }

  return baseline;
}

/**
 * Get historical visibility trends for a campaign
 */
export async function getVisibilityTrends(
  campaignId: number,
  options?: { days?: number }
): Promise<RankTrend[]> {
  const db = await getDb();
  if (!db) return [];

  const days = options?.days || 90;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const queryLocations = await getQueryLocationsByCampaignId(campaignId);
  const totalQueries = queryLocations.length; // Only tracked query-locations
  if (totalQueries === 0) return [];

  // Only include tracked snapshots — bonus query snapshots MUST NEVER affect trend scoring
  const allSnapshots = await db.select().from(rankSnapshots)
    .where(and(
      eq(rankSnapshots.campaignId, campaignId),
      eq(rankSnapshots.isTracked, true),
      gte(rankSnapshots.checkedAt, since)
    ))
    .orderBy(asc(rankSnapshots.checkedAt));

  // Group by check date (day level)
  const byDate = new Map<string, typeof allSnapshots>();
  for (const snap of allSnapshots) {
    const dateKey = snap.checkedAt.toISOString().split("T")[0];
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey)!.push(snap);
  }

  // Calculate score per date
  const trends: RankTrend[] = [];
  for (const [date, snaps] of Array.from(byDate.entries())) {
    // Deduplicate by queryLocationId (take latest per day)
    const latestPerQL = new Map<number, typeof allSnapshots[0]>();
    for (const s of snaps) {
      const existing = latestPerQL.get(s.queryLocationId);
      if (!existing || s.checkedAt > existing.checkedAt) {
        latestPerQL.set(s.queryLocationId, s);
      }
    }

    const daySnapshots = Array.from(latestPerQL.values());
    // Use snapshot-backed denominator: score each day against the number of queries
    // that were actually checked that day, not the current total query-location count.
    const dayTotalQueries = daySnapshots.length > 0 ? daySnapshots.length : totalQueries;
    const score = calculateVisibilityScore(daySnapshots, dayTotalQueries);

    trends.push({
      date,
      overall: score.overall,
      chatgpt: score.chatgpt,
      gemini: score.gemini,
      aiOverview: score.aiOverview,
      mentionedQueries: score.mentionedQueries,
    });
  }

  return trends;
}

/**
 * Generate a full campaign rank report
 */
export async function generateCampaignRankReport(campaignId: number): Promise<CampaignRankReport> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const campaign = await getCampaignById(campaignId);
  if (!campaign) throw new Error("Campaign not found");

  const businessResult = await db.select().from(businesses)
    .where(eq(businesses.id, campaign.businessId)).limit(1);
  const business = businessResult[0];
  if (!business) throw new Error("Business not found");

  const queryLocations = await getQueryLocationsByCampaignId(campaignId);

  // Get latest snapshots
  const latestSnapshots = await getLatestSnapshots(campaignId);
  const baselineSnapshots = await getBaselineSnapshots(campaignId);

  // Use snapshot-backed denominator: only count queries that have actually been checked.
  // Queries added after the last check run must NOT dilute the score until they are checked.
  const currentSnaps = Array.from(latestSnapshots.values());
  const totalQueries = currentSnaps.length > 0 ? currentSnaps.length : queryLocations.length;
  const currentScore = calculateVisibilityScore(currentSnaps, totalQueries);

  // Baseline denominator: use the number of queries that were checked at baseline time.
  const baselineSnaps = Array.from(baselineSnapshots.values());
  const baselineTotalQueries = baselineSnaps.length > 0 ? baselineSnaps.length : totalQueries;
  const baselineScore = baselineSnaps.length > 0
    ? calculateVisibilityScore(baselineSnaps, baselineTotalQueries)
    : null;

  // Get trends
  const trends = await getVisibilityTrends(campaignId, { days: 90 });

  // Previous score (second-to-last check date)
  let previousScore: VisibilityScore | null = null;
  if (trends.length >= 2) {
    const prevTrend = trends[trends.length - 2];
    previousScore = {
      overall: prevTrend.overall,
      chatgpt: prevTrend.chatgpt,
      gemini: prevTrend.gemini,
      aiOverview: prevTrend.aiOverview,
      totalQueries: totalQueries,
      mentionedQueries: prevTrend.mentionedQueries,
    };
  }

  // Build query details with change detection.
  // Only include queries that have been checked (have at least a latest snapshot).
  // Queries added after the last check run are excluded until they are actually checked.
  const checkedQueryLocations = queryLocations.filter((ql) => latestSnapshots.has(ql.id));
  const queryDetails: QueryRankDetail[] = checkedQueryLocations.map((ql) => {
    const latest = latestSnapshots.get(ql.id);
    const baseline = baselineSnapshots.get(ql.id);

    function detectChange(
      currentMentioned: boolean,
      currentPos: number | null,
      baselineMentioned: boolean | undefined,
      baselinePos: number | null | undefined
    ): QueryRankDetail["chatgptChange"] {
      if (baselineMentioned === undefined) return currentMentioned ? "new" : "never";
      if (!baselineMentioned && currentMentioned) return "new";
      if (baselineMentioned && !currentMentioned) return "lost";
      if (baselineMentioned && currentMentioned) {
        if (currentPos && baselinePos && currentPos < baselinePos) return "improved";
        if (currentPos && baselinePos && currentPos > baselinePos) return "declined";
        return "same";
      }
      return "never";
    }

    return {
      queryLocationId: ql.id,
      searchQuery: ql.searchQuery,
      location: ql.location,
      aiSearchVolume: ql.aiSearchVolume,
      chatgptMentioned: latest?.chatgptMentioned || false,
      chatgptPosition: latest?.chatgptPosition || null,
      geminiMentioned: latest?.geminiMentioned || false,
      geminiPosition: latest?.geminiPosition || null,
      aiOverviewMentioned: latest?.aiOverviewMentioned || false,
      aiOverviewPosition: latest?.aiOverviewPosition || null,
      chatgptChange: detectChange(
        latest?.chatgptMentioned || false, latest?.chatgptPosition || null,
        baseline?.chatgptMentioned ?? undefined, baseline?.chatgptPosition
      ),
      geminiChange: detectChange(
        latest?.geminiMentioned || false, latest?.geminiPosition || null,
        baseline?.geminiMentioned ?? undefined, baseline?.geminiPosition
      ),
      aiOverviewChange: detectChange(
        latest?.aiOverviewMentioned || false, latest?.aiOverviewPosition || null,
        baseline?.aiOverviewMentioned ?? undefined, baseline?.aiOverviewPosition
      ),
      firstMentionedAt: ql.firstMentionedAt?.toISOString() || null,
      lastCheckedAt: ql.lastRankCheckAt?.toISOString() || null,
    };
  });

  // Detect recent wins (from last check)
  const recentWins: WinDetection[] = [];
  for (const detail of queryDetails) {
    if (detail.chatgptChange === "new") {
      recentWins.push({
        queryLocationId: detail.queryLocationId,
        searchQuery: detail.searchQuery,
        location: detail.location,
        platform: "chatgpt",
        winType: "new_mention",
        previousValue: "Not mentioned",
        currentValue: "Mentioned",
        detectedAt: detail.firstMentionedAt || new Date().toISOString(),
        firstMentionedAt: detail.firstMentionedAt,
      });
    }
    if (detail.geminiChange === "new") {
      recentWins.push({
        queryLocationId: detail.queryLocationId,
        searchQuery: detail.searchQuery,
        location: detail.location,
        platform: "gemini",
        winType: "new_mention",
        previousValue: "Not mentioned",
        currentValue: "Mentioned",
        detectedAt: detail.firstMentionedAt || new Date().toISOString(),
        firstMentionedAt: detail.firstMentionedAt,
      });
    }
    if (detail.aiOverviewChange === "new") {
      recentWins.push({
        queryLocationId: detail.queryLocationId,
        searchQuery: detail.searchQuery,
        location: detail.location,
        platform: "aiOverview",
        winType: "new_mention",
        previousValue: "Not mentioned",
        currentValue: "Mentioned",
        detectedAt: detail.firstMentionedAt || new Date().toISOString(),
        firstMentionedAt: detail.firstMentionedAt,
      });
    }
    // position_improvement win type removed — LLMs are generative, mention rate is what matters
  }

  // Count total checks
  const allSnapshotCount = await db.select({ count: sql<number>`count(*)` })
    .from(rankSnapshots)
    .where(eq(rankSnapshots.campaignId, campaignId));

  return {
    campaignId,
    businessName: business.name,
    businessWebsite: business.website || "",
    currentScore,
    baselineScore,
    previousScore,
    trends,
    queryDetails,
    recentWins,
    lastCheckAt: currentSnaps.length > 0
      ? currentSnaps.reduce((latest, s) => s.checkedAt > latest ? s.checkedAt : latest, currentSnaps[0].checkedAt).toISOString()
      : null,
    baselineCheckAt: campaign.baselineCheckCompletedAt?.toISOString() || null,
    totalChecks: Number(allSnapshotCount[0]?.count || 0),
    // Show Before vs. After as soon as at least one post-baseline scheduled check exists.
    // No longer gated on sprint completion — gains are visible in real time.
    isBaselineOnly: currentSnaps.length === 0,
  };
}

// ============= Report History =============

export interface CheckRunSummary {
  date: string;
  checkedAt: string;
  checkType: string;
  score: VisibilityScore;
  queriesChecked: number;
}

export async function getCheckRunHistory(campaignId: number): Promise<CheckRunSummary[]> {
  const db = await getDb();
  if (!db) return [];

  const snaps = await db
    .select()
    .from(rankSnapshots)
    .where(and(
      eq(rankSnapshots.campaignId, campaignId),
      eq(rankSnapshots.isTracked, true)
    ))
    .orderBy(asc(rankSnapshots.checkedAt));

  if (snaps.length === 0) return [];

  const qls = await db
    .select({ id: campaignQueryLocations.id })
    .from(campaignQueryLocations)
    .where(and(
      eq(campaignQueryLocations.campaignId, campaignId),
      eq(campaignQueryLocations.isTargetLocation, true)
    ));
  const totalQueries = qls.length;

  const groups = new Map<string, typeof snaps>();
  for (const snap of snaps) {
    const dateKey = new Date(snap.checkedAt).toISOString().slice(0, 10);
    const groupKey = `${dateKey}__${snap.checkType}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(snap);
  }

  const results: CheckRunSummary[] = [];
  for (const [groupKey, groupSnaps] of groups) {
    const [dateStr, checkType] = groupKey.split("__");
    const latestPerQuery = new Map<number, typeof snaps[0]>();
    for (const s of groupSnaps) {
      const existing = latestPerQuery.get(s.queryLocationId);
      if (!existing || s.checkedAt > existing.checkedAt) latestPerQuery.set(s.queryLocationId, s);
    }
    const dedupedSnaps = Array.from(latestPerQuery.values());
    // Use snapshot-backed denominator: score this historical run against the number
    // of queries that were actually checked in that run, not the current total.
    const runTotalQueries = dedupedSnaps.length > 0 ? dedupedSnaps.length : (totalQueries || 1);
    const score = calculateVisibilityScore(dedupedSnaps, runTotalQueries);
    const earliestCheckedAt = groupSnaps.reduce((min, s) => s.checkedAt < min ? s.checkedAt : min, groupSnaps[0].checkedAt);
    results.push({ date: dateStr, checkedAt: new Date(earliestCheckedAt).toISOString(), checkType: checkType || "scheduled", score, queriesChecked: dedupedSnaps.length });
  }

  return results.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
}

export interface CheckRunDetail {
  date: string;
  checkedAt: string;
  checkType: string;
  score: VisibilityScore;
  queries: Array<{
    queryLocationId: number;
    searchQuery: string;
    location: string;
    chatgptMentioned: boolean | null;
    chatgptPosition: number | null;
    chatgptResponseSnippet: string | null;
    geminiMentioned: boolean | null;
    geminiPosition: number | null;
    geminiResponseSnippet: string | null;
    aiOverviewMentioned: boolean | null;
    aiOverviewPosition: number | null;
    aiOverviewResponseSnippet: string | null;
  }>;
}

export async function getCheckRunDetail(campaignId: number, date: string, checkType: string): Promise<CheckRunDetail | null> {
  const db = await getDb();
  if (!db) return null;

  const startOfDay = new Date(date + "T00:00:00.000Z");
  const endOfDay = new Date(date + "T23:59:59.999Z");

  const snaps = await db
    .select()
    .from(rankSnapshots)
    .where(and(
      eq(rankSnapshots.campaignId, campaignId),
      eq(rankSnapshots.isTracked, true),
      eq(rankSnapshots.checkType, checkType as any),
      gte(rankSnapshots.checkedAt, startOfDay),
      lte(rankSnapshots.checkedAt, endOfDay)
    ))
    .orderBy(asc(rankSnapshots.checkedAt));

  if (snaps.length === 0) return null;

  const qls = await db
    .select()
    .from(campaignQueryLocations)
    .where(and(
      eq(campaignQueryLocations.campaignId, campaignId),
      eq(campaignQueryLocations.isTargetLocation, true)
    ));
  const qlMap = new Map(qls.map((q) => [q.id, q]));

  const latestPerQuery = new Map<number, typeof snaps[0]>();
  for (const s of snaps) {
    const existing = latestPerQuery.get(s.queryLocationId);
    if (!existing || s.checkedAt > existing.checkedAt) latestPerQuery.set(s.queryLocationId, s);
  }
  const dedupedSnaps = Array.from(latestPerQuery.values());
  // Use snapshot-backed denominator: score this run against queries actually checked,
  // not the current total query-location count (which may have grown since this run).
  const totalQueries = dedupedSnaps.length > 0 ? dedupedSnaps.length : (qls.length || 1);
  const score = calculateVisibilityScore(dedupedSnaps, totalQueries);
  const earliestCheckedAt = snaps.reduce((min, s) => s.checkedAt < min ? s.checkedAt : min, snaps[0].checkedAt);

  return {
    date,
    checkedAt: new Date(earliestCheckedAt).toISOString(),
    checkType,
    score,
    queries: dedupedSnaps.map((s) => {
      const ql = qlMap.get(s.queryLocationId);
      return {
        queryLocationId: s.queryLocationId,
        searchQuery: ql?.searchQuery ?? "(unknown query)",
        location: ql?.location ?? "",
        chatgptMentioned: s.chatgptMentioned ?? null,
        chatgptPosition: s.chatgptPosition ?? null,
        chatgptResponseSnippet: s.chatgptResponseSnippet ?? null,
        geminiMentioned: s.geminiMentioned ?? null,
        geminiPosition: s.geminiPosition ?? null,
        geminiResponseSnippet: s.geminiResponseSnippet ?? null,
        aiOverviewMentioned: s.aiOverviewMentioned ?? null,
        aiOverviewPosition: s.aiOverviewPosition ?? null,
        aiOverviewResponseSnippet: s.aiOverviewResponseSnippet ?? null,
      };
    }),
  };
}
