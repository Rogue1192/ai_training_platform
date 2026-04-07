import { Router, Request, Response } from "express";
import { z } from "zod";
import crypto from "crypto";
import { encrypt } from "./encryption";
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
import { getDb } from "./db";
import { businesses, users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ============= Webhook Payload Schema =============

const onboardingPayloadSchema = z.object({
  // Business info
  businessName: z.string().min(1, "Business name is required"),
  websiteUrl: z.string().url("Valid website URL is required"),
  industry: z.string().min(1, "Industry is required"),
  contactEmail: z.string().email("Valid contact email is required"),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),

  // Location data
  locations: z.array(z.string().min(1)).min(1, "At least one location is required"),

  // Package selection — accept either slug or ID
  packageTierSlug: z.string().optional(),
  packageTierId: z.number().optional(),

  // Client type for the campaign
  clientType: z.enum(["ai_only", "ai_plus_seo", "ai_plus_seo_plus_build"]).default("ai_only"),

  // Optional: competitor tracking
  competitors: z.array(z.string()).optional(),

  // Optional: WordPress credentials for auto-publishing
  siteAdminUrl: z.string().optional(),
  siteUsername: z.string().optional(),
  sitePassword: z.string().optional(),

  // Optional: specific search queries (if client/salesperson already knows them)
  searchQueries: z.array(z.string()).optional(),

  // Optional: additional business info for credibility research
  yearsFounded: z.number().optional(),
  certifications: z.array(z.string()).optional(),
  awards: z.array(z.string()).optional(),
  bbbRating: z.string().optional(),
  googleReviewCount: z.number().optional(),
  googleRating: z.number().optional(),

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

  // Optional: webhook secret for authentication
  webhookSecret: z.string().optional(),
});

export type OnboardingPayload = z.infer<typeof onboardingPayloadSchema>;

// ============= Webhook Authentication =============

/**
 * Verify webhook secret if configured.
 * Checks x-webhook-secret header against WEBHOOK_SECRET env var.
 * If WEBHOOK_SECRET is not set, authentication is skipped (open mode).
 */
