/**
 * Stripe billing service for the Agency Portal.
 *
 * Handles:
 *  - Creating a Stripe customer for a new agency
 *  - Charging the one-time $397 setup fee via PaymentIntent
 *  - Creating a per-client monthly subscription when an agency adds a client
 *  - Cancelling a client subscription when a client is removed
 *
 * The Stripe secret key is stored encrypted in the serviceKeys table under
 * the "stripe" service. We read and decrypt it at call time so it is never
 * held in memory longer than needed.
 */

import Stripe from "stripe";
import { getServiceKey } from "./db";
import { decrypt } from "./encryption";
import { AGENCY_PACKAGES, AGENCY_SETUP_FEE, getPackageBySlug } from "./agencyPackages";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Initialise a Stripe client using the live or test key stored in the DB.
 * Throws if no Stripe key has been configured.
 */
async function getStripeClient(): Promise<Stripe> {
  const record = await getServiceKey("stripe");
  if (!record) {
    throw new Error(
      "Stripe is not configured. Please add your Stripe secret key in Settings."
    );
  }

  const raw = decrypt(record.encryptedValue);
  let liveKey: string | undefined;
  let testKey: string | undefined;

  try {
    const parsed = JSON.parse(raw) as { liveKey?: string; testKey?: string };
    liveKey = parsed.liveKey;
    testKey = parsed.testKey;
  } catch {
    // Legacy: plain key stored directly
    liveKey = raw.startsWith("sk_live_") ? raw : undefined;
    testKey = raw.startsWith("sk_test_") ? raw : undefined;
  }

  const key = liveKey ?? testKey;
  if (!key) {
    throw new Error(
      "No valid Stripe secret key found. Please re-enter your Stripe key in Settings."
    );
  }

  return new Stripe(key, { apiVersion: "2026-03-25.dahlia" });
}

// ─── Customer ────────────────────────────────────────────────────────────────

/**
 * Create (or retrieve) a Stripe customer for an agency.
 * Returns the Stripe customer ID to store on the agency record.
 */
export async function createOrGetStripeCustomer(params: {
  agencyId: number;
  name: string;
  email: string;
  existingStripeCustomerId?: string | null;
}): Promise<string> {
  const stripe = await getStripeClient();

  if (params.existingStripeCustomerId) {
    // Verify the customer still exists
    try {
      const existing = await stripe.customers.retrieve(
        params.existingStripeCustomerId
      );
      if (!("deleted" in existing)) return existing.id;
    } catch {
      // Fall through and create a new one
    }
  }

  const customer = await stripe.customers.create({
    name: params.name,
    email: params.email,
    metadata: { agencyId: String(params.agencyId) },
  });

  return customer.id;
}

// ─── Setup Fee ───────────────────────────────────────────────────────────────

/**
 * Charge the one-time $397 agency setup fee.
 * Returns the PaymentIntent so the caller can store the ID and confirm status.
 *
 * NOTE: This creates a PaymentIntent in "manual" confirmation mode.
 * The front-end must confirm it using the client_secret returned here.
 * Alternatively, use the pre-built payment link (AGENCY_SETUP_FEE.paymentLinkUrl)
 * for a hosted checkout experience.
 */
export async function createSetupFeePaymentIntent(params: {
  stripeCustomerId: string;
  agencyName: string;
}): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const stripe = await getStripeClient();

  const intent = await stripe.paymentIntents.create({
    amount: AGENCY_SETUP_FEE.amount * 100, // $397 in cents
    currency: "usd",
    customer: params.stripeCustomerId,
    description: `Agency Setup Fee — ${params.agencyName}`,
    metadata: {
      type: "agency_setup_fee",
      agencyName: params.agencyName,
    },
    // Allow saving the payment method for future subscription charges
    setup_future_usage: "off_session",
  });

  return {
    clientSecret: intent.client_secret!,
    paymentIntentId: intent.id,
  };
}

// ─── Client Subscriptions ────────────────────────────────────────────────────

/**
 * Create a monthly subscription for a client business under an agency.
 * The subscription is billed to the agency's Stripe customer.
 *
 * @param packageSlug  "starter" | "growth" | "pro"
 * @returns            The Stripe subscription ID to store on the campaign/business record
 */
export async function createClientSubscription(params: {
  stripeCustomerId: string;
  packageSlug: string;
  agencyName: string;
  clientBusinessName: string;
  agencyId: number;
  businessId: number;
}): Promise<{ subscriptionId: string; status: string }> {
  const stripe = await getStripeClient();

  const pkg = getPackageBySlug(params.packageSlug);
  if (!pkg) {
    throw new Error(`Unknown agency package tier: ${params.packageSlug}`);
  }

  const subscription = await stripe.subscriptions.create({
    customer: params.stripeCustomerId,
    items: [{ price: pkg.stripePriceId }],
    metadata: {
      agencyId: String(params.agencyId),
      businessId: String(params.businessId),
      packageSlug: params.packageSlug,
      agencyName: params.agencyName,
      clientBusinessName: params.clientBusinessName,
    },
    description: `${params.agencyName} — ${params.clientBusinessName} (${pkg.name})`,
  });

  return {
    subscriptionId: subscription.id,
    status: subscription.status,
  };
}

/**
 * Cancel a client subscription when a client is removed from an agency.
 * Cancels at period end by default (no immediate proration).
 */
export async function cancelClientSubscription(params: {
  subscriptionId: string;
  immediately?: boolean;
}): Promise<void> {
  const stripe = await getStripeClient();

  if (params.immediately) {
    await stripe.subscriptions.cancel(params.subscriptionId);
  } else {
    await stripe.subscriptions.update(params.subscriptionId, {
      cancel_at_period_end: true,
    });
  }
}

/**
 * Retrieve the current status of a Stripe subscription.
 */
export async function getSubscriptionStatus(
  subscriptionId: string
): Promise<string> {
  const stripe = await getStripeClient();
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  return sub.status;
}
