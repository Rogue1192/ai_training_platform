import { Router, Request, Response } from "express";
import { serializeLocations } from "@shared/location";
import { z } from "zod";
import crypto from "crypto";
import {
  createWebhookLog,
  updateWebhookLog,
  createCampaign,
  getPackageTierBySlug,
  getPackageTierById,
  createCampaignQueryLocations,
  createClientDashboard,
  seedDefaultPackageTiers,
  getCampaignById,
  updateCampaign,
  getContentPagesByCampaignId,
  updateContentPage,
  getCampaignsByBusinessId,
} from "./dbCampaigns";
import { getDb, getServiceKey } from "./db";
import { businesses, users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ============= Webhook Payload Schema =============

const onboardingPayloadSchema = z.object({
  // Business info
  businessName: z.string().min(1, "Business name is required"),
  websiteUrl: z.string().url("Valid website URL is required"),
  // Industry is optional: the GHL intake survey doesn't collect it. When omitted
  // we default businessType to "general" server-side (keyword research uses the
  // same fallback, and no downstream pipeline step hard-requires it).
  industry: z.string().optional(),
  contactEmail: z.string().email("Valid contact email is required"),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),

  // Location data. Either pass a `locations` array, OR pass `city` + `state`
  // (the GHL survey sends them as two separate fields) and we compose
  // ["City, ST"] server-side. At least one location must resolve from one of
  // these — enforced in the handler, not the schema, so we can accept either.
  locations: z.array(z.string().min(1)).optional(),
  city: z.string().optional(),
  state: z.string().optional(),

  // Package selection — accept either slug or ID
  packageTierSlug: z.string().optional(),
  packageTierId: z.number().optional(),

  // Optional: specific search queries (if client/salesperson already knows them)
  // These will be distributed across all provided locations up to the plan's maxQuerySlots.
  searchQueries: z.array(z.string()).optional(),

  // Optional: per-location query map for clients who want different queries per city
  // e.g. [{"location": "Atlanta, GA", "queries": ["roof repair Atlanta", ...]}, ...]
  // Total pairs across all locations must not exceed the plan's maxQuerySlots.
  locationQueryMap: z.array(z.object({
    location: z.string().min(1),
    queries: z.array(z.string().min(1)),
  })).optional(),

  // Optional: billing type override for this campaign
  // 'white_label' = agency wholesale, 'direct' = retail, 'legacy' = costs only
  billingType: z.enum(["white_label", "direct", "legacy"]).optional(),

  // Optional: additional business info for credibility research
  yearsFounded: z.number().optional(),
  certifications: z.array(z.string()).optional(),
  awards: z.array(z.string()).optional(),
  bbbRating: z.string().optional(),
  googleReviewCount: z.number().optional(),
  googleRating: z.number().optional(),
  licenses: z.string().optional(),
  warranties: z.string().optional(),
  differentiators: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
  description: z.string().optional(),

  // Package selected during onboarding (from GHL form)
  // e.g., 'starter_5loc' | 'growth_5loc' | 'pro_5loc' | 'starter_10loc' | 'growth_10loc' | 'pro_10loc'
  selectedPackage: z.string().optional(),

  // ── Agency linkage (optional) ──────────────────────────────────────────────
  // When provided, the business is linked to this agency (white-label client).
  // When omitted, the business is treated as a direct/retail client (agencyId = null).
  agencyId: z.number().int().positive().optional(),
  // Agency billing tier — used to set agencyPackageTier on the business record.
  // Accepts 'starter' | 'growth' | 'pro'. Falls back to packageTierSlug if omitted.
  agencyPackageTier: z.enum(['starter', 'growth', 'pro']).optional(),

  // Optional: internal source tag.
  //   "rogue"       = Rogue Business Marketing internal/test campaigns (noCharge=true)
  //   "ranklocal"   = Rank Local clients billed through Rank Local (noCharge=true)
  //   "answerforge" = Direct AI AnswerForge clients billed separately (noCharge=false, tracked in cost reporting)
  //   Any other string = future agency or partner tags (accepted without code changes)
  source: z.string().optional(),

  // Optional: specialties / unique expertise — hammered into every MiniMax training iteration
  specialties: z.string().optional(),

  // Optional: credibility verification URLs — BBB profile, certification body pages, award listings, etc.
  // Accept either a pre-serialized JSON string '[{"label":"BBB","url":"https://..."}]'
  // or a structured array of {label, url} objects. Normalized to JSON string for storage.
  credibilityUrls: z.union([
    z.string(),
    z.array(z.object({ label: z.string(), url: z.string().url() })),
  ]).optional(),

  // Optional: promo code — applied at campaign creation for free trials or discounts
  promoCode: z.string().optional(),

  // Optional: webhook secret for authentication
  webhookSecret: z.string().optional(),
});

