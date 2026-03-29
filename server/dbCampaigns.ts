import { and, eq, sql, desc, gte, inArray } from "drizzle-orm";
import { getDb } from "./db";
import {
  packageTiers,
  InsertPackageTier,
  PackageTier,
  campaigns,
  InsertCampaign,
  Campaign,
  campaignQueryLocations,
  InsertCampaignQueryLocation,
  CampaignQueryLocation,
  credibilityData,
  InsertCredibilityData,
  CredibilityData,
  contentPages,
  InsertContentPage,
  ContentPage,
  industryKeywordCache,
  InsertIndustryKeywordCache,
  IndustryKeywordCache,
  rankSnapshots,
  InsertRankSnapshot,
  RankSnapshot,
  clientDashboards,
  InsertClientDashboard,
  ClientDashboard,
  webhookLogs,
  InsertWebhookLog,
  WebhookLog,
  notificationLogs,
  InsertNotificationLog,
  NotificationLog,
  llmTxtFiles,
  InsertLlmTxtFile,
  LlmTxtFile,
  schemaMarkupRecommendations,
  InsertSchemaMarkupRecommendation,
  SchemaMarkupRecommendation,
  businesses,
} from "../drizzle/schema";

// ============= Package Tier Operations =============

export async function createPackageTier(tier: Omit<InsertPackageTier, "id" | "slug" | "createdAt" | "updatedAt">): Promise<PackageTier> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Auto-generate slug from name
  const slug = tier.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  const result = await db.insert(packageTiers).values({
    ...tier,
    slug,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return result[0]!;
}

export async function getPackageTiers(activeOnly = false): Promise<PackageTier[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = activeOnly ? [eq(packageTiers.isActive, true)] : [];
  return db
    .select()
    .from(packageTiers)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(packageTiers.sortOrder, packageTiers.createdAt);
}

export async function getPackageTierById(id: number): Promise<PackageTier | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(packageTiers).where(eq(packageTiers.id, id)).limit(1);
  return result[0];
}

export async function getPackageTierBySlug(slug: string): Promise<PackageTier | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(packageTiers).where(eq(packageTiers.slug, slug)).limit(1);
  return result[0];
}

export async function updatePackageTier(id: number, updates: Partial<InsertPackageTier>): Promise<PackageTier | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .update(packageTiers)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(packageTiers.id, id))
    .returning();
  return result[0];
}

export async function deletePackageTier(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.delete(packageTiers).where(eq(packageTiers.id, id)).returning();
  return result.length > 0;
}

// ============= Campaign Operations =============

export async function createCampaign(campaign: Omit<InsertCampaign, "id" | "createdAt" | "updatedAt">): Promise<Campaign> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(campaigns).values({
    ...campaign,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return result[0]!;
}

export async function getCampaignsByUserId(userId: number): Promise<Campaign[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));
}

export async function getCampaignById(id: number): Promise<Campaign | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return result[0];
}

export async function getCampaignsByBusinessId(businessId: number): Promise<Campaign[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.businessId, businessId))
    .orderBy(desc(campaigns.createdAt));
}

export async function updateCampaign(id: number, updates: Partial<InsertCampaign>): Promise<Campaign | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .update(campaigns)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(campaigns.id, id))
    .returning();
  return result[0];
}

export async function getCampaignStats(userId: number): Promise<Record<string, number>> {
  const db = await getDb();
  if (!db) return {};

  const result = await db
    .select({
      status: campaigns.status,
      count: sql<number>`count(*)`,
    })
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .groupBy(campaigns.status);

  const stats: Record<string, number> = {};
  for (const row of result) {
    stats[row.status] = Number(row.count);
  }
  return stats;
}

// ============= Campaign Query-Location Operations =============

export async function createCampaignQueryLocations(
  entries: Omit<InsertCampaignQueryLocation, "id" | "createdAt" | "updatedAt">[]
): Promise<CampaignQueryLocation[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (entries.length === 0) return [];

  const result = await db.insert(campaignQueryLocations).values(
    entries.map((e) => ({
      ...e,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  ).returning();
  return result;
}

export async function getQueryLocationsByCampaignId(campaignId: number): Promise<CampaignQueryLocation[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(campaignQueryLocations)
    .where(eq(campaignQueryLocations.campaignId, campaignId))
    .orderBy(campaignQueryLocations.createdAt);
}

export async function updateQueryLocation(id: number, updates: Partial<InsertCampaignQueryLocation>): Promise<CampaignQueryLocation | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .update(campaignQueryLocations)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(campaignQueryLocations.id, id))
    .returning();
  return result[0];
}

// ============= Webhook Log Operations =============

export async function createWebhookLog(log: Omit<InsertWebhookLog, "id" | "createdAt">): Promise<WebhookLog> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(webhookLogs).values({
    ...log,
    createdAt: new Date(),
  }).returning();
  return result[0]!;
}

