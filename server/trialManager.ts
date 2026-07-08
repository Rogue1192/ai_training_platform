/**
 * Trial Manager
 *
 * 14-day risk-free trial logic.
 *
 * Flow:
 *  1. Client onboards via GHL → onboarding webhook → trial starts (15 query slots)
 *  2. Day 14 arrives → system automatically upgrades to their selected package
 *     (no manual action, no payment confirmation needed — GHL handles billing)
 *  3. After upgrade, run baseline scans for NEW query-location pairs (beyond the trial set)
 *     and send a "Your Full Package Has Started" email with before-videos for all new queries.
 *  4. ONLY exception: if GHL sends a cancellation webhook before day 14,
 *     the campaign stops and no upgrade happens.
 *
 * Package tier mapping (from GHL webhook `selectedPackage` field or packageTierSlug):
 *  starter → 15 query-location slots  → $199/mo (direct) / $99/mo (white-label)
 *  growth  → 30 query-location slots  → $299/mo (direct) / $149/mo (white-label)
 *  pro     → 50 query-location slots  → $349/mo (direct) / $179/mo (white-label)
 */

import { getDb } from "./db";
import { campaigns, businesses, clientDashboards } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Package Tier Definitions ─────────────────────────────────────────────────

export interface PackageTier {
  id: string;
  name: string;
  maxQuerySlots: number;  // Total query-location pairs budget (new model)
  maxQueries: number;     // Legacy: kept for backward compat
  maxLocations: number;   // Legacy: kept for backward compat
  monthlyPriceDirect: number;     // Retail/direct client price (cents)
  monthlyPriceWhiteLabel: number; // Agency wholesale price (cents)
}

export const PACKAGE_TIERS: Record<string, PackageTier> = {
  // Trial (default for all new campaigns) — 15 slots, same as Starter
  trial:   { id: "trial",   name: "14-Day Trial", maxQuerySlots: 15, maxQueries: 5,  maxLocations: 3,  monthlyPriceDirect: 0,     monthlyPriceWhiteLabel: 0     },
  // Current tier slugs (new query-budget model)
  starter: { id: "starter", name: "Starter",      maxQuerySlots: 15, maxQueries: 5,  maxLocations: 3,  monthlyPriceDirect: 19900, monthlyPriceWhiteLabel: 9900  },
  growth:  { id: "growth",  name: "Growth",       maxQuerySlots: 30, maxQueries: 6,  maxLocations: 5,  monthlyPriceDirect: 29900, monthlyPriceWhiteLabel: 14900 },
  pro:     { id: "pro",     name: "Pro",          maxQuerySlots: 50, maxQueries: 10, maxLocations: 5,  monthlyPriceDirect: 34900, monthlyPriceWhiteLabel: 17900 },
  // Legacy tier slugs (kept for backward compat with existing campaigns)
  starter_5loc:  { id: "starter_5loc",  name: "Starter — Territory Control",  maxQuerySlots: 25, maxQueries: 5,  maxLocations: 5,  monthlyPriceDirect: 69700, monthlyPriceWhiteLabel: 9900  },
  growth_5loc:   { id: "growth_5loc",   name: "Growth — Territory Control",   maxQuerySlots: 40, maxQueries: 8,  maxLocations: 5,  monthlyPriceDirect: 79700, monthlyPriceWhiteLabel: 14900 },
  pro_5loc:      { id: "pro_5loc",      name: "Pro — Territory Control",      maxQuerySlots: 50, maxQueries: 10, maxLocations: 5,  monthlyPriceDirect: 89700, monthlyPriceWhiteLabel: 17900 },
  starter_10loc: { id: "starter_10loc", name: "Starter — Market Dominance",   maxQuerySlots: 50, maxQueries: 5,  maxLocations: 10, monthlyPriceDirect: 109700, monthlyPriceWhiteLabel: 9900 },
  growth_10loc:  { id: "growth_10loc",  name: "Growth — Market Dominance",    maxQuerySlots: 80, maxQueries: 8,  maxLocations: 10, monthlyPriceDirect: 129700, monthlyPriceWhiteLabel: 14900 },
  pro_10loc:     { id: "pro_10loc",     name: "Pro — Market Dominance",       maxQuerySlots: 100, maxQueries: 10, maxLocations: 10, monthlyPriceDirect: 149700, monthlyPriceWhiteLabel: 17900 },
};

export const TRIAL_DURATION_DAYS = 14;

// ─── Trial Initialization ─────────────────────────────────────────────────────

/**
 * Initialize trial settings when a new campaign is created from a GHL webhook.
 * Sets trial limits (5q × 3loc) and 14-day upgrade date.
 */
export async function initializeTrial(
  campaignId: number,
  selectedPackage?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();
  const upgradeAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await db
    .update(campaigns)
    .set({
      trialStatus: "trial",
      trialStartedAt: now,
      trialExpiresAt: upgradeAt, // At this date, auto-upgrade fires
      maxQueries: PACKAGE_TIERS.trial.maxQueries,
      maxLocations: PACKAGE_TIERS.trial.maxLocations,
      maxQuerySlots: PACKAGE_TIERS.trial.maxQuerySlots,
      selectedPackage: selectedPackage || null,
      updatedAt: now,
    })
    .where(eq(campaigns.id, campaignId));

  console.log(`[TrialManager] Trial initialized for campaign ${campaignId}. Auto-upgrade scheduled: ${upgradeAt.toISOString()}`);
}

// ─── Scheduled Trial Check (runs daily) ──────────────────────────────────────

/**
 * Check all active trials and auto-upgrade any that have reached day 14.
 * Called by the smart scheduler daily.
 * 
 * If the campaign has a selectedPackage, upgrades to that package.
 * If no selectedPackage was set, upgrades to growth_5loc (default).
 */
