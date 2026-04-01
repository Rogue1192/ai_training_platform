/**
 * Trial Manager
 *
 * Handles the 14-day risk-free trial logic.
 * 
 * IMPORTANT: This system does NOT process payments directly.
 * All billing is handled externally through Go High Level (GHL).
 * 
 * Flow:
 *  1. Client onboards via GHL form → GHL fires onboarding webhook → trial starts (5q × 3loc)
 *  2. Client appears in AI results → win detected → admin notified to follow up in GHL
 *  3. Client pays in GHL → GHL fires conversion webhook → limits expand to full package
 *  4. 14 days pass with no win → trial expires → campaign pauses → client notified
 *
 * Package tier mapping (from GHL webhook `selectedPackage` field):
 *  starter_5loc  → 5 queries × 5 locations  → $697/mo
 *  growth_5loc   → 8 queries × 5 locations  → $797/mo
 *  pro_5loc      → 10 queries × 5 locations → $897/mo
 *  starter_10loc → 5 queries × 10 locations → $1,097/mo
 *  growth_10loc  → 8 queries × 10 locations → $1,297/mo
 *  pro_10loc     → 10 queries × 10 locations → $1,497/mo
 */

import { getDb } from "./db";
import { campaigns, businesses } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Package Tier Definitions ─────────────────────────────────────────────────

export interface PackageTier {
  id: string;
  name: string;
  maxQueries: number;
  maxLocations: number;
  monthlyPrice: number;
}

export const PACKAGE_TIERS: Record<string, PackageTier> = {
  // Trial (default for all new campaigns)
  trial: { id: "trial", name: "14-Day Trial", maxQueries: 5, maxLocations: 3, monthlyPrice: 0 },
  // Territory Control (5 locations)
  starter_5loc:  { id: "starter_5loc",  name: "Starter — Territory Control",  maxQueries: 5,  maxLocations: 5,  monthlyPrice: 697  },
  growth_5loc:   { id: "growth_5loc",   name: "Growth — Territory Control",   maxQueries: 8,  maxLocations: 5,  monthlyPrice: 797  },
  pro_5loc:      { id: "pro_5loc",      name: "Pro — Territory Control",      maxQueries: 10, maxLocations: 5,  monthlyPrice: 897  },
  // Market Dominance (10 locations)
  starter_10loc: { id: "starter_10loc", name: "Starter — Market Dominance",   maxQueries: 5,  maxLocations: 10, monthlyPrice: 1097 },
  growth_10loc:  { id: "growth_10loc",  name: "Growth — Market Dominance",    maxQueries: 8,  maxLocations: 10, monthlyPrice: 1297 },
  pro_10loc:     { id: "pro_10loc",     name: "Pro — Market Dominance",       maxQueries: 10, maxLocations: 10, monthlyPrice: 1497 },
};

export const TRIAL_DURATION_DAYS = 14;

// ─── Trial Initialization ─────────────────────────────────────────────────────

/**
 * Initialize trial settings when a new campaign is created from a GHL webhook.
 * Sets trial limits (5q × 3loc) and 14-day expiry date.
 */
export async function initializeTrial(
  campaignId: number,
  selectedPackage?: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + TRIAL_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await db
    .update(campaigns)
    .set({
      trialStatus: "trial",
      trialStartedAt: now,
      trialExpiresAt: expiresAt,
      maxQueries: PACKAGE_TIERS.trial.maxQueries,
      maxLocations: PACKAGE_TIERS.trial.maxLocations,
      selectedPackage: selectedPackage || null,
      updatedAt: now,
    })
    .where(eq(campaigns.id, campaignId));

  console.log(`[TrialManager] Trial initialized for campaign ${campaignId}. Expires: ${expiresAt.toISOString()}`);
}

// ─── Trial Status Check ───────────────────────────────────────────────────────

/**
 * Check if a campaign's trial is still active.
 */
export async function isTrialActive(campaignId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) return false;
  if (campaign.trialStatus === "converted" || campaign.trialStatus === "paid") return false;
  if (campaign.trialStatus === "expired") return false;

  // Check if trial has expired by date
  if (campaign.trialExpiresAt && new Date() > campaign.trialExpiresAt) {
    await expireTrial(campaignId);
    return false;
  }

  return true;
}