function verifyWebhookAuth(req: Request): { valid: boolean; error?: string } {
  const configuredSecret = process.env.WEBHOOK_SECRET;
  if (!configuredSecret) {
    // No secret configured — open mode (acceptable for development)
    return { valid: true };
  }

  const headerSecret = req.headers["x-webhook-secret"] as string;
  const bodySecret = req.body?.webhookSecret;
  const providedSecret = headerSecret || bodySecret;

  if (!providedSecret) {
    return { valid: false, error: "Missing webhook secret. Provide x-webhook-secret header or webhookSecret in body." };
  }

  // BUG-007 fix: use timing-safe comparison to prevent timing attacks
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
// NOTE: siteUsername is stored PLAINTEXT (not a secret).
// sitePassword is encrypted using the canonical AES-256-GCM encrypt() from encryption.ts.
// The old local encryptWpCredentials() (AES-256-CBC) has been removed — it was
// incompatible with the app's decrypt() function and caused WordPress publish failures.

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
      // ISSUE-008 FIX: Verify webhook authentication
      const authResult = verifyWebhookAuth(req);
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

      // Ensure default package tiers exist
      await seedDefaultPackageTiers();

      // Resolve the package tier
      let packageTier;
      if (payload.packageTierId) {
        packageTier = await getPackageTierById(payload.packageTierId);
      } else if (payload.packageTierSlug) {
        packageTier = await getPackageTierBySlug(payload.packageTierSlug);
      }

      if (!packageTier) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: "Package tier not found. Provide a valid packageTierSlug or packageTierId.",
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
          businessType: payload.industry,
          contactEmail: payload.contactEmail,
          updatedAt: new Date(),
        };
        if (payload.contactName) updateFields.contactName = payload.contactName;
        if (payload.contactPhone) updateFields.phone = payload.contactPhone;
        if (payload.competitors) updateFields.competitors = payload.competitors;
        if (payload.yearsFounded) updateFields.yearsInBusiness = payload.yearsFounded;
        if (payload.certifications) updateFields.certifications = payload.certifications.join(", ");
        if (payload.awards) updateFields.awards = payload.awards.join(", ");
        if (payload.bbbRating) updateFields.bbbRating = payload.bbbRating;
        if (payload.clientType) updateFields.clientType = payload.clientType;
        // ISSUE-014 FIX: Store ALL locations as comma-separated string
        if (payload.locations.length > 0) updateFields.location = payload.locations.join(", ");
        // ISSUE-010 FIX: Store WP credentials (encrypted)
        if (payload.siteAdminUrl) updateFields.siteAdminUrl = payload.siteAdminUrl;
        // siteUsername stored plaintext — it is not a secret
        if (payload.siteUsername) updateFields.siteUsername = payload.siteUsername;
        // sitePassword encrypted with canonical AES-256-GCM encrypt() from encryption.ts
        if (payload.sitePassword) updateFields.sitePasswordEncrypted = encrypt(payload.sitePassword);

        await db.update(businesses).set(updateFields).where(eq(businesses.id, businessId));
      } else {
        // Create new business record
        const newBusiness = await db
          .insert(businesses)
          .values({
            userId: ownerId,
            name: payload.businessName,
            website: payload.websiteUrl,
            businessType: payload.industry,
            contactEmail: payload.contactEmail,
            contactName: payload.contactName || null,
            phone: payload.contactPhone || null,
            // ISSUE-014 FIX: Store ALL locations as comma-separated string
            location: payload.locations.join(", "),
            description: null,
            clientType: payload.clientType,
            competitors: payload.competitors || null,
            yearsInBusiness: payload.yearsFounded || null,
            certifications: payload.certifications?.join(", ") || null,
            awards: payload.awards?.join(", ") || null,
            bbbRating: payload.bbbRating || null,
            // siteUsername stored plaintext; sitePassword encrypted with canonical encrypt()
            siteAdminUrl: payload.siteAdminUrl || null,
            siteUsername: payload.siteUsername || null,
            sitePasswordEncrypted: payload.sitePassword ? encrypt(payload.sitePassword) : null,
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

      // Create the campaign
      const campaign = await createCampaign({
        userId: ownerId,
        businessId,
        packageTierId: packageTier.id,
        campaignName: `${payload.businessName} - AI Visibility`,
        status: "pending",
        clientType: payload.clientType,
        trainingAggressiveness: "aggressive",
        rankCheckFrequency: "weekly",
        sourceWebhookId: webhookLog.id,
        errorCount: 0,
        // Trial defaults — overridden by initializeTrial() below
        trialStatus: "trial",
        maxQueries: 5,
        maxLocations: 3,
        selectedPackage: payload.selectedPackage || null,
      });

      // Initialize 14-day trial
      const { initializeTrial } = await import("./trialManager");
      await initializeTrial(campaign.id, payload.selectedPackage);

      // Build the query×location matrix
      // If specific queries were provided, use those. Otherwise, we'll generate them in the keyword research phase.
      const queries = payload.searchQueries?.slice(0, packageTier.maxQueries) || [];
      const locations = payload.locations.slice(0, packageTier.maxLocations);

      if (queries.length > 0 && locations.length > 0) {
        // Build the full matrix
        const entries = [];
        for (const query of queries) {
          for (const location of locations) {
            entries.push({
              campaignId: campaign.id,
              searchQuery: query,
              location,
              trainingStatus: "pending" as const,
              trainingSessions: 0,
            });
          }
        }
        await createCampaignQueryLocations(entries);
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

  // SiteForge Ultra callback webhook (for Scenario C — when website build is complete)
  // ISSUE-007 FIX: Implement the SiteForge callback instead of leaving it as a stub
  router.post("/api/webhooks/siteforge-callback", async (req: Request, res: Response) => {
    const ipAddress = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "";

    let webhookLog;
    try {
      webhookLog = await createWebhookLog({
        source: "siteforge_ultra",
        payload: req.body,
        status: "received",
        ipAddress,
      });
    } catch (err) {
      console.error("[Webhook] Failed to log SiteForge callback:", err);
      res.status(500).json({ error: "Internal error logging webhook" });
      return;
    }

    try {
      // Verify webhook auth
      const authResult = verifyWebhookAuth(req);
      if (!authResult.valid) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: `Auth failed: ${authResult.error}`,
        });
        res.status(401).json({ error: authResult.error });
        return;
      }

      await updateWebhookLog(webhookLog.id, { status: "processing" });

      const { campaignId, publishedUrls, llmTxtUrl, schemaMarkup } = req.body;

      if (!campaignId) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: "campaignId is required",
        });
        res.status(400).json({ error: "campaignId is required" });
        return;
      }

      // Verify the campaign exists
      const campaign = await getCampaignById(campaignId);
      if (!campaign) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: `Campaign ${campaignId} not found`,
        });
        res.status(404).json({ error: `Campaign ${campaignId} not found` });
        return;
      }

      // Update content pages with published URLs
      if (publishedUrls && Array.isArray(publishedUrls)) {
        const contentPages = await getContentPagesByCampaignId(campaignId);
        for (const urlInfo of publishedUrls) {
          const { slug, url } = urlInfo;
          const matchingPage = contentPages.find(
            (p) => p.pageSlug === slug || p.pageType === slug
          );
          if (matchingPage) {
            await updateContentPage(matchingPage.id, {
              publishedUrl: url,
              status: "published",
            });
          }
        }
      }

      // Advance campaign to publishing_completed → indexing phase
      await updateCampaign(campaignId, {
        status: "indexing",
        publishingCompletedAt: new Date(),
      } as any);

      await updateWebhookLog(webhookLog.id, {
        status: "completed",
        campaignId,
        processedAt: new Date(),
      });

      console.log(`[Webhook] SiteForge callback processed for campaign ${campaignId}. Advancing to indexing phase.`);

      res.status(200).json({
        success: true,
        message: "SiteForge callback processed. Campaign advancing to indexing phase.",
      });

      // Auto-continue the pipeline from the indexing step
      setImmediate(async () => {
        try {
          const { runPipelineStep } = await import("./pipelineOrchestrator");
          console.log(`[Webhook] Auto-starting indexing for campaign ${campaignId}...`);
          // Use ownerId from the campaign
          const camp = await getCampaignById(campaignId);
          if (camp && camp.userId != null) {
            await runPipelineStep(campaignId, "indexing", camp.userId);
          } else if (camp) {
            // userId is null — get admin user as fallback
            const { getDb } = await import("./db");
            const { users } = await import("../drizzle/schema");
            const { eq } = await import("drizzle-orm");
            const db = await getDb();
            if (db) {
              const admins = await db.select().from(users).where(eq(users.role, "admin")).limit(1);
              if (admins.length > 0) {
                await runPipelineStep(campaignId, "indexing", admins[0]!.id);
              }
            }
          }
        } catch (err: any) {
          console.error(`[Webhook] Auto-indexing failed for campaign ${campaignId}:`, err.message);
        }
      });

    } catch (err: any) {
      console.error("[Webhook] Error processing SiteForge callback:", err);
      if (webhookLog) {
        await updateWebhookLog(webhookLog.id, {
          status: "failed",
          errorMessage: err.message || "Unknown error",
        }).catch(() => {});
      }
      res.status(500).json({ error: "Internal error processing webhook" });
    }
  });

  // ─── GHL Cancel Trial Webhook ─────────────────────────────────────────────
  // GHL calls this if a client cancels before their 14-day trial ends.
  // Stops the campaign. Without this, the system auto-upgrades at day 14.
  // POST /api/ghl/cancel-trial
  // Body: { campaignId: number, ghlContactId?: string, reason?: string }
  router.post("/api/ghl/cancel-trial", async (req: Request, res: Response) => {
    try {
      // Verify webhook auth
      const authResult = verifyWebhookAuth(req);
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
