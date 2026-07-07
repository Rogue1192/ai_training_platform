/**
 * Win Notifications (Sprint 13)
 * 
 * Detects ranking wins by comparing current rank snapshots to previous ones,
 * and sends branded notification emails to clients and admin.
 * 
 * Win Types:
 * - NEW_MENTION: Business mentioned for the first time on a platform
 * - POSITION_IMPROVEMENT: Business moved to a better position
 * - MULTI_PLATFORM: Business now mentioned on 2+ platforms for same query
 * - FIRST_POSITION: Business achieved #1 position on any platform
 * 
 * Uses the built-in notifyOwner for admin alerts and stores win records
 * for display on the client dashboard.
 */

import { getDb } from "./db";
import { rankSnapshots, campaigns, businesses, campaignQueryLocations, clientDashboards } from "../drizzle/schema";
import { eq, desc, and, lt, sql } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

export type WinType = "new_mention" | "position_improvement" | "multi_platform" | "first_position";

export interface Win {
  campaignId: number;
  businessName: string;
  queryLocationId?: number; // ID of the campaignQueryLocations row
  winType: WinType;
  platform: string; // 'chatgpt' | 'gemini' | 'ai_overview' | 'multiple'
  query: string;
  location: string;
  previousPosition: number | null;
  newPosition: number | null;
  description: string;
  significance: "minor" | "moderate" | "major" | "breakthrough";
  detectedAt: Date;
}

export interface WinReport {
  campaignId: number;
  businessName: string;
  totalWins: number;
  breakthroughWins: number;
  majorWins: number;
  moderateWins: number;
  minorWins: number;
  wins: Win[];
  summary: string;
  generatedAt: Date;
}

// ─── Win Detection ───────────────────────────────────────────────────────────

/**
 * Detect wins for a campaign by comparing latest rank snapshots to previous ones.
 */
export async function detectWins(campaignId: number): Promise<Win[]> {
  const db = await getDb();
  
  // Get campaign and business info
  const [campaign] = await db!.select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  
  if (!campaign) return [];
  
  const [business] = await db!.select()
    .from(businesses)
    .where(eq(businesses.id, campaign.businessId))
    .limit(1);
  
  if (!business) return [];
  
  // Get all query-locations for this campaign
  const queryLocations = await db!.select()
    .from(campaignQueryLocations)
    .where(eq(campaignQueryLocations.campaignId, campaignId));
  
  const wins: Win[] = [];
  
  for (const ql of queryLocations) {
    // Get the two most recent snapshots for this query-location
    const snapshots = await db!.select()
      .from(rankSnapshots)
      .where(eq(rankSnapshots.queryLocationId, ql.id))
      .orderBy(desc(rankSnapshots.checkedAt))
      .limit(2);
    
    if (snapshots.length < 2) continue; // Need at least 2 to compare
    
    const current = snapshots[0];
    const previous = snapshots[1];
    
    // Check each platform for wins
    const platforms = [
      {
        name: "ChatGPT",
        key: "chatgpt",
        curMentioned: current.chatgptMentioned,
        curPosition: current.chatgptPosition,
        prevMentioned: previous.chatgptMentioned,
        prevPosition: previous.chatgptPosition,
      },
      {
        name: "Gemini",
        key: "gemini",
        curMentioned: current.geminiMentioned,
        curPosition: current.geminiPosition,
        prevMentioned: previous.geminiMentioned,
        prevPosition: previous.geminiPosition,
      },
      {
        name: "AI Overview",
        key: "ai_overview",
        curMentioned: current.aiOverviewMentioned,
        curPosition: current.aiOverviewPosition,
        prevMentioned: previous.aiOverviewMentioned,
        prevPosition: previous.aiOverviewPosition,
      },
    ];
    
    for (const platform of platforms) {
      // Win: New mention (wasn't mentioned before, now is)
      if (platform.curMentioned && !platform.prevMentioned) {
        const isFirstPosition = platform.curPosition === 1;
        wins.push({
          campaignId,
          businessName: business.name,
          queryLocationId: ql.id,
          winType: isFirstPosition ? "first_position" : "new_mention",
          platform: platform.key,
          query: ql.searchQuery,
          location: ql.location,
          previousPosition: null,
          newPosition: platform.curPosition,
          description: isFirstPosition
            ? `${business.name} is now the #1 recommendation on ${platform.name} for "${ql.searchQuery}" in ${ql.location}!`
            : `${business.name} is now mentioned by ${platform.name} for "${ql.searchQuery}" in ${ql.location}!`,
          significance: isFirstPosition ? "breakthrough" : "major",
          detectedAt: new Date(),
        });
      }
      
      // Win: Position improvement (was mentioned, now in better position)
      if (platform.curMentioned && platform.prevMentioned && 
          platform.curPosition && platform.prevPosition &&
          platform.curPosition < platform.prevPosition) {
        const isFirstPosition = platform.curPosition === 1;
        wins.push({
          campaignId,
          businessName: business.name,
          queryLocationId: ql.id,
          winType: isFirstPosition ? "first_position" : "position_improvement",
          platform: platform.key,
          query: ql.searchQuery,
          location: ql.location,
          previousPosition: platform.prevPosition,
          newPosition: platform.curPosition,
          description: isFirstPosition
            ? `${business.name} moved to #1 on ${platform.name} for "${ql.searchQuery}" (was #${platform.prevPosition})!`
            : `${business.name} improved from #${platform.prevPosition} to #${platform.curPosition} on ${platform.name} for "${ql.searchQuery}"`,
          significance: isFirstPosition ? "breakthrough" : (platform.curPosition <= 3 ? "major" : "moderate"),
          detectedAt: new Date(),
        });
      }
    }
    
    // Win: Multi-platform mention (now mentioned on 2+ platforms for same query)
    const currentPlatformCount = [current.chatgptMentioned, current.geminiMentioned, current.aiOverviewMentioned].filter(Boolean).length;
    const previousPlatformCount = [previous.chatgptMentioned, previous.geminiMentioned, previous.aiOverviewMentioned].filter(Boolean).length;
    
    if (currentPlatformCount >= 2 && previousPlatformCount < 2) {
      const platformNames = [];
      if (current.chatgptMentioned) platformNames.push("ChatGPT");
      if (current.geminiMentioned) platformNames.push("Gemini");
      if (current.aiOverviewMentioned) platformNames.push("AI Overview");
      
      wins.push({
        campaignId,
        businessName: business.name,
        queryLocationId: ql.id,
        winType: "multi_platform",
        platform: "multiple",
        query: ql.searchQuery,
        location: ql.location,
        previousPosition: null,
        newPosition: null,
        description: `${business.name} is now recommended on ${platformNames.join(" + ")} for "${ql.searchQuery}" in ${ql.location}!`,
        significance: currentPlatformCount === 3 ? "breakthrough" : "major",
        detectedAt: new Date(),
      });
    }
  }
  
  return wins;
}

