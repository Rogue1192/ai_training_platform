/**
 * Bonus Query Scanner
 *
 * Runs bi-weekly per campaign. For each tracked query/location combo, it:
 *   1. Asks an LLM to generate semantically adjacent queries (different intent framing,
 *      long-tail variations, service-specific phrasings) that are NOT already tracked.
 *   2. Checks ChatGPT + Gemini for each adjacent query.
 *   3. If the business appears → records a bonus win, optionally promotes to tracked.
 *   4. If already tracked → skips entirely (no double-scanning).
 *   5. Never re-reports an existing tracked mention as a new win.
 *
 * Drop-off detection is handled separately in rankTrackingEngine.ts (scheduled rank check).
 */

import { getDb, getApiKeyByProvider } from "./db";
import { decrypt } from "./encryption";
import {
  campaigns,
  businesses,
  campaignQueryLocations,
  bonusQueryResults,
  queryDropoffEvents,
  type BonusQueryResult,
} from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { checkLLMVisibilityDirect } from "./dataforseoService";
import { callAI } from "./aiProviders";
import { logDFSCost, DFS_COSTS } from "./costLogger";

const BONUS_QUERIES_PER_TRACKED = 4; // Max adjacent queries to generate per tracked query
const MAX_BONUS_QUERIES_PER_CAMPAIGN = 200; // Safety cap across all queries in a campaign

interface AdjacentQuerySet {
  sourceQuery: string;
  location: string;
  adjacentQueries: string[];
}

/**
 * Generate semantically adjacent queries for a tracked query using an LLM.
 * These are NOT simple modifier prefixes — they are topically related but
 * differently framed queries that the training sessions may not have covered.
 */
async function generateAdjacentQueries(
  trackedQuery: string,
  location: string,
  businessName: string,
  businessType: string,
  alreadyTrackedQueries: Set<string>
): Promise<string[]> {
  const prompt = `You are an AI search query analyst. Given a tracked search query for a local business, generate ${BONUS_QUERIES_PER_TRACKED} semantically adjacent queries that:
- Have different intent framing (e.g., urgency, comparison, specific service variant, seasonal)
- Are long-tail variations a real person might type into ChatGPT or Gemini
- Are NOT simple modifier prefixes like "best" or "top rated" — those are already covered by training
- Are genuinely different enough that they might surface different results
- Include the location naturally

Business: ${businessName}
Business type: ${businessType}
Tracked query: "${trackedQuery}"
Location: ${location}

Return ONLY a JSON array of ${BONUS_QUERIES_PER_TRACKED} query strings, no explanation:
["query 1", "query 2", "query 3", "query 4"]`;

  try {
    // Resolve OpenAI API key
    const keyRecord = await getApiKeyByProvider("openai");
    if (!keyRecord?.encryptedKey) return [];
    const apiKey = decrypt(keyRecord.encryptedKey);

    const response = await callAI(
      "openai",
      apiKey,
      "gpt-4o-mini",
      [{ role: "user", content: prompt }]
    );

    const content = response.content?.trim() || "[]";
    // Extract JSON array from response
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return [];

    const queries: string[] = JSON.parse(match[0]);
    if (!Array.isArray(queries)) return [];

    // Filter out any that are already tracked (case-insensitive)
    return queries
      .filter((q) => typeof q === "string" && q.length > 5)
      .filter((q) => !alreadyTrackedQueries.has(q.toLowerCase().trim()))
      .slice(0, BONUS_QUERIES_PER_TRACKED);
  } catch (err) {
    console.error("[BonusScanner] Failed to generate adjacent queries:", err);
    return [];
  }
}

/**
 * Run the bonus query scan for a single campaign.
 * Called by the bi-weekly scheduler.
 */