export type OnboardingPayload = z.infer<typeof onboardingPayloadSchema>;

// ============= Webhook Authentication =============

/**
 * Verify inbound webhook secret.
 * Priority order:
 *   1. DB-stored inbound secret (serviceKeys, service='whitelabel', metadata.inboundWebhookSecret)
 *   2. WEBHOOK_SECRET environment variable (Railway fallback)
 * If neither is configured, authentication is skipped (open/dev mode).
 * Uses timing-safe comparison to prevent timing attacks.
 */
async function verifyWebhookAuth(req: Request): Promise<{ valid: boolean; error?: string }> {
  // 1. Try DB-stored inbound secret first (stored as JSON inside encryptedValue)
  let configuredSecret: string | undefined;
  try {
    const wlKey = await getServiceKey("whitelabel");
    if (wlKey?.encryptedValue) {
      const { decrypt } = await import("./encryption");
      const parsed = JSON.parse(decrypt(wlKey.encryptedValue)) as Record<string, string>;
      configuredSecret = parsed.inboundWebhookSecret || undefined;
    }
  } catch {
    // DB unavailable or decrypt failed — fall through to env var
  }
  // 2. Fall back to WEBHOOK_SECRET env var
  if (!configuredSecret) {
    configuredSecret = process.env.WEBHOOK_SECRET;
  }
  if (!configuredSecret) {
    // No secret configured anywhere — open mode (acceptable for development)
    return { valid: true };
  }

  const headerSecret = req.headers["x-webhook-secret"] as string;
  const bodySecret = req.body?.webhookSecret;
  const providedSecret = headerSecret || bodySecret;

  if (!providedSecret) {
    return { valid: false, error: "Missing webhook secret. Provide x-webhook-secret header or webhookSecret in body." };
  }

  // Timing-safe comparison to prevent timing attacks
  const provided = Buffer.from(providedSecret);
  const expected = Buffer.from(configuredSecret);
  const isValid =
    provided.length === expected.length &&
    crypto.timingSafeEqual(provided, expected);
  if (!isValid) {
    return { valid: false, error: "Invalid webhook secret." };
  }

  return { valid: true };
}

// ============= Webhook Router =============

