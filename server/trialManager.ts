/**
 * Trial Manager
 *
 * Handles the 14-day risk-free trial logic:
 *  - Sets trial limits (5 queries × 3 locations) on campaign creation
 *  - Enforces trial limits during keyword research and campaign setup
 *  - Triggers Stripe payment link email when first win is detected
 *  - Expires trials after 14 days with no results (stops all activity)
 *  - Expands limits to full package after payment confirmed
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
  stripePriceId?: string; // Set in Railway env vars
}

export const PACKAGE_TIERS: Record<string, PackageTier> = {
  // Trial
  trial: { id: "trial", name: "14-Day Trial", maxQueries: 5, maxLocations: 3, monthlyPrice: 0 },
  // Territory Control (5 locations)
  starter_5loc: { id: "starter_5loc", name: "Starter — Territory Control", maxQueries: 5, maxLocations: 5, monthlyPrice: 697 },
  growth_5loc: { id: "growth_5loc", name: "Growth — Territory Control", maxQueries: 8, maxLocations: 5, monthlyPrice: 797 },
  pro_5loc: { id: "pro_5loc", name: "Pro — Territory Control", maxQueries: 10, maxLocations: 5, monthlyPrice: 897 },
  // Market Dominance (10 locations)
  starter_10loc: { id: "starter_10loc", name: "Starter — Market Dominance", maxQueries: 5, maxLocations: 10, monthlyPrice: 1097 },
  growth_10loc: { id: "growth_10loc", name: "Growth — Market Dominance", maxQueries: 8, maxLocations: 10, monthlyPrice: 1297 },
  pro_10loc: { id: "pro_10loc", name: "Pro — Market Dominance", maxQueries: 10, maxLocations: 10, monthlyPrice: 1497 },
};

export const TRIAL_DURATION_DAYS = 14;

// ─── Trial Initialization ─────────────────────────────────────────────────────

/**
 * Initialize trial settings when a new campaign is created from a webhook.
 * Sets trial limits and expiry date.
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
 * Returns false if expired or already converted.
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

// ─── Trial Expiry ─────────────────────────────────────────────────────────────

/**
 * Expire a trial — stops all campaign activity.
 * Called by the scheduler when 14 days pass with no win.
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

  // Send expiry notification email
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

// ─── Win-Triggered Payment Link ───────────────────────────────────────────────

/**
 * When a trial campaign gets its first win, send the Stripe payment link email.
 * Called by win detection logic.
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

  // Only fire for active trials that haven't already sent a payment link
  if (campaign.trialStatus !== "trial") return;
  if (campaign.stripePaymentLinkSentAt) return;

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, campaign.businessId))
    .limit(1);

  if (!business?.contactEmail) return;

  // Get the package tier they selected
  const packageKey = campaign.selectedPackage || "growth_5loc";
  const tier = PACKAGE_TIERS[packageKey] || PACKAGE_TIERS.growth_5loc;

  // Create Stripe payment link
  let paymentUrl = "";
  try {
    paymentUrl = await createStripePaymentLink(campaignId, business, tier);
  } catch (err) {
    console.error("[TrialManager] Failed to create Stripe payment link:", err);
    // Fall back to a generic URL
    paymentUrl = process.env.STRIPE_PAYMENT_LINK_FALLBACK || "https://aianswerforge.com/upgrade";
  }

  // Send the win + payment email
  try {
    const { sendTrialWinPaymentEmail } = await import("./emailService");
    await sendTrialWinPaymentEmail({
      businessName: business.name,
      contactName: business.contactName || business.name,
      contactEmail: business.contactEmail,
      packageName: tier.name,
      monthlyPrice: tier.monthlyPrice,
      maxQueries: tier.maxQueries,
      maxLocations: tier.maxLocations,
      paymentUrl,
    });

    // Mark payment link as sent
    await db
      .update(campaigns)
      .set({
        stripePaymentLinkSentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaignId));

    console.log(`[TrialManager] Payment link sent for campaign ${campaignId} (${tier.name} - $${tier.monthlyPrice}/mo)`);
  } catch (err) {
    console.error("[TrialManager] Failed to send trial win payment email:", err);
  }
}

// ─── Stripe Payment Link Creation ────────────────────────────────────────────

async function createStripePaymentLink(
  campaignId: number,
  business: { name: string; contactEmail: string | null },
  tier: PackageTier
): Promise<string> {
  // Use Stripe MCP or direct API to create a payment link
  // The price IDs are stored as Railway env vars per tier
  const priceIdEnvKey = `STRIPE_PRICE_ID_${tier.id.toUpperCase().replace(/-/g, "_")}`;
  const priceId = process.env[priceIdEnvKey];

  if (!priceId) {
    // Fall back to a static payment link if price IDs aren't configured yet
    const fallback = process.env.STRIPE_PAYMENT_LINK_FALLBACK;
    if (fallback) return `${fallback}?campaign=${campaignId}`;
    throw new Error(`Stripe price ID not configured for tier: ${tier.id}. Set ${priceIdEnvKey} in Railway.`);
  }

  // Dynamic import to avoid loading Stripe on every request
  const Stripe = (await import("stripe")).default;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

  const stripe = new Stripe(stripeKey, { apiVersion: "2026-03-25.dahlia" });

  // Create or retrieve customer
  let customerId: string | undefined;
  if (business.contactEmail) {
    const existing = await stripe.customers.list({ email: business.contactEmail, limit: 1 });
    if (existing.data.length > 0) {
      customerId = existing.data[0].id;
    } else {
      const customer = await stripe.customers.create({
        email: business.contactEmail,
        name: business.name,
        metadata: { campaignId: String(campaignId) },
      });
      customerId = customer.id;
    }
  }

  // Create payment link
  const paymentLink = await stripe.paymentLinks.create({
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { campaignId: String(campaignId) },
    after_completion: {
      type: "redirect",
      redirect: { url: `${process.env.APP_URL || "https://aianswerforge.com"}/payment-success?campaign=${campaignId}` },
    },
  });

  // Store Stripe customer ID on campaign
  const db = await getDb();
  if (db && customerId) {
    await db
      .update(campaigns)
      .set({ stripeCustomerId: customerId, updatedAt: new Date() })
      .where(eq(campaigns.id, campaignId));
  }

  return paymentLink.url;
}

// ─── Payment Confirmation (Stripe Webhook) ────────────────────────────────────

/**
 * Called when Stripe confirms payment (via Stripe webhook).
 * Upgrades the campaign from trial limits to full package limits.
 */
export async function confirmPaymentAndUpgrade(
  campaignId: number,
  stripeSubscriptionId: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) return;

  // Get the full package limits
  const packageKey = campaign.selectedPackage || "growth_5loc";
  const tier = PACKAGE_TIERS[packageKey] || PACKAGE_TIERS.growth_5loc;

  await db
    .update(campaigns)
    .set({
      trialStatus: "converted",
      trialConvertedAt: new Date(),
      maxQueries: tier.maxQueries,
      maxLocations: tier.maxLocations,
      stripeSubscriptionId,
      status: "training", // Resume full training
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId));

  console.log(`[TrialManager] Campaign ${campaignId} converted to ${tier.name}. Limits expanded to ${tier.maxQueries} queries × ${tier.maxLocations} locations.`);
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

  // Find all active trials that have expired
  const expiredTrials = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.trialStatus, "trial"));

  let expiredCount = 0;
  for (const campaign of expiredTrials) {
    if (campaign.trialExpiresAt && now > campaign.trialExpiresAt) {
      await expireTrial(campaign.id);
      expiredCount++;
    }
  }

  if (expiredCount > 0) {
    console.log(`[TrialManager] Expired ${expiredCount} trial(s) during scheduled check.`);
  }
}
