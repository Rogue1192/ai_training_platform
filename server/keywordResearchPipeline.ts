import {
  runKeywordResearchPipeline,
  runBaselineRankCheck,
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

    const maxQueries = packageTier?.maxQueries || 5;
    const maxLocations = packageTier?.maxLocations || 3;

    // Check if query-locations already exist (e.g., from webhook with pre-set queries)
    const existingQLs = await getQueryLocationsByCampaignId(campaignId);
    if (existingQLs.length > 0) {
      console.log(`[Pipeline] Campaign ${campaignId} already has ${existingQLs.length} query-locations, skipping keyword research`);
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

    // Determine the industry
    const industry = business.businessType || "general";

    // Step 1: Check industry cache
    let topKeywords: { keyword: string; aiSearchVolume: number; searchVolume: number; searchIntent: string | null }[] = [];
    let usedCache = false;

    const goldenTemplate = await getGoldenTemplateKeywords(industry);

    if (goldenTemplate) {
      // Use cached golden template — no API call needed!
      topKeywords = goldenTemplate.slice(0, maxQueries).map((k) => ({
        keyword: k.keyword,
        aiSearchVolume: k.aiSearchVolume,
        searchVolume: k.searchVolume,
        searchIntent: k.searchIntent,
      }));
      usedCache = true;
      console.log(`[Pipeline] Using golden template for "${industry}" — saved API costs!`);
    } else {
      // Step 2: Run fresh keyword research
      if (!business.website) {
        throw new Error("Business has no website URL — cannot run keyword research");
      }

      const research = await runKeywordResearchPipeline(business.website, {
        maxKeywords: maxQueries,
      });

      topKeywords = research.topKeywords;

      // Step 3: Contribute to industry cache
      await contributeToIndustryCache(
        industry,
        research.topKeywords.map((k) => ({
          keyword: k.keyword,
          aiSearchVolume: k.aiSearchVolume,
          searchVolume: k.searchVolume,
          searchIntent: k.searchIntent,
        }))
      );
    }

    // Step 4: Build query×location matrix
    // Get locations from the business record
    const locations: string[] = [];
    if (business.location) {
      // Parse the ";"-delimited location string (legacy "City, ST" comma
      // fallback handled in shared/location.ts) into individual locations.
      const parsed = parseLocations(business.location);
      locations.push(...parsed.slice(0, maxLocations));
    }

    // If no locations found, we can't build the matrix
    if (locations.length === 0) {
      console.warn(`[Pipeline] No locations found for campaign ${campaignId} — matrix will be empty`);
      await updateCampaign(campaignId, {
        keywordResearchCompletedAt: new Date(),
        lastError: "No locations configured. Add locations to build query matrix.",
      });
      return {
        success: true,
        keywordsFound: topKeywords.length,
        queryLocationsCreated: 0,
        usedCache,
      };
    }

    // Build the matrix
    const entries = [];
    for (const kw of topKeywords) {
      for (const location of locations) {
        entries.push({
          campaignId,
          searchQuery: kw.keyword,
          location,
          aiSearchVolume: kw.aiSearchVolume,
          trainingStatus: "pending" as const,
          trainingSessions: 0,
        });
      }
    }

    if (entries.length > 0) {
      await createCampaignQueryLocations(entries);
    }

    // Step 5: Update campaign status
    await updateCampaign(campaignId, {
      keywordResearchCompletedAt: new Date(),
      lastError: null,
    });

    console.log(
      `[Pipeline] Keyword research complete for campaign ${campaignId}: ${topKeywords.length} keywords × ${locations.length} locations = ${entries.length} combos`
    );

    return {
      success: true,
      keywordsFound: topKeywords.length,
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

    if (!business.website) {
      throw new Error("Business has no website URL — cannot run baseline check");
    }

    // Run the baseline check via DataForSEO
    const mentions = await runBaselineRankCheck(business.website);

    // Get the campaign's query-locations to match against
    const queryLocations = await getQueryLocationsByCampaignId(campaignId);

    let snapshotsCreated = 0;

    // Create rank snapshots for each query-location
    for (const ql of queryLocations) {
      // Find if this query has a mention
      const mention = mentions.find(
        (m) => m.keyword.toLowerCase() === ql.searchQuery.toLowerCase()
      );

      const snapshot = await createRankSnapshot({
        campaignId,
        queryLocationId: ql.id,
        chatgptMentioned: mention?.llmResponses.chatgpt?.mentioned || false,
        chatgptPosition: mention?.llmResponses.chatgpt?.position || null,
        chatgptResponseSnippet: mention?.llmResponses.chatgpt?.snippet || null,
        geminiMentioned: mention?.llmResponses.gemini?.mentioned || false,
        geminiPosition: mention?.llmResponses.gemini?.position || null,
        geminiResponseSnippet: mention?.llmResponses.gemini?.snippet || null,
        aiOverviewMentioned: mention?.llmResponses.aiOverview?.mentioned || false,
        aiOverviewPosition: mention?.llmResponses.aiOverview?.position || null,
        aiOverviewResponseSnippet: mention?.llmResponses.aiOverview?.snippet || null,
        sourcesCited: mention
          ? [
              ...(mention.llmResponses.chatgpt?.sourcesCited || []),
              ...(mention.llmResponses.gemini?.sourcesCited || []),
              ...(mention.llmResponses.aiOverview?.sourcesCited || []),
            ]
          : null,
        checkType: "baseline",
        checkedAt: new Date(),
      });

      // Update the query-location with current rank status
      const isMentioned =
        mention?.llmResponses.chatgpt?.mentioned ||
        mention?.llmResponses.gemini?.mentioned ||
        mention?.llmResponses.aiOverview?.mentioned;

      await updateQueryLocation(ql.id, {
        currentRankChatGPT: mention?.llmResponses.chatgpt?.mentioned ? "mentioned" : "not_mentioned",
        currentRankGemini: mention?.llmResponses.gemini?.mentioned ? "mentioned" : "not_mentioned",
        currentRankAIOverview: mention?.llmResponses.aiOverview?.mentioned ? "mentioned" : "not_mentioned",
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
      `[Pipeline] Baseline check complete for campaign ${campaignId}: ${mentions.length} total mentions, ${snapshotsCreated} snapshots created`
    );

    // ── Separate queries into "not ranking" (record video) vs "already ranking" (skip) ──
    const notRankingQls: typeof queryLocations = [];
    const alreadyRankingQls: typeof queryLocations = [];

    for (const ql of queryLocations) {
      const mention = mentions.find(
        (m) => m.keyword.toLowerCase() === ql.searchQuery.toLowerCase()
      );
      const isAlreadyRanking =
        mention?.llmResponses.chatgpt?.mentioned ||
        mention?.llmResponses.gemini?.mentioned ||
        mention?.llmResponses.aiOverview?.mentioned;

      if (isAlreadyRanking) {
        alreadyRankingQls.push(ql);
        console.log(`[Pipeline] Skipping video for already-ranking query: "${ql.searchQuery}" in ${ql.location}`);
      } else {
        notRankingQls.push(ql);
      }
    }

    // ── Record "before" videos for queries where client is NOT ranking ──
    if (notRankingQls.length > 0) {
      try {
        const { recordBaselineVideos } = await import("./scanVideoRecorder");
        await recordBaselineVideos(
          campaignId,
          notRankingQls.map((ql) => ({
            id: ql.id,
            searchQuery: ql.searchQuery,
            location: ql.location,
          }))
        );
        console.log(`[Pipeline] Baseline videos recorded for ${notRankingQls.length} queries`);
      } catch (videoErr: any) {
        console.error(`[Pipeline] Baseline video recording failed (non-fatal):`, videoErr.message);
      }
    }

    // ── Send Day 1 baseline visibility email to client ──
    if (business.contactEmail) {
      try {
        const { sendBaselineVisibilityEmail } = await import("./emailService");
        // Fetch updated query-locations with video URLs
        const updatedQls = await getQueryLocationsByCampaignId(campaignId);
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
          notRankingQueries: notRankingQls.map((ql) => {
            const updated = updatedQls.find((u) => u.id === ql.id);
            return {
              query: ql.searchQuery,
              location: ql.location,
              beforeVideoChatgpt: (updated as any)?.beforeVideoChatgpt || undefined,
              beforeVideoGoogleAi: (updated as any)?.beforeVideoGoogleAi || undefined,
            };
          }),
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
      mentionsFound: mentions.length,
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