export async function checkAndUpgradeTrials(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();

  const activeTrials = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.trialStatus, "trial"));

  let upgradedCount = 0;
  for (const campaign of activeTrials) {
    if (campaign.trialExpiresAt && now >= campaign.trialExpiresAt) {
      await autoUpgradeTrial(campaign.id, campaign.selectedPackage || undefined);
      upgradedCount++;
    }
  }

  if (upgradedCount > 0) {
    console.log(`[TrialManager] Auto-upgraded ${upgradedCount} trial(s) to paid packages.`);
  }
}

// ─── Auto-Upgrade at Day 14 ───────────────────────────────────────────────────

/**
 * Automatically upgrade a trial campaign to its selected package at day 14.
 *
 * After upgrading the DB limits, this function triggers an async expanded
 * baseline scan for NEW queries/locations and sends the upgrade email.
 */
export async function autoUpgradeTrial(
  campaignId: number,
  selectedPackage?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const packageKey = selectedPackage || "growth";
  const tier = PACKAGE_TIERS[packageKey] || PACKAGE_TIERS.growth;

  // ── Step 1: Upgrade DB limits ──────────────────────────────────────────────
  await db
    .update(campaigns)
    .set({
      trialStatus: "converted",
      trialConvertedAt: new Date(),
      maxQueries: tier.maxQueries,
      maxLocations: tier.maxLocations,
      maxQuerySlots: tier.maxQuerySlots,
      selectedPackage: packageKey,
      status: "training",
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId));

  console.log(`[TrialManager] Campaign ${campaignId} auto-upgraded to ${tier.name} (${tier.maxQuerySlots} query slots).`);

  // ── Step 2: Run expanded baseline for NEW queries/locations (async) ────────
  runExpandedBaselineAfterUpgrade(campaignId, tier).catch((err: any) => {
    console.error(`[TrialManager] Expanded baseline failed for campaign ${campaignId}:`, err?.message || err);
  });
}

/**
 * After a trial upgrades to a full package, run baseline scans for the NEW
 * query-location combos that weren't in the 5×3 trial set, then send the
 * "Your Full Package Has Started" email.
 *
 * Runs asynchronously after the DB upgrade so the scheduler isn't blocked.
 */
async function runExpandedBaselineAfterUpgrade(
  campaignId: number,
  tier: PackageTier
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // ── Fetch campaign + business ──────────────────────────────────────────
    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);
    if (!campaign) return;

    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, campaign.businessId))
      .limit(1);
    if (!business || !business.contactEmail) return;

    // ── Fetch existing query-locations (from trial) ────────────────────────
    const { getQueryLocationsByCampaignId } = await import("./dbCampaigns");
    const existingQls = await getQueryLocationsByCampaignId(campaignId);

    // ── Run keyword research to generate the FULL set of query-locations ──
    // The keyword research pipeline respects maxQueries/maxLocations from the
    // campaign record (now updated to the full package limits).
    // It will add NEW query-location rows without touching existing ones.
    try {
      const { runCampaignKeywordResearch } = await import("./keywordResearchPipeline");
      await runCampaignKeywordResearch(campaignId);
      console.log(`[TrialManager] Keyword research expanded for campaign ${campaignId}`);
    } catch (kwErr: any) {
      console.error(`[TrialManager] Keyword research expansion failed (non-fatal):`, kwErr.message);
    }

    // ── Identify NEW query-locations added by the expanded package ─────────
    const allQls = await getQueryLocationsByCampaignId(campaignId);
    const existingIds = new Set(existingQls.map((q) => q.id));
    const newQls = allQls.filter((q) => !existingIds.has(q.id));

    console.log(`[TrialManager] ${newQls.length} new query-locations added for campaign ${campaignId}`);

    // ── Get dashboard URL ──────────────────────────────────────────────────
    const [dashboard] = await db
      .select()
      .from(clientDashboards)
      .where(eq(clientDashboards.campaignId, campaignId))
      .limit(1);
    const baseUrl = process.env.APP_BASE_URL ?? "";
    const dashboardUrl = dashboard?.isActive && baseUrl
      ? `${baseUrl}/report/${dashboard.accessToken}`
      : undefined;

    // ── Send "Your Full Package Has Started" email ─────────────────────────
    const { sendPackageUpgradeEmail } = await import("./emailService");
    await sendPackageUpgradeEmail({
      businessName: business.name,
      contactName: business.contactName || business.name,
      contactEmail: business.contactEmail,
      packageName: tier.name,
      maxQuerySlots: tier.maxQuerySlots,
      dashboardUrl,
      newBaselineQueries: newQls.map((ql) => ({
        query: ql.searchQuery,
        location: ql.location,
      })),
    });

    console.log(`[TrialManager] Package upgrade email sent to ${business.contactEmail} for campaign ${campaignId}`);
  } catch (err: any) {
    console.error(`[TrialManager] runExpandedBaselineAfterUpgrade failed for campaign ${campaignId}:`, err?.message || err);
  }
}

// ─── GHL Cancellation Handler ─────────────────────────────────────────────────

/**
 * Called when GHL sends a cancellation webhook.
 * Stops the campaign — no upgrade will happen.
 * 
 * GHL should POST to: POST /api/ghl/cancel-trial
 * Body: { campaignId: number, ghlContactId?: string, reason?: string }
 */
export async function cancelTrial(
  campaignId: number,
  reason?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(campaigns)
    .set({
      trialStatus: "expired",
      status: "paused",
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId));

  console.log(`[TrialManager] Trial cancelled for campaign ${campaignId}. Reason: ${reason || "GHL cancellation webhook"}`);
}
