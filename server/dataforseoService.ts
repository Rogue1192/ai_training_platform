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

// ---- Industry-relevance seeding ----
// Keyword research seeded from a bare domain returns generic high-volume
// fallbacks (e.g. "banks near me") when a small site has little ranking data.
// To keep results on-topic we derive buyer-intent seed queries from the
// business's own businessType + specialties (relevant by construction) and use
// a stem-based relevance filter to drop off-topic domain keywords.

// Words that carry no industry signal — excluded from the relevance vocabulary
// so we don't match generic keywords via them.
const QUERY_STOPWORDS = new Set([
  "near", "best", "top", "rated", "affordable", "cheap", "local", "me",
  "company", "companies", "service", "services", "the", "and", "for", "with",
]);

// Generic service action-words shared across local/home-service verticals. A
// specialty fragment counts as a real service if it contains one of these, even
// when its vocabulary differs from the businessType (e.g. a "plumbing" business
// offering "drain cleaning" / "water heater installation"). Kept to action
// words (not object nouns like "carpet") so the accompanying verb carries it.
const SERVICE_HEADS = new Set([
  "cleaning", "cleanup", "cleanout", "maid", "janitorial", "housekeeping",
  "repair", "installation", "install", "replacement", "maintenance",
  "inspection", "removal", "restoration", "remediation", "hauling",
  "landscaping", "mowing", "paving", "roofing", "painting", "remodeling",
  "remodel", "plumbing", "heating", "cooling", "hvac", "electrical", "wiring",
  "pest", "towing", "moving", "detailing", "grooming", "sealing", "staining",
  "grading", "excavation", "fencing", "flooring", "tiling", "drywall",
  "insulation", "waterproofing",
]);

// Geography / marketing filler tokens. A fragment containing one of these is
// dropped unless it also names a real service (has a SERVICE_HEADS word).
const NON_SERVICE_TOKENS = new Set([
  "county", "city", "area", "areas", "radius", "mile", "miles", "region",
  "homes", "home", "businesses", "residents", "customers", "clients",
  "products", "product", "quality", "satisfaction", "guarantee", "family",
  "owned", "operated", "trusted", "west", "east", "north", "south", "western",
  "eastern", "northern", "southern", "half", "surrounding", "greater",
]);

// Leading filler words stripped from the front of a service phrase.
const LEADING_FILLER = new Set([
  "professional", "recurring", "our", "the", "a", "an", "full", "complete",
  "quality", "affordable", "reliable", "expert",
]);

/** Lowercase, strip punctuation (keep hyphens), collapse whitespace. */
function normalizePhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Basic plural normalization for whole-word matching. Only strips a trailing
 * "s" (and removes hyphens); it does NOT strip -ing/-er, so "server" and
 * "serving" stay distinct — avoiding the false collisions a blunt prefix stem
 * would cause.
 */
function normWord(word: string): string {
  const w = word.replace(/-/g, "");
  return w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w;
}

/** Meaningful (>=3 char) words of a phrase, hyphens removed. */
function phraseWords(phrase: string): string[] {
  return normalizePhrase(phrase)
    .split(" ")
    .map((w) => w.replace(/-/g, ""))
    .filter((w) => w.length >= 3);
}

/**
 * Build a small set of clean, service-specific seed phrases from the business's
 * type + specialties. businessType is the reliable floor. A specialty fragment
 * is kept when it names a real service — either it contains a generic service
 * action-word (SERVICE_HEADS, so "drain cleaning" survives under "plumbing") or
 * it shares a word with the businessType — and it is not pure geography/marketing
 * filler. So "deep cleaning" / "pipe repair" survive but "homes and businesses"
 * and "Cullman County" do not.
 */
