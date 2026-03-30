/**
 * Smart Scheduler (Sprint 12)
 * 
 * Manages the transition between aggressive and maintenance training modes,
 * and auto-recovery when ranking drops are detected.
 * 
 * Modes:
 * - AGGRESSIVE: High-frequency training (multiple times per day) during first 30-60 days
 * - MODERATE: Medium-frequency (daily) once rankings are established
 * - MAINTENANCE: Low-frequency (weekly) once rankings are stable
 * 
 * Auto-Recovery:
 * - Monitors rank snapshots for drops
 * - Automatically escalates back to aggressive mode when drops detected
 * - Sends notification to admin when auto-recovery triggers
 * 
 * This module does NOT modify the existing scheduler.ts — it adds a layer on top
 * that manages campaign-level scheduling strategy.
 */

import { getDb } from "./db";
import { campaigns, rankSnapshots, businesses } from "../drizzle/schema";
import { eq, desc, and, gte, sql } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AggressivenessMode = "aggressive" | "moderate" | "maintenance";

export interface ScheduleConfig {
  mode: AggressivenessMode;
  trainingsPerDay: number;
  rankCheckFrequency: "daily" | "weekly" | "biweekly";
  retryIntervalMinutes: number; // Interval between training iterations
  iterationsPerSession: number; // How many iterations per training session
  description: string;
}

export interface CampaignScheduleStatus {
  campaignId: number;
  campaignName: string;
  businessName: string;
  currentMode: AggressivenessMode;
  recommendedMode: AggressivenessMode;
  modeChangeReason: string | null;
  daysSinceCreation: number;
  currentVisibilityScore: number | null;
  previousVisibilityScore: number | null;
  scoreTrend: "improving" | "stable" | "declining" | "unknown";
  autoRecoveryTriggered: boolean;
  nextScheduledAction: string;
}

export interface AutoRecoveryEvent {
  campaignId: number;
  previousMode: AggressivenessMode;
  newMode: AggressivenessMode;
  reason: string;
  visibilityDrop: number;
  triggeredAt: Date;
}

// ─── Schedule Configurations ─────────────────────────────────────────────────

const SCHEDULE_CONFIGS: Record<AggressivenessMode, ScheduleConfig> = {
  aggressive: {
    mode: "aggressive",
    trainingsPerDay: 3,
    rankCheckFrequency: "daily",
    retryIntervalMinutes: 15, // 15 min between iterations
    iterationsPerSession: 10, // 10 iterations per session
    description: "High-frequency training: 3 sessions/day, 10 iterations each, daily rank checks. Used during initial ramp-up (first 30-60 days) or after ranking drops.",
  },
  moderate: {
    mode: "moderate",
    trainingsPerDay: 1,
    rankCheckFrequency: "daily",
    retryIntervalMinutes: 30, // 30 min between iterations
    iterationsPerSession: 8,
    description: "Medium-frequency training: 1 session/day, 8 iterations, daily rank checks. Used once initial rankings are established.",
  },
  maintenance: {
    mode: "maintenance",
    trainingsPerDay: 0.14, // ~1 per week
    rankCheckFrequency: "weekly",
    retryIntervalMinutes: 60, // 60 min between iterations
    iterationsPerSession: 5,
    description: "Low-frequency training: 1 session/week, 5 iterations, weekly rank checks. Used once rankings are stable and strong.",
  },
};

/**
 * Get the schedule configuration for a given mode.
 */
export function getScheduleConfig(mode: AggressivenessMode): ScheduleConfig {
  return SCHEDULE_CONFIGS[mode];
}

/**
 * Get all schedule configurations.
 */
export function getAllScheduleConfigs(): Record<AggressivenessMode, ScheduleConfig> {
  return { ...SCHEDULE_CONFIGS };
}

// ─── Mode Recommendation Engine ──────────────────────────────────────────────

