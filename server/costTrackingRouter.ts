/**
 * Cost Tracking Router
 *
 * Super-admin endpoints for viewing API costs vs. revenue (P&L) per client/campaign.
 * Supports white-label, direct, and legacy billing types.
 * Billing cycles reset on the campaign's creation day-of-month each month.
 */
import { router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import { getDb } from "./db";
import {
  costLogs,
  campaigns,
  businesses,
  packageTiers,
  agencies,
} from "../drizzle/schema";
import { eq, and, gte, lte, sql, desc, sum } from "drizzle-orm";
import {
  getMonthlyRevenue,
  getCurrentBillingCycleStart,
} from "./costLogger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CampaignCostSummary {
  campaignId: number;
  businessId: number;
  businessName: string;
  agencyName: string | null;
  packageTierName: string;
  packageTierSlug: string;
  billingType: string;
  campaignStatus: string;
  campaignCreatedAt: string;
  // Billing cycle
  billingCycleStart: string;
  billingCycleEnd: string;
  // Costs (current billing cycle)
  totalCostUsd: number;
  trainingCostUsd: number;
  rankCheckCostUsd: number;
  keywordResearchCostUsd: number;
  contentGenerationCostUsd: number;
  otherCostUsd: number;
  // Revenue
  monthlyRevenueUsd: number;
  // P&L
  netProfitUsd: number;
  marginPct: number;
  // Lifetime costs
  lifetimeCostUsd: number;
}