export function buildServiceSeeds(
  businessType?: string | null,
  specialties?: string | null
): string[] {
  const seeds: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    let words = normalizePhrase(raw).split(" ").filter(Boolean);
    while (words.length > 1 && LEADING_FILLER.has(words[0]!)) words.shift();
    words = words.slice(0, 5);
    const n = words.join(" ").trim();
    if (!n) return;
    if (!words.some((w) => w.replace(/-/g, "").length >= 4)) return; // needs a meaningful word
    if (seen.has(n)) return;
    seen.add(n);
    seeds.push(n);
  };

  // businessType words used for the "shares vocabulary" check (minus generic
  // stopwords like "services" so they don't over-match).
  const typeWords = new Set(
    (businessType ? phraseWords(businessType) : [])
      .map(normWord)
      .filter((w) => w.length >= 4 && !QUERY_STOPWORDS.has(w))
  );

  if (businessType && normalizePhrase(businessType)) add(businessType);

  if (specialties) {
    // Only mine the leading clause; prose after the first sentence is usually
    // marketing copy, not a service list.
    const head = specialties.split(/(?<=\.)\s/)[0] || specialties;
    const fragments = head.split(/[,;/]|\band\b|\bplus\b|\bfor\b|\bacross\b/i);
    for (const frag of fragments) {
      if (seeds.length >= 8) break;
      const words = phraseWords(frag);
      if (words.length === 0 || words.length > 4) continue;
      const hasServiceHead = words.some((w) => SERVICE_HEADS.has(normWord(w)));
      const sharesType = words.some((w) => typeWords.has(normWord(w)));
      const hasGeoFiller = words.some((w) => NON_SERVICE_TOKENS.has(normWord(w)));
      // Keep real services; drop geography/filler unless it also names a service.
      if ((hasServiceHead || sharesType) && !(hasGeoFiller && !hasServiceHead)) {
        add(frag);
      }
    }
  }

  return seeds.slice(0, 8);
}

/** Expand seed service phrases into buyer-intent query candidates. */
export function expandToBuyerIntentQueries(seeds: string[], maxKeywords: number): string[] {
  const templates = (s: string) => [
    `${s} near me`,
    `best ${s}`,
    `${s} company`,
    `affordable ${s}`,
    `top rated ${s}`,
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    if (!seen.has(q)) { seen.add(q); out.push(q); }
  };
  // Round-robin over template index so each seed contributes its primary variant first.
  const perSeed = seeds.map(templates);
  for (let t = 0; t < 5; t++) {
    for (const variants of perSeed) push(variants[t]!);
  }
  return out.slice(0, Math.max(maxKeywords * 3, 15));
}

/** Whole-word vocabulary of the seed phrases, used to filter domain keywords. */
export function seedStemVocab(seeds: string[]): Set<string> {
  const vocab = new Set<string>();
  for (const s of seeds) {
    for (const w of phraseWords(s)) {
      const nw = normWord(w);
      if (nw.length >= 4 && !QUERY_STOPWORDS.has(nw)) vocab.add(nw);
    }
  }
  return vocab;
}

/** A keyword is relevant if it shares a (plural-normalized) word with the vocab. */
export function isRelevantKeyword(keyword: string, vocab: Set<string>): boolean {
  if (vocab.size === 0) return true; // no signal -> don't filter
  return phraseWords(keyword).some((w) => {
    const nw = normWord(w);
    return nw.length >= 4 && vocab.has(nw);
  });
}

/**
 * Full keyword research pipeline for a new client:
 * 1. Derive industry-relevant buyer-intent seed queries from businessType +
 *    specialties (relevant by construction; prevents generic "near me" junk).
 * 2. Pull the domain's ranked keywords, keep commercial/transactional intent,
 *    and drop off-topic ones via the seed relevance filter.
 * 3. Check AI search volume for the combined candidate set.
 * 4. Sort by AI search volume desc and return up to maxKeywords.
 *
 * If businessType/specialties are absent, we fall back to the previous
 * domain-only behavior (no relevance filter) so nothing regresses.
 */