// Thresholds for mode transitions
const AGGRESSIVE_TO_MODERATE_THRESHOLD = 30; // Visibility score above 30 → moderate
const MODERATE_TO_MAINTENANCE_THRESHOLD = 60; // Visibility score above 60 → maintenance
const RECOVERY_DROP_THRESHOLD = 15; // Score drops more than 15 points → recovery
const MIN_DAYS_BEFORE_MODERATE = 14; // At least 14 days before considering moderate
const MIN_DAYS_BEFORE_MAINTENANCE = 30; // At least 30 days before considering maintenance
const MIN_SNAPSHOTS_FOR_TREND = 3; // Need at least 3 snapshots to detect a trend

/**
 * Analyze a campaign's rank history and recommend the optimal training mode.
 */
export async function recommendMode(campaignId: number): Promise<{
  recommendedMode: AggressivenessMode;
  reason: string;
  currentScore: number | null;
  previousScore: number | null;
  trend: "improving" | "stable" | "declining" | "unknown";
  autoRecoveryNeeded: boolean;
}> {
  const db = await getDb();
  if (!db) {
    return {
      recommendedMode: "aggressive" as AggressivenessMode,
      reason: "Database not available — defaulting to aggressive",
      currentScore: null,
      previousScore: null,
      trend: "unknown" as const,
      autoRecoveryNeeded: false,
    };
  }
  
  // Get campaign info
  const [campaign] = await db.select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  
  if (!campaign) {
    return {
      recommendedMode: "aggressive",
      reason: "Campaign not found — defaulting to aggressive",
      currentScore: null,
      previousScore: null,
      trend: "unknown",
      autoRecoveryNeeded: false,
    };
  }
  
  const currentMode = campaign.trainingAggressiveness as AggressivenessMode;
  const daysSinceCreation = Math.floor(
    (Date.now() - new Date(campaign.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  
  // Get recent rank snapshots for this campaign
  const recentSnapshots = await db.select()
    .from(rankSnapshots)
    .where(eq(rankSnapshots.campaignId, campaignId))
    .orderBy(desc(rankSnapshots.checkedAt))
    .limit(30); // Get more to group by check date
  
  // Group snapshots by check date (multiple query-locations per check)
  const checkGroups = groupSnapshotsByCheck(recentSnapshots);
  
  // Not enough data to make a recommendation
  if (checkGroups.length < MIN_SNAPSHOTS_FOR_TREND) {
    const latestScore = checkGroups.length > 0 ? checkGroups[0].score : null;
    return {
      recommendedMode: "aggressive",
      reason: `Only ${checkGroups.length} rank checks — need at least ${MIN_SNAPSHOTS_FOR_TREND} for trend analysis. Staying aggressive.`,
      currentScore: latestScore,
      previousScore: checkGroups.length > 1 ? checkGroups[1].score : null,
      trend: "unknown",
      autoRecoveryNeeded: false,
    };
  }
  
  const currentScore = checkGroups[0].score;
  const previousScore = checkGroups[1].score;
  
  // Calculate trend from last 3+ check groups
  const scores = checkGroups.slice(0, 5).map((g: { date: Date; score: number }) => g.score);
  const trend = calculateTrend(scores);
  
  // Check for ranking drop (auto-recovery trigger)
  const scoreDrop = previousScore - currentScore;
  if (scoreDrop >= RECOVERY_DROP_THRESHOLD && currentMode !== "aggressive") {
    return {
      recommendedMode: "aggressive",
      reason: `Visibility score dropped ${scoreDrop} points (${previousScore} → ${currentScore}). Auto-recovery: escalating to aggressive mode.`,
      currentScore,
      previousScore,
      trend: "declining",
      autoRecoveryNeeded: true,
    };
  }
  
  // Check for sustained decline (3+ consecutive drops)
  if (trend === "declining" && currentMode !== "aggressive") {
    const avgDrop = (scores[scores.length - 1] - scores[0]) / (scores.length - 1);
    if (Math.abs(avgDrop) > 3) {
      return {
        recommendedMode: "aggressive",
        reason: `Sustained visibility decline detected over ${scores.length} checks. Auto-recovery: escalating to aggressive mode.`,
        currentScore,
        previousScore,
        trend: "declining",
        autoRecoveryNeeded: true,
      };
    }
  }
  
  // Normal mode progression
  if (currentMode === "aggressive") {
    // Can we move to moderate?
    if (daysSinceCreation >= MIN_DAYS_BEFORE_MODERATE && currentScore >= AGGRESSIVE_TO_MODERATE_THRESHOLD && trend !== "declining") {
      return {
        recommendedMode: "moderate",
        reason: `Visibility score ${currentScore} exceeds threshold (${AGGRESSIVE_TO_MODERATE_THRESHOLD}) and campaign is ${daysSinceCreation} days old. Rankings established — transitioning to moderate.`,
        currentScore,
        previousScore,
        trend,
        autoRecoveryNeeded: false,
      };
    }
  }
  
  if (currentMode === "moderate" || (currentMode === "aggressive" && daysSinceCreation >= MIN_DAYS_BEFORE_MAINTENANCE)) {
    // Can we move to maintenance?
    if (daysSinceCreation >= MIN_DAYS_BEFORE_MAINTENANCE && currentScore >= MODERATE_TO_MAINTENANCE_THRESHOLD && trend === "stable") {
      return {
        recommendedMode: "maintenance",
        reason: `Visibility score ${currentScore} exceeds threshold (${MODERATE_TO_MAINTENANCE_THRESHOLD}), rankings stable for ${daysSinceCreation} days. Transitioning to maintenance mode.`,
        currentScore,
        previousScore,
        trend,
        autoRecoveryNeeded: false,
      };
    }
  }
  
  // Stay in current mode
  return {
    recommendedMode: currentMode,
    reason: `Current mode (${currentMode}) is appropriate. Score: ${currentScore}, Trend: ${trend}, Days: ${daysSinceCreation}.`,
    currentScore,
    previousScore,
    trend,
    autoRecoveryNeeded: false,
  };
}

/**
 * Group rank snapshots by check date and compute an aggregate visibility score.
 * Each "check" may have multiple snapshots (one per query-location).
 * Score: weighted average — ChatGPT mention = 40pts, Gemini = 30pts, AI Overview = 30pts.
 * Position bonus: pos 1 = full points, pos 2 = 85%, pos 3 = 75%, etc.
 */
function groupSnapshotsByCheck(snapshots: any[]): Array<{ date: Date; score: number }> {
  if (snapshots.length === 0) return [];
  
  // Group by checkedAt date (round to nearest hour)
  const groups = new Map<string, any[]>();
  for (const snap of snapshots) {
    const date = new Date(snap.checkedAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(snap);
  }
  
  // Compute score for each group
  const results: Array<{ date: Date; score: number }> = [];
  for (const [_key, snaps] of Array.from(groups.entries())) {
    let totalScore = 0;
    let count = 0;
    
    for (const snap of snaps) {
      let snapScore = 0;
      
      // ChatGPT (40% weight)
      if (snap.chatgptMentioned) {
        const posMultiplier = getPositionMultiplier(snap.chatgptPosition);
        snapScore += 40 * posMultiplier;
      }
      
      // Gemini (30% weight)
      if (snap.geminiMentioned) {
        const posMultiplier = getPositionMultiplier(snap.geminiPosition);
        snapScore += 30 * posMultiplier;
      }
      
      // AI Overview (30% weight)
      if (snap.aiOverviewMentioned) {
        const posMultiplier = getPositionMultiplier(snap.aiOverviewPosition);
        snapScore += 30 * posMultiplier;
      }
      
      totalScore += snapScore;
      count++;
    }
    
    results.push({
      date: new Date(snaps[0].checkedAt),
      score: count > 0 ? Math.round(totalScore / count) : 0,
    });
  }
  
  // Sort newest first
  results.sort((a, b) => b.date.getTime() - a.date.getTime());
  return results;
}

function getPositionMultiplier(position: number | null): number {
  if (!position || position <= 0) return 1;
  if (position === 1) return 1;
  if (position === 2) return 0.85;
  if (position === 3) return 0.75;
  if (position <= 5) return 0.6;
  return 0.4;
}

/**
 * Calculate trend direction from a series of scores (newest first).
 */
function calculateTrend(scores: number[]): "improving" | "stable" | "declining" {
  if (scores.length < 2) return "stable";
  
  // Reverse so oldest is first
  const chronological = [...scores].reverse();
  
  let improvements = 0;
  let declines = 0;
  
  for (let i = 1; i < chronological.length; i++) {
    const diff = chronological[i] - chronological[i - 1];
    if (diff > 2) improvements++;
    else if (diff < -2) declines++;
  }
  
  if (improvements > declines && improvements >= 2) return "improving";
  if (declines > improvements && declines >= 2) return "declining";
  return "stable";
}

// ─── Mode Transition ─────────────────────────────────────────────────────────

/**
 * Apply a mode change to a campaign. Updates the campaign record and returns
 * the new schedule configuration.
 */
export async function applyCampaignModeChange(
  campaignId: number,
  newMode: AggressivenessMode,
  reason: string
): Promise<{ success: boolean; config: ScheduleConfig; previousMode: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const [campaign] = await db.select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  
  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }
  
  const previousMode = campaign.trainingAggressiveness;
  const config = getScheduleConfig(newMode);
  
  // Update campaign
  await db.update(campaigns)
    .set({
      trainingAggressiveness: newMode,
      rankCheckFrequency: config.rankCheckFrequency,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId));
  
  console.log(`[Smart Scheduler] Campaign ${campaignId} mode changed: ${previousMode} → ${newMode}. Reason: ${reason}`);
  
  return {
    success: true,
    config,
    previousMode,
  };
}

// ─── Campaign Status ─────────────────────────────────────────────────────────

/**
 * Get the full scheduling status for a campaign.
 */
export async function getCampaignScheduleStatus(campaignId: number): Promise<CampaignScheduleStatus | null> {
  const db = await getDb();
  if (!db) return null;
  
  const [campaign] = await db.select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  
  if (!campaign) return null;
  
  const [business] = await db.select()
    .from(businesses)
    .where(eq(businesses.id, campaign.businessId))
    .limit(1);
  
  const recommendation = await recommendMode(campaignId);
  const currentMode = campaign.trainingAggressiveness as AggressivenessMode;
  const config = getScheduleConfig(currentMode);
  
  const daysSinceCreation = Math.floor(
    (Date.now() - new Date(campaign.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  
  // Determine next action
  let nextScheduledAction = "Training in progress";
  if (currentMode === "aggressive") {
    nextScheduledAction = `${config.trainingsPerDay} training sessions/day, rank check ${config.rankCheckFrequency}`;
  } else if (currentMode === "moderate") {
    nextScheduledAction = `${config.trainingsPerDay} training session/day, rank check ${config.rankCheckFrequency}`;
  } else {
    nextScheduledAction = `~1 training session/week, rank check ${config.rankCheckFrequency}`;
  }
  
  return {
    campaignId,
    campaignName: campaign.campaignName,
    businessName: business?.name || "Unknown",
    currentMode,
    recommendedMode: recommendation.recommendedMode,
    modeChangeReason: recommendation.recommendedMode !== currentMode ? recommendation.reason : null,
    daysSinceCreation,
    currentVisibilityScore: recommendation.currentScore,
    previousVisibilityScore: recommendation.previousScore,
    scoreTrend: recommendation.trend,
    autoRecoveryTriggered: recommendation.autoRecoveryNeeded,
    nextScheduledAction,
  };
}

/**
 * Get scheduling status for all active campaigns.
 */
export async function getAllCampaignScheduleStatuses(): Promise<CampaignScheduleStatus[]> {
  const db = await getDb();
  if (!db) return [];
  
  const activeCampaigns = await db.select({ id: campaigns.id })
    .from(campaigns)
    .where(
      sql`${campaigns.status} IN ('training', 'monitoring')`
    );
  
  const statuses: CampaignScheduleStatus[] = [];
  for (const campaign of activeCampaigns) {
    const status = await getCampaignScheduleStatus(campaign.id);
    if (status) statuses.push(status);
  }
  
  return statuses;
}

// ─── Auto-Recovery Check ─────────────────────────────────────────────────────

/**
 * Check all active campaigns for ranking drops and trigger auto-recovery.
 * This should be called periodically (e.g., after each rank check cycle).
 * 
 * Returns list of campaigns where auto-recovery was triggered.
 */
export async function checkAutoRecovery(): Promise<AutoRecoveryEvent[]> {
  const db = await getDb();
  if (!db) return [];
  
  const activeCampaigns = await db.select()
    .from(campaigns)
    .where(
      sql`${campaigns.status} IN ('training', 'monitoring')`
    );
  
  const recoveryEvents: AutoRecoveryEvent[] = [];
  
  for (const campaign of activeCampaigns) {
    const recommendation = await recommendMode(campaign.id);
    
    if (recommendation.autoRecoveryNeeded) {
      const previousMode = campaign.trainingAggressiveness as AggressivenessMode;
      
      // Apply the mode change
      await applyCampaignModeChange(
        campaign.id,
        "aggressive",
        recommendation.reason
      );
      
      const event: AutoRecoveryEvent = {
        campaignId: campaign.id,
        previousMode,
        newMode: "aggressive",
        reason: recommendation.reason,
        visibilityDrop: (recommendation.previousScore || 0) - (recommendation.currentScore || 0),
        triggeredAt: new Date(),
      };
      
      recoveryEvents.push(event);
      
      console.log(`[Smart Scheduler] AUTO-RECOVERY triggered for campaign ${campaign.id}: ${previousMode} → aggressive. Drop: ${event.visibilityDrop} points.`);
    }
  }
  
  return recoveryEvents;
}

// ─── Batch Mode Evaluation ───────────────────────────────────────────────────

/**
 * Evaluate all active campaigns and apply recommended mode changes.
 * This is the main "smart scheduling" loop that should run periodically.
 * 
 * Returns summary of changes made.
 */
export async function evaluateAndApplyModeChanges(): Promise<{
  evaluated: number;
  changed: number;
  recoveries: number;
  changes: Array<{
    campaignId: number;
    previousMode: string;
    newMode: string;
    reason: string;
  }>;
}> {
  const db = await getDb();
  if (!db) return { evaluated: 0, changed: 0, recoveries: 0, changes: [] };
  
  const activeCampaigns = await db.select()
    .from(campaigns)
    .where(
      sql`${campaigns.status} IN ('training', 'monitoring')`
    );
  
  const changes: Array<{
    campaignId: number;
    previousMode: string;
    newMode: string;
    reason: string;
  }> = [];
  
  let recoveries = 0;
  
  for (const campaign of activeCampaigns) {
    const recommendation = await recommendMode(campaign.id);
    const currentMode = campaign.trainingAggressiveness as AggressivenessMode;
    
    if (recommendation.recommendedMode !== currentMode) {
      const result = await applyCampaignModeChange(
        campaign.id,
        recommendation.recommendedMode,
        recommendation.reason
      );
      
      changes.push({
        campaignId: campaign.id,
        previousMode: result.previousMode,
        newMode: recommendation.recommendedMode,
        reason: recommendation.reason,
      });
      
      if (recommendation.autoRecoveryNeeded) recoveries++;
    }
  }
  
  console.log(`[Smart Scheduler] Evaluated ${activeCampaigns.length} campaigns: ${changes.length} mode changes, ${recoveries} auto-recoveries.`);
  
  return {
    evaluated: activeCampaigns.length,
    changed: changes.length,
    recoveries,
    changes,
  };
}