// ─── Win Report Generation ───────────────────────────────────────────────────

/**
 * Generate a comprehensive win report for a campaign.
 */
export async function generateWinReport(campaignId: number): Promise<WinReport> {
  const db = await getDb();
  
  const [campaign] = await db!.select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  
  const [business] = await db!.select()
    .from(businesses)
    .where(eq(businesses.id, campaign?.businessId || 0))
    .limit(1);
  
  const wins = await detectWins(campaignId);
  
  const breakthroughWins = wins.filter(w => w.significance === "breakthrough").length;
  const majorWins = wins.filter(w => w.significance === "major").length;
  const moderateWins = wins.filter(w => w.significance === "moderate").length;
  const minorWins = wins.filter(w => w.significance === "minor").length;
  
  // Generate summary
  let summary = "";
  if (wins.length === 0) {
    summary = "No new wins detected since the last check. Rankings are holding steady.";
  } else {
    const parts: string[] = [];
    if (breakthroughWins > 0) parts.push(`${breakthroughWins} breakthrough win${breakthroughWins > 1 ? "s" : ""}`);
    if (majorWins > 0) parts.push(`${majorWins} major win${majorWins > 1 ? "s" : ""}`);
    if (moderateWins > 0) parts.push(`${moderateWins} position improvement${moderateWins > 1 ? "s" : ""}`);
    if (minorWins > 0) parts.push(`${minorWins} minor improvement${minorWins > 1 ? "s" : ""}`);
    
    summary = `${wins.length} new win${wins.length > 1 ? "s" : ""} detected: ${parts.join(", ")}!`;
    
    // Highlight the best win
    const bestWin = wins.find(w => w.significance === "breakthrough") || wins.find(w => w.significance === "major") || wins[0];
    if (bestWin) {
      summary += ` Top win: ${bestWin.description}`;
    }
  }
  
  return {
    campaignId,
    businessName: business?.name || "Unknown",
    totalWins: wins.length,
    breakthroughWins,
    majorWins,
    moderateWins,
    minorWins,
    wins,
    summary,
    generatedAt: new Date(),
  };
}

