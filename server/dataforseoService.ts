import axios from "axios";
import { US_STATE_LOCATION_CODES, STATE_FIPS_TO_ABBR } from "../shared/locationCodes";
import { COUNTY_POPULATION, STATE_POPULATION, US_POPULATION } from "../shared/countyPopulation";

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

async function dfsFetch<T = any>(endpoint: string, body: any[], retries = 3): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const auth = await getAuthHeader();
      const response = await axios.post(`${DATAFORSEO_BASE}${endpoint}`, body, {
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
        },
        timeout: 120_000, // 2 minutes — some endpoints are slow
      });

      if (response.data?.status_code !== 20000) {
        throw new Error(
          `DataForSEO API error: ${response.data?.status_message || "Unknown error"} (code: ${response.data?.status_code})`
        );
      }

      return response.data;
    } catch (err: any) {
      lastError = err;
      const isCredentialError = err.message?.includes("credentials not configured") ||
        err.message?.includes("401") ||
        err.response?.status === 401;
      // Don't retry credential errors — they won't fix themselves
      if (isCredentialError) throw err;
      if (attempt < retries) {
        const delay = attempt * 2000; // 2s, 4s backoff
        console.warn(`[DataForSEO] Attempt ${attempt}/${retries} failed: ${err.message}. Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError ?? new Error("DataForSEO request failed after retries");
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

/**
 * Expand seed service phrases into long-tail, geo-specific, high-buying-intent queries.
 *
 * Every query is phrased as a natural-language sentence a homeowner or business
 * owner would type into ChatGPT or Google AI Overview — NOT a bare keyword fragment.
 * The city+state is baked directly into the query string so the stored query is
 * immediately meaningful without any post-processing location suffix.
 *
 * Pattern philosophy (mirrors Titan Cleaning gold-standard):
 *   - Always include "in {city}, {state}" or "near {city}, {state}" inline
 *   - Mix question-form queries ("who", "what", "how to find") with noun-phrase queries
 *   - Include audience qualifiers ("for busy families", "for older homes", "for small businesses")
 *   - Include urgency/situation qualifiers ("emergency", "same-day", "last-minute")
 *   - Include eco/quality qualifiers ("eco-friendly", "licensed and insured", "affordable")
 *   - Avoid bare fragments like "hvac", "best repair", "company near me"
 */
export function expandToBuyerIntentQueries(
  seeds: string[],
  maxKeywords: number,
  location?: string   // e.g. "Chino, CA" — baked into every query
): string[] {
  const loc = location?.trim() || "";
  const inLoc  = loc ? ` in ${loc}`  : "";
  const nearLoc = loc ? ` near ${loc}` : "";
  const forLoc  = loc ? ` for ${loc} residents` : "";

  const templates = (s: string): string[] => [
    // ── Noun-phrase + geo ───────────────────────────────────────────────────
    `best ${s} services${inLoc}`,
    `affordable ${s} options${inLoc}`,
    `licensed and insured ${s} companies${inLoc}`,
    `top-rated ${s} professionals${nearLoc}`,
    `reliable ${s} contractors${inLoc}`,
    // ── Question-form (high AI-Overview match rate) ─────────────────────────
    `who are the best ${s} companies${inLoc}`,
    `how to find affordable ${s} options${inLoc}`,
    `what ${s} services are available${inLoc}`,
    `are there any eco-friendly ${s} providers${inLoc}`,
    `which ${s} company is most trusted${inLoc}`,
    // ── Audience-qualified ─────────────────────────────────────────────────
    `affordable ${s} options for busy families${inLoc}`,
    `${s} services for small businesses${inLoc}`,
    `${s} solutions for older homes${inLoc}`,
    `${s} help${forLoc}`,
    // ── Urgency / situation ────────────────────────────────────────────────
    `emergency ${s} services${inLoc}`,
    `same-day ${s} companies${inLoc}`,
    `last-minute ${s} options${nearLoc}`,
    // ── Comparison / decision ──────────────────────────────────────────────
    `best local ${s} options${inLoc}`,
    `${s} companies with free estimates${inLoc}`,
    `${s} specialists with good reviews${inLoc}`,
  ];

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const norm = q.toLowerCase().trim();
    if (!seen.has(norm)) { seen.add(norm); out.push(q); }
  };

  // Round-robin over template index so each seed contributes its primary variant
  // first — ensures diversity across seeds before exhausting any single seed.
  const perSeed = seeds.map(templates);
  const maxTemplates = templates("").length;
  for (let t = 0; t < maxTemplates; t++) {
    for (const variants of perSeed) {
      if (variants[t]) push(variants[t]!);
    }
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
    /** Primary location string (e.g. "Chino, CA") baked into every generated query. */
    primaryLocation?: string | null;
  }
): Promise<KeywordResearchResult> {
  const { maxKeywords, businessType, specialties, locationCode = 2840, languageCode = "en", primaryLocation } = options;

  console.log(`[DataForSEO] Starting keyword research pipeline for ${domain} (max: ${maxKeywords})`);

  // Step 1: Derive industry-relevant buyer-intent seeds from the business's own
  // type + specialties. These are relevant by construction and are the primary
  // source; the domain's ranked keywords are only a supplement below.
  const seeds = buildServiceSeeds(businessType, specialties);
  const seededQueries = seeds.length ? expandToBuyerIntentQueries(seeds, maxKeywords, primaryLocation ?? undefined) : [];
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
  // Domain keywords that pass the relevance filter are bare fragments (e.g. "hvac",
  // "a/c repair") — expand them through the same long-tail geo-specific templates
  // so every stored query is a full sentence with city+state inline.
  const siteByKeyword = new Map(relevantSiteKeywords.map((k) => [k.keyword.toLowerCase(), k]));
  const domainKeywordSeeds = relevantSiteKeywords.map((k) => k.keyword);
  const expandedDomainQueries = domainKeywordSeeds.length
    ? expandToBuyerIntentQueries(domainKeywordSeeds, maxKeywords, primaryLocation ?? undefined)
    : [];
  const candidateStrings: string[] = [];
  const seenCandidate = new Set<string>();
  // Seeded queries first (highest priority), then expanded domain queries.
  for (const q of [...seededQueries, ...expandedDomainQueries]) {
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

  // All candidates are now long-tail sentences; the siteByKeyword map keys are bare
  // fragments so they won't match directly. We still try a lookup for any bare
  // keywords that may have slipped through, but default to 0 / "commercial" otherwise.
  const merged = candidateStrings.map((kw) => {
    const site = siteByKeyword.get(kw.toLowerCase());
    return {
      keyword: kw,
      searchVolume: site?.searchVolume || 0,
      aiSearchVolume: aiVolumeMap.get(kw.toLowerCase())?.aiSearchVolume || 0,
      // All seeded / expanded queries are buyer-intent by construction.
      searchIntent: site?.searchIntent || "commercial",
    };
  });

  // Step 5: Sort by AI volume desc (tiebreak: SEO volume) and take top N.
  // All candidates are now long-tail geo-specific sentences, so the old anchor-slot
  // strategy (which reserved slots for bare seed fragments) is no longer needed.
  // The round-robin expansion in expandToBuyerIntentQueries already ensures each
  // service seed contributes its primary variant before any seed is exhausted.
  merged.sort((a, b) => {
    if (b.aiSearchVolume !== a.aiSearchVolume) return b.aiSearchVolume - a.aiSearchVolume;
    return b.searchVolume - a.searchVolume;
  });

  const topKeywords = merged.slice(0, maxKeywords);

  console.log(
    `[DataForSEO] Pipeline complete: ${topKeywords.length} long-tail geo-specific queries selected from ${candidateStrings.length} candidates`
  );

  return {
    keywords: siteKeywords,
    aiVolumes,
    topKeywords,
  };
}

/**
 * Get Google Ads search volume for a list of keywords.
 * Used as a fallback when AI volume is zero — multiply by 25% to estimate AI searches.
 * Accepts up to 1000 keywords per request.
 */
export async function getGoogleAdsSearchVolume(
  keywords: string[],
  options: {
    locationCode?: number;
    languageCode?: string;
  } = {}
): Promise<Map<string, number>> {
  const { locationCode = 2840, languageCode = "en" } = options;
  const volumeMap = new Map<string, number>();

  if (keywords.length === 0) return volumeMap;

  // API accepts up to 1000 keywords per request
  const batches: string[][] = [];
  for (let i = 0; i < keywords.length; i += 1000) {
    batches.push(keywords.slice(i, i + 1000));
  }

  console.log(`[DataForSEO] Fetching Google Ads search volume for ${keywords.length} keywords at location_code=${locationCode}`);
  console.log(`[DataForSEO] Request keywords: ${JSON.stringify(keywords)}`);

  for (const batch of batches) {
    try {
      const data = await dfsFetch("/keywords_data/google_ads/search_volume/live", [
        {
          keywords: batch,
          location_code: locationCode,
          language_code: languageCode,
        },
      ]);
      const items: any[] = data?.tasks?.[0]?.result || [];
      console.log(`[DataForSEO] Raw response items (${items.length}):`);
      for (const item of items) {
        console.log(`[DataForSEO]   keyword="${item?.keyword}" search_volume=${item?.search_volume} location_code=${item?.location_code}`);
        if (item?.keyword && item?.search_volume != null) {
          volumeMap.set(item.keyword.toLowerCase(), item.search_volume || 0);
        }
      }
      if (items.length === 0) {
        console.log(`[DataForSEO] WARNING: No result items returned. Full task: ${JSON.stringify(data?.tasks?.[0]?.status_code)} ${data?.tasks?.[0]?.status_message}`);
      }
    } catch (err: any) {
      console.warn(`[DataForSEO] Google Ads volume batch failed: ${err.message}`);
    }
  }

  return volumeMap;
}

/**
 * Fetch high-volume commercial/transactional keyword suggestions from DataForSEO
 * for a set of seed keywords. Used by the prospect audit query generator.
 *
 * Flow:
 *   1. Call keyword_suggestions for each seed (in parallel)
 *   2. Merge results, keep only main_intent === "commercial" | "transactional"
 *   3. Sort by search_volume desc, deduplicate by normalized keyword
 *   4. Return the top N results
 */
export async function getKeywordSuggestionsForProspect(
  seeds: string[],
  options: {
    locationCode?: number;
    languageCode?: string;
    limit?: number; // per seed, before filtering
  } = {}
): Promise<{ keyword: string; searchVolume: number }[]> {
  const { locationCode = 2840, languageCode = "en", limit = 100 } = options;

  if (!seeds.length) return [];

  console.log(`[DataForSEO] Fetching keyword suggestions for seeds: ${seeds.join(" | ")}`);

  // Run all seed lookups in parallel
  const results = await Promise.allSettled(
    seeds.map((seed) =>
      dfsFetch("/dataforseo_labs/google/keyword_suggestions/live", [
        {
          keyword: seed.trim(),
          location_code: locationCode,
          language_code: languageCode,
          include_seed_keyword: true,
          include_serp_info: true,   // REQUIRED: search_intent_info is null without this
          limit,
          order_by: ["keyword_info.search_volume,desc"],
        },
      ]).then((data: any) => {
        const items: any[] = data?.tasks?.[0]?.result?.[0]?.items || [];
        return items
          .filter((item: any) => {
            const intent = item?.search_intent_info?.main_intent;
            // Keep commercial and transactional — these are the money queries.
            // If intent is null (shouldn't happen with include_serp_info:true but
            // DataForSEO occasionally omits it for very new keywords), keep the
            // keyword anyway so we don't silently drop valid results.
            return intent === "commercial" || intent === "transactional" || intent == null;
          })
          .map((item: any) => ({
            keyword: (item.keyword as string).trim(),
            searchVolume: (item.keyword_info?.search_volume as number) || 0,
            intent: (item?.search_intent_info?.main_intent as string) || null,
          }))
          // Second pass: drop anything that is research/cost/informational by pattern.
          // DataForSEO sometimes marks cost/price queries as "commercial" — we don't
          // want those. We want queries where someone is ready to HIRE, not research.
          .filter((kw: any) => {
            const k = kw.keyword.toLowerCase();
            const NON_BUYING_PATTERNS = [
              // Informational question starters
              /^how (to|do|does|can|long|much|many|often)/,
              /^what (is|are|does|do|to)/,
              /^why /,
              /^when /,
              /^where (to|can|do|does)/,
              // Research/guide content
              /^(guide|tutorial|tips|steps|ways|ideas|examples|types|list|history|definition|meaning|explained)/,
              /\b(how to|what is|what are|diy|yourself|timeline|process|benefits of|advantages of|disadvantages|comparison|difference between)\b/,
              // Cost/price research — person is researching, not buying
              /\b(cost|costs|price|prices|pricing|how much|average cost|average price|per foot|per linear|per panel|per post|calculator|estimate cost|price guide|price list|cost guide|cost breakdown|cost per|price per|rates|rate chart)\b/,
              // Installation process / DIY research
              /\b(installation process|how to install|install yourself|diy install|steps to install|installing a|how long does|how long to|time to install|permit|permits required|do i need a permit)\b/,
              // Comparison / research queries
              /\b(vs\b|versus|compared to|comparison|pros and cons|which is better|should i get|should i choose|difference between)\b/,
              // Review/research queries
              /\b(reviews|review|complaints|problems|issues|common problems|warranty|lifespan|how long does it last|maintenance tips|care tips)\b/,
            ];
            return !NON_BUYING_PATTERNS.some((re) => re.test(k));
          })
          .map((kw: any) => ({ keyword: kw.keyword, searchVolume: kw.searchVolume }));
      })
    )
  );

  // Merge all results, deduplicate by lowercased keyword, keep highest volume
  const volumeMap = new Map<string, { keyword: string; searchVolume: number }>();
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const kw of r.value) {
      const key = kw.keyword.toLowerCase();
      const existing = volumeMap.get(key);
      if (!existing || kw.searchVolume > existing.searchVolume) {
        volumeMap.set(key, kw);
      }
    }
  }

  // Sort by search volume descending
  return Array.from(volumeMap.values()).sort((a, b) => b.searchVolume - a.searchVolume);
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
export type MentionSentiment = "positive" | "neutral" | "negative";

export interface LLMCheckResult {
  mentioned: boolean;
  position: number | null;           // legacy field (kept for compat)
  snippet: string | null;
  sourcesCited: string[];
  recommendationRank: number | null; // position in a numbered/bulleted list (1-based)
  citedUrl: boolean;                 // client's domain found in sourcesCited
  sentiment: MentionSentiment | null; // only set when mentioned=true
}

export interface DirectVisibilityResult {
  keyword: string;
  llmResponses: {
    chatgpt?: LLMCheckResult;
    gemini?: LLMCheckResult;
    aiOverview?: LLMCheckResult;
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

  // ── Helper: extract recommendation rank from numbered/bulleted list ──────────
  // Scans the LLM response for a numbered or bulleted list and returns the
  // 1-based position where the business name appears, or null if not in a list.
  function extractRecommendationRank(responseText: string, name: string): number | null {
    const lines = responseText.split(/\n/);
    // Match lines like: "1. Business Name", "2) Business Name", "- Business Name", "• Business Name"
    const listLineRe = /^\s*(?:(\d+)[.):]?|[-•*])\s+(.+)$/;
    let rank = 0;
    for (const line of lines) {
      const m = line.match(listLineRe);
      if (!m) continue;
      rank++;
      const lineText = m[2] ?? line;
      if (detectMention(lineText, name)) return rank;
    }
    return null;
  }

  // ── Helper: check if the client's domain appears in cited sources ────────────
  function extractCitedUrl(sourcesCited: string[], website: string | null | undefined): boolean {
    if (!website || sourcesCited.length === 0) return false;
    const stem = domainStem(website);
    if (!stem || stem.length < 4) return false;
    return sourcesCited.some(url => url.toLowerCase().includes(stem));
  }

  // ── Helper: classify sentiment of the mention via GPT-4o-mini ───────────────
  async function classifySentiment(
    snippet: string,
    name: string,
    apiKey: string | null
  ): Promise<MentionSentiment | null> {
    if (!apiKey || !snippet) return null;
    try {
      // Extract just the sentences that mention the business name
      const nameLower = name.toLowerCase();
      const relevantSentences = snippet
        .split(/(?<=[.!?])\s+/)
        .filter(s => s.toLowerCase().includes(nameLower))
        .join(" ");
      if (!relevantSentences) return "neutral";

      const resp = await callAI("openai", apiKey, "gpt-4o-mini", [
        {
          role: "system",
          content: `Classify the sentiment of the following text about a business as exactly one of: positive, neutral, or negative.
- positive: recommended, praised, highly rated, described as excellent/best/top
- neutral: listed as an option without praise or criticism
- negative: criticized, warned against, described as problematic
Reply with ONLY the single word: positive, neutral, or negative.`,
        },
        { role: "user", content: relevantSentences },
      ]);
      const word = resp.content.trim().toLowerCase();
      if (word === "positive" || word === "negative") return word;
      return "neutral";
    } catch {
      return null;
    }
  }

  const result: DirectVisibilityResult = { keyword: query, llmResponses: {} };

  // ── Resolve API keys first (both in parallel) ────────────────────────────────
  const [openaiKey, googleKey] = await Promise.all([
    resolveKey("openai"),
    resolveKey("google"),
  ]);

  // ── ChatGPT check helper ─────────────────────────────────────────────────────
  async function runChatGPT(): Promise<void> {
    if (!openaiKey) {
      console.warn(`[DirectCheck] No OpenAI API key — skipping ChatGPT check for "${query}"`);
      return;
    }
    try {
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
          timeout: 45000,
        }
      );
      const outputItems: any[] = responsesResp.data?.output ?? [];
      const textContent = outputItems
        .filter((item: any) => item.type === "message")
        .flatMap((item: any) => item.content ?? [])
        .filter((c: any) => c.type === "output_text")
        .map((c: any) => c.text ?? "")
        .join("\n");
      const sourcesCited: string[] = outputItems
        .filter((item: any) => item.type === "message")
        .flatMap((item: any) => item.content ?? [])
        .filter((c: any) => c.type === "output_text")
        .flatMap((c: any) => c.annotations ?? [])
        .filter((a: any) => a.type === "url_citation")
        .map((a: any) => a.url as string)
        .filter(Boolean);
      const mentioned = detectMention(textContent, businessName);
      const snippet = textContent.substring(0, 500);
      const recommendationRank = mentioned ? extractRecommendationRank(textContent, businessName) : null;
      const citedUrl = extractCitedUrl(sourcesCited, businessWebsite);
      const sentiment = mentioned ? await classifySentiment(snippet, businessName, openaiKey) : null;
      result.llmResponses.chatgpt = { mentioned, position: null, snippet, sourcesCited, recommendationRank, citedUrl, sentiment };
      console.log(`[DirectCheck] ChatGPT (web search) for "${query}": mentioned=${mentioned}, rank=${recommendationRank}, sentiment=${sentiment}, cited=${citedUrl}`);
    } catch (err: any) {
      console.warn(`[DirectCheck] ChatGPT Responses API failed for "${query}", falling back to Chat Completions: ${err.message}`);
      try {
        const resp = await callAI("openai", openaiKey, "gpt-4o", [
          { role: "system", content: "You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge." },
          { role: "user", content: query },
        ]);
        const mentioned = detectMention(resp.content, businessName);
        const snippet = resp.content.substring(0, 500);
        const recommendationRank = mentioned ? extractRecommendationRank(resp.content, businessName) : null;
        const sentiment = mentioned ? await classifySentiment(snippet, businessName, openaiKey) : null;
        result.llmResponses.chatgpt = { mentioned, position: null, snippet, sourcesCited: [], recommendationRank, citedUrl: false, sentiment };
        console.log(`[DirectCheck] ChatGPT (fallback) for "${query}": mentioned=${mentioned}, rank=${recommendationRank}, sentiment=${sentiment}`);
      } catch (fallbackErr: any) {
        console.error(`[DirectCheck] ChatGPT fallback also failed for "${query}":`, fallbackErr.message);
      }
    }
  }

  // ── Gemini check helper ──────────────────────────────────────────────────────
  async function runGemini(): Promise<void> {
    if (!googleKey) {
      console.warn(`[DirectCheck] No Google API key — skipping Gemini check for "${query}"`);
      return;
    }
    try {
      const resp = await callAI("google", googleKey, "gemini-2.5-flash", [
        { role: "system", content: "You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge." },
        { role: "user", content: query },
      ], { webSearch: true });
      const mentioned = detectMention(resp.content, businessName);
      const snippet = resp.content.substring(0, 500);
      const recommendationRank = mentioned ? extractRecommendationRank(resp.content, businessName) : null;
      // Gemini grounding returns sources in resp.sources (array of {uri, title})
      const geminiSources: string[] = ((resp as any).sources ?? []).map((s: any) => s.uri ?? s.url ?? "").filter(Boolean);
      const citedUrl = extractCitedUrl(geminiSources, businessWebsite);
      const sentiment = mentioned ? await classifySentiment(snippet, businessName, openaiKey) : null;
      result.llmResponses.gemini = { mentioned, position: null, snippet, sourcesCited: geminiSources, recommendationRank, citedUrl, sentiment };
      console.log(`[DirectCheck] Gemini for "${query}": mentioned=${mentioned}, rank=${recommendationRank}, sentiment=${sentiment}, cited=${citedUrl}`);
    } catch (err: any) {
      console.error(`[DirectCheck] Gemini check failed for "${query}":`, err.message);
    }
  }

  // ── AI Overview check helper ─────────────────────────────────────────────────
  // Uses the real DataForSEO SERP endpoint to check whether Google's AI Overview
  // feature actually surfaces the business for this query.
  //
  // Google does NOT show an AI Overview for every query — local service queries
  // often return no AI Overview at all. In that case we record mentioned=false
  // and snippet="No AI Overview found for this query" which is honest data.
  //
  // We set load_async_ai_overview=true so we catch both cached (synchronous)
  // and on-the-fly (asynchronous) AI Overviews. DataForSEO refunds the extra
  // charge if no async overview exists.
  async function runAIOverview(): Promise<void> {
    try {
      const serpData = await dfsFetch("/serp/google/organic/live/advanced", [
        {
          keyword: query,
          location_code: 2840,   // United States — AI Overview availability is US-only
          language_code: "en",
          depth: 10,
          load_async_ai_overview: true,
        },
      ]);

      const items: any[] = serpData?.tasks?.[0]?.result?.[0]?.items ?? [];
      const aiOverviewItem = items.find((item: any) => item.type === "ai_overview");

      if (!aiOverviewItem) {
        // Google did not serve an AI Overview for this query — that's valid data
        result.llmResponses.aiOverview = {
          mentioned: false,
          position: null,
          snippet: "No AI Overview found for this query",
          sourcesCited: [],
          recommendationRank: null,
          citedUrl: false,
          sentiment: null,
        };
        console.log(`[DirectCheck] AI Overview for "${query}": no overview present in SERP`);
        return;
      }

      // Extract text from the ai_overview item
      // The item has a top-level markdown field and nested ai_overview_element items
      const overviewText = [
        aiOverviewItem.markdown ?? "",
        ...(aiOverviewItem.items ?? [])
          .map((el: any) => el.text ?? el.markdown ?? "")
          .filter(Boolean),
      ].join("\n").trim();

      // Extract cited source URLs from references
      const sourcesCited: string[] = [
        ...(aiOverviewItem.references ?? []),
        ...(aiOverviewItem.items ?? []).flatMap((el: any) => el.references ?? []),
      ]
        .map((ref: any) => ref.url as string)
        .filter(Boolean);

      const mentioned = detectMention(overviewText, businessName);
      const snippet = overviewText.substring(0, 500);
      const recommendationRank = mentioned ? extractRecommendationRank(overviewText, businessName) : null;
      const citedUrl = extractCitedUrl(sourcesCited, businessWebsite);
      const sentiment = mentioned ? await classifySentiment(snippet, businessName, openaiKey) : null;
      result.llmResponses.aiOverview = {
        mentioned,
        position: null,
        snippet,
        sourcesCited,
        recommendationRank,
        citedUrl,
        sentiment,
      };
      console.log(`[DirectCheck] AI Overview (real SERP) for "${query}": mentioned=${mentioned}, rank=${recommendationRank}, sentiment=${sentiment}, cited=${citedUrl}`);
    } catch (err: any) {
      console.error(`[DirectCheck] AI Overview SERP check failed for "${query}":`, err.message);
      // On failure, record as not found rather than leaving it undefined
      result.llmResponses.aiOverview = {
        mentioned: false,
        position: null,
        snippet: "AI Overview check failed",
        sourcesCited: [],
        recommendationRank: null,
        citedUrl: false,
        sentiment: null,
      };
    }
  }

  // ── Run all 3 checks in parallel ─────────────────────────────────────────────
  // Promise.allSettled ensures all 3 complete (or fail gracefully) regardless
  // of individual failures. This cuts per-query time from ~40s to ~15s.
  await Promise.allSettled([
    runChatGPT(),
    runGemini(),
    runAIOverview(),
  ]);

  return result;
}

// ============= City Location Code Resolver =============

/**
 * Resolve a DataForSEO city-level location_code from a location string
 * like "Cullman, AL" or "Birmingham, Alabama".
 *
 * Hits the DataForSEO locations list and finds the closest city-level match.
 * Falls back to state-level code, then US national (2840) if not found.
 *
 * Results are cached in-process to avoid repeated API calls for the same city.
 */
const _cityCodeCache = new Map<string, number>();

export async function getCityLocationCode(location: string): Promise<number> {
  if (!location) return 2840;

  const cacheKey = location.trim().toLowerCase();
  if (_cityCodeCache.has(cacheKey)) return _cityCodeCache.get(cacheKey)!;

  // Parse city name from "City, ST" or "City, State" format
  const cityMatch = location.trim().match(/^([^,]+)/);
  const cityName = cityMatch ? cityMatch[1].trim() : location.trim();

  // Also extract state abbreviation for filtering
  const stateMatch = location.trim().match(/,?\s+([A-Z]{2})$/);
  const stateAbbr = stateMatch ? stateMatch[1].toUpperCase() : null;

  try {
    const auth = await getAuthHeader();
    // DataForSEO locations endpoint — returns all available locations for a country
    const resp = await axios.get(
      `${DATAFORSEO_BASE}/keywords_data/google_ads/locations`,
      {
        headers: { Authorization: auth },
        params: { country_iso_code: "US" },
        timeout: 15_000,
      }
    );

    const locations: Array<{
      location_code: number;
      location_name: string;
      location_type: string;
      country_iso_code: string;
    }> = resp.data?.locations ?? [];

    const cityLower = cityName.toLowerCase();

    // Priority 1: exact city name match in the correct state
    let match = locations.find(
      (l) =>
        l.location_type === "City" &&
        l.country_iso_code === "US" &&
        l.location_name.toLowerCase() === cityLower &&
        (!stateAbbr || l.location_name.toLowerCase().includes(stateAbbr.toLowerCase()))
    );

    // Priority 2: city name starts-with match
    if (!match) {
      match = locations.find(
        (l) =>
          l.location_type === "City" &&
          l.country_iso_code === "US" &&
          l.location_name.toLowerCase().startsWith(cityLower)
      );
    }

    if (match) {
      console.log(`[LocationCode] Resolved "${location}" → city code ${match.location_code} (${match.location_name})`);
      _cityCodeCache.set(cacheKey, match.location_code);
      return match.location_code;
    }

    // Fall back to state-level code
    const { resolveLocationCode } = await import("../shared/locationCodes");
    const stateCode = resolveLocationCode(location);
    console.log(`[LocationCode] City "${cityName}" not found in DataForSEO, using state code ${stateCode} for "${location}"`);
    _cityCodeCache.set(cacheKey, stateCode);
    return stateCode;
  } catch (err: any) {
    console.warn(`[LocationCode] Failed to resolve location code for "${location}":`, err.message);
    try {
      const { resolveLocationCode } = await import("../shared/locationCodes");
      return resolveLocationCode(location);
    } catch {
      return 2840;
    }
  }
}

/**
 * getCityLocationWithPopRatio
 *
 * Resolves a city/location string to:
 *  - The DataForSEO STATE-level location code (most granular available for Google Ads volume)
 *  - A population ratio (county population / state population) to proportion state volume
 *    down to the realistic local market size.
 *
 * Strategy:
 *  1. Parse city name + state abbreviation from any input format.
 *  2. Use Census Geocoder (no key needed) to resolve city → county FIPS code.
 *  3. Look up county population and state population from static 2023 Census table.
 *  4. Return state DataForSEO code + ratio.
 *
 * Results are cached in-process.
 */
const _countyCodeCache = new Map<string, { locationCode: number; populationRatio: number; resolvedAs: string }>();

/**
 * Parses a location string into { cityName, stateAbbr } handling all formats:
 *   "Houston, TX" | "Houston, Texas" | "Houston Texas" | "houston, tx"
 */
function parseLocationString(location: string): { cityName: string; stateAbbr: string | null } {
  const STATE_NAMES: Record<string, string> = {
    alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR',
    california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
    florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
    illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS',
    kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
    massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
    missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
    'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
    ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
    'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
    tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
    virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
    wisconsin: 'WI', wyoming: 'WY', 'district of columbia': 'DC',
  };

  const normalized = location.trim();
  const lower = normalized.toLowerCase();

  let stateAbbr: string | null = null;
  const abbrMatch = normalized.match(/,?\s+([A-Za-z]{2})$/);
  if (abbrMatch) {
    const candidate = abbrMatch[1].toUpperCase();
    if (Object.values(STATE_NAMES).includes(candidate)) stateAbbr = candidate;
  }
  if (!stateAbbr) {
    const sortedNames = Object.keys(STATE_NAMES).sort((a, b) => b.length - a.length);
    for (const name of sortedNames) {
      if (lower.includes(name)) { stateAbbr = STATE_NAMES[name]; break; }
    }
  }

  let cityName: string;
  if (normalized.includes(',')) {
    cityName = normalized.split(',')[0].trim();
  } else if (stateAbbr) {
    const statePattern = new RegExp(`\\s+(${abbrMatch?.[1] ?? stateAbbr}|${Object.keys(STATE_NAMES).find(k => STATE_NAMES[k] === stateAbbr) ?? ''})\\s*$`, 'i');
    cityName = normalized.replace(statePattern, '').trim();
  } else {
    cityName = normalized;
  }

  return { cityName, stateAbbr };
}

export async function getCityCountyLocationCode(
  location: string
): Promise<{ locationCode: number; populationRatio: number; resolvedAs: string }> {
  if (!location) return { locationCode: 2840, populationRatio: 1, resolvedAs: 'national' };

  const cacheKey = `pop:${location.trim().toLowerCase()}`;
  if (_countyCodeCache.has(cacheKey)) return _countyCodeCache.get(cacheKey)!;

  const { cityName, stateAbbr } = parseLocationString(location);

  // Get the DataForSEO state-level code (most granular available for this endpoint)
  const stateCode = stateAbbr ? (US_STATE_LOCATION_CODES[stateAbbr] ?? 2840) : 2840;

  // Default ratio = 1 (use full state volume if we can't resolve county)
  let populationRatio = 1;
  let resolvedAs = stateAbbr ? `state:${stateAbbr}` : 'national';

  // ── Step 1: Check if input is already a county ──────────────────────────────
  const countyInputMatch = cityName.match(/^(.+?)\s+(County|Parish|Borough)$/i);
  if (countyInputMatch && stateAbbr) {
    // Find county FIPS by name in our population table
    const countyBaseName = countyInputMatch[1].trim().toLowerCase();
    const stateFips = Object.entries(STATE_FIPS_TO_ABBR).find(([, abbr]) => abbr === stateAbbr)?.[0];
    if (stateFips) {
      const countyFips = Object.entries(COUNTY_POPULATION).find(([fips]) => {
        // We don't have names in the table, so fall through to geocoder
        return false;
      })?.[0];
      // Fall through to geocoder for county-name → FIPS resolution
    }
  }

  // ── Step 2: Census Geocoder → county FIPS ──────────────────────────────────
  try {
    const geocodeUrl = `https://geocoding.geo.census.gov/geocoder/geographies/address` +
      `?street=1+Main+St&city=${encodeURIComponent(cityName)}&state=${stateAbbr ?? ''}` +
      `&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
    const geoResp = await axios.get(geocodeUrl, { timeout: 8_000 });
    const matches = geoResp.data?.result?.addressMatches ?? [];
    if (matches.length > 0) {
      const county = matches[0]?.geographies?.Counties?.[0];
      if (county?.GEOID && county?.STATE) {
        // GEOID is the 5-digit county FIPS (e.g. "01103" = Morgan County, AL)
        const countyFips = county.GEOID as string;
        const stateFips = county.STATE as string;
        const countyPop = COUNTY_POPULATION[countyFips];
        const statePop = STATE_POPULATION[stateFips];

        if (countyPop && statePop && statePop > 0) {
          populationRatio = countyPop / statePop;
          resolvedAs = `${county.NAME ?? countyFips} (${(populationRatio * 100).toFixed(1)}% of state)`;
          console.log(`[PopRatio] "${location}" → ${county.NAME}: pop ${countyPop.toLocaleString()} / state ${statePop.toLocaleString()} = ${(populationRatio * 100).toFixed(2)}%`);
        } else {
          console.warn(`[PopRatio] No population data for county FIPS ${countyFips}`);
        }
      }
    } else {
      console.warn(`[PopRatio] Census geocoder returned no matches for "${cityName}, ${stateAbbr}"`);
    }
  } catch (err: any) {
    console.warn(`[PopRatio] Census geocoder failed for "${cityName}": ${err.message}`);
  }

  const result = { locationCode: stateCode, populationRatio, resolvedAs };
  console.log(`[PopRatio] "${location}" final: locationCode=${stateCode}, ratio=${(populationRatio * 100).toFixed(2)}% of state, resolvedAs=${resolvedAs}`);
  _countyCodeCache.set(cacheKey, result);
  return result;
}

// ============= SERP-Based Query Generation for Prospect Audits =============

export interface SerpQueryCandidate {
  query: string;
  source: "related_search" | "paa";
}

/**
 * Fetch queries from a real Google SERP for a given seed keyword + location.
 * Pulls from three SERP item types:
 *   1. related_searches — short, location-specific, commercial (highest priority)
 *   2. people_also_search — similar to related searches, also short and local
 *   3. people_also_ask — filtered strictly to hiring/transactional intent only
 *
 * Brand filtering: any result containing a capitalized word that isn't a
 * location word or a seed keyword word is treated as a branded result and dropped.
 * e.g. "Parris fence company", "A-1 Fence company", "Huntsville Fence Company" all dropped.
 *
 * Informational queries are dropped: anything about cost/price/budget without
 * a hiring signal is informational ("how much does a fence cost" = thinking stage,
 * not hiring stage).
 */
export async function getSerpQueriesForProspect(
  seedKeyword: string,
  locationName: string,  // e.g. "Cullman, AL"
  locationCode: number,  // DataForSEO location_code
  maxResults: number = 15
): Promise<SerpQueryCandidate[]> {
  // Build a seed that naturally includes the location
  // e.g. "fence company Cullman Alabama"
  const cityPart = locationName.replace(/,\s*[A-Z]{2}$/, "").trim(); // strip state abbr
  const seedWithLocation = `${seedKeyword} ${cityPart}`;

  let serpItems: any[] = [];
  try {
    const serpData = await dfsFetch("/serp/google/organic/live/advanced", [
      {
        keyword: seedWithLocation,
        location_code: locationCode,
        language_code: "en",
        depth: 10,
      },
    ]);
    serpItems = serpData?.tasks?.[0]?.result?.[0]?.items ?? [];
  } catch (err: any) {
    console.warn(`[SerpQueries] SERP fetch failed for "${seedWithLocation}": ${err.message}`);
    return [];
  }

  const candidates: SerpQueryCandidate[] = [];
  const seen = new Set<string>();

  // Build a set of "allowed" capitalized words: location words + seed keyword words
  // Everything else that's capitalized is likely a brand name
  const locationWords = new Set(
    locationName.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean)
  );
  const seedWords = new Set(seedKeyword.toLowerCase().split(/\s+/).filter(Boolean));
  const allowedCapWords = new Set([...locationWords, ...seedWords]);

  // Common non-brand capitalized words that should always be allowed
  const genericWords = new Set([
    "best", "top", "local", "near", "me", "reviews", "rated", "affordable",
    "cheap", "free", "residential", "commercial", "wood", "vinyl", "chain",
    "link", "metal", "steel", "iron", "aluminum", "privacy", "split", "rail",
    "picket", "installation", "repair", "replacement", "contractor", "contractors",
    "company", "companies", "service", "services", "provider", "providers",
    "gate", "gates", "fencing", "fence", "fences",
  ]);

  function isBranded(text: string): boolean {
    const words = text.split(/\s+/);
    return words.some(w => {
      // Must start with uppercase AND be longer than 1 char (not abbreviations like AL)
      if (!/^[A-Z][a-z]/.test(w)) return false;
      const wl = w.toLowerCase().replace(/[^a-z]/g, "");
      if (!wl || wl.length < 3) return false;
      if (allowedCapWords.has(wl)) return false;
      if (genericWords.has(wl)) return false;
      // It's a capitalized word not in our allowed set — likely a brand
      return true;
    });
  }

  // Patterns that indicate INFORMATIONAL intent (drop these)
  // These are people in the "research" phase, not the "hire" phase
  const INFORMATIONAL_PATTERNS = [
    /^how much (does|do|should|will|would|is)/i,
    /^what (does|do|is|are) .* cost/i,
    /^what is the (average|typical|normal|standard) (cost|price|rate)/i,
    /^how (expensive|cheap)/i,
    /^(what|how) .* (budget|budgeting)/i,
    /^what .* (best|good|better) (fence|material|type|option)/i,
    /^(what|which) (type|kind|material|style) of fence/i,
    /^how (long|tall|high|wide)/i,
    /^(do i need|is it legal|can i|am i allowed)/i,
    /^what are the (laws|rules|regulations|requirements)/i,
    /^(what|how) .* (diy|do it yourself|myself)/i,
  ];

  // Patterns that confirm TRANSACTIONAL/HIRING intent (keep these)
  const TRANSACTIONAL_PATTERNS = [
    /near me/i,
    /in (cullman|hartselle|huntsville|birmingham|montgomery|mobile|tuscaloosa|decatur|florence|gadsden|anniston|dothan|auburn|phenix|enterprise|madison|vestavia|hoover|homewood|alabaster|pelham|trussville|gardendale|center point|moody|oxford|talladega|selma|opelika|alexander city|albertville|athens|scottsboro|jasper|fort payne|boaz|oneonta|sylacauga|clanton|wetumpka|prattville|millbrook|calera|helena|chelsea|columbiana|childersburg|pell city|lincoln|ashville|springville|moody|trussville|irondale|mountain brook|fairfield|bessemer|midfield|tarrant|fultondale|warrior|hayden|blount|marshall|morgan|madison|limestone|lawrence|colbert|lauderdale|franklin|winston|walker|jefferson|shelby|st clair|calhoun|etowah|dekalb|cherokee|cleburne|randolph|talladega|coosa|elmore|autauga|dallas|perry|bibb|chilton|hale|greene|sumter|marengo|wilcox|monroe|conecuh|escambia|covington|coffee|dale|houston|henry|barbour|pike|bullock|macon|lee|chambers|tallapoosa|clay|cleburne|randolph|coosa|elmore|autauga|lowndes|butler|crenshaw|montgomery|macon)/i,
    /\b(al|alabama)\b/i,
    /\b(company|companies|contractor|contractors|service|services|installer|installers|professional|professionals)\b/i,
    /\b(hire|hiring|find|finding|looking for|need|recommend|recommendation|quote|quotes|estimate|estimates)\b/i,
    /\b(local|nearby|area|region)\b/i,
    /\b(best|top|rated|reviewed|trusted|reliable|reputable|licensed|insured)\b/i,
  ];

  function isTransactional(text: string): boolean {
    // First check: if it matches an informational pattern, it's out
    if (INFORMATIONAL_PATTERNS.some(p => p.test(text))) return false;
    // Second check: must match at least one transactional signal
    return TRANSACTIONAL_PATTERNS.some(p => p.test(text));
  }

  // ── 1. Related searches (highest priority) ────────────────────────────────
  for (const item of serpItems) {
    if (item.type !== "related_searches") continue;
    const searches: string[] = item.items ?? [];
    for (const s of searches) {
      const q = s.trim().toLowerCase();
      if (!q || seen.has(q)) continue;
      if (isBranded(s)) { console.log(`[SerpQueries] Dropped branded related: "${s}"`); continue; }
      if (!isTransactional(s)) { console.log(`[SerpQueries] Dropped non-transactional related: "${s}"`); continue; }
      seen.add(q);
      candidates.push({ query: s.trim(), source: "related_search" });
    }
  }

  // ── 2. People also search (similar to related searches) ────────────────────
  for (const item of serpItems) {
    if (item.type !== "people_also_search") continue;
    const searches: string[] = item.items ?? [];
    for (const s of searches) {
      const q = s.trim().toLowerCase();
      if (!q || seen.has(q)) continue;
      if (isBranded(s)) { console.log(`[SerpQueries] Dropped branded people_also_search: "${s}"`); continue; }
      if (!isTransactional(s)) { console.log(`[SerpQueries] Dropped non-transactional people_also_search: "${s}"`); continue; }
      seen.add(q);
      candidates.push({ query: s.trim(), source: "related_search" });
    }
  }

  // ── 3. PAA — strictly hiring/transactional intent only ──────────────────────
  // PAA is the lowest priority and most likely to be informational.
  // Only include PAA questions that explicitly ask about finding/hiring someone.
  const HIRING_PAA_PATTERNS = [
    /how (do|can|should) (i|you|we) (find|hire|choose|pick|select|get|locate)/i,
    /how to (find|hire|choose|pick|select|get|locate)/i,
    /who (should|can|do) (i|you|we) (hire|call|contact|use)/i,
    /who (is|are) the best .*(company|contractor|service)/i,
    /where (can|should|do) (i|you|we) (find|hire|get)/i,
    /should i (hire|use|get|call)/i,
    /what should i (look for|ask|expect) (when|in|from) (hiring|a)/i,
    /how to (negotiate|get quotes|compare)/i,
  ];

  for (const item of serpItems) {
    if (item.type !== "people_also_ask") continue;
    const paaItems: any[] = item.items ?? [];
    for (const paa of paaItems) {
      const title: string = paa.title ?? "";
      if (!title) continue;
      const q = title.trim().toLowerCase();
      if (seen.has(q)) continue;
      if (isBranded(title)) { console.log(`[SerpQueries] Dropped branded PAA: "${title}"`); continue; }
      const isHiring = HIRING_PAA_PATTERNS.some(p => p.test(title));
      if (!isHiring) { console.log(`[SerpQueries] Dropped non-hiring PAA: "${title}"`); continue; }
      seen.add(q);
      candidates.push({ query: title.trim(), source: "paa" });
    }
  }

  const relCount = candidates.filter(c => c.source === "related_search").length;
  const paaCount = candidates.filter(c => c.source === "paa").length;
  console.log(`[SerpQueries] ${candidates.length} candidates for "${seedWithLocation}" (${relCount} related/also_search, ${paaCount} PAA)`);

  return candidates.slice(0, maxResults);
}
