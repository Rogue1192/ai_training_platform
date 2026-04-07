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
} from "../drizzle/schema";
import { eq, and, desc, asc, gte, lte, sql } from "drizzle-orm";
import { checkRankForQueries, searchLLMMentions } from "./dataforseoService";
import {
  getCampaignById,
  getQueryLocationsByCampaignId,
  createRankSnapshot,
  updateQueryLocation,
  updateCampaign,
} from "./dbCampaigns";

// ============= Types =============

export interface VisibilityScore {
  overall: number;           // 0-100 composite score
  chatgpt: number;           // 0-100 ChatGPT visibility
  gemini: number;            // 0-100 Gemini visibility
  aiOverview: number;        // 0-100 Google AI Overview visibility
  totalQueries: number;
  mentionedQueries: number;
  averagePosition: number | null;
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
  winType: "new_mention" | "position_improvement" | "new_source_cited";
  previousValue: string;
  currentValue: string;
  detectedAt: string;
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
}

// ============= Visibility Scoring =============

/**
 * Calculate a visibility score from rank snapshots.
 * 
 * Scoring logic:
 * - Each query-location combo is worth equal weight
 * - Per platform: mentioned = base points, position 1-3 = bonus
 * - Platforms weighted: ChatGPT 40%, Gemini 30%, AI Overview 30%
 * - Score normalized to 0-100
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
    return { overall: 0, chatgpt: 0, gemini: 0, aiOverview: 0, totalQueries: 0, mentionedQueries: 0, averagePosition: null };
  }

  let chatgptScore = 0;
  let geminiScore = 0;
  let aiOverviewScore = 0;
  let mentionedQueries = 0;
  let positionSum = 0;
  let positionCount = 0;

  for (const snap of snapshots) {
    let queryMentioned = false;

    // ChatGPT scoring (0-100 per query)
    if (snap.chatgptMentioned) {
      queryMentioned = true;
      let score = 60; // Base for being mentioned
      if (snap.chatgptPosition !== null) {
        if (snap.chatgptPosition <= 1) score = 100;
        else if (snap.chatgptPosition <= 3) score = 85;
        else if (snap.chatgptPosition <= 5) score = 70;
        positionSum += snap.chatgptPosition;
        positionCount++;
      }
      chatgptScore += score;
    }

    // Gemini scoring
    if (snap.geminiMentioned) {
      queryMentioned = true;
      let score = 60;
      if (snap.geminiPosition !== null) {
        if (snap.geminiPosition <= 1) score = 100;
        else if (snap.geminiPosition <= 3) score = 85;
        else if (snap.geminiPosition <= 5) score = 70;
        positionSum += snap.geminiPosition;
        positionCount++;
      }
      geminiScore += score;
    }

    // AI Overview scoring
    if (snap.aiOverviewMentioned) {
      queryMentioned = true;
      let score = 60;
      if (snap.aiOverviewPosition !== null) {
        if (snap.aiOverviewPosition <= 1) score = 100;
        else if (snap.aiOverviewPosition <= 3) score = 85;
        else if (snap.aiOverviewPosition <= 5) score = 70;
        positionSum += snap.aiOverviewPosition;
        positionCount++;
      }
      aiOverviewScore += score;
    }

    if (queryMentioned) mentionedQueries++;
  }

  // Normalize per-platform scores to 0-100
  const chatgptNorm = Math.round(chatgptScore / totalQueries);
  const geminiNorm = Math.round(geminiScore / totalQueries);
  const aiOverviewNorm = Math.round(aiOverviewScore / totalQueries);

  // Weighted overall: ChatGPT 40%, Gemini 30%, AI Overview 30%
  const overall = Math.round(chatgptNorm * 0.4 + geminiNorm * 0.3 + aiOverviewNorm * 0.3);

  return {
    overall,
    chatgpt: chatgptNorm,
    gemini: geminiNorm,
    aiOverview: aiOverviewNorm,
    totalQueries,
    mentionedQueries,
    averagePosition: positionCount > 0 ? Math.round((positionSum / positionCount) * 10) / 10 : null,
  };
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

  console.log(`[Rank Tracking] Running scheduled check for campaign ${campaignId} (${business.name})`);

  // Get all query-locations
  const queryLocations = await getQueryLocationsByCampaignId(campaignId);
  if (queryLocations.length === 0) {
    return { success: true, snapshotsCreated: 0, winsDetected: [], currentScore: calculateVisibilityScore([], 0) };
  }

  // Get previous snapshots for comparison (most recent per query-location)
  const previousSnapshots = await getLatestSnapshots(campaignId);

  // Run the rank check via DataForSEO
  const mentions = await searchLLMMentions(business.website, {
    limit: 500,
    targetType: "domain",
  });

  const mentionsByKeyword = new Map(
    mentions.map((m) => [m.keyword.toLowerCase(), m])
  );

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

  for (const ql of queryLocations) {
    const mention = mentionsByKeyword.get(ql.searchQuery.toLowerCase()) || null;

    const chatgptMentioned = mention?.llmResponses.chatgpt?.mentioned || false;
    const chatgptPosition = mention?.llmResponses.chatgpt?.position || null;
    const geminiMentioned = mention?.llmResponses.gemini?.mentioned || false;
    const geminiPosition = mention?.llmResponses.gemini?.position || null;
    const aiOverviewMentioned = mention?.llmResponses.aiOverview?.mentioned || false;
    const aiOverviewPosition = mention?.llmResponses.aiOverview?.position || null;

    // Create snapshot
    await createRankSnapshot({
      campaignId,
      queryLocationId: ql.id,
      chatgptMentioned,
      chatgptPosition,
      chatgptResponseSnippet: mention?.llmResponses.chatgpt?.snippet || null,
      geminiMentioned,
      geminiPosition,
      geminiResponseSnippet: mention?.llmResponses.gemini?.snippet || null,
      aiOverviewMentioned,
      aiOverviewPosition,
      aiOverviewResponseSnippet: mention?.llmResponses.aiOverview?.snippet || null,
      sourcesCited: mention
        ? [
            ...(mention.llmResponses.chatgpt?.sourcesCited || []),
            ...(mention.llmResponses.gemini?.sourcesCited || []),
            ...(mention.llmResponses.aiOverview?.sourcesCited || []),
          ]
        : null,
      checkType: "scheduled",
      checkedAt: new Date(),
    });

    newSnapshots.push({ chatgptMentioned, chatgptPosition, geminiMentioned, geminiPosition, aiOverviewMentioned, aiOverviewPosition });

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
          currentValue: chatgptPosition ? `Position ${chatgptPosition}` : "Mentioned",
          detectedAt: new Date().toISOString(),
        });
      } else if (chatgptMentioned && prev.chatgptMentioned && chatgptPosition && prev.chatgptPosition && chatgptPosition < prev.chatgptPosition) {
        winsDetected.push({
          queryLocationId: ql.id,
          searchQuery: ql.searchQuery,
          location: ql.location,
          platform: "chatgpt",
          winType: "position_improvement",
          previousValue: `Position ${prev.chatgptPosition}`,
          currentValue: `Position ${chatgptPosition}`,
          detectedAt: new Date().toISOString(),
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
          currentValue: geminiPosition ? `Position ${geminiPosition}` : "Mentioned",
          detectedAt: new Date().toISOString(),
        });
      } else if (geminiMentioned && prev.geminiMentioned && geminiPosition && prev.geminiPosition && geminiPosition < prev.geminiPosition) {
        winsDetected.push({
          queryLocationId: ql.id,
          searchQuery: ql.searchQuery,
          location: ql.location,
          platform: "gemini",
          winType: "position_improvement",
          previousValue: `Position ${prev.geminiPosition}`,
          currentValue: `Position ${geminiPosition}`,
          detectedAt: new Date().toISOString(),
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
          currentValue: aiOverviewPosition ? `Position ${aiOverviewPosition}` : "Mentioned",
          detectedAt: new Date().toISOString(),
        });
      } else if (aiOverviewMentioned && prev.aiOverviewMentioned && aiOverviewPosition && prev.aiOverviewPosition && aiOverviewPosition < prev.aiOverviewPosition) {
        winsDetected.push({
          queryLocationId: ql.id,
          searchQuery: ql.searchQuery,
          location: ql.location,
          platform: "aiOverview",
          winType: "position_improvement",
          previousValue: `Position ${prev.aiOverviewPosition}`,
          currentValue: `Position ${aiOverviewPosition}`,
          detectedAt: new Date().toISOString(),
        });
      }
    }

    // Update query-location with latest rank
    const isMentioned = chatgptMentioned || geminiMentioned || aiOverviewMentioned;
    await updateQueryLocation(ql.id, {
      currentRankChatGPT: chatgptMentioned ? (chatgptPosition ? `position_${chatgptPosition}` : "mentioned") : "not_mentioned",
      currentRankGemini: geminiMentioned ? (geminiPosition ? `position_${geminiPosition}` : "mentioned") : "not_mentioned",
      currentRankAIOverview: aiOverviewMentioned ? (aiOverviewPosition ? `position_${aiOverviewPosition}` : "mentioned") : "not_mentioned",
      lastRankCheckAt: new Date(),
      ...(isMentioned && !ql.firstMentionedAt ? { firstMentionedAt: new Date() } : {}),
    });

    snapshotsCreated++;
  }

  const currentScore = calculateVisibilityScore(newSnapshots, queryLocations.length);

  console.log(`[Rank Tracking] Check complete: ${snapshotsCreated} snapshots, ${winsDetected.length} wins, score: ${currentScore.overall}/100`);

  return { success: true, snapshotsCreated, winsDetected, currentScore };
}

// ============= Data Retrieval =============

/**
 * Get the latest snapshot per query-location for a campaign
 */
