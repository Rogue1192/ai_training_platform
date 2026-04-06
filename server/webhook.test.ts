import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ============= Test Helpers =============

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "casey@roguebusinessmarketing.com",
    name: "Casey",
    loginMethod: "supabase",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

// ============= Package Tier Tests =============

describe("packageTier router", () => {
  it("lists package tiers (auto-seeds defaults if empty)", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const tiers = await caller.packageTier.list();

    // Should have at least the 4 default tiers
    expect(tiers.length).toBeGreaterThanOrEqual(4);

    // Verify the default tier names exist
    const names = tiers.map((t: any) => t.name);
    expect(names).toContain("Starter");
    expect(names).toContain("Growth");
    expect(names).toContain("Pro");
    expect(names).toContain("Enterprise");
  });

  it("each default tier has correct constraints", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const tiers = await caller.packageTier.list();
    const starter = tiers.find((t: any) => t.name === "Starter");

    expect(starter).toBeDefined();
    expect(starter!.maxQueries).toBe(5);
    expect(starter!.maxLocations).toBe(3);
    expect(starter!.isActive).toBe(true);
    expect(starter!.slug).toBe("starter");
  });

  it("can create a custom package tier", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const newTier = await caller.packageTier.create({
      name: "Test Custom Tier",
      maxQueries: 15,
      maxLocations: 8,
      monthlyPrice: 1500,
      description: "Test tier for vitest",
      isActive: true,
      sortOrder: 99,
    });

    expect(newTier).toBeDefined();
    expect(newTier.name).toBe("Test Custom Tier");
    expect(newTier.maxQueries).toBe(15);
    expect(newTier.maxLocations).toBe(8);
    expect(newTier.slug).toBe("test_custom_tier");

    // Clean up
    await caller.packageTier.delete({ id: newTier.id });
  });

  it("can update a package tier", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    // Create a tier to update
    const tier = await caller.packageTier.create({
      name: "Update Test Tier",
      maxQueries: 5,
      maxLocations: 3,
      monthlyPrice: 500,
      isActive: true,
      sortOrder: 98,
    });

    const updated = await caller.packageTier.update({
      id: tier.id,
      monthlyPrice: 750,
      description: "Updated description",
    });

    expect(updated).toBeDefined();
    expect(updated!.monthlyPrice).toBe(750);
    expect(updated!.description).toBe("Updated description");

    // Clean up
    await caller.packageTier.delete({ id: tier.id });
  });
});

// ============= Campaign Router Tests =============

describe("campaign router", () => {
  it("lists campaigns for the current user", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const campaigns = await caller.campaign.list();

    // Should return an array (may be empty or have test data)
    expect(Array.isArray(campaigns)).toBe(true);
  });

  it("returns campaign stats", async () => {
    const { ctx } = createAdminContext();
    const caller = appRouter.createCaller(ctx);

    const stats = await caller.campaign.stats();

    // Should return an object with status counts
    expect(typeof stats).toBe("object");
  });
});

// ============= Webhook Payload Validation Tests =============

