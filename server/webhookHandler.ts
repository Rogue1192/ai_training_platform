import { Router, Request, Response } from "express";
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
  wpAdminUrl: z.string().optional(),
  wpUsername: z.string().optional(),
  wpPassword: z.string().optional(),

  // Optional: specific search queries (if client/salesperson already knows them)
  searchQueries: z.array(z.string()).optional(),

  // Optional: additional business info for credibility research
  yearsFounded: z.number().optional(),
  certifications: z.array(z.string()).optional(),
  awards: z.array(z.string()).optional(),
  bbbRating: z.string().optional(),
  googleReviewCount: z.number().optional(),
  googleRating: z.number().optional(),
});

export type OnboardingPayload = z.infer<typeof onboardingPayloadSchema>;

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

      // Check if business already exists (by name + website)
      const existingBusinesses = await db
        .select()
        .from(businesses)
        .where(eq(businesses.website, payload.websiteUrl))
        .limit(1);

      let businessId: number;

      if (existingBusinesses.length > 0) {
        businessId = existingBusinesses[0]!.id;
        // Update business with any new info from the webhook
        await db
          .update(businesses)
          .set({
            businessType: payload.industry,
            contactEmail: payload.contactEmail,
            ...(payload.contactPhone ? { phone: payload.contactPhone } : {}),
            updatedAt: new Date(),
          })
          .where(eq(businesses.id, businessId));
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
            location: payload.locations[0] || null,
            description: null,
            clientType: payload.clientType,
            competitors: payload.competitors || null,
            yearsInBusiness: payload.yearsFounded || null,
            certifications: payload.certifications?.join(", ") || null,
            awards: payload.awards?.join(", ") || null,
            bbbRating: payload.bbbRating || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .returning();
        businessId = newBusiness[0]!.id;
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
      });

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
      res.status(201).json({
        success: true,
        campaignId: campaign.id,
        businessId,
        dashboardToken: accessToken,
        dashboardUrl: `${req.protocol}://${req.get("host")}/dashboard/${accessToken}`,
        message: `Campaign "${campaign.campaignName}" created successfully. Pipeline will begin automatically.`,
      });

      // TODO: In Sprint 3+, kick off the automated pipeline here:
      // 1. Trigger keyword research (if no queries provided)
      // 2. Trigger credibility research
      // 3. Trigger content generation
      // etc.

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

      // TODO: In Sprint 6+, process the SiteForge callback:
      // 1. Update content pages with published URLs
      // 2. Update llm.txt record
      // 3. Update schema markup record
      // 4. Advance campaign to indexing phase

      await updateWebhookLog(webhookLog.id, {
        status: "completed",
        campaignId,
        processedAt: new Date(),
      });

      res.status(200).json({
        success: true,
        message: "SiteForge callback received. Campaign will advance to indexing phase.",
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

  return router;
}