export interface AggregateCostSummary {
  totalCostUsd: number;
  totalRevenueUsd: number;
  totalNetProfitUsd: number;
  avgMarginPct: number;
  campaignCount: number;
  whiteLabelCount: number;
  directCount: number;
  legacyCount: number;
  byOperationType: Array<{ operationType: string; costUsd: number }>;
  byProvider: Array<{ provider: string; costUsd: number }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBillingCycleEnd(cycleStart: Date): Date {
  const end = new Date(cycleStart);
  end.setMonth(end.getMonth() + 1);
  end.setDate(end.getDate() - 1);
  end.setHours(23, 59, 59, 999);
  return end;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const costTrackingRouter = router({
  /**
   * Get per-campaign cost summaries for the current billing cycle.
   * Admin only.
   */
  getCampaignCosts: protectedProcedure
    .input(
      z.object({
        billingType: z.enum(["all", "white_label", "direct", "legacy"]).default("all"),
        agencyId: z.number().optional(),
        limit: z.number().min(1).max(200).default(100),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") throw new Error("Forbidden");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Get all active campaigns with their business, package tier, and agency
      const campaignRows = await db
        .select({
          campaignId: campaigns.id,
          campaignStatus: campaigns.status,
          campaignCreatedAt: campaigns.createdAt,
          billingType: campaigns.billingType,
          businessId: businesses.id,
          businessName: businesses.name,
          agencyId: businesses.agencyId,
          packageTierId: campaigns.packageTierId,
        })
        .from(campaigns)
        .innerJoin(businesses, eq(businesses.id, campaigns.businessId))
        .where(
          input.billingType !== "all"
            ? and(
                eq(campaigns.billingType, input.billingType),
                input.agencyId ? eq(businesses.agencyId, input.agencyId) : undefined
              )
            : input.agencyId
            ? eq(businesses.agencyId, input.agencyId)
            : undefined
        )
        .orderBy(desc(campaigns.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      if (campaignRows.length === 0) {
        return { campaigns: [], total: 0 };
      }

      // Batch-load package tiers and agencies
      const tierIds = [...new Set(campaignRows.map((r) => r.packageTierId).filter(Boolean))] as number[];
      const agencyIds = [...new Set(campaignRows.map((r) => r.agencyId).filter(Boolean))] as number[];

      const [tierRows, agencyRows] = await Promise.all([
        tierIds.length > 0
          ? db.select().from(packageTiers).where(sql`${packageTiers.id} = ANY(${tierIds})`)
          : [],
        agencyIds.length > 0
          ? db.select({ id: agencies.id, brandName: agencies.brandName }).from(agencies).where(sql`${agencies.id} = ANY(${agencyIds})`)
          : [],
      ]);

      const tierMap = new Map(tierRows.map((t) => [t.id, t]));
      const agencyMap = new Map(agencyRows.map((a) => [a.id, a.brandName]));

      // For each campaign, compute billing cycle window and aggregate costs
      const results: CampaignCostSummary[] = await Promise.all(
        campaignRows.map(async (row) => {
          const tier = row.packageTierId ? tierMap.get(row.packageTierId) : null;
          const tierSlug = tier?.slug ?? "starter";
          const tierName = tier?.name ?? "Starter";
          const billingType = row.billingType ?? "white_label";
          const agencyName = row.agencyId ? (agencyMap.get(row.agencyId) ?? null) : null;

          const cycleStart = getCurrentBillingCycleStart(row.campaignCreatedAt);
          const cycleEnd = getBillingCycleEnd(cycleStart);

          // Aggregate costs for current billing cycle
          const cycleAgg = await db
            .select({
              operationType: costLogs.operationType,
              totalCost: sql<string>`COALESCE(SUM(${costLogs.costUsd}::numeric), 0)`,
            })
            .from(costLogs)
            .where(
              and(
                eq(costLogs.campaignId, row.campaignId),
                gte(costLogs.createdAt, cycleStart),
                lte(costLogs.createdAt, cycleEnd)
              )
            )
            .groupBy(costLogs.operationType);

          // Lifetime costs
          const lifetimeAgg = await db
            .select({
              totalCost: sql<string>`COALESCE(SUM(${costLogs.costUsd}::numeric), 0)`,
            })
            .from(costLogs)
            .where(eq(costLogs.campaignId, row.campaignId));

          // Build cost breakdown
          let trainingCost = 0;
          let rankCheckCost = 0;
          let keywordResearchCost = 0;
          let contentGenerationCost = 0;
          let otherCost = 0;

          for (const agg of cycleAgg) {
            const cost = parseFloat(agg.totalCost);
            switch (agg.operationType) {
              case "training":
                trainingCost += cost;
                break;
              case "rank_check":
                rankCheckCost += cost;
                break;
              case "keyword_research":
                keywordResearchCost += cost;
                break;
              case "content_generation":
                contentGenerationCost += cost;
                break;
              default:
                otherCost += cost;
            }
          }

          const totalCostUsd = trainingCost + rankCheckCost + keywordResearchCost + contentGenerationCost + otherCost;
          const lifetimeCostUsd = parseFloat(lifetimeAgg[0]?.totalCost ?? "0");
          const monthlyRevenueUsd = getMonthlyRevenue(billingType, tierSlug);
          const netProfitUsd = monthlyRevenueUsd - totalCostUsd;
          const marginPct = monthlyRevenueUsd > 0 ? Math.round((netProfitUsd / monthlyRevenueUsd) * 100) : 0;

          return {
            campaignId: row.campaignId,
            businessId: row.businessId,
            businessName: row.businessName ?? "Unknown",
            agencyName,
            packageTierName: tierName,
            packageTierSlug: tierSlug,
            billingType,
            campaignStatus: row.campaignStatus ?? "unknown",
            campaignCreatedAt: row.campaignCreatedAt.toISOString(),
            billingCycleStart: cycleStart.toISOString(),
            billingCycleEnd: cycleEnd.toISOString(),
            totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
            trainingCostUsd: Math.round(trainingCost * 10000) / 10000,
            rankCheckCostUsd: Math.round(rankCheckCost * 10000) / 10000,
            keywordResearchCostUsd: Math.round(keywordResearchCost * 10000) / 10000,
            contentGenerationCostUsd: Math.round(contentGenerationCost * 10000) / 10000,
            otherCostUsd: Math.round(otherCost * 10000) / 10000,
            monthlyRevenueUsd,
            netProfitUsd: Math.round(netProfitUsd * 100) / 100,
            marginPct,
            lifetimeCostUsd: Math.round(lifetimeCostUsd * 10000) / 10000,
          };
        })
      );

      // Total count for pagination
      const countResult = await db
        .select({ count: sql<string>`COUNT(*)` })
        .from(campaigns)
        .innerJoin(businesses, eq(businesses.id, campaigns.businessId));
      const total = parseInt(countResult[0]?.count ?? "0", 10);

      return { campaigns: results, total };
    }),

  /**
   * Get aggregate P&L summary across all campaigns for the current billing cycle.
   * Admin only.
   */
  getAggregateSummary: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user?.role !== "admin") throw new Error("Forbidden");

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Get all campaigns for billing cycle windows
    const allCampaigns = await db
      .select({
        id: campaigns.id,
        createdAt: campaigns.createdAt,
        billingType: campaigns.billingType,
        packageTierId: campaigns.packageTierId,
      })
      .from(campaigns);

    // For each campaign, compute current cycle costs
    let totalCostUsd = 0;
    let totalRevenueUsd = 0;
    let whiteLabelCount = 0;
    let directCount = 0;
    let legacyCount = 0;

    const tierIds = [...new Set(allCampaigns.map((c) => c.packageTierId).filter(Boolean))] as number[];
    const tierRows = tierIds.length > 0
      ? await db.select().from(packageTiers).where(sql`${packageTiers.id} = ANY(${tierIds})`)
      : [];
    const tierMap = new Map(tierRows.map((t) => [t.id, t]));

    // Aggregate costs by operation type and provider (across all campaigns, current cycles)
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [byOpType, byProvider] = await Promise.all([
      db
        .select({
          operationType: costLogs.operationType,
          totalCost: sql<string>`COALESCE(SUM(${costLogs.costUsd}::numeric), 0)`,
        })
        .from(costLogs)
        .where(gte(costLogs.createdAt, thirtyDaysAgo))
        .groupBy(costLogs.operationType)
        .orderBy(sql`SUM(${costLogs.costUsd}::numeric) DESC`),
      db
        .select({
          provider: costLogs.provider,
          totalCost: sql<string>`COALESCE(SUM(${costLogs.costUsd}::numeric), 0)`,
        })
        .from(costLogs)
        .where(gte(costLogs.createdAt, thirtyDaysAgo))
        .groupBy(costLogs.provider)
        .orderBy(sql`SUM(${costLogs.costUsd}::numeric) DESC`),
    ]);

    // Sum up per-campaign current cycle costs and revenue
    for (const campaign of allCampaigns) {
      const tier = campaign.packageTierId ? tierMap.get(campaign.packageTierId) : null;
      const tierSlug = tier?.slug ?? "starter";
      const billingType = campaign.billingType ?? "white_label";

      const cycleStart = getCurrentBillingCycleStart(campaign.createdAt);
      const cycleEnd = getBillingCycleEnd(cycleStart);

      const costAgg = await db
        .select({ total: sql<string>`COALESCE(SUM(${costLogs.costUsd}::numeric), 0)` })
        .from(costLogs)
        .where(
          and(
            eq(costLogs.campaignId, campaign.id),
            gte(costLogs.createdAt, cycleStart),
            lte(costLogs.createdAt, cycleEnd)
          )
        );

      const campaignCost = parseFloat(costAgg[0]?.total ?? "0");
      const campaignRevenue = getMonthlyRevenue(billingType, tierSlug);

      totalCostUsd += campaignCost;
      totalRevenueUsd += campaignRevenue;

      if (billingType === "white_label") whiteLabelCount++;
      else if (billingType === "direct") directCount++;
      else legacyCount++;
    }

    const totalNetProfitUsd = totalRevenueUsd - totalCostUsd;
    const avgMarginPct = totalRevenueUsd > 0
      ? Math.round((totalNetProfitUsd / totalRevenueUsd) * 100)
      : 0;

    return {
      totalCostUsd: Math.round(totalCostUsd * 100) / 100,
      totalRevenueUsd: Math.round(totalRevenueUsd * 100) / 100,
      totalNetProfitUsd: Math.round(totalNetProfitUsd * 100) / 100,
      avgMarginPct,
      campaignCount: allCampaigns.length,
      whiteLabelCount,
      directCount,
      legacyCount,
      byOperationType: byOpType.map((r) => ({
        operationType: r.operationType,
        costUsd: Math.round(parseFloat(r.totalCost) * 10000) / 10000,
      })),
      byProvider: byProvider.map((r) => ({
        provider: r.provider,
        costUsd: Math.round(parseFloat(r.totalCost) * 10000) / 10000,
      })),
    } satisfies AggregateCostSummary;
  }),

  /**
   * Get detailed cost log entries for a specific campaign.
   * Admin only.
   */
  getCampaignCostLogs: protectedProcedure
    .input(
      z.object({
        campaignId: z.number(),
        limit: z.number().min(1).max(500).default(100),
        offset: z.number().min(0).default(0),
        currentCycleOnly: z.boolean().default(true),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") throw new Error("Forbidden");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Get campaign for billing cycle window
      const [campaign] = await db
        .select({ createdAt: campaigns.createdAt })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);

      if (!campaign) throw new Error("Campaign not found");

      const cycleStart = getCurrentBillingCycleStart(campaign.createdAt);
      const cycleEnd = getBillingCycleEnd(cycleStart);

      const whereClause = input.currentCycleOnly
        ? and(
            eq(costLogs.campaignId, input.campaignId),
            gte(costLogs.createdAt, cycleStart),
            lte(costLogs.createdAt, cycleEnd)
          )
        : eq(costLogs.campaignId, input.campaignId);

      const logs = await db
        .select()
        .from(costLogs)
        .where(whereClause)
        .orderBy(desc(costLogs.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const countResult = await db
        .select({ count: sql<string>`COUNT(*)` })
        .from(costLogs)
        .where(whereClause);

      return {
        logs: logs.map((l) => ({
          id: l.id,
          operationType: l.operationType,
          provider: l.provider,
          model: l.model,
          inputTokens: l.inputTokens,
          outputTokens: l.outputTokens,
          costUsd: parseFloat(l.costUsd),
          billingCycleStart: l.billingCycleStart.toISOString(),
          metadata: l.metadata,
          createdAt: l.createdAt.toISOString(),
        })),
        total: parseInt(countResult[0]?.count ?? "0", 10),
        cycleStart: cycleStart.toISOString(),
        cycleEnd: cycleEnd.toISOString(),
      };
    }),

  /**
   * Update a campaign's billing type.
   * Admin only.
   */
  updateCampaignBillingType: protectedProcedure
    .input(
      z.object({
        campaignId: z.number(),
        billingType: z.enum(["white_label", "direct", "legacy"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user?.role !== "admin") throw new Error("Forbidden");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db
        .update(campaigns)
        .set({ billingType: input.billingType, updatedAt: new Date() })
        .where(eq(campaigns.id, input.campaignId));

      return { success: true };
    }),
});