export function createWebhookRouter(): Router {
  const router = Router();

  // Health check for the webhook endpoint
  router.get("/api/webhooks/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", endpoint: "/api/webhooks/onboarding", method: "POST" });
  });

  // Main onboarding webhook endpoint
  router.post("/api/webhooks/onboarding", async (req: Request, res: Response) => {
    const ipAddress = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "";

    // Log the incoming webhook immediately
    let webhookLog;
    try {
      webhookLog = await createWebhookLog({
        source: "ghl",
        payload: req.body,
        status: "received",
        ipAddress,
      });
    } catch (err) {
      console.error("[Webhook] Failed to log webhook:", err);
      res.status(500).json({ error: "Internal error logging webhook" });
      return;
    }

    try {
      // ISSUE-008 FIX: Verify webhook authentication (async — checks DB then env var)
      const authResult = await verifyWebhookAuth(req);
      if (!authResult.valid) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: `Auth failed: ${authResult.error}`,
        });
        res.status(401).json({ error: authResult.error });
        return;
      }

      // Update status to processing
      await updateWebhookLog(webhookLog.id, { status: "processing" });

      // Validate the payload
      const parseResult = onboardingPayloadSchema.safeParse(req.body);
      if (!parseResult.success) {
        const errorMsg = parseResult.error.issues.map((e: any) => `${e.path.join(".")}: ${e.message}`).join("; ");
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: `Validation failed: ${errorMsg}`,
        });
        res.status(400).json({ error: "Invalid payload", details: parseResult.error.issues });
        return;
      }

      const payload = parseResult.data;

      // Compose the effective location list. The GHL survey sends city + state as
      // two separate fields; other callers may send a `locations` array. Prefer an
      // explicit array; otherwise build ["City, ST"] from city + state.
      //
      // serializeLocations joins entries with ";", and the parser splits stored
      // values on ";", so a caller-supplied ";" would fragment one location into
      // several (phantom targets + prompt-injection into training prompts). Strip
      // ";" from every location input and cap length before composing.
      const sanitizeLoc = (s: string, max: number) =>
        s.replace(/;/g, ",").replace(/\s+/g, " ").trim().slice(0, max);
      const finalLocations: string[] = (payload.locations ?? [])
        .map((l) => sanitizeLoc(l, 140))
        .filter(Boolean);
      if (
        finalLocations.length === 0 &&
        payload.city?.trim() &&
        payload.state?.trim()
      ) {
        const city = sanitizeLoc(payload.city, 100);
        const state = sanitizeLoc(payload.state, 40);
        if (city && state) finalLocations.push(`${city}, ${state}`);
      }
      if (finalLocations.length === 0) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage:
            "At least one location is required (provide `locations[]` or both `city` and `state`).",
        });
        res.status(400).json({
          error: "At least one location is required (locations[] or city + state).",
        });
        return;
      }

      // Industry is optional from GHL; default to "general". Keyword research uses
      // the same fallback and no downstream step hard-requires businessType.
      const industry = payload.industry?.trim() || "general";

      // Ensure default package tiers exist
      await seedDefaultPackageTiers();

      // Resolve the package tier. The GHL survey defers program/package selection
      // to a post-submit step, so the webhook may arrive without a tier.
      //  - No tier provided at all → default to "starter" (5×3), which matches the
      //    trial limits initializeTrial() applies anyway.
      //  - An explicit tier that doesn't resolve (e.g. a typo'd slug) → 400, so an
      //    integration bug surfaces instead of being silently downgraded.
      const tierExplicitlyProvided =
        payload.packageTierId != null || payload.packageTierSlug != null;
      let packageTier;
      if (payload.packageTierId) {
        packageTier = await getPackageTierById(payload.packageTierId);
      } else if (payload.packageTierSlug) {
        packageTier = await getPackageTierBySlug(payload.packageTierSlug);
      }

      if (!packageTier && tierExplicitlyProvided) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: "Package tier not found. Provide a valid packageTierSlug or packageTierId.",
        });
        res.status(400).json({ error: "Package tier not found" });
        return;
      }

      // No tier supplied (GHL pre-program-selection) — fall back to "starter".
      if (!packageTier) {
        packageTier = await getPackageTierBySlug("starter");
      }

      if (!packageTier) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage:
            "Package tier could not be resolved (default 'starter' tier missing). Seed package tiers or provide a valid packageTierSlug/packageTierId.",
        });
        res.status(400).json({ error: "Package tier not found" });
        return;
      }

      // Get the owner user (the admin who runs the platform)
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const ownerUsers = await db
        .select()
        .from(users)
        .where(eq(users.role, "admin"))
        .limit(1);

      if (ownerUsers.length === 0) {
        throw new Error("No admin user found. Please create an admin account first.");
      }

      const ownerId = ownerUsers[0]!.id;

      // Check if business already exists (by website URL)
      const existingBusinesses = await db
        .select()
        .from(businesses)
        .where(eq(businesses.website, payload.websiteUrl))
        .limit(1);

      let businessId: number;

      if (existingBusinesses.length > 0) {
        businessId = existingBusinesses[0]!.id;
        // ISSUE-011 FIX: Update ALL fields from the webhook, not just a few
        const updateFields: Record<string, any> = {
          businessType: industry,
          contactEmail: payload.contactEmail,
          updatedAt: new Date(),
        };
        if (payload.contactName) updateFields.contactName = payload.contactName;
        if (payload.contactPhone) updateFields.phone = payload.contactPhone;
        if (payload.yearsFounded) updateFields.yearsInBusiness = payload.yearsFounded;
        if (payload.certifications) updateFields.certifications = payload.certifications.join(", ");
        if (payload.awards) updateFields.awards = payload.awards.join(", ");
        if (payload.bbbRating) updateFields.bbbRating = payload.bbbRating;
        // Store ALL locations, ";" -delimited
        updateFields.location = serializeLocations(finalLocations);
        // credibilityUrls: normalize to JSON string for storage
        if (payload.credibilityUrls !== undefined) {
          updateFields.credibilityUrls = typeof payload.credibilityUrls === 'string'
            ? payload.credibilityUrls
            : JSON.stringify(payload.credibilityUrls);
        }
        // Internal source tag for filtering
        if (payload.source) updateFields.internalSource = payload.source;
        if (payload.specialties) updateFields.specialties = payload.specialties;
        if (payload.licenses) updateFields.licenses = payload.licenses;
        if (payload.warranties) updateFields.warranties = payload.warranties;
        if (payload.differentiators) updateFields.differentiators = payload.differentiators;
        if (payload.address) updateFields.address = payload.address;
        if (payload.notes) updateFields.notes = payload.notes;
        if (payload.description) updateFields.description = payload.description;

        await db.update(businesses).set(updateFields).where(eq(businesses.id, businessId));
      } else {
        // Create new business record
        const newBusiness = await db
          .insert(businesses)
          .values({
            userId: ownerId,
            name: payload.businessName,
            website: payload.websiteUrl,
            businessType: industry,
            contactEmail: payload.contactEmail,
            contactName: payload.contactName || null,
            phone: payload.contactPhone || null,
            // ISSUE-014 FIX: Store ALL locations, ";"-delimited so a "City, ST"
            // location is never re-split on its internal comma.
            location: serializeLocations(finalLocations),
            yearsInBusiness: payload.yearsFounded || null,
            certifications: payload.certifications?.join(", ") || null,
            awards: payload.awards?.join(", ") || null,
            bbbRating: payload.bbbRating || null,
            // credibilityUrls: normalize to JSON string for storage
            credibilityUrls: payload.credibilityUrls !== undefined
              ? (typeof payload.credibilityUrls === 'string' ? payload.credibilityUrls : JSON.stringify(payload.credibilityUrls))
              : null,
            internalSource: payload.source || null,
            specialties: payload.specialties || null,
            licenses: payload.licenses || null,
            warranties: payload.warranties || null,
            differentiators: payload.differentiators || null,
            address: payload.address || null,
            notes: payload.notes || null,
            description: payload.description || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        businessId = newBusiness[0]!.id;
      }

      // ISSUE-012 FIX: Check for existing active campaign before creating a new one
      const existingCampaigns = await getCampaignsByBusinessId(businessId);
      const activeCampaign = existingCampaigns.find(
        (c) => c.status !== "monitoring" && c.status !== "error" && c.status !== "paused"
      );

      if (activeCampaign) {
        // Return the existing campaign instead of creating a duplicate
        await updateWebhookLog(webhookLog.id, {
          status: "completed",
          businessId,
          campaignId: activeCampaign.id,
          processedAt: new Date(),
        });

        // Get existing dashboard token
        const { getClientDashboardsByCampaignId } = await import("./dbCampaigns");
        const dashboards = await getClientDashboardsByCampaignId(activeCampaign.id);
        const existingToken = dashboards.find((d) => d.isActive)?.accessToken || "";

        console.log(
          `[Webhook] Existing active campaign found: ${activeCampaign.campaignName} (ID: ${activeCampaign.id}) for business ${payload.businessName}`
        );

        res.status(200).json({
          success: true,
          campaignId: activeCampaign.id,
          businessId,
          dashboardToken: existingToken,
          // ISSUE-006 FIX: Use correct route path /report/ instead of /dashboard/
          dashboardUrl: `${req.protocol}://${req.get("host")}/report/${existingToken}`,
          message: `Active campaign already exists: "${activeCampaign.campaignName}". No duplicate created.`,
          existing: true,
        });
        return;
      }

      // Resolve the query-slot budget from the package tier
      const resolvedMaxQuerySlots = packageTier.maxQuerySlots || (packageTier.maxQueries * packageTier.maxLocations);

      // Validate and apply promo code if provided
      let appliedPromo: { id: number; code: string; noCharge: boolean; trialDays: number } | null = null;
      if (payload.promoCode) {
        const { promoCodes } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const [promo] = await db.select().from(promoCodes)
          .where(eq(promoCodes.code, payload.promoCode.toUpperCase().trim()))
          .limit(1);
        if (promo && (!promo.expiresAt || new Date() <= promo.expiresAt) && (promo.maxUses === null || promo.usedCount < promo.maxUses)) {
          appliedPromo = { id: promo.id, code: promo.code, noCharge: promo.noCharge, trialDays: promo.trialDays || 30 };
          // Increment usedCount
          await db.update(promoCodes).set({ usedCount: promo.usedCount + 1, updatedAt: new Date() }).where(eq(promoCodes.id, promo.id));
        }
      }

      // Create the campaign
      const campaign = await createCampaign({
        userId: ownerId,
        businessId,
        packageTierId: packageTier.id,
        campaignName: `${payload.businessName} - AI Visibility`,
        status: "pending",
        trainingAggressiveness: "aggressive",
        rankCheckFrequency: "weekly",
        sourceWebhookId: webhookLog.id,
        errorCount: 0,
        // Trial defaults — overridden by initializeTrial() below
        trialStatus: "trial",
        maxQueries: packageTier.maxQueries,
        maxLocations: packageTier.maxLocations,
        maxQuerySlots: resolvedMaxQuerySlots,
        selectedPackage: payload.selectedPackage || null,
        billingType: payload.billingType || (payload.agencyId ? "white_label" : "direct"),
        // noCharge logic:
        //   rogue / ranklocal = billed outside this platform — do not track as billable cost here
        //   answerforge / no source / anything else = direct client, costs tracked in AI AnswerForge billing
        //   promo code with noCharge=true overrides to noCharge regardless of source
        noCharge: (payload.source === "rogue" || payload.source === "ranklocal" || appliedPromo?.noCharge) ? true : false,
        promoCodeId: appliedPromo?.id || null,
        promoCodeUsed: appliedPromo?.code || null,
      });

      // Initialize 14-day trial
      const { initializeTrial } = await import("./trialManager");
      await initializeTrial(campaign.id, payload.selectedPackage);

      // Build the query×location matrix
      // Priority: locationQueryMap > searchQueries (distributed across all locations) > auto-generate in keyword research phase
      const entries: { campaignId: number; searchQuery: string; location: string; trainingStatus: "pending"; trainingSessions: number }[] = [];
      let slotsUsed = 0;

      if (payload.locationQueryMap && payload.locationQueryMap.length > 0) {
        // Per-location query map — most flexible option
        for (const lqEntry of payload.locationQueryMap) {
          for (const q of lqEntry.queries) {
            if (slotsUsed >= resolvedMaxQuerySlots) break;
            entries.push({ campaignId: campaign.id, searchQuery: q, location: lqEntry.location, trainingStatus: "pending", trainingSessions: 0 });
            slotsUsed++;
          }
          if (slotsUsed >= resolvedMaxQuerySlots) break;
        }
      } else if (payload.searchQueries && payload.searchQueries.length > 0 && finalLocations.length > 0) {
        // Flat query list — distribute across all locations up to budget
        for (const query of payload.searchQueries) {
          for (const location of finalLocations) {
            if (slotsUsed >= resolvedMaxQuerySlots) break;
            entries.push({ campaignId: campaign.id, searchQuery: query, location, trainingStatus: "pending", trainingSessions: 0 });
            slotsUsed++;
          }
          if (slotsUsed >= resolvedMaxQuerySlots) break;
        }
      }
      // If no queries provided, keyword research phase will auto-generate them

      if (entries.length > 0) {
        await createCampaignQueryLocations(entries);

        // Seed trainingQueries from the pre-set queries so the V3 sprint scheduler
        // has something to train on. This mirrors what approveQueryReview does for
        // the standard (auto-generate) path.
        try {
          const { getDb } = await import('./db');
          const db = await getDb();
          if (db) {
            const { trainingQueries: tqTable } = await import('../drizzle/schema');
            const uniqueQueries = Array.from(new Set(entries.map(e => e.searchQuery).filter(Boolean)));
            for (let i = 0; i < uniqueQueries.length; i++) {
              await db.insert(tqTable).values({
                campaignId: campaign.id,
                businessId,
                phraseText: uniqueQueries[i],
                phraseVariations: [uniqueQueries[i]],
                sortOrder: i + 1,
                isActive: true,
                lockedAt: new Date(),
              });
            }
            console.log(`[Webhook] Seeded ${uniqueQueries.length} trainingQueries for campaign ${campaign.id}`);
          }
        } catch (seedErr: any) {
          console.error('[Webhook] trainingQueries seeding failed (non-fatal):', seedErr.message);
        }
      }

      // Create the client dashboard with a private access token
      const accessToken = crypto.randomBytes(32).toString("hex");
      await createClientDashboard({
        businessId,
        campaignId: campaign.id,
        accessToken,
        isActive: true,
        dashboardTitle: `${payload.businessName} - AI Visibility Report`,
        accessCount: 0,
      });

      // Update webhook log with success
      await updateWebhookLog(webhookLog.id, {
        status: "completed",
        businessId,
        campaignId: campaign.id,
        processedAt: new Date(),
      });

      console.log(
        `[Webhook] Campaign created: ${campaign.campaignName} (ID: ${campaign.id}) for business ${payload.businessName} (ID: ${businessId})`
      );

      // Return success with campaign details
      // ISSUE-006 FIX: Use correct route path /report/ instead of /dashboard/
      res.status(201).json({
        success: true,
        campaignId: campaign.id,
        businessId,
        dashboardToken: accessToken,
        dashboardUrl: `${req.protocol}://${req.get("host")}/report/${accessToken}`,
        message: `Campaign "${campaign.campaignName}" created successfully. Pipeline will begin automatically.`,
      });

      // ISSUE-009 FIX: Auto-kick off the pipeline after campaign creation
      // Run asynchronously so the webhook response isn't delayed
      setImmediate(async () => {
        try {
          const { runFullPipeline } = await import("./pipelineOrchestrator");
          console.log(`[Webhook] Auto-starting pipeline for campaign ${campaign.id}...`);
          const result = await runFullPipeline(campaign.id, ownerId);
          console.log(`[Webhook] Pipeline auto-run completed for campaign ${campaign.id}:`, result.reason);
        } catch (pipelineErr: any) {
          console.error(`[Webhook] Pipeline auto-run failed for campaign ${campaign.id}:`, pipelineErr.message);
          // Don't throw — the campaign is created, pipeline can be retried from the admin UI
        }
      });

    } catch (err: any) {
      console.error("[Webhook] Error processing onboarding webhook:", err);
      if (webhookLog) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: err.message || "Unknown error",
        }).catch(() => {});
      }
      res.status(500).json({ error: "Internal error processing webhook", message: err.message });
    }
  });

  // ─── GHL Cancel Trial Webhook ─────────────────────────────────────────────
  // GHL calls this if a client cancels before their 14-day trial ends.
  // Stops the campaign. Without this, the system auto-upgrades at day 14.
  // POST /api/ghl/cancel-trial
  // Body: { campaignId: number, ghlContactId?: string, reason?: string }
  router.post("/api/ghl/cancel-trial", async (req: Request, res: Response) => {
    try {
      // Verify webhook auth (async — checks DB then env var)
      const authResult = await verifyWebhookAuth(req);
      if (!authResult.valid) {
        res.status(401).json({ error: authResult.error });
        return;
      }

      const { campaignId, ghlContactId, reason } = req.body;

      if (!campaignId) {
        res.status(400).json({ error: "campaignId is required" });
        return;
      }

      const { cancelTrial } = await import("./trialManager");
      await cancelTrial(Number(campaignId), reason);

      console.log(`[Webhook] GHL trial cancellation: campaign ${campaignId}. GHL contact: ${ghlContactId || "unknown"}. Reason: ${reason || "none"}`);

      res.status(200).json({
        success: true,
        message: `Campaign ${campaignId} trial cancelled and paused.`,
      });
    } catch (err: any) {
      console.error("[Webhook] Error processing GHL trial cancellation:", err);
      res.status(500).json({ error: err.message || "Internal error" });
    }
  });

  return router;
}