export async function updateWebhookLog(id: number, updates: Partial<InsertWebhookLog>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(webhookLogs).set(updates).where(eq(webhookLogs.id, id));
}

export async function getWebhookLogs(limit = 50): Promise<WebhookLog[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(webhookLogs)
    .orderBy(desc(webhookLogs.createdAt))
    .limit(limit);
}

// ============= Industry Keyword Cache Operations =============

export async function getIndustryKeywordCache(industry: string): Promise<IndustryKeywordCache | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const normalized = industry.toLowerCase().trim();
  const result = await db
    .select()
    .from(industryKeywordCache)
    .where(eq(industryKeywordCache.industry, normalized))
    .limit(1);
  return result[0];
}

export async function upsertIndustryKeywordCache(
  industry: string,
  data: Partial<InsertIndustryKeywordCache>
): Promise<IndustryKeywordCache> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalized = industry.toLowerCase().trim();
  const existing = await getIndustryKeywordCache(normalized);

  if (existing) {
    const result = await db
      .update(industryKeywordCache)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(industryKeywordCache.id, existing.id))
      .returning();
    return result[0]!;
  } else {
    const result = await db
      .insert(industryKeywordCache)
      .values({
        industry: normalized,
        keywords: data.keywords || [],
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return result[0]!;
  }
}

export async function getAllIndustryKeywordCaches(): Promise<IndustryKeywordCache[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(industryKeywordCache).orderBy(industryKeywordCache.industry);
}

// ============= Credibility Data Operations =============

export async function createCredibilityData(data: Omit<InsertCredibilityData, "id" | "createdAt" | "updatedAt">): Promise<CredibilityData> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(credibilityData).values({
    ...data,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return result[0]!;
}

export async function getCredibilityDataByBusinessId(businessId: number): Promise<CredibilityData | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(credibilityData)
    .where(eq(credibilityData.businessId, businessId))
    .orderBy(desc(credibilityData.createdAt))
    .limit(1);
  return result[0];
}

// ============= Content Page Operations =============

export async function createContentPage(page: Omit<InsertContentPage, "id" | "createdAt" | "updatedAt">): Promise<ContentPage> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(contentPages).values({
    ...page,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return result[0]!;
}

export async function getContentPagesByCampaignId(campaignId: number): Promise<ContentPage[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(contentPages)
    .where(eq(contentPages.campaignId, campaignId))
    .orderBy(contentPages.createdAt);
}

export async function updateContentPage(id: number, updates: Partial<InsertContentPage>): Promise<ContentPage | undefined> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .update(contentPages)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(contentPages.id, id))
    .returning();
  return result[0];
}

// ============= Rank Snapshot Operations =============

export async function createRankSnapshot(snapshot: Omit<InsertRankSnapshot, "id">): Promise<RankSnapshot> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(rankSnapshots).values(snapshot).returning();
  return result[0]!;
}

export async function getRankSnapshotsByQueryLocation(queryLocationId: number, limit = 50): Promise<RankSnapshot[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(rankSnapshots)
    .where(eq(rankSnapshots.queryLocationId, queryLocationId))
    .orderBy(desc(rankSnapshots.checkedAt))
    .limit(limit);
}

export async function getRankSnapshotsByCampaign(campaignId: number, limit = 100): Promise<RankSnapshot[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(rankSnapshots)
    .where(eq(rankSnapshots.campaignId, campaignId))
    .orderBy(desc(rankSnapshots.checkedAt))
    .limit(limit);
}

// ============= Client Dashboard Operations =============

export async function createClientDashboard(dashboard: Omit<InsertClientDashboard, "id" | "createdAt">): Promise<ClientDashboard> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(clientDashboards).values({
    ...dashboard,
    createdAt: new Date(),
  }).returning();
  return result[0]!;
}

export async function getClientDashboardByToken(token: string): Promise<ClientDashboard | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(clientDashboards)
    .where(and(eq(clientDashboards.accessToken, token), eq(clientDashboards.isActive, true)))
    .limit(1);
  return result[0];
}

export async function getClientDashboardsByCampaignId(campaignId: number): Promise<ClientDashboard[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(clientDashboards)
    .where(eq(clientDashboards.campaignId, campaignId));
}

export async function updateClientDashboardAccess(id: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db
    .update(clientDashboards)
    .set({
      lastAccessedAt: new Date(),
      accessCount: sql`${clientDashboards.accessCount} + 1`,
    })
    .where(eq(clientDashboards.id, id));
}

// ============= Notification Log Operations =============

export async function createNotificationLog(log: Omit<InsertNotificationLog, "id" | "createdAt">): Promise<NotificationLog> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(notificationLogs).values({
    ...log,
    createdAt: new Date(),
  }).returning();
  return result[0]!;
}

