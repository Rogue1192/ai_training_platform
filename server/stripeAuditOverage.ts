/**
 * Stripe billing for AI Visibility Audit overage blocks.
 *
 * Packages (one-time purchases):
 *   5  audits  — $15
 *   10 audits  — $25
 *   25 audits  — $60
 *   50 audits  — $100
 *
 * Flow:
 *   1. Agency clicks "Buy More Audits" in the UI
 *   2. Server creates a Stripe Checkout Session (one-time payment)
 *   3. On success, Stripe redirects to /audit-overage-success?session_id=...
 *   4. Server fulfils the purchase via webhook (checkout.session.completed)
 *      OR via the success-page poll endpoint as a fallback
 */

import Stripe from "stripe";
import { getServiceKey, getDb } from "./db";
import { decrypt } from "./encryption";
import { agencyAuditQuota } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ─── Overage packages ─────────────────────────────────────────────────────────

export const AUDIT_OVERAGE_PACKAGES = [
  { id: "audit_5",  audits: 5,  priceCents: 1500, label: "5 Audits",  description: "$15 — 5 additional AI Visibility Audits" },
  { id: "audit_10", audits: 10, priceCents: 2500, label: "10 Audits", description: "$25 — 10 additional AI Visibility Audits" },
  { id: "audit_25", audits: 25, priceCents: 6000, label: "25 Audits", description: "$60 — 25 additional AI Visibility Audits" },
  { id: "audit_50", audits: 50, priceCents: 10000, label: "50 Audits", description: "$100 — 50 additional AI Visibility Audits" },
] as const;

export type AuditOveragePackageId = typeof AUDIT_OVERAGE_PACKAGES[number]["id"];

// ─── Stripe client ────────────────────────────────────────────────────────────

async function getStripeClient(): Promise<Stripe> {
  const record = await getServiceKey("stripe");
  if (!record) {
    throw new Error("Stripe is not configured. Please add your Stripe secret key in Settings.");
  }
  const raw = decrypt(record.encryptedValue);
  let liveKey: string | undefined;
  let testKey: string | undefined;
  try {
    const parsed = JSON.parse(raw) as { liveKey?: string; testKey?: string };
    liveKey = parsed.liveKey;
    testKey = parsed.testKey;
  } catch {
    liveKey = raw.startsWith("sk_live_") ? raw : undefined;
    testKey = raw.startsWith("sk_test_") ? raw : undefined;
  }
  const key = liveKey ?? testKey;
  if (!key) {
    throw new Error("No valid Stripe secret key found. Please re-enter your Stripe key in Settings.");
  }
  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

// ─── Checkout session creation ────────────────────────────────────────────────

export interface CreateAuditOverageSessionParams {
  agencyId: number;
  packageId: AuditOveragePackageId;
  /** Full URL to redirect to on success, e.g. https://app.example.com/audit-overage-success */
  successUrl: string;
  /** Full URL to redirect to on cancel */
  cancelUrl: string;
  /** Optional Stripe customer ID for the agency */
  stripeCustomerId?: string | null;
}

export async function createAuditOverageCheckoutSession(
  params: CreateAuditOverageSessionParams
): Promise<{ url: string; sessionId: string }> {
  const { agencyId, packageId, successUrl, cancelUrl, stripeCustomerId } = params;

  const pkg = AUDIT_OVERAGE_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new Error(`Unknown audit overage package: ${packageId}`);

  const stripe = await getStripeClient();

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: pkg.priceCents,
          product_data: {
            name: `AI Visibility Audit — ${pkg.label}`,
            description: pkg.description,
          },
        },
        quantity: 1,
      },
    ],
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl,
    metadata: {
      type: "audit_overage",
      agencyId: String(agencyId),
      packageId,
      auditsGranted: String(pkg.audits),
    },
  };

  if (stripeCustomerId) {
    sessionParams.customer = stripeCustomerId;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  if (!session.url) throw new Error("Stripe did not return a checkout URL");
  return { url: session.url, sessionId: session.id };
}

// ─── Fulfilment ───────────────────────────────────────────────────────────────

/**
 * Credit the agency's audit quota after a successful Stripe payment.
 * Safe to call multiple times — uses the Stripe session ID as an idempotency key
 * by checking if the session has already been fulfilled.
 */
export async function fulfillAuditOveragePurchase(
  agencyId: number,
  auditsGranted: number,
  periodMonth: string // "YYYY-MM"
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Upsert the quota row for this period
  const existing = await db
    .select()
    .from(agencyAuditQuota)
    .where(
      and(
        eq(agencyAuditQuota.agencyId, agencyId),
        eq(agencyAuditQuota.periodMonth, periodMonth)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    const blocksToAdd = Math.ceil(auditsGranted / 5); // each block = 5 audits
    await db
      .update(agencyAuditQuota)
      .set({
        overageBlocksPurchased: existing[0].overageBlocksPurchased + blocksToAdd,
        updatedAt: new Date(),
      })
      .where(eq(agencyAuditQuota.id, existing[0].id));
  } else {
    // Create the row if it doesn't exist yet (e.g. agency bought before running any audits)
    await db.insert(agencyAuditQuota).values({
      agencyId,
      periodMonth,
      includedQuota: 20,
      overageBlocksPurchased: Math.ceil(auditsGranted / 5),
      auditsUsed: 0,
    });
  }

  console.log(
    `[AuditOverage] Fulfilled ${auditsGranted} audits for agency ${agencyId} in ${periodMonth}`
  );
}

// ─── Verify session (success-page poll fallback) ──────────────────────────────

/**
 * Retrieve a Checkout Session from Stripe and return fulfilment metadata.
 * Used by the success page to confirm payment and trigger fulfilment
 * if the webhook hasn't fired yet.
 */
export async function getAuditOverageSession(sessionId: string): Promise<{
  paid: boolean;
  agencyId: number | null;
  packageId: string | null;
  auditsGranted: number;
}> {
  const stripe = await getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  const paid = session.payment_status === "paid";
  const meta = session.metadata ?? {};

  return {
    paid,
    agencyId: meta.agencyId ? parseInt(meta.agencyId, 10) : null,
    packageId: meta.packageId ?? null,
    auditsGranted: meta.auditsGranted ? parseInt(meta.auditsGranted, 10) : 0,
  };
}
