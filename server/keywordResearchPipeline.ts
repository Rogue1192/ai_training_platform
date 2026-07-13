import {
  runKeywordResearchPipeline,
  runBaselineRankCheck,
  checkLLMVisibilityDirect,
  getKeywordSuggestionsForProspect,
  getAIKeywordSearchVolume,
  getGoogleAdsSearchVolume,
  type KeywordResearchResult,
  type LLMMentionResult,
} from "./dataforseoService";
import { parseLocations } from "@shared/location";
import {
  getIndustryKeywordCache,
  upsertIndustryKeywordCache,
  getCampaignById,
  updateCampaign,
  createCampaignQueryLocations,
  getQueryLocationsByCampaignId,
  getPackageTierById,
  createRankSnapshot,
  updateQueryLocation,
} from "./dbCampaigns";
import { getDb } from "./db";
import { businesses } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { logDFSCost, DFS_COSTS } from "./costLogger";

// ============= Types =============

interface CachedKeyword {
  keyword: string;
  aiSearchVolume: number;
  searchVolume: number;
  searchIntent: string | null;
  frequency: number; // How many times this keyword appeared across clients
}

// ============= Industry Keyword Cache Logic =============

/**
 * Check if an industry has a locked golden template.
 * If yes, return those keywords directly (no API call needed).
 * If no, return null — caller should run fresh research.
 */
export async function getGoldenTemplateKeywords(
  industry: string
): Promise<CachedKeyword[] | null> {
  const cache = await getIndustryKeywordCache(industry);

  if (!cache || !cache.isLocked || !cache.goldenTemplateKeywords) {
    return null;
  }

  console.log(
    `[Keyword Cache] Using golden template for "${industry}" (${(cache.goldenTemplateKeywords as CachedKeyword[]).length} keywords)`
  );

  return cache.goldenTemplateKeywords as CachedKeyword[];
}

/**
 * After running keyword research for a client, contribute the results
 * to the industry cache. If the cache reaches the lock threshold,
 * analyze overlap and lock in the golden template.
 */
export async function contributeToIndustryCache(
  industry: string,
  newKeywords: { keyword: string; aiSearchVolume: number; searchVolume: number; searchIntent: string | null }[]
): Promise<void> {
  const cache = await getIndustryKeywordCache(industry);

  if (cache?.isLocked) {
    // Already locked — no need to update
    return;
  }

  // Merge new keywords with existing cache
  const existingKeywords: CachedKeyword[] = (cache?.keywords as CachedKeyword[]) || [];
  const keywordMap = new Map<string, CachedKeyword>();

  // Load existing
  for (const kw of existingKeywords) {
    keywordMap.set(kw.keyword.toLowerCase(), kw);
  }

  // Merge new
  for (const kw of newKeywords) {
    const key = kw.keyword.toLowerCase();
    const existing = keywordMap.get(key);
    if (existing) {
      existing.frequency += 1;
      // Update volumes to latest
      existing.aiSearchVolume = Math.max(existing.aiSearchVolume, kw.aiSearchVolume);
      existing.searchVolume = Math.max(existing.searchVolume, kw.searchVolume);
    } else {
      keywordMap.set(key, {
        keyword: kw.keyword,
        aiSearchVolume: kw.aiSearchVolume,
        searchVolume: kw.searchVolume,
        searchIntent: kw.searchIntent,
        frequency: 1,
      });
    }
  }

  const allKeywords = Array.from(keywordMap.values());
  const newClientCount = (cache?.clientCount || 0) + 1;
  const lockThreshold = cache?.lockThreshold || 3;

  // Check if we should lock the golden template
  if (newClientCount >= lockThreshold) {
    // Find keywords that appear in at least 50% of client research runs
    const minFrequency = Math.ceil(newClientCount * 0.5);
    const goldenKeywords = allKeywords
      .filter((k) => k.frequency >= minFrequency && k.aiSearchVolume > 0)
      .sort((a, b) => b.aiSearchVolume - a.aiSearchVolume)
      .slice(0, 50); // Cap at 50 golden keywords per industry

    console.log(
      `[Keyword Cache] Locking golden template for "${industry}": ${goldenKeywords.length} keywords from ${newClientCount} clients`
    );

    await upsertIndustryKeywordCache(industry, {
      keywords: allKeywords,
      goldenTemplateKeywords: goldenKeywords,
      clientCount: newClientCount,
      isLocked: true,
      lastRefreshedAt: new Date(),
    });
  } else {
    // Not enough clients yet — just update the cache
    console.log(
      `[Keyword Cache] Updated cache for "${industry}": ${allKeywords.length} keywords, ${newClientCount}/${lockThreshold} clients`
    );

    await upsertIndustryKeywordCache(industry, {
      keywords: allKeywords,
      clientCount: newClientCount,
      lastRefreshedAt: new Date(),
    });
  }
}