export async function updateNotificationLog(id: number, updates: Partial<InsertNotificationLog>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(notificationLogs).set(updates).where(eq(notificationLogs.id, id));
}

// ============= LLM.txt File Operations =============

export async function createLlmTxtFile(file: Omit<InsertLlmTxtFile, "id" | "createdAt" | "updatedAt">): Promise<LlmTxtFile> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(llmTxtFiles).values({
    ...file,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return result[0]!;
}

export async function getLlmTxtFileByBusinessId(businessId: number): Promise<LlmTxtFile | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(llmTxtFiles)
    .where(eq(llmTxtFiles.businessId, businessId))
    .orderBy(desc(llmTxtFiles.createdAt))
    .limit(1);
  return result[0];
}

// ============= Schema Markup Operations =============

export async function createSchemaMarkupRecommendation(rec: Omit<InsertSchemaMarkupRecommendation, "id" | "createdAt" | "updatedAt">): Promise<SchemaMarkupRecommendation> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(schemaMarkupRecommendations).values({
    ...rec,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();
  return result[0]!;
}

export async function getSchemaMarkupByBusinessId(businessId: number): Promise<SchemaMarkupRecommendation | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(schemaMarkupRecommendations)
    .where(eq(schemaMarkupRecommendations.businessId, businessId))
    .orderBy(desc(schemaMarkupRecommendations.createdAt))
    .limit(1);
  return result[0];
}

// ============= Campaign with Business Info (joined query) =============

export async function getCampaignsWithBusinessInfo(userId: number): Promise<
  (Campaign & { businessName: string; businessType: string | null; website: string | null })[]
> {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select({
      id: campaigns.id,
      userId: campaigns.userId,
      businessId: campaigns.businessId,
      packageTierId: campaigns.packageTierId,
      campaignName: campaigns.campaignName,
      status: campaigns.status,
      clientType: campaigns.clientType,
      keywordResearchCompletedAt: campaigns.keywordResearchCompletedAt,
      credibilityResearchCompletedAt: campaigns.credibilityResearchCompletedAt,
      contentGenerationCompletedAt: campaigns.contentGenerationCompletedAt,
      publishingCompletedAt: campaigns.publishingCompletedAt,
      indexingSubmittedAt: campaigns.indexingSubmittedAt,
      indexingVerifiedAt: campaigns.indexingVerifiedAt,
      baselineCheckCompletedAt: campaigns.baselineCheckCompletedAt,
      trainingStartedAt: campaigns.trainingStartedAt,
      trainingAggressiveness: campaigns.trainingAggressiveness,
      rankCheckFrequency: campaigns.rankCheckFrequency,
      lastError: campaigns.lastError,
      errorCount: campaigns.errorCount,
      sourceWebhookId: campaigns.sourceWebhookId,
      createdAt: campaigns.createdAt,
      updatedAt: campaigns.updatedAt,
      businessName: businesses.name,
      businessType: businesses.businessType,
      website: businesses.website,
    })
    .from(campaigns)
    .innerJoin(businesses, eq(campaigns.businessId, businesses.id))
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));

  return result as any;
}

// ============= Seed Default Package Tiers =============

const DEFAULT_PACKAGE_TIERS = [
  {
    name: "Starter",
    maxQueries: 5,
    maxLocations: 3,
    monthlyPrice: 600,
    isActive: true,
    sortOrder: 1,
    description: "5 AI search queries across 3 locations. Ideal for single-location businesses.",
  },
  {
    name: "Growth",
    maxQueries: 10,
    maxLocations: 3,
    monthlyPrice: 800,
    isActive: true,
    sortOrder: 2,
    description: "10 AI search queries across 3 locations. Great for businesses expanding their reach.",
  },
  {
    name: "Pro",
    maxQueries: 5,
    maxLocations: 5,
    monthlyPrice: 750,
    isActive: true,
    sortOrder: 3,
    description: "5 AI search queries across 5 locations. Perfect for multi-location businesses.",
  },
  {
    name: "Enterprise",
    maxQueries: 10,
    maxLocations: 10,
    monthlyPrice: 1000,
    isActive: true,
    sortOrder: 4,
    description: "10 AI search queries across 10 locations. Maximum AI visibility coverage.",
  },
];

export async function seedDefaultPackageTiers(): Promise<PackageTier[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if any tiers already exist
  const existing = await db.select().from(packageTiers).limit(1);
  if (existing.length > 0) {
    // Already seeded, return existing
    return db.select().from(packageTiers).orderBy(packageTiers.sortOrder);
  }

  const results: PackageTier[] = [];
  for (const tier of DEFAULT_PACKAGE_TIERS) {
    const created = await createPackageTier(tier);
    results.push(created);
  }

  console.log(`[Seed] Created ${results.length} default package tiers`);
  return results;
}