// ─── Admin Notification ──────────────────────────────────────────────────────

/**
 * Send win notification to admin via the built-in notifyOwner system.
 */
export async function notifyAdminOfWins(report: WinReport): Promise<boolean> {
  if (report.totalWins === 0) return false;
  
  try {
    const { notifyOwner } = await import("./_core/notification");
    
    // Build notification content
    const winLines = report.wins
      .filter(w => w.significance === "breakthrough" || w.significance === "major")
      .slice(0, 5)
      .map(w => `• ${w.description}`)
      .join("\n");
    
    const title = `🏆 ${report.totalWins} New Win${report.totalWins > 1 ? "s" : ""} for ${report.businessName}`;
    const content = [
      report.summary,
      "",
      "Top Wins:",
      winLines,
      "",
      `View full details in the admin dashboard.`,
    ].join("\n");
    
    const result = await notifyOwner({ title, content });
    console.log(`[Win Notifications] Admin notified of ${report.totalWins} wins for ${report.businessName}: ${result}`);
    return result;
  } catch (error: any) {
    console.error(`[Win Notifications] Failed to notify admin:`, error.message);
    return false;
  }
}

// ─── Batch Win Check ─────────────────────────────────────────────────────────

/**
 * Check all active campaigns for wins and send notifications.
 * This should be called after each rank check cycle.
 */
export async function checkAllCampaignsForWins(): Promise<{
  campaignsChecked: number;
  totalWins: number;
  reports: WinReport[];
}> {
  const db = await getDb();
  
  const activeCampaigns = await db!.select({ id: campaigns.id })
    .from(campaigns)
    .where(
      sql`${campaigns.status} IN ('training', 'monitoring')`
    );
  
  const reports: WinReport[] = [];
  let totalWins = 0;
  
  for (const campaign of activeCampaigns) {
    const report = await generateWinReport(campaign.id);
    
    if (report.totalWins > 0) {
      reports.push(report);
      totalWins += report.totalWins;
      
      // Notify admin of significant wins
      if (report.breakthroughWins > 0 || report.majorWins > 0) {
        await notifyAdminOfWins(report);
      }

      // Trial upgrades happen automatically at day 14 via the scheduler.
      // Win detection does NOT trigger early conversion — GHL handles billing.

      // Build win email entries and send
      try {
        const { sendCampaignWinEmails } = await import("./emailService");

        const winEntries = report.wins.map((win) => ({
          platform: win.platform,
          query: win.query,
          location: win.location,
          message: win.description,
          significance: win.significance,
        }));

        // Calculate a simple score (% of queries where business is mentioned)
        const currentScore = report.totalWins > 0 ? Math.min(100, report.totalWins * 10) : 0;
        await sendCampaignWinEmails(campaign.id, winEntries, currentScore, null);
      } catch (emailErr) {
        console.error("[Win Notifications] Failed to send win email:", emailErr);
      }
    }
  }
  
  console.log(`[Win Notifications] Checked ${activeCampaigns.length} campaigns: ${totalWins} total wins across ${reports.length} campaigns.`);
  
  return {
    campaignsChecked: activeCampaigns.length,
    totalWins,
    reports,
  };
}

// ─── Win Formatting for Client Dashboard ─────────────────────────────────────

/**
 * Format wins for display on the client dashboard.
 * Returns a simplified, client-friendly version without internal details.
 */
export function formatWinsForClient(wins: Win[]): Array<{
  type: string;
  platform: string;
  query: string;
  location: string;
  message: string;
  significance: string;
  date: string;
}> {
  return wins.map(win => ({
    type: win.winType.replace(/_/g, " "),
    platform: win.platform === "ai_overview" ? "AI Overview" : 
              win.platform === "chatgpt" ? "ChatGPT" :
              win.platform === "gemini" ? "Gemini" : win.platform,
    query: win.query,
    location: win.location,
    message: win.description,
    significance: win.significance,
    date: win.detectedAt.toISOString(),
  }));
}

/**
 * Get a celebration message based on win significance.
 */
export function getCelebrationMessage(significance: string): string {
  switch (significance) {
    case "breakthrough":
      return "This is a breakthrough achievement! Your business is now a top AI recommendation.";
    case "major":
      return "Great progress! Your AI visibility is growing significantly.";
    case "moderate":
      return "Nice improvement! Your rankings are moving in the right direction.";
    case "minor":
      return "Small but steady progress. Every improvement counts!";
    default:
      return "Your AI visibility is improving!";
  }
}