// ============= Campaign Keyword Research Pipeline =============

/**
 * Run the full keyword research phase for a campaign.
 * This is called automatically after campaign creation from the webhook.
 *
 * Flow:
 * 1. Check industry cache for golden template
 * 2. If no golden template, run fresh DataForSEO keyword research
 * 3. Contribute results to industry cache
 * 4. Build the query×location matrix
 * 5. Update campaign status
 */
export async function runCampaignKeywordResearch(campaignId: number): Promise<{
  success: boolean;
  keywordsFound: number;
  queryLocationsCreated: number;
  usedCache: boolean;
  error?: string;
}> {
  console.log(`[Pipeline] Starting keyword research for campaign ${campaignId}`);

  try {
    // Get campaign details
    const campaign = await getCampaignById(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    // Update campaign status
    await updateCampaign(campaignId, { status: "keyword_research" });

    // Get business info
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const businessResult = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, campaign.businessId))
      .limit(1);

    if (businessResult.length === 0) throw new Error(`Business ${campaign.businessId} not found`);
    const business = businessResult[0]!;

    // Get package tier for caps
    const packageTier = campaign.packageTierId
      ? await getPackageTierById(campaign.packageTierId)
      : null;

    // New query-budget model: maxQuerySlots is the total number of query-location pairs allowed.
    // Fall back to the legacy maxQueries * maxLocations calculation for older tiers without maxQuerySlots.
    const maxQuerySlots = campaign.maxQuerySlots || packageTier?.maxQuerySlots || (packageTier ? packageTier.maxQueries * packageTier.maxLocations : 15);
    // For keyword generation, use all unique query slots (we'll distribute across locations below)
    const allLocations = business.location ? parseLocations(business.location) : [];
    const numLocations = Math.max(allLocations.length, 1);
    // How many unique keyword topics to generate = ceil(budget / locations)
    // NOTE: maxQueries is recalculated below after we know effectiveMaxQuerySlots
    let maxQueries = Math.ceil(maxQuerySlots / numLocations);
    const maxLocations = allLocations.length; // use all provided locations

    // Check if query-locations already exist (e.g., from webhook with pre-set queries)
    // Only count tracked (isTargetLocation=true) rows against the quota.
    const existingQLs = await getQueryLocationsByCampaignId(campaignId);
    const remainingSlots = maxQuerySlots - existingQLs.length;
    if (remainingSlots <= 0) {
      console.log(`[Pipeline] Campaign ${campaignId} already has ${existingQLs.length}/${maxQuerySlots} tracked query-locations — quota full, skipping keyword research`);
      await updateCampaign(campaignId, {
        keywordResearchCompletedAt: new Date(),
      });
      return {
        success: true,
        keywordsFound: existingQLs.length,
        queryLocationsCreated: 0,
        usedCache: false,
      };
    }
    // Adjust the slot budget to only fill remaining capacity
    const effectiveMaxQuerySlots = remainingSlots;
    // Recalculate maxQueries based on remaining slots
    maxQueries = Math.ceil(effectiveMaxQuerySlots / numLocations);
    console.log(`[Pipeline] Campaign ${campaignId} has ${existingQLs.length} existing tracked queries, filling ${effectiveMaxQuerySlots} remaining slots (quota: ${maxQuerySlots})`);

    // Determine the industry
    const industry = business.businessType || "general";

    // ── Pass 1: Keyword selection via DataForSEO keyword_suggestions ──────────
    // Build seeds from businessType + specialties. Feed into DataForSEO
    // keyword_suggestions, keep only commercial/transactional, sort by volume desc.
    // This replaces the old keywords_for_site approach.
    const { buildServiceSeeds } = await import("./dataforseoService");
    const seeds = buildServiceSeeds(business.businessType, business.specialties);

    let baseKeywords: string[] = [];
    let usedCache = false;

    if (seeds.length > 0) {
      try {
        const dfsKeywords = await getKeywordSuggestionsForProspect(seeds, {
          locationCode: 2840,
          languageCode: "en",
          limit: 200,
        });
        baseKeywords = dfsKeywords.slice(0, maxQueries).map((k) => k.keyword);
        console.log(`[Pipeline] DataForSEO keyword_suggestions returned ${dfsKeywords.length} commercial/transactional keywords, using top ${baseKeywords.length}`);

        await logDFSCost({
          campaignId,
          businessId: campaign.businessId,
          operationType: 'keyword_research',
          endpoint: '/dataforseo_labs/google/keyword_suggestions/live',
          costUsd: DFS_COSTS.keywordsForSite, // same cost tier
          campaignCreatedAt: campaign.createdAt,
          metadata: { seedCount: seeds.length, keywordsFound: dfsKeywords.length },
        });
      } catch (dfsErr: any) {
        console.warn(`[Pipeline] DataForSEO keyword_suggestions failed, using seed fallback: ${dfsErr.message}`);
      }
    }

    // Fallback: if DataForSEO returned nothing, expand seeds into buyer-intent queries
    if (baseKeywords.length === 0) {
      const { expandToBuyerIntentQueries } = await import("./dataforseoService");
      const fallbackQueries = expandToBuyerIntentQueries(seeds.length > 0 ? seeds : [industry], maxQueries, allLocations[0] ?? undefined);
      baseKeywords = fallbackQueries.slice(0, maxQueries);
      console.log(`[Pipeline] Using fallback buyer-intent expansion: ${baseKeywords.length} queries`);
    }

    // Contribute to industry cache for golden template learning
    await contributeToIndustryCache(
      industry,
      baseKeywords.map((kw) => ({
        keyword: kw,
        aiSearchVolume: 0,
        searchVolume: 0,
        searchIntent: "commercial",
      }))
    );

    // ── Build query×location matrix ──────────────────────────────────────────
    const locations: string[] = allLocations;

    if (locations.length === 0) {
      console.warn(`[Pipeline] No locations found for campaign ${campaignId} — matrix will be empty`);
      await updateCampaign(campaignId, {
        keywordResearchCompletedAt: new Date(),
        lastError: "No locations configured. Add locations to build query matrix.",
      });
      return {
        success: true,
        keywordsFound: baseKeywords.length,
        queryLocationsCreated: 0,
        usedCache,
      };
    }

    // Build keyword×location pairs, capped at effectiveMaxQuerySlots
    const matrixPairs: { keyword: string; location: string }[] = [];
    let slotsUsed = 0;
    outer: for (const kw of baseKeywords) {
      for (const location of locations) {
        if (slotsUsed >= effectiveMaxQuerySlots) break outer;
        matrixPairs.push({ keyword: kw, location });
        slotsUsed++;
      }
    }

    // ── Pass 2: Per-location volume lookup on final query+location strings ────
    // Hit AI volume endpoint first; fall back to Google Ads × 25% for zeros.
    const finalStrings = matrixPairs.map((p) => `${p.keyword} ${p.location}`);
    const aiVolumeMap = new Map<string, number>();
    const fallbackVolumeMap = new Map<string, number>();

    try {
      const aiVolumes = await getAIKeywordSearchVolume(finalStrings, { locationCode: 2840 });
      for (const v of aiVolumes) {
        if (v.aiSearchVolume > 0) aiVolumeMap.set(v.keyword.toLowerCase(), v.aiSearchVolume);
      }
      await logDFSCost({
        campaignId,
        businessId: campaign.businessId,
        operationType: 'keyword_research',
        endpoint: '/ai_optimization/ai_keyword_data/keywords_search_volume/live',
        costUsd: DFS_COSTS.aiKeywordVolume * finalStrings.length,
        campaignCreatedAt: campaign.createdAt,
        metadata: { keywordCount: finalStrings.length },
      });
    } catch (volErr: any) {
      console.warn(`[Pipeline] AI volume lookup failed: ${volErr.message}`);
    }

    // Google Ads fallback for any zero-AI-volume pairs
    const needsGoogleFallback = finalStrings.filter((s) => !aiVolumeMap.has(s.toLowerCase()));
    if (needsGoogleFallback.length > 0) {
      try {
        const googleVolMap = await getGoogleAdsSearchVolume(needsGoogleFallback, { locationCode: 2840 });
        for (const [k, v] of googleVolMap.entries()) {
          if (v > 0) fallbackVolumeMap.set(k, Math.round(v * 0.25));
        }
      } catch (gErr: any) {
        console.warn(`[Pipeline] Google Ads volume fallback failed: ${gErr.message}`);
      }
    }

    // Build final entries with accurate per-location volume
    const entries = matrixPairs.map((p) => {
      const key = `${p.keyword} ${p.location}`.toLowerCase();
      const aiVol = aiVolumeMap.get(key) ?? 0;
      const fallbackVol = fallbackVolumeMap.get(key) ?? 0;
      const finalVolume = aiVol > 0 ? aiVol : (fallbackVol > 0 ? fallbackVol : Math.round(100 * 0.25));
      return {
        campaignId,
        searchQuery: p.keyword,
        location: p.location,
        aiSearchVolume: finalVolume,
        trainingStatus: "pending" as const,
        trainingSessions: 0,
        isTargetLocation: true,
      };
    });

    if (entries.length > 0) {
      await createCampaignQueryLocations(entries);
    }

    // Update campaign status
    await updateCampaign(campaignId, {
      keywordResearchCompletedAt: new Date(),
      lastError: null,
    });

    console.log(
      `[Pipeline] Keyword research complete for campaign ${campaignId}: ${baseKeywords.length} keywords × ${locations.length} locations = ${entries.length} combos`
    );

    return {
      success: true,
      keywordsFound: baseKeywords.length,
      queryLocationsCreated: entries.length,
      usedCache,
    };
  } catch (err: any) {
    console.error(`[Pipeline] Keyword research failed for campaign ${campaignId}:`, err.message);

    await updateCampaign(campaignId, {
      lastError: `Keyword research failed: ${err.message}`,
      errorCount: (await getCampaignById(campaignId))?.errorCount
        ? ((await getCampaignById(campaignId))?.errorCount || 0) + 1
        : 1,
    }).catch(() => {});

    return {
      success: false,
      keywordsFound: 0,
      queryLocationsCreated: 0,
      usedCache: false,
      error: err.message,
    };
  }
}