describe("webhook payload validation", () => {
  // We test the Zod schema directly since the webhook is an Express route, not tRPC
  const { z } = require("zod");

  const onboardingPayloadSchema = z.object({
    businessName: z.string().min(1),
    websiteUrl: z.string().url(),
    industry: z.string().min(1),
    contactEmail: z.string().email(),
    contactName: z.string().optional(),
    contactPhone: z.string().optional(),
    locations: z.array(z.string().min(1)).min(1),
    packageTierSlug: z.string().optional(),
    packageTierId: z.number().optional(),
    clientType: z.enum(["ai_only", "ai_plus_seo", "ai_plus_seo_plus_build"]).default("ai_only"),
    competitors: z.array(z.string()).optional(),
    siteAdminUrl: z.string().optional(),
    siteUsername: z.string().optional(),
    sitePassword: z.string().optional(),
    searchQueries: z.array(z.string()).optional(),
    yearsFounded: z.number().optional(),
    certifications: z.array(z.string()).optional(),
    awards: z.array(z.string()).optional(),
    bbbRating: z.string().optional(),
    googleReviewCount: z.number().optional(),
    googleRating: z.number().optional(),
  });

  it("validates a complete GHL onboarding payload", () => {
    const payload = {
      businessName: "Test HVAC Company",
      websiteUrl: "https://testhvac.com",
      industry: "HVAC",
      contactEmail: "test@testhvac.com",
      contactName: "John Smith",
      contactPhone: "555-123-4567",
      locations: ["Dallas, TX", "Fort Worth, TX", "Arlington, TX"],
      packageTierSlug: "starter",
      clientType: "ai_only",
      competitors: ["competitor1.com", "competitor2.com"],
      yearsFounded: 2010,
      certifications: ["NATE Certified", "EPA 608"],
      bbbRating: "A+",
    };

    const result = onboardingPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.businessName).toBe("Test HVAC Company");
      expect(result.data.locations).toHaveLength(3);
      expect(result.data.clientType).toBe("ai_only");
    }
  });

  it("validates a minimal payload (required fields only)", () => {
    const payload = {
      businessName: "Minimal Business",
      websiteUrl: "https://minimal.com",
      industry: "Plumbing",
      contactEmail: "info@minimal.com",
      locations: ["Houston, TX"],
      packageTierSlug: "starter",
    };

    const result = onboardingPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientType).toBe("ai_only"); // default
      expect(result.data.competitors).toBeUndefined();
    }
  });

  it("rejects payload with missing required fields", () => {
    const payload = {
      businessName: "Test",
      // missing websiteUrl, industry, contactEmail, locations
    };

    const result = onboardingPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects payload with invalid email", () => {
    const payload = {
      businessName: "Test",
      websiteUrl: "https://test.com",
      industry: "HVAC",
      contactEmail: "not-an-email",
      locations: ["Dallas, TX"],
    };

    const result = onboardingPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects payload with invalid URL", () => {
    const payload = {
      businessName: "Test",
      websiteUrl: "not-a-url",
      industry: "HVAC",
      contactEmail: "test@test.com",
      locations: ["Dallas, TX"],
    };

    const result = onboardingPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects payload with empty locations array", () => {
    const payload = {
      businessName: "Test",
      websiteUrl: "https://test.com",
      industry: "HVAC",
      contactEmail: "test@test.com",
      locations: [],
    };

    const result = onboardingPayloadSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("validates all three client types", () => {
    const base = {
      businessName: "Test",
      websiteUrl: "https://test.com",
      industry: "HVAC",
      contactEmail: "test@test.com",
      locations: ["Dallas, TX"],
    };

    for (const clientType of ["ai_only", "ai_plus_seo", "ai_plus_seo_plus_build"]) {
      const result = onboardingPayloadSchema.safeParse({ ...base, clientType });
      expect(result.success).toBe(true);
    }
  });

  it("validates payload with WordPress credentials", () => {
    const payload = {
      businessName: "WP Client",
      websiteUrl: "https://wpclient.com",
      industry: "Roofing",
      contactEmail: "wp@wpclient.com",
      locations: ["Austin, TX"],
      packageTierSlug: "growth",
      clientType: "ai_plus_seo",
      siteAdminUrl: "https://wpclient.com/wp-admin",
      siteUsername: "admin",
      sitePassword: "securepass123",
    };

    const result = onboardingPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("validates payload with search queries pre-populated", () => {
    const payload = {
      businessName: "Query Client",
      websiteUrl: "https://queryclient.com",
      industry: "Landscaping",
      contactEmail: "info@queryclient.com",
      locations: ["Denver, CO"],
      packageTierSlug: "starter",
      searchQueries: ["best landscaping company", "affordable landscaping services", "top rated landscaper"],
    };

    const result = onboardingPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.searchQueries).toHaveLength(3);
    }
  });
});