export async function runBonusQueryScan(campaignId: number): Promise<{
  bonusWinsFound: number;
  queriesChecked: number;
}> {
  console.log(`[BonusScanner] Starting scan for campaign ${campaignId}`);

  const db = await getDb();
  if (!db) {
    console.warn(`[BonusScanner] DB not available`);
    return { bonusWinsFound: 0, queriesChecked: 0 };
  }

  // Load campaign + business
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    console.warn(`[BonusScanner] Campaign ${campaignId} not found`);
    return { bonusWinsFound: 0, queriesChecked: 0 };
  }

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, (campaign as any).businessId))
    .limit(1);

  if (!business) {
    console.warn(`[BonusScanner] Business not found for campaign ${campaignId}`);
    return { bonusWinsFound: 0, queriesChecked: 0 };
  }

  // Load all tracked query/location combos
  const trackedQueryLocations = await db
    .select()
    .from(campaignQueryLocations)
    .where(eq(campaignQueryLocations.campaignId, campaignId));

  if (trackedQueryLocations.length === 0) {
    console.log(`[BonusScanner] No tracked queries for campaign ${campaignId}`);
    return { bonusWinsFound: 0, queriesChecked: 0 };
  }

  // Build a set of all already-tracked query strings (for dedup)
  const alreadyTrackedSet = new Set<string>(
    trackedQueryLocations.map((ql: any) => ql.searchQuery.toLowerCase().trim())
  );

  // Also load all bonus queries we've already checked to avoid re-scanning
  const previousBonusResults = await db
    .select({ bonusSearchQuery: bonusQueryResults.bonusSearchQuery })
    .from(bonusQueryResults)
    .where(eq(bonusQueryResults.campaignId, campaignId));

  const alreadyScannedBonus = new Set<string>(
    previousBonusResults.map((r: any) => r.bonusSearchQuery.toLowerCase().trim())
  );

  const businessType = (business as any).businessType || (business as any).industry || "local business";

  let bonusWinsFound = 0;
  let queriesChecked = 0;
  const scanRunAt = new Date();

  // Process each tracked query — generate and check adjacent queries
  for (const ql of trackedQueryLocations as any[]) {
    if (queriesChecked >= MAX_BONUS_QUERIES_PER_CAMPAIGN) {
      console.log(`[BonusScanner] Hit cap of ${MAX_BONUS_QUERIES_PER_CAMPAIGN} queries for campaign ${campaignId}`);
      break;
    }

    // Generate adjacent queries for this tracked query
    const adjacentQueries = await generateAdjacentQueries(
      ql.searchQuery,
      ql.location,
      business.name,
      businessType,
      alreadyTrackedSet
    );

    for (const adjacentQuery of adjacentQueries) {
      if (queriesChecked >= MAX_BONUS_QUERIES_PER_CAMPAIGN) break;

      // Skip if we've already scanned this bonus query before
      if (alreadyScannedBonus.has(adjacentQuery.toLowerCase().trim())) {
        continue;
      }

      // Skip if it's actually already a tracked query (double-check)
      if (alreadyTrackedSet.has(adjacentQuery.toLowerCase().trim())) {
        continue;
      }

      queriesChecked++;

      // Check visibility on ChatGPT + Gemini
      let chatgptMentioned = false;
      let chatgptSnippet: string | null = null;
      let geminiMentioned = false;
      let geminiSnippet: string | null = null;

      try {
        // Append location only for local-scope campaigns
        const campaignScope = (campaign as any).campaignScope ?? 'local';
        const queryWithLocation =
          campaignScope === 'local' && ql.location
            ? `${adjacentQuery} in ${ql.location}`
            : adjacentQuery;
        const result = await checkLLMVisibilityDirect(
          queryWithLocation,
          (business as any).name,
          (business as any).agencyId ?? null,
          (business as any).website ?? null,
          (business as any).phone ?? null,
          {
            campaignId,
            businessId: (business as any).id,
            campaignCreatedAt: (campaign as any).createdAt,
            operationType: 'bonus_query_scan',
          },
          (business as any).location ?? null
        );
        // Cost logging is now handled inside checkLLMVisibilityDirect via costContext (real per-provider token costs)

        chatgptMentioned = result.llmResponses.chatgpt?.mentioned || false;
        chatgptSnippet = result.llmResponses.chatgpt?.snippet || null;
        geminiMentioned = result.llmResponses.gemini?.mentioned || false;
        geminiSnippet = result.llmResponses.gemini?.snippet || null;
      } catch (err) {
        console.error(`[BonusScanner] Visibility check failed for "${adjacentQuery}":`, err);
      }

      const isBonusWin = chatgptMentioned || geminiMentioned;

      if (isBonusWin) {
        bonusWinsFound++;
      }

      // Record the bonus query result — bonus queries NEVER get promoted to tracked.
      // They exist purely as bonus visibility data and never affect the ranking score.
      await db.insert(bonusQueryResults).values({
        campaignId,
        businessId: (business as any).id,
        sourceQueryLocationId: ql.id,
        sourceSearchQuery: ql.searchQuery,
        bonusSearchQuery: adjacentQuery,
        location: ql.location,
        chatgptMentioned,
        chatgptSnippet,
        geminiMentioned,
        geminiSnippet,
        isBonusWin,
        promotedToTracked: false,
        promotedQueryLocationId: null,
        scanRunAt,
      });

      // Add to already-scanned set
      alreadyScannedBonus.add(adjacentQuery.toLowerCase().trim());
    }
  }

  console.log(
    `[BonusScanner] Campaign ${campaignId} complete: ${queriesChecked} checked, ${bonusWinsFound} bonus wins found`
  );

  return { bonusWinsFound, queriesChecked };
}

/**
 * Get the latest bonus query results for a campaign, grouped by source query.
 * Used by the tRPC endpoint and client dashboard.
 */
export async function getBonusQueryResults(campaignId: number): Promise<{
  totalBonusWins: number;
  lastScanAt: string | null;
  bySourceQuery: Array<{
    sourceQuery: string;
    location: string;
    bonusWins: BonusQueryResult[];
  }>;
}> {
  const db = await getDb();
  if (!db) return { totalBonusWins: 0, lastScanAt: null, bySourceQuery: [] };

  const results = await db
    .select()
    .from(bonusQueryResults)
    .where(
      and(
        eq(bonusQueryResults.campaignId, campaignId),
        eq(bonusQueryResults.isBonusWin, true)
      )
    )
    .orderBy(sql`${bonusQueryResults.scanRunAt} DESC`);

  if (results.length === 0) {
    return { totalBonusWins: 0, lastScanAt: null, bySourceQuery: [] };
  }

  // Group by source query
  const grouped = new Map<string, { location: string; wins: BonusQueryResult[] }>();
  for (const r of results) {
    const key = r.sourceSearchQuery;
    if (!grouped.has(key)) {
      grouped.set(key, { location: r.location, wins: [] });
    }
    grouped.get(key)!.wins.push(r);
  }

  const lastScanAt = results[0]?.scanRunAt?.toISOString() || null;

  return {
    totalBonusWins: results.length,
    lastScanAt,
    bySourceQuery: Array.from(grouped.entries()).map(([sourceQuery, data]) => ({
      sourceQuery,
      location: data.location,
      bonusWins: data.wins,
    })),
  };
}

/**
 * Get active drop-off events for a campaign (queries that lost visibility and
 * haven't yet recovered).
 */
export async function getActiveDropoffEvents(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(queryDropoffEvents)
    .where(
      and(
        eq(queryDropoffEvents.campaignId, campaignId),
        sql`${queryDropoffEvents.recoveredAt} IS NULL`
      )
    )
    .orderBy(sql`${queryDropoffEvents.detectedAt} DESC`);
}
