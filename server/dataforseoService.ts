import axios from "axios";

// ============= DataForSEO API Client =============

const DATAFORSEO_BASE = "https://api.dataforseo.com/v3";

async function getAuthHeader(): Promise<string> {
  // Try DB first (set via Settings UI)
  try {
    const { getServiceKey } = await import("./db");
    const { decrypt } = await import("./encryption");
    const record = await getServiceKey("dataforseo");
    if (record?.encryptedValue) {
      const creds = JSON.parse(decrypt(record.encryptedValue)) as { login: string; password: string };
      if (creds.login && creds.password) {
        return "Basic " + Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
      }
    }
  } catch {
    // Fall through to env var
  }
  // Fallback to env vars (Railway secrets)
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DataForSEO credentials not configured. Please add them in Settings → Service Keys.");
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function dfsFetch<T = any>(endpoint: string, body: any[]): Promise<T> {
  const response = await axios.post(`${DATAFORSEO_BASE}${endpoint}`, body, {
    headers: {
      "Content-Type": "application/json",
      Authorization: await getAuthHeader(),
    },
    timeout: 120_000, // 2 minutes — some endpoints are slow
  });

  if (response.data?.status_code !== 20000) {
    throw new Error(
      `DataForSEO API error: ${response.data?.status_message || "Unknown error"} (code: ${response.data?.status_code})`
    );
  }

  return response.data;
}

// ============= Types =============

export interface KeywordForSiteResult {
  keyword: string;
  searchVolume: number;
  competition: number | null;
  cpc: number | null;
  searchIntent: string | null; // 'commercial' | 'informational' | 'navigational' | 'transactional'
  monthlySearches: { year: number; month: number; search_volume: number }[] | null;
}

export interface AIKeywordVolumeResult {
  keyword: string;
  aiSearchVolume: number;
  monthlyTrend: { year: number; month: number; count: number }[] | null;
}

export interface LLMMentionResult {
  keyword: string;
  aiSearchVolume: number;
  monthlyTrend: { year: number; month: number; count: number }[] | null;
  llmResponses: {
    chatgpt?: {
      mentioned: boolean;
      position: number | null;
      snippet: string | null;
      sourcesCited: string[];
    };
    gemini?: {
      mentioned: boolean;
      position: number | null;
      snippet: string | null;
      sourcesCited: string[];
    };
    aiOverview?: {
      mentioned: boolean;
      position: number | null;
      snippet: string | null;
      sourcesCited: string[];
    };
  };
  relatedQueries: string[];
}

export interface KeywordResearchResult {
  keywords: KeywordForSiteResult[];
  aiVolumes: AIKeywordVolumeResult[];
  topKeywords: {
    keyword: string;
    searchVolume: number;
    aiSearchVolume: number;
    searchIntent: string | null;
  }[];
}

// ============= API Methods =============

/**
 * Get keywords from a website domain using DataForSEO Labs
 * Returns up to `limit` keywords sorted by search volume
 */
export async function getKeywordsForSite(
  domain: string,
  options: {
    locationCode?: number;
    languageCode?: string;
    limit?: number;
    filters?: string[][];
  } = {}
): Promise<KeywordForSiteResult[]> {
  const {
    locationCode = 2840, // US
    languageCode = "en",
    limit = 500,
  } = options;

  console.log(`[DataForSEO] Fetching keywords for site: ${domain} (limit: ${limit})`);

  const data = await dfsFetch("/dataforseo_labs/google/keywords_for_site/live", [
    {
      target: domain.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      location_code: locationCode,
      language_code: languageCode,
      limit,
      include_serp_info: false,
      order_by: ["keyword_info.search_volume,desc"],
      filters: options.filters || [["keyword_info.search_volume", ">", 0]],
    },
  ]);

  const items = data?.tasks?.[0]?.result?.[0]?.items || [];

  return items.map((item: any) => ({
    keyword: item.keyword,
    searchVolume: item.keyword_info?.search_volume || 0,
    competition: item.keyword_info?.competition || null,
    cpc: item.keyword_info?.cpc || null,
    searchIntent: item.search_intent_info?.main_intent || null,
    monthlySearches: item.keyword_info?.monthly_searches || null,
  }));
}

/**
 * Get AI search volume for a list of keywords
 * This tells you how often each keyword is asked in AI search engines
 */
export async function getAIKeywordSearchVolume(
  keywords: string[],
  options: {
    locationCode?: number;
    languageCode?: string;
  } = {}
): Promise<AIKeywordVolumeResult[]> {
  const {
    locationCode = 2840,
    languageCode = "en",
  } = options;

  if (keywords.length === 0) return [];

  // API accepts up to 1000 keywords per request
  const batches: string[][] = [];
  for (let i = 0; i < keywords.length; i += 1000) {
    batches.push(keywords.slice(i, i + 1000));
  }

  console.log(`[DataForSEO] Checking AI search volume for ${keywords.length} keywords in ${batches.length} batch(es)`);

  const allResults: AIKeywordVolumeResult[] = [];

  for (const batch of batches) {
    const data = await dfsFetch("/ai_optimization/ai_keyword_data/keywords_search_volume/live", [
      {
        keywords: batch,
        location_code: locationCode,
        language_code: languageCode,
      },
    ]);

    const resultSets = data?.tasks?.[0]?.result || [];

    for (const resultSet of resultSets) {
      const items = resultSet.items || [];
      for (const item of items) {
        allResults.push({
          keyword: item.keyword,
          aiSearchVolume: item.ai_search_volume || 0,
          monthlyTrend: item.ai_monthly_searches
            ? item.ai_monthly_searches.map((m: any) => ({
                year: m.year,
                month: m.month,
                count: m.ai_search_volume || 0,
              }))
            : null,
        });
      }
    }
  }

  return allResults;
}

/**
 * Search for LLM mentions of a brand/domain
 * This is the rank tracking API — tells you where a business appears in AI responses
 */
export async function searchLLMMentions(
  target: string,
  options: {
    locationCode?: number;
    languageCode?: string;
    limit?: number;
    targetType?: "domain" | "brand";
  } = {}
): Promise<LLMMentionResult[]> {
  const {
    locationCode = 2840,
    languageCode = "en",
    limit = 100,
    targetType = "domain",
  } = options;

  console.log(`[DataForSEO] Searching LLM mentions for: ${target} (type: ${targetType}, limit: ${limit})`);

  const requestBody: any = {
    target,
    location_code: locationCode,
    language_code: languageCode,
    limit,
  };

  // If target looks like a domain, use it as-is. If it's a brand name, we still pass it as target.
  // The API handles both.

  const data = await dfsFetch("/ai_optimization/llm_mentions/search/live", [requestBody]);

  const items = data?.tasks?.[0]?.result?.[0]?.items || [];

  return items.map((item: any) => {
    const llmResponses: LLMMentionResult["llmResponses"] = {};

    // Parse ChatGPT mentions
    if (item.chatgpt_responses) {
      for (const resp of item.chatgpt_responses) {
        llmResponses.chatgpt = {
          mentioned: true,
          position: resp.position || null,
          snippet: resp.text?.substring(0, 500) || null,
          sourcesCited: resp.references?.map((r: any) => r.url).filter(Boolean) || [],
        };
      }
    }

    // Parse Gemini/AI Overview mentions
    if (item.google_ai_overview_responses) {
      for (const resp of item.google_ai_overview_responses) {
        llmResponses.aiOverview = {
          mentioned: true,
          position: resp.position || null,
          snippet: resp.text?.substring(0, 500) || null,
          sourcesCited: resp.references?.map((r: any) => r.url).filter(Boolean) || [],
        };
      }
    }

    // Parse Gemini responses
    if (item.gemini_responses) {
      for (const resp of item.gemini_responses) {
        llmResponses.gemini = {
          mentioned: true,
          position: resp.position || null,
          snippet: resp.text?.substring(0, 500) || null,
          sourcesCited: resp.references?.map((r: any) => r.url).filter(Boolean) || [],
        };
      }
    }

    return {
      keyword: item.keyword || "",
      aiSearchVolume: item.ai_search_volume || 0,
      monthlyTrend: item.monthly_searches
        ? item.monthly_searches.map((m: any) => ({
            year: m.year,
            month: m.month,
            count: m.search_volume || m.count || 0,
          }))
        : null,
      llmResponses,
      relatedQueries: item.related_queries?.map((q: any) => q.keyword || q).filter(Boolean) || [],
    };
  });
}

// ============= High-Level Pipeline Functions =============

/**
 * Full keyword research pipeline for a new client:
 * 1. Get keywords from their website
 * 2. Filter to ONLY commercial and transactional intent — informational/navigational are useless for AI citation
 * 3. Check AI search volume for those buyer-intent keywords
 * 4. Sort by AI search volume desc and return up to maxKeywords
 *
 * NOTE: If fewer than maxKeywords commercial/transactional keywords exist, we return only what's available.
 * We do NOT fall back to informational keywords — they are not relevant to purchase-intent AI queries.
 */
export async function runKeywordResearchPipeline(
  domain: string,
  options: {
    maxKeywords: number; // Cap from package tier (e.g. 5 or 10)
    locationCode?: number;
    languageCode?: string;
  }
): Promise<KeywordResearchResult> {
  const { maxKeywords, locationCode = 2840, languageCode = "en" } = options;

  console.log(`[DataForSEO] Starting keyword research pipeline for ${domain} (max: ${maxKeywords})`);

  // Step 1: Fetch a broad set of keywords from the site — we pull more than needed so filtering has room to work
  const siteKeywords = await getKeywordsForSite(domain, {
    locationCode,
    languageCode,
    limit: Math.min(maxKeywords * 20, 500), // Pull 20x so we have enough after filtering
  });

  if (siteKeywords.length === 0) {
    return { keywords: [], aiVolumes: [], topKeywords: [] };
  }

  // Step 2: Filter to ONLY commercial and transactional intent keywords
  // Informational ("how does X work") and navigational ("X brand website") are irrelevant for
  // AI citation campaigns — we only want buyer-intent queries like "best X near me" or "X service cost"
  const buyerIntentKeywords = siteKeywords.filter(
    (k) => k.searchIntent === "commercial" || k.searchIntent === "transactional"
  );

  console.log(
    `[DataForSEO] Intent filter: ${buyerIntentKeywords.length} commercial/transactional out of ${siteKeywords.length} total keywords`
  );

  if (buyerIntentKeywords.length === 0) {
    console.warn(`[DataForSEO] WARNING: No commercial/transactional keywords found for ${domain}. Returning empty.`);
    return { keywords: siteKeywords, aiVolumes: [], topKeywords: [] };
  }

  // Step 3: Check AI search volume only for buyer-intent keywords (saves API credits)
  const keywordStrings = buyerIntentKeywords.map((k) => k.keyword);
  const aiVolumes = await getAIKeywordSearchVolume(keywordStrings, {
    locationCode,
    languageCode,
  });

  console.log(`[DataForSEO] Got AI search volume for ${aiVolumes.length} buyer-intent keywords`);

  // Step 4: Merge AI volume data back into buyer-intent keyword list
  const aiVolumeMap = new Map(aiVolumes.map((v) => [v.keyword.toLowerCase(), v]));

  const merged = buyerIntentKeywords.map((k) => {
    const aiData = aiVolumeMap.get(k.keyword.toLowerCase());
    return {
      keyword: k.keyword,
      searchVolume: k.searchVolume,
      aiSearchVolume: aiData?.aiSearchVolume || 0,
      searchIntent: k.searchIntent,
    };
  });

  // Step 5: Sort by AI search volume desc, then regular search volume as tiebreaker
  merged.sort((a, b) => {
    if (b.aiSearchVolume !== a.aiSearchVolume) return b.aiSearchVolume - a.aiSearchVolume;
    return b.searchVolume - a.searchVolume;
  });

  // Step 6: Cap at maxKeywords — if fewer buyer-intent keywords exist, we use fewer (no informational fallback)
  const topKeywords = merged.slice(0, maxKeywords);

  console.log(
    `[DataForSEO] Pipeline complete: ${topKeywords.length} keywords selected ` +
    `(${buyerIntentKeywords.length} commercial/transactional available, capped at ${maxKeywords})`
  );

  return {
    keywords: siteKeywords,
    aiVolumes,
    topKeywords,
  };
}

/**
 * Run a baseline rank check for a business domain
 * Returns all queries where the business is currently mentioned in AI responses
 */
export async function runBaselineRankCheck(
  domain: string,
  options: {
    locationCode?: number;
    languageCode?: string;
    limit?: number;
  } = {}
): Promise<LLMMentionResult[]> {
  const { locationCode = 2840, languageCode = "en", limit = 200 } = options;

  console.log(`[DataForSEO] Running baseline rank check for: ${domain}`);

  const mentions = await searchLLMMentions(domain, {
    locationCode,
    languageCode,
    limit,
    targetType: "domain",
  });

  console.log(`[DataForSEO] Baseline check found ${mentions.length} queries with mentions`);

  return mentions;
}

/**
 * Check rank for specific query+location combinations
 * Used for ongoing rank tracking of campaign targets
 */
export async function checkRankForQueries(
  domain: string,
  queries: { query: string; location: string }[],
  options: {
    languageCode?: string;
  } = {}
): Promise<Map<string, LLMMentionResult | null>> {
  const { languageCode = "en" } = options;
  const results = new Map<string, LLMMentionResult | null>();

  for (const { query } of queries) {
    try {
      const mentions = await searchLLMMentions(domain, {
        languageCode,
        limit: 1,
        targetType: "domain",
      });
      results.set(query, mentions[0] || null);
    } catch (err) {
      console.error(`[DataForSEO] Failed to check rank for query "${query}":`, err);
      results.set(query, null);
    }
  }

  return results;
}
