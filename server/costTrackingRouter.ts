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
import { eq, and, gte, lte, sql, desc, sum, inArray, isNull } from "drizzle-orm";
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
  externalCount: number;
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
        billingType: z.enum(["all", "white_label", "direct", "legacy", "external"]).default("all"),
        agencyId: z.number().optional(),
        limit: z.number().min(1).max(200).default(100),
        offset: z.number().min(0).default(0),
        // Date range filter — ISO strings. If omitted, defaults to current billing cycle per campaign.
        // Pass useBillingCycle: true to force per-campaign billing cycle windows (Per-Client tab default).
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        useBillingCycle: z.boolean().optional().default(false),
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
          noCharge: campaigns.noCharge,
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
                eq(campaigns.noCharge, false),
                input.agencyId ? eq(businesses.agencyId, input.agencyId) : undefined
              )
            : and(
                eq(campaigns.noCharge, false),
                input.agencyId ? eq(businesses.agencyId, input.agencyId) : undefined
              )
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
          ? db.select().from(packageTiers).where(inArray(packageTiers.id, tierIds))
          : Promise.resolve([]),
        agencyIds.length > 0
          ? db.select({ id: agencies.id, brandName: agencies.brandName }).from(agencies).where(inArray(agencies.id, agencyIds))
          : Promise.resolve([]),
      ]);

      const tierMap = new Map(tierRows.map((t) => [t.id, t]));
      const agencyMap = new Map(agencyRows.map((a) => [a.id, a.brandName]));

      // Resolve the date window to use for cost aggregation:
      // - useBillingCycle=true (Per-Client tab): use each campaign's own billing cycle window
      // - dateFrom/dateTo provided: use the explicit range
      // - neither: default to last 30 days
      const now = new Date();
      const globalDateFrom = input.dateFrom ? new Date(input.dateFrom) : (() => { const d = new Date(now); d.setDate(d.getDate() - 30); return d; })();
      const globalDateTo = input.dateTo ? new Date(input.dateTo) : now;

      // For each campaign, compute billing cycle window and aggregate costs
      const results: CampaignCostSummary[] = await Promise.all(
        campaignRows.map(async (row) => {
          const tier = row.packageTierId ? tierMap.get(row.packageTierId) : null;
          const tierSlug = tier?.slug ?? "starter";
          const tierName = tier?.name ?? "Starter";
          // null billingType = no billing plan (legacy/pre-existing) — revenue is $0
          const billingType = row.billingType ?? null;
          const agencyName = row.agencyId ? (agencyMap.get(row.agencyId) ?? null) : null;

          const cycleStart = getCurrentBillingCycleStart(row.campaignCreatedAt);
          const cycleEnd = getBillingCycleEnd(cycleStart);

          // Choose the window: billing cycle (Per-Client default) or the global date range
          const windowStart = input.useBillingCycle ? cycleStart : globalDateFrom;
          const windowEnd = input.useBillingCycle ? cycleEnd : globalDateTo;

          // Aggregate costs for the selected window
          const cycleAgg = await db
            .select({
              operationType: costLogs.operationType,
              totalCost: sql<string>`COALESCE(SUM(${costLogs.costUsd}::numeric), 0)`,
            })
            .from(costLogs)
            .where(
              and(
                eq(costLogs.campaignId, row.campaignId),
                gte(costLogs.createdAt, windowStart),
                lte(costLogs.createdAt, windowEnd)
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
              // Training — V2 legacy and V3 sprint turn types
              case "training":
              case "training_target_turn":
              case "training_trainer_turn":
              case "training_clean_probe":
              case "training_trainer_session_total":
                trainingCost += cost;
                break;
              // Rank checks — scheduled, baseline, training polls, bonus scans
              case "rank_check":
              case "baseline_check":
              case "baseline_check_sentiment":
              case "training_poll":
              case "training_poll_sentiment":
              case "rank_check_sentiment":
              case "bonus_query_scan":
              case "bonus_query_scan_sentiment":
                rankCheckCost += cost;
                break;
              case "keyword_research":
                keywordResearchCost += cost;
                break;
              case "content_generation":
              case "credibility_research":
                contentGenerationCost += cost;
                break;
              default:
                otherCost += cost;
            }
          }

          const totalCostUsd = trainingCost + rankCheckCost + keywordResearchCost + contentGenerationCost + otherCost;
          const lifetimeCostUsd = parseFloat(lifetimeAgg[0]?.totalCost ?? "0");
          // noCharge campaigns always show $0 revenue
          const monthlyRevenueUsd = (row as any).noCharge ? 0 : getMonthlyRevenue(billingType, tierSlug);
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
            billingCycleStart: (input.useBillingCycle ? cycleStart : windowStart).toISOString(),
            billingCycleEnd: (input.useBillingCycle ? cycleEnd : windowEnd).toISOString(),
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
  getAggregateSummary: protectedProcedure
    .input(
      z.object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
    if (ctx.user?.role !== "admin") throw new Error("Forbidden");

    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const now = new Date();
    // Default to last 30 days if no range provided
    const rangeFrom = input?.dateFrom ? new Date(input.dateFrom) : (() => { const d = new Date(now); d.setDate(d.getDate() - 30); return d; })();
    const rangeTo = input?.dateTo ? new Date(input.dateTo) : now;

    // Single query: all campaigns + their package tier slug + lifetime cost aggregated
    // We compute billing-cycle costs in one pass using a LEFT JOIN on costLogs.
    // Revenue is computed in JS since it depends on billing-cycle start logic.
    const [campaignRows, tierRows, byOpType, byProvider] = await Promise.all([
      // All campaigns with their total lifetime cost (we filter to current cycle in JS)
      db
        .select({
          id: campaigns.id,
          createdAt: campaigns.createdAt,
          billingType: campaigns.billingType,
          packageTierId: campaigns.packageTierId,
          noCharge: campaigns.noCharge,
        })
        .from(campaigns),

      // All package tiers (small table, full fetch is fine)
      db.select({ id: packageTiers.id, slug: packageTiers.slug }).from(packageTiers),

      // Cost breakdown by operation type (selected date range)
      db
        .select({
          operationType: costLogs.operationType,
          totalCost: sql<string>`COALESCE(SUM(${costLogs.costUsd}::numeric), 0)`,
        })
        .from(costLogs)
        .where(and(gte(costLogs.createdAt, rangeFrom), lte(costLogs.createdAt, rangeTo)))
        .groupBy(costLogs.operationType)
        .orderBy(sql`SUM(${costLogs.costUsd}::numeric) DESC`),

      // Cost breakdown by provider (selected date range)
      db
        .select({
          provider: costLogs.provider,
          totalCost: sql<string>`COALESCE(SUM(${costLogs.costUsd}::numeric), 0)`,
        })
        .from(costLogs)
        .where(and(gte(costLogs.createdAt, rangeFrom), lte(costLogs.createdAt, rangeTo)))
        .groupBy(costLogs.provider)
        .orderBy(sql`SUM(${costLogs.costUsd}::numeric) DESC`),
    ]);

    // Build tier map
    const tierMap = new Map(tierRows.map((t) => [t.id, t.slug]));

    // Fetch all cost logs within the selected date range in ONE query
    const rangeLogs = campaignRows.length > 0
      ? await db
          .select({
            campaignId: costLogs.campaignId,
            costUsd: costLogs.costUsd,
            createdAt: costLogs.createdAt,
          })
          .from(costLogs)
          .where(and(gte(costLogs.createdAt, rangeFrom), lte(costLogs.createdAt, rangeTo)))
      : [];

    // Group logs by campaignId for fast lookup
    const logsByCampaign = new Map<number, { costUsd: string | number; createdAt: Date }[]>();
    for (const log of rangeLogs) {
      if (!log.campaignId) continue;
      if (!logsByCampaign.has(log.campaignId)) logsByCampaign.set(log.campaignId, []);
      logsByCampaign.get(log.campaignId)!.push(log);
    }

    // Aggregate per campaign
    let totalCostUsd = 0;
    let totalRevenueUsd = 0;
    let whiteLabelCount = 0;
    let directCount = 0;
    let legacyCount = 0;
    let externalCount = 0;

    for (const campaign of campaignRows) {
      const tierSlug = campaign.packageTierId ? (tierMap.get(campaign.packageTierId) ?? "starter") : "starter";
      // Pass billingType as-is — null means no billing plan (legacy/pre-existing), revenue = 0
      const billingType = campaign.billingType ?? null;
      const logs = logsByCampaign.get(campaign.id) ?? [];

      const campaignRangeCost = logs
        .reduce((sum, l) => sum + parseFloat(String(l.costUsd ?? 0)), 0);

      totalCostUsd += campaignRangeCost;
      // noCharge campaigns contribute $0 revenue regardless of billingType
      const campaignRevenue = campaign.noCharge ? 0 : getMonthlyRevenue(billingType, tierSlug);
      totalRevenueUsd += campaignRevenue;

      if (billingType === "white_label") whiteLabelCount++;
      else if (billingType === "direct") directCount++;
      else if (billingType === "external") externalCount++;
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
      campaignCount: campaignRows.length,
      whiteLabelCount,
      directCount,
      legacyCount,
      externalCount,
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
   * Backfill billingType for all campaigns that have NULL billingType.
   * Sets white_label if the business has an agencyId, otherwise legacy.
   * Admin only — run once after deploy to fix pre-existing campaigns.
   */
  backfillBillingTypes: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (ctx.user?.role !== "admin") throw new Error("Forbidden");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { businesses } = await import("../drizzle/schema");

      // ── Step 1: backfill businesses that have no billingType set ─────────────
      // Fetch all businesses with their agencyId so we can derive the correct type
      const allBusinesses = await db
        .select({ id: businesses.id, agencyId: businesses.agencyId, billingType: businesses.billingType })
        .from(businesses);

      let businessesUpdated = 0;
      for (const biz of allBusinesses) {
        // Only backfill if billingType is null — don't overwrite explicit choices
        if (biz.billingType === null || biz.billingType === undefined) {
          const resolvedType = biz.agencyId ? "white_label" : "legacy";
          await db
            .update(businesses)
            .set({ billingType: resolvedType })
            .where(eq(businesses.id, biz.id));
          businessesUpdated++;
        }
      }

      // ── Step 2: backfill campaigns that have null billingType ────────────────
      // Fetch all campaigns with null billingType
      const nullCampaigns = await db
        .select({ id: campaigns.id, businessId: campaigns.businessId })
        .from(campaigns)
        .where(isNull(campaigns.billingType));

      // Fetch all businesses that have an agencyId (for campaign derivation)
      const agencyBusinessIds = new Set(
        (await db.select({ id: businesses.id }).from(businesses).where(sql`"agencyId" IS NOT NULL`))
          .map((b) => b.id)
      );

      let campaignsUpdated = 0;
      for (const c of nullCampaigns) {
        const resolvedType = c.businessId && agencyBusinessIds.has(c.businessId) ? "white_label" : "legacy";
        await db
          .update(campaigns)
          .set({ billingType: resolvedType, updatedAt: new Date() })
          .where(eq(campaigns.id, c.id));
        campaignsUpdated++;
      }

      return { updated: campaignsUpdated + businessesUpdated, businessesUpdated, campaignsUpdated };
    }),

  /**
   * Update a campaign's billing type.
   * Admin only.
   */
  updateCampaignBillingType: protectedProcedure
    .input(
      z.object({
        campaignId: z.number(),
        billingType: z.enum(["white_label", "direct", "legacy", "external"]),
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