async function getLatestSnapshots(campaignId: number): Promise<Map<number, typeof rankSnapshots.$inferSelect>> {
  const db = await getDb();
  if (!db) return new Map();

  // Get all snapshots ordered by date desc, then deduplicate by queryLocationId
  const allSnapshots = await db.select().from(rankSnapshots)
    .where(eq(rankSnapshots.campaignId, campaignId))
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
 * Get baseline snapshots for a campaign (first check)
 */
async function getBaselineSnapshots(campaignId: number): Promise<Map<number, typeof rankSnapshots.$inferSelect>> {
  const db = await getDb();
  if (!db) return new Map();

  const baselineSnaps = await db.select().from(rankSnapshots)
    .where(and(
      eq(rankSnapshots.campaignId, campaignId),
      eq(rankSnapshots.checkType, "baseline")
    ))
    .orderBy(asc(rankSnapshots.checkedAt));

  const baseline = new Map<number, typeof rankSnapshots.$inferSelect>();
  for (const snap of baselineSnaps) {
    if (!baseline.has(snap.queryLocationId)) {
      baseline.set(snap.queryLocationId, snap);
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
  const totalQueries = queryLocations.length;
  if (totalQueries === 0) return [];

  // Get all snapshots in the time range
  const allSnapshots = await db.select().from(rankSnapshots)
    .where(and(
      eq(rankSnapshots.campaignId, campaignId),
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
    const score = calculateVisibilityScore(daySnapshots, totalQueries);

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
  const totalQueries = queryLocations.length;

  // Get latest snapshots
  const latestSnapshots = await getLatestSnapshots(campaignId);
  const baselineSnapshots = await getBaselineSnapshots(campaignId);

  // Calculate current score
  const currentSnaps = Array.from(latestSnapshots.values());
  const currentScore = calculateVisibilityScore(currentSnaps, totalQueries);

  // Calculate baseline score
  const baselineSnaps = Array.from(baselineSnapshots.values());
  const baselineScore = baselineSnaps.length > 0
    ? calculateVisibilityScore(baselineSnaps, totalQueries)
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
      totalQueries,
      mentionedQueries: prevTrend.mentionedQueries,
      averagePosition: null,
    };
  }

  // Build query details with change detection
  const queryDetails: QueryRankDetail[] = queryLocations.map((ql) => {
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
        currentValue: detail.chatgptPosition ? `Position ${detail.chatgptPosition}` : "Mentioned",
        detectedAt: new Date().toISOString(),
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
        currentValue: detail.geminiPosition ? `Position ${detail.geminiPosition}` : "Mentioned",
        detectedAt: new Date().toISOString(),
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
        currentValue: detail.aiOverviewPosition ? `Position ${detail.aiOverviewPosition}` : "Mentioned",
        detectedAt: new Date().toISOString(),
      });
    }
    if (detail.chatgptChange === "improved") {
      recentWins.push({
        queryLocationId: detail.queryLocationId,
        searchQuery: detail.searchQuery,
        location: detail.location,
        platform: "chatgpt",
        winType: "position_improvement",
        previousValue: "Lower position",
        currentValue: detail.chatgptPosition ? `Position ${detail.chatgptPosition}` : "Improved",
        detectedAt: new Date().toISOString(),
      });
    }
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
  };
}