// ============= Baseline Rank Check Pipeline =============

/**
 * Run the baseline rank check for a campaign.
 * Checks where the business currently appears in AI search results.
 */
export async function runCampaignBaselineCheck(campaignId: number): Promise<{
  success: boolean;
  mentionsFound: number;
  snapshotsCreated: number;
  error?: string;
}> {
  console.log(`[Pipeline] Starting baseline rank check for campaign ${campaignId}`);

  try {
    const campaign = await getCampaignById(campaignId);
    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    await updateCampaign(campaignId, { status: "baseline_check" });

    // Get business info
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const businessResult = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, campaign.businessId))
      .limit(1);

    if (businessResult.length === 0) throw new Error(`Business ${campaign.businessId} not found`);
    const business = businessResult[0]!;

    // Business name is required to detect mentions in LLM responses
    if (!business.name) {
      throw new Error("Business has no name — cannot run baseline check");
    }

    // Get the campaign's query-locations
    const queryLocations = await getQueryLocationsByCampaignId(campaignId);

    let snapshotsCreated = 0;
    let mentionsFound = 0;

    // ── Direct real-time LLM check per query ─────────────────────────────────
    // We ask ChatGPT, Gemini, and AI Overview directly for each tracked query
    // instead of using the DataForSEO domain-index lookup. This gives accurate
    // results for new/small businesses not yet in DataForSEO's index and avoids
    // the index-lag problem that caused all-zero baselines.
    console.log(`[Pipeline] Running direct LLM visibility checks for ${queryLocations.length} queries (business: "${business.name}")`);

    // Determine campaign scope — 'local' appends location, 'national'/'ecommerce' do not
    const campaignScope = (campaign as any).campaignScope ?? 'local';

    for (const ql of queryLocations) {
      // Build the query string — append location only for local-scope campaigns
      const queryWithLocation =
        campaignScope === 'local' && ql.location
          ? `${ql.searchQuery} in ${ql.location}`
          : ql.searchQuery;

      const mention = await checkLLMVisibilityDirect(
        queryWithLocation,
        business.name,
        business.agencyId ?? null,
        business.website ?? null,
        business.phone ?? null
      );

      const chatgptMentioned = mention.llmResponses.chatgpt?.mentioned || false;
      const geminiMentioned = mention.llmResponses.gemini?.mentioned || false;
      const aiOverviewMentioned = mention.llmResponses.aiOverview?.mentioned || false;

      await createRankSnapshot({
        campaignId,
        queryLocationId: ql.id,
        chatgptMentioned,
        chatgptPosition: mention.llmResponses.chatgpt?.position || null,
        chatgptResponseSnippet: mention.llmResponses.chatgpt?.snippet || null,
        geminiMentioned,
        geminiPosition: mention.llmResponses.gemini?.position || null,
        geminiResponseSnippet: mention.llmResponses.gemini?.snippet || null,
        aiOverviewMentioned,
        aiOverviewPosition: mention.llmResponses.aiOverview?.position || null,
        aiOverviewResponseSnippet: mention.llmResponses.aiOverview?.snippet || null,
        sourcesCited: null,
        checkType: "baseline",
        checkedAt: new Date(),
      });

      // Log rank check LLM costs (3 LLM calls per query: ChatGPT + Gemini + AI Overview)
      await logDFSCost({
        campaignId,
        businessId: campaign.businessId,
        operationType: 'rank_check',
        endpoint: 'direct_llm_check',
        costUsd: DFS_COSTS.llmResponse * 3,
        campaignCreatedAt: campaign.createdAt,
        metadata: { query: ql.searchQuery, location: ql.location, checkType: 'baseline' },
      });

      // Update the query-location with current rank status
      const isMentioned = chatgptMentioned || geminiMentioned || aiOverviewMentioned;
      if (isMentioned) mentionsFound++;

      await updateQueryLocation(ql.id, {
        currentRankChatGPT: chatgptMentioned ? "mentioned" : "not_mentioned",
        currentRankGemini: geminiMentioned ? "mentioned" : "not_mentioned",
        currentRankAIOverview: aiOverviewMentioned ? "mentioned" : "not_mentioned",
        lastRankCheckAt: new Date(),
        ...(isMentioned ? { firstMentionedAt: new Date() } : {}),
      });

      snapshotsCreated++;
    }

    // Update campaign
    await updateCampaign(campaignId, {
      baselineCheckCompletedAt: new Date(),
      lastError: null,
    });

    console.log(
      `[Pipeline] Baseline check complete for campaign ${campaignId}: ${mentionsFound} queries with mentions, ${snapshotsCreated} snapshots created`
    );

    // ── Separate queries into "not ranking" vs "already ranking" ──
    // Re-read the query locations to get the updated rank status we just wrote
    const updatedQls = await getQueryLocationsByCampaignId(campaignId);
    const notRankingQls: typeof updatedQls = [];
    const alreadyRankingQls: typeof updatedQls = [];

    for (const ql of updatedQls) {
      const isAlreadyRanking =
        ql.currentRankChatGPT === "mentioned" ||
        ql.currentRankGemini === "mentioned" ||
        ql.currentRankAIOverview === "mentioned";

      if (isAlreadyRanking) {
        alreadyRankingQls.push(ql);
      } else {
        notRankingQls.push(ql);
      }
    }

    // ── Send Day 1 baseline visibility email to client ──
    if (business.contactEmail) {
      try {
        const { sendBaselineVisibilityEmail } = await import("./emailService");
        const clientDashboardResult = await db
          .select()
          .from(require("../drizzle/schema").clientDashboards)
          .where(eq(require("../drizzle/schema").clientDashboards.campaignId, campaignId))
          .limit(1);
        const dashboardUrl = clientDashboardResult[0]?.accessToken
          ? `${process.env.APP_BASE_URL || ""}/report/${clientDashboardResult[0].accessToken}`
          : undefined;

        await sendBaselineVisibilityEmail({
          businessName: business.name,
          contactName: business.contactName || business.name,
          contactEmail: business.contactEmail,
          dashboardUrl,
          notRankingQueries: notRankingQls.map((ql) => ({
            query: ql.searchQuery,
            location: ql.location,
          })),
          alreadyRankingQueries: alreadyRankingQls.map((ql) => ({
            query: ql.searchQuery,
            location: ql.location,
          })),
        });
        console.log(`[Pipeline] Day 1 baseline email sent to ${business.contactEmail}`);
      } catch (emailErr: any) {
        console.error(`[Pipeline] Baseline email failed (non-fatal):`, emailErr.message);
      }
    }

    return {
      success: true,
      mentionsFound,
      snapshotsCreated,
    };
  } catch (err: any) {
    console.error(`[Pipeline] Baseline check failed for campaign ${campaignId}:`, err.message);

    await updateCampaign(campaignId, {
      lastError: `Baseline check failed: ${err.message}`,
    }).catch(() => {});

    return {
      success: false,
      mentionsFound: 0,
      snapshotsCreated: 0,
      error: err.message,
    };
  }
}