// ─── Trial Win Handler ────────────────────────────────────────────────────────

/**
 * Called when a trial campaign gets its first win.
 * Notifies the admin (via email) so they can follow up with the client in GHL.
 * Does NOT process any payment — billing is handled entirely in GHL.
 */
export async function handleTrialWin(campaignId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) return;

  // Only fire for active trials
  if (campaign.trialStatus !== "trial") return;

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, campaign.businessId))
    .limit(1);

  if (!business) return;

  const packageKey = campaign.selectedPackage || "growth_5loc";
  const tier = PACKAGE_TIERS[packageKey] || PACKAGE_TIERS.growth_5loc;

  // Notify admin so they can follow up in GHL
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    if (adminEmail) {
      const { sendTrialWinAdminNotification } = await import("./emailService");
      await sendTrialWinAdminNotification({
        businessName: business.name,
        contactName: business.contactName || business.name,
        contactEmail: business.contactEmail,
        selectedPackage: tier.name,
        monthlyPrice: tier.monthlyPrice,
        campaignId,
        adminEmail,
      });
    }
  } catch (err) {
    console.error("[TrialManager] Failed to send trial win admin notification:", err);
  }

  console.log(`[TrialManager] Trial win detected for campaign ${campaignId} (${business.name}). Admin notified.`);
}

// ─── GHL Conversion Webhook ───────────────────────────────────────────────────

/**
 * Called when GHL fires a conversion webhook confirming the client has paid.
 * Upgrades the campaign from trial limits to full package limits.
 * 
 * GHL should POST to: POST /api/ghl/trial-converted
 * Payload: { campaignId, selectedPackage, ghlContactId }
 */
export async function convertTrialToPaid(
  campaignId: number,
  selectedPackage?: string
): Promise<{ success: boolean; tier: PackageTier }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // Use the package from the conversion webhook, or fall back to what was selected at signup
  const packageKey = selectedPackage || campaign.selectedPackage || "growth_5loc";
  const tier = PACKAGE_TIERS[packageKey] || PACKAGE_TIERS.growth_5loc;

  await db
    .update(campaigns)
    .set({
      trialStatus: "converted",
      trialConvertedAt: new Date(),
      maxQueries: tier.maxQueries,
      maxLocations: tier.maxLocations,
      selectedPackage: packageKey,
      status: "training", // Resume/continue full training
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId));

  console.log(`[TrialManager] Campaign ${campaignId} converted to ${tier.name}. Limits: ${tier.maxQueries} queries × ${tier.maxLocations} locations.`);

  return { success: true, tier };
}

// ─── Trial Expiry ─────────────────────────────────────────────────────────────

/**
 * Expire a trial — pauses the campaign and notifies the client.
 */
export async function expireTrial(campaignId: number): Promise<void> {
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

  console.log(`[TrialManager] Trial expired for campaign ${campaignId}. Campaign paused.`);

  // Send expiry notification to client
  try {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
    const [business] = campaign
      ? await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1)
      : [];

    if (business?.contactEmail) {
      const { sendTrialExpiredEmail } = await import("./emailService");
      await sendTrialExpiredEmail({
        businessName: business.name,
        contactName: business.contactName || business.name,
        contactEmail: business.contactEmail,
      });
    }
  } catch (err) {
    console.error("[TrialManager] Failed to send trial expiry email:", err);
  }
}

// ─── Scheduled Trial Expiry Check ────────────────────────────────────────────

/**
 * Check all active trials and expire any that have passed the 14-day mark.
 * Called by the smart scheduler (runs daily).
 */
export async function checkAndExpireTrials(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const now = new Date();

  const activeTrials = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.trialStatus, "trial"));

  let expiredCount = 0;
  for (const campaign of activeTrials) {
    if (campaign.trialExpiresAt && now > campaign.trialExpiresAt) {
      await expireTrial(campaign.id);
      expiredCount++;
    }
  }

  if (expiredCount > 0) {
    console.log(`[TrialManager] Expired ${expiredCount} trial(s) during scheduled check.`);
  }
}