export async function runKeywordResearchPipeline(
  domain: string,
  options: {
    maxKeywords: number; // Cap from package tier (e.g. 5 or 10)
    businessType?: string | null;
    specialties?: string | null;
    locationCode?: number;
    languageCode?: string;
  }
): Promise<KeywordResearchResult> {
  const { maxKeywords, businessType, specialties, locationCode = 2840, languageCode = "en" } = options;

  console.log(`[DataForSEO] Starting keyword research pipeline for ${domain} (max: ${maxKeywords})`);

  // Step 1: Derive industry-relevant buyer-intent seeds from the business's own
  // type + specialties. These are relevant by construction and are the primary
  // source; the domain's ranked keywords are only a supplement below.
  const seeds = buildServiceSeeds(businessType, specialties);
  const seededQueries = seeds.length ? expandToBuyerIntentQueries(seeds, maxKeywords) : [];
  const relevanceVocab = seedStemVocab(seeds);
  if (seeds.length) {
    console.log(`[DataForSEO] Seeded ${seededQueries.length} buyer-intent queries from ${seeds.length} service seed(s): ${seeds.join(" | ")}`);
  } else {
    console.log(`[DataForSEO] No businessType/specialties signal — falling back to domain-only keyword research`);
  }

  // Step 2: Pull the domain's ranked keywords, keep commercial/transactional
  // intent, then drop off-topic ones when we have a relevance signal. This is
  // what prevents generic high-volume fallbacks (e.g. "banks near me") from winning.
  const siteKeywords = await getKeywordsForSite(domain, {
    locationCode,
    languageCode,
    limit: Math.min(maxKeywords * 20, 500),
  });

  const buyerIntentKeywords = siteKeywords.filter(
    (k) => k.searchIntent === "commercial" || k.searchIntent === "transactional"
  );
  const relevantSiteKeywords = buyerIntentKeywords.filter((k) =>
    isRelevantKeyword(k.keyword, relevanceVocab)
  );
  console.log(
    `[DataForSEO] Domain keywords: ${siteKeywords.length} total -> ${buyerIntentKeywords.length} buyer-intent -> ${relevantSiteKeywords.length} on-topic`
  );

  // Step 3: Candidate set = seeded queries + on-topic domain keywords (deduped).
  const siteByKeyword = new Map(relevantSiteKeywords.map((k) => [k.keyword.toLowerCase(), k]));
  const candidateStrings: string[] = [];
  const seenCandidate = new Set<string>();
  for (const q of [...seededQueries, ...relevantSiteKeywords.map((k) => k.keyword)]) {
    const key = q.toLowerCase();
    if (!seenCandidate.has(key)) {
      seenCandidate.add(key);
      candidateStrings.push(q);
    }
  }

  if (candidateStrings.length === 0) {
    console.warn(`[DataForSEO] No relevant keyword candidates for ${domain}. Returning empty.`);
    return { keywords: siteKeywords, aiVolumes: [], topKeywords: [] };
  }

  // Step 4: Check AI search volume for the candidates — this ranks them.
  const aiVolumes = await getAIKeywordSearchVolume(candidateStrings, {
    locationCode,
    languageCode,
  });
  const aiVolumeMap = new Map(aiVolumes.map((v) => [v.keyword.toLowerCase(), v]));
  console.log(`[DataForSEO] Got AI search volume for ${aiVolumes.length} candidate keywords`);

  const merged = candidateStrings.map((kw) => {
    const site = siteByKeyword.get(kw.toLowerCase());
    return {
      keyword: kw,
      searchVolume: site?.searchVolume || 0,
      aiSearchVolume: aiVolumeMap.get(kw.toLowerCase())?.aiSearchVolume || 0,
      // Seeded queries are buyer-intent by construction; domain keywords carry their own intent.
      searchIntent: site?.searchIntent || "commercial",
    };
  });

  // Step 5: Anchor-slot strategy.
  // Each bare seed (e.g. "house cleaning") gets a guaranteed slot before any
  // modifier variants ("best house cleaning", "top rated house cleaning", etc.)
  // are allowed to fill remaining capacity.  This prevents a scenario where
  // every slot is consumed by modifier-heavy variants and the foundational
  // service term is never trained on.
  //
  // Algorithm:
  //   a) Sort the full candidate list by AI volume desc (tiebreak: SEO volume).
  //   b) Walk the sorted list; mark the FIRST occurrence of each bare seed as
  //      an "anchor" and promote it to the front of the output list.
  //   c) Fill remaining slots from the sorted list, skipping already-selected.

  merged.sort((a, b) => {
    if (b.aiSearchVolume !== a.aiSearchVolume) return b.aiSearchVolume - a.aiSearchVolume;
    return b.searchVolume - a.searchVolume;
  });

  // Build a normalised set of bare seed strings for anchor detection.
  const bareSeedSet = new Set(seeds.map((s) => s.toLowerCase().trim()));

  // Identify the best (highest-volume) representative of each bare seed.
  const anchorMap = new Map<string, (typeof merged)[0]>(); // seed -> best candidate
  for (const item of merged) {
    const kw = item.keyword.toLowerCase();
    for (const seed of bareSeedSet) {
      // A keyword is the bare-seed representative if it IS the seed (possibly
      // with a location suffix added later) or equals it exactly.
      // We match: keyword starts with seed and contains no extra modifier words
      // ("best", "top", "affordable", "near me", "company").
      const withoutSeed = kw.replace(seed, "").trim();
      const isModified = /\b(best|top|affordable|near me|company|rated|trusted|leading|#1|number one)\b/.test(withoutSeed);
      if ((kw === seed || kw.startsWith(seed + " ")) && !isModified) {
        if (!anchorMap.has(seed)) anchorMap.set(seed, item);
        break;
      }
    }
  }

  const anchors = Array.from(anchorMap.values());
  const anchorKeywords = new Set(anchors.map((a) => a.keyword.toLowerCase()));

  // Fill remaining slots from the volume-sorted list, skipping anchors already included.
  const fillers = merged.filter((item) => !anchorKeywords.has(item.keyword.toLowerCase()));

  const combined = [...anchors, ...fillers];
  const topKeywords = combined.slice(0, maxKeywords);

  console.log(
    `[DataForSEO] Pipeline complete: ${topKeywords.length} on-topic keywords selected from ${candidateStrings.length} candidates (${anchors.length} anchor slots reserved for bare service terms)`
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

// ============= Direct LLM Visibility Check =============

/**
 * Result of a direct real-time LLM visibility check for a single query.
 * Mirrors the shape of LLMMentionResult.llmResponses so callers can use
 * the same snapshot-creation code regardless of which method was used.
 */
export interface DirectVisibilityResult {
  keyword: string;
  llmResponses: {
    chatgpt?: { mentioned: boolean; position: number | null; snippet: string | null; sourcesCited: string[] };
    gemini?: { mentioned: boolean; position: number | null; snippet: string | null; sourcesCited: string[] };
    aiOverview?: { mentioned: boolean; position: number | null; snippet: string | null; sourcesCited: string[] };
  };
}

/**
 * Check whether a business is mentioned by ChatGPT, Gemini, and AI Overview
 * for a specific search query — using LIVE direct LLM calls instead of the
 * DataForSEO domain-index lookup.
 *
 * This is the authoritative baseline/rank-check method because:
 *  - It returns real-time results regardless of DataForSEO index lag
 *  - It uses the same prompt framing as the training system
 *  - It is accurate for new/small businesses not yet in DataForSEO's index
 *
 * @param query      The search query (e.g. "house cleaning services in Austin TX")
 * @param businessName  The business name to look for in the response
 * @param agencyId   Optional agency ID to resolve the correct API keys
 */
export async function checkLLMVisibilityDirect(
  query: string,
  businessName: string,
  agencyId?: number | null,
  businessWebsite?: string | null,
  businessPhone?: string | null
): Promise<DirectVisibilityResult> {
  const { callAI } = await import("./aiProviders");
  const { getApiKeyByProvider } = await import("./db");
  const { getAgencyById } = await import("./dbAgencies");
  const { decrypt } = await import("./encryption");

  // ── Helper: resolve API key for a provider ──────────────────────────────────
  async function resolveKey(provider: "openai" | "google"): Promise<string | null> {
    if (agencyId) {
      try {
        const agency = await getAgencyById(agencyId);
        if (agency) {
          const encryptedKey = provider === "openai" ? agency.agencyOpenAiKey : agency.agencyGeminiKey;
          if (encryptedKey) return decrypt(encryptedKey);
        }
      } catch { /* fall through to platform key */ }
    }
    const record = await getApiKeyByProvider(provider);
    if (!record) return null;
    try { return decrypt(record.encryptedKey); } catch { return null; }
  }

  // ── Helper: extract domain stem from a URL ─────────────────────────────────
  function domainStem(url: string): string {
    try {
      const host = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
      // Strip www. and TLD so "titancleaningcompany.com" → "titancleaningcompany"
      return host.replace(/^www\./, "").replace(/\.[^.]+$/, "").toLowerCase();
    } catch { return ""; }
  }

  // ── Helper: normalise a phone number to digits only ─────────────────────────
  function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, "");
  }

  // ── Helper: detect mention in LLM response ──────────────────────────────────
  // Handles variants like "Titan" / "Titan Cleaning" / "Titan Cleaning Company"
  // when the registered name is "Titan Cleaning Company".
  // When businessWebsite or businessPhone are provided, a partial name match is
  // only accepted if the snippet also contains a corroborating signal (domain
  // stem or phone digits) — this prevents a "Titan Roofing" in another city
  // from being counted as a match for "Titan Cleaning Company".
  function detectMention(responseText: string, name: string): boolean {
    const lower = responseText.toLowerCase();
    const nameLower = name.toLowerCase();

    // 1. Exact full-name match — always trusted
    if (lower.includes(nameLower)) return true;

    // Pre-compute corroborating signals from the business profile
    const domain = businessWebsite ? domainStem(businessWebsite) : "";
    const phone  = businessPhone   ? normalizePhone(businessPhone) : "";
    // Strip non-digits from the response text for phone matching
    const lowerDigits = responseText.replace(/\D/g, "");

    function hasCorroboration(): boolean {
      if (domain && domain.length > 4 && lower.includes(domain)) return true;
      if (phone  && phone.length  >= 7 && lowerDigits.includes(phone)) return true;
      return false;
    }

    // 2. Prefix match — require ≥2 words OR corroboration for single-word prefixes
    //    e.g. "Titan Cleaning" always matches; bare "Titan" only matches if the
    //    snippet also contains the website domain or phone number.
    const words = nameLower.split(/\s+/).filter(Boolean);
    for (let len = words.length - 1; len >= 1; len--) {
      const prefix = words.slice(0, len).join(" ");
      if (prefix.length < 4) continue;
      if (lower.includes(prefix)) {
        // Multi-word prefix: trust it directly
        if (len >= 2) return true;
        // Single-word prefix: only trust with corroboration
        if (hasCorroboration()) return true;
      }
    }

    // 3. Partial match: ≥60% of significant (non-stop) words present
    //    Always require corroboration here since it's the weakest signal.
    const stopWords = new Set(["the", "and", "inc", "llc", "corp", "company", "services", "group", "co"]);
    const sigWords = words.filter(w => w.length > 3 && !stopWords.has(w));
    if (sigWords.length === 0) return false;
    const matched = sigWords.filter(w => lower.includes(w));
    if (matched.length / sigWords.length >= 0.6) {
      return hasCorroboration();
    }

    return false;
  }

  const result: DirectVisibilityResult = { keyword: query, llmResponses: {} };

  // ── ChatGPT check (Responses API + web_search_preview) ──────────────────────
  // Uses the OpenAI Responses API with the web_search_preview built-in tool,
  // which mirrors real ChatGPT behaviour (both free and paid tiers now use
  // web search by default for local business queries).
  const openaiKey = await resolveKey("openai");
  if (openaiKey) {
    try {
      // POST to the Responses API endpoint
      const responsesResp = await axios.post(
        "https://api.openai.com/v1/responses",
        {
          model: "gpt-4o",
          tools: [{ type: "web_search_preview" }],
          input: query,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          timeout: 30000,
        }
      );

      // Extract text content from the output array
      const outputItems: any[] = responsesResp.data?.output ?? [];
      const textContent = outputItems
        .filter((item: any) => item.type === "message")
        .flatMap((item: any) => item.content ?? [])
        .filter((c: any) => c.type === "output_text")
        .map((c: any) => c.text ?? "")
        .join("\n");

      // Extract cited URLs from web_search_call annotations
      const sourcesCited: string[] = outputItems
        .filter((item: any) => item.type === "message")
        .flatMap((item: any) => item.content ?? [])
        .filter((c: any) => c.type === "output_text")
        .flatMap((c: any) => c.annotations ?? [])
        .filter((a: any) => a.type === "url_citation")
        .map((a: any) => a.url as string)
        .filter(Boolean);

      const mentioned = detectMention(textContent, businessName);
      result.llmResponses.chatgpt = {
        mentioned,
        position: null,
        snippet: textContent.substring(0, 500),
        sourcesCited,
      };
      console.log(`[DirectCheck] ChatGPT (web search) for "${query}": mentioned=${mentioned}, sources=${sourcesCited.length}`);
    } catch (err: any) {
      // If Responses API fails (e.g. key doesn't have access), fall back to Chat Completions
      console.warn(`[DirectCheck] ChatGPT Responses API failed for "${query}", falling back to Chat Completions: ${err.message}`);
      try {
        const { callAI } = await import("./aiProviders");
        const resp = await callAI("openai", openaiKey, "gpt-4o", [
          { role: "system", content: "You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge." },
          { role: "user", content: query },
        ]);
        const mentioned = detectMention(resp.content, businessName);
        result.llmResponses.chatgpt = {
          mentioned,
          position: null,
          snippet: resp.content.substring(0, 500),
          sourcesCited: [],
        };
        console.log(`[DirectCheck] ChatGPT (fallback) for "${query}": mentioned=${mentioned}`);
      } catch (fallbackErr: any) {
        console.error(`[DirectCheck] ChatGPT fallback also failed for "${query}":`, fallbackErr.message);
      }
    }
  } else {
    console.warn(`[DirectCheck] No OpenAI API key — skipping ChatGPT check for "${query}"`);
  }

  // ── Gemini check ─────────────────────────────────────────────────────────────
  const googleKey = await resolveKey("google");
  if (googleKey) {
    try {
      // webSearch:true enables Google Search grounding — Gemini retrieves live
      // web results, matching how real users experience Gemini with web access on.
      const resp = await callAI("google", googleKey, "gemini-2.5-flash", [
        { role: "system", content: "You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge." },
        { role: "user", content: query },
      ], { webSearch: true });
      const mentioned = detectMention(resp.content, businessName);
      result.llmResponses.gemini = {
        mentioned,
        position: null,
        snippet: resp.content.substring(0, 500),
        sourcesCited: [],
      };
      console.log(`[DirectCheck] Gemini for "${query}": mentioned=${mentioned}`);
    } catch (err: any) {
      console.error(`[DirectCheck] Gemini check failed for "${query}":`, err.message);
    }

    // ── AI Overview check (same model, search-query framing) ──────────────────
    try {
      // Convert conversational query to search-query style for AI Overview
      const searchQuery = query
        .replace(/^(can you |please |could you |i('m| am) looking for |who (are|is) |what (are|is) )/i, "")
        .replace(/\?$/, "")
        .trim();
      // webSearch:true mirrors Google AI Overview which always uses live web results.
      const resp = await callAI("google", googleKey, "gemini-2.5-flash", [
        { role: "system", content: "You are a Google Search AI assistant that generates AI Overview summaries for local business queries. Provide concise, factual summaries highlighting relevant local options." },
        { role: "user", content: searchQuery },
      ], { webSearch: true });
      const mentioned = detectMention(resp.content, businessName);
      result.llmResponses.aiOverview = {
        mentioned,
        position: null,
        snippet: resp.content.substring(0, 500),
        sourcesCited: [],
      };
      console.log(`[DirectCheck] AI Overview for "${query}": mentioned=${mentioned}`);
    } catch (err: any) {
      console.error(`[DirectCheck] AI Overview check failed for "${query}":`, err.message);
    }
  } else {
    console.warn(`[DirectCheck] No Google API key — skipping Gemini/AI Overview checks for "${query}"`);
  }

  return result;
}
