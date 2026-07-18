/**
 * Prospect Audit Engine
 *
 * Generates 15 AI-search queries for a prospect business and runs a baseline
 * visibility check across ChatGPT, Gemini, and AI Overview.
 *
 * This is a pure baseline check — no bonus queries, no win detection, no
 * comparison to prior snapshots. Results are stored in prospectAudits so that
 * if the prospect signs up, the baseline can be promoted to their campaign
 * without re-running the check.
 */

import { getDb, getApiKeyByProvider } from "./db";
import { decrypt } from "./encryption";
import { callAI } from "./aiProviders";
import { checkLLMVisibilityDirect, getAIKeywordSearchVolume, getGoogleAdsSearchVolume, getCityLocationCode, getCityCountyLocationCode } from "./dataforseoService";
import { calculateVisibilityScore } from "./rankTrackingEngine";
import { prospectAudits } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Domain Normalization ─────────────────────────────────────────────────────

/**
 * Normalize a website URL to a bare domain for prospect-to-client matching.
 * Handles all common input formats:
 *   https://www.titancleaningco.com/  →  titancleaningco.com
 *   http://titancleaningco.com        →  titancleaningco.com
 *   www.titancleaningco.com           →  titancleaningco.com
 *   TITANCLEANINGCO.COM               →  titancleaningco.com
 */
export function normalizeDomain(website: string | null | undefined): string | null {
  if (!website || !website.trim()) return null;
  try {
    let raw = website.trim().toLowerCase();
    // Add protocol if missing so URL can be parsed
    if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
      raw = "https://" + raw;
    }
    const url = new URL(raw);
    let host = url.hostname;
    // Strip leading www.
    if (host.startsWith("www.")) host = host.slice(4);
    // Strip trailing dot (rare but valid)
    if (host.endsWith(".")) host = host.slice(0, -1);
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Topic-level volume lookup for the prospect audit report.
 *
 * Instead of looking up volume per conversational query (which always returns
 * zero because long-tail LLM queries are not indexed), we look up volume for
 * SHORT SEED PHRASES that represent the service category in this market.
 *
 * For local scope:
 *   Seeds: "[service] [city]", "[service] near me", "best [service] [city]"
 * For national scope:
 *   Seeds: "[service]", "best [service]", "[service] company"
 * For ecommerce scope:
 *   Seeds: "[service]", "buy [service]", "best [service]"
 *
 * The aggregate Google Ads volume across these seeds is divided evenly across
 * all queries for that location, then multiplied by the 25% AI adoption rate.
 * This gives a meaningful, defensible per-query estimate instead of a floor.
 *
 * 25% blended estimate rationale:
 *   - AI Overviews trigger on ~40% of local-intent queries
 *   - ChatGPT at ~12% of Google volume
 *   - Gemini at ~5-8% of Google volume
 *   - Overlap between platforms
 * Source: industry research June 2026
 */
const AI_VOLUME_FALLBACK_RATE = 0.25;

// Suburban uplift removed: we now resolve to county level via Google Maps,
// so the county population already includes suburbs and surrounding areas.
// No additional multiplier needed.

/**
 * Build the short seed phrases used for topic-level volume lookup.
 * These are short enough to have real Google Ads search volume.
 */
function buildVolumeSeeds(
  serviceType: string,
  location: string,
  campaignScope: "local" | "national" | "ecommerce"
): string[] {
  // Use the raw seed exactly as entered — do NOT strip or convert anything.
  // "fence company" stays "fence company", "roofing company" stays "roofing company".
  // The volume lookup uses these as-is to generate variants.
  const base = serviceType.trim() || serviceType;

  if (campaignScope === "local") {
    // Do NOT include city name in seeds — we query nationally and apply a
    // county/US population ratio. Generate variants from the raw seed.
    const core = base.split(/\s+/)[0]; // first word, e.g. "fence", "roof"
    const seeds = new Set<string>([
      base,
      `${base} near me`,
      `best ${base}`,
      `${base} company`,
      `${base} company near me`,
      `${base} contractor`,
      `${base} contractor near me`,
      `${base} service`,
      `${base} service near me`,
    ]);
    // Add core-noun variants when core differs meaningfully from base
    if (core && core !== base && core.length > 2) {
      seeds.add(`${core} company`);
      seeds.add(`${core} company near me`);
      seeds.add(`${core} contractor`);
      seeds.add(`${core} contractor near me`);
      seeds.add(`${core} service near me`);
    }
    return [...seeds];
  } else if (campaignScope === "national") {
    return [
      base,
      `best ${base}`,
      `${base} company`,
      `${base} agency`,
    ];
  } else {
    return [
      base,
      `buy ${base}`,
      `best ${base}`,
      `${base} online`,
    ];
  }
}

/**
 * Fetch topic-level Google Ads volume for a set of seed phrases, then
 * distribute the aggregate volume evenly across `queryCount` queries.
 *
 * Returns { estimatedVolumePerQuery, totalTopicVolume, usedFallback }.
 */
async function fetchTopicVolume(
  serviceType: string,
  location: string,
  locationCode: number,
  populationRatio: number,
  queryCount: number,
  campaignScope: "local" | "national" | "ecommerce",
  countyPop: number = 0
): Promise<{ estimatedVolumePerQuery: number; totalTopicVolume: number; usedFallback: boolean }> {
  const seeds = buildVolumeSeeds(serviceType, location, campaignScope);
  // For national/ecommerce, always use 2840.
  // For local, also use 2840 — the AI volume endpoint is national-only and Google Ads
  // national data is more reliable than state-level (state returns zero for many terms).
  const locCode = 2840;
  // For national/ecommerce, ratio is always 1; for local, use county/US ratio
  const ratio = campaignScope === "local" ? Math.min(1, Math.max(0.000001, populationRatio)) : 1;

  let totalVolume = 0;
  let usedFallback = false;

  // ── Pass 1: AI search volume on seed phrases (primary) ───────────────
  // NOTE: AI volume endpoint is national-only — no location_code parameter.
  try {
    const aiVolumes = await getAIKeywordSearchVolume(seeds, { locationCode: locCode });
    for (const v of aiVolumes) {
      totalVolume += v.aiSearchVolume || 0;
    }
    console.log(`[ProspectAudit] AI volume for "${serviceType}" in ${location}: ${totalVolume}/mo national (seeds: ${seeds.join(", ")})`);
  } catch (err: any) {
    console.warn(`[ProspectAudit] AI volume endpoint failed for seeds: ${err.message}`);
  }

  // ── Pass 2: Google Ads volume as fallback (NATIONAL scope, then ratio-proportioned) ──
  // Always query at national level (2840) — state-level Google Ads data is sparse.
  if (totalVolume === 0) {
    try {
      const googleVolMap = await getGoogleAdsSearchVolume(seeds, { locationCode: 2840 });
      for (const seed of seeds) {
        totalVolume += googleVolMap.get(seed.toLowerCase()) ?? 0;
      }
      if (totalVolume > 0) {
        console.log(`[ProspectAudit] Google Ads national fallback volume for "${serviceType}" in ${location}: ${totalVolume}/mo national → county ratio ${(ratio * 100).toFixed(4)}%`);
        usedFallback = true;
      }
    } catch (err: any) {
      console.warn(`[ProspectAudit] Google Ads fallback volume failed for seeds: ${err.message}`);
    }
  }

  // ── Floor: if both return zero, use population-based estimate ────────
  // ~3 AI searches per 1,000 residents/month for a home service category.
  if (totalVolume === 0) {
    if (campaignScope === "local") {
      const pop = countyPop > 0 ? countyPop : Math.round(ratio * 334_914_895);
      totalVolume = Math.max(500, Math.round(pop * 0.003));
    } else {
      totalVolume = 10_000;
    }
    usedFallback = true;
    console.log(`[ProspectAudit] Using population-based volume floor for "${serviceType}" in ${location}: ${totalVolume}/mo`);
  }

  // Apply population ratio to proportion national volume down to county/market size.
  const scaledVolume = totalVolume * ratio;
  const totalAIVolume = usedFallback
    ? Math.round(scaledVolume * AI_VOLUME_FALLBACK_RATE)
    : Math.round(scaledVolume);
  const perQuery = Math.max(1, Math.round(totalAIVolume / queryCount));

  console.log(`[ProspectAudit] Final volume for "${location}": national=${totalVolume} × county_ratio=${(ratio * 100).toFixed(4)}% = ${Math.round(scaledVolume)} → AI=${totalAIVolume}/mo`);
  return { estimatedVolumePerQuery: perQuery, totalTopicVolume: totalAIVolume, usedFallback };
}

const PROSPECT_QUERY_COUNT = 15;
const FAN_OUT_CANDIDATES = 20; // GPT-4o generates this many per location before scoring

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProspectQueryInput {
  businessName: string;
  /** Primary location (first in list) — kept for backward compat */
  location: string;
  /** All target locations — if provided, queries are generated for each */
  locations?: string[];
  seedKeywords?: string; // comma-separated
  /** Controls query framing and volume lookup strategy */
  campaignScope?: "local" | "national" | "ecommerce";
}

export interface ProspectQueryResult {
  searchQuery: string;
  location: string;
}

export interface ProspectSnapshotResult {
  searchQuery: string;
  location: string;
  chatgptMentioned: boolean;
  chatgptPosition: number | null;
  chatgptSnippet: string | null;
  chatgptRecommendationRank: number | null;
  chatgptCitedUrl: boolean;
  chatgptSentiment: string | null;
  geminiMentioned: boolean;
  geminiPosition: number | null;
  geminiSnippet: string | null;
  geminiRecommendationRank: number | null;
  geminiCitedUrl: boolean;
  geminiSentiment: string | null;
  aiOverviewMentioned: boolean;
  aiOverviewPosition: number | null;
  aiOverviewSnippet: string | null;
  aiOverviewRecommendationRank: number | null;
  aiOverviewCitedUrl: boolean;
  aiOverviewSentiment: string | null;
}

export interface ProspectQueryVolume {
  searchQuery: string;
  aiSearchVolume: number;    // actual DataForSEO AI volume, or 0 if unavailable
  googleSearchVolume: number; // Google volume used for fallback calculation
  estimatedAIVolume: number;  // final value used in report (actual or 25% fallback)
  usedFallback: boolean;      // true if 25% fallback was applied
}

export interface ProspectAuditScores {
  overall: number;
  chatgpt: number;
  gemini: number;
  aiOverview: number;
  mentionedQueries: number;
  totalQueries: number;
  // Search volume summary for the pain-point cards
  totalAISearches: number;       // sum of estimatedAIVolume across all 15 queries
  visibleSearches: number;       // searches where business was mentioned (any platform)
  lostOpportunities: number;     // totalAISearches - visibleSearches
  volumeUsedFallback: boolean;   // true if any query used the 25% fallback
}

// ─── Query Generation ─────────────────────────────────────────────────────────

/**
 * Fallback queries when SERP data is unavailable — written as real English
 * sentences with the city baked in naturally.
 *
 * @param serviceDesc  A proper service description phrase (e.g. "fence installation"),
 *                     NOT the raw seed keyword (e.g. "fence company").
 */
/**
 * GPT-4o fan-out: generate FAN_OUT_CANDIDATES query candidates per location
 * across 3 intent buckets (transactional, commercial/comparison, reputation/trust).
 * Then score each candidate and return the top `needed` by score.
 *
 * For national/ecommerce scope, location is omitted from the prompt.
 */
async function fanOutQueriesForLocation(
  serviceType: string,
  location: string,
  needed: number,
  campaignScope: "local" | "national" | "ecommerce",
  openaiKey: string,
  allSeedKeywords?: string[]
): Promise<string[]> {
  const isLocal = campaignScope === "local";
  const locationClause = isLocal ? ` in ${location}` : "";
  const locationInstruction = isLocal
    ? `The city is ${location}. Every query MUST naturally include the city name or a clear local reference. Do NOT append the city as a suffix after a question mark — weave it into the sentence naturally.`
    : `This is a ${campaignScope} business. Do NOT include any city or location in the queries.`;

  // Build the business context block from seed keywords only.
  // The seeds ARE the context — no separate industry line needed.
  const servicesList = allSeedKeywords && allSeedKeywords.length > 0
    ? allSeedKeywords
    : [serviceType];
  const servicesLine = servicesList.length === 1
    ? `Service: ${servicesList[0]}`
    : servicesList.map((s, i) => `Service ${i + 1}: ${s}`).join("\n");
  const contextBlock = servicesLine;

  // Only these service types get urgency/emergency framing in queries.
  // The bar is high: the service must be something people genuinely search for
  // with urgency (burst pipe, no heat in winter, locked out, fallen tree, etc.).
  // "Fastest" / "quickest" framing is NEVER appropriate even for these —
  // only "emergency" and "urgent" are used.
  // Everything else (fence, painting, landscaping, cleaning, remodeling, etc.) gets
  // plain service-seeking framing with zero urgency language.
  const EMERGENCY_SERVICES = [
    'plumbing', 'plumber',
    'electrical', 'electrician',
    'hvac', 'heating', 'cooling', 'air conditioning', 'furnace', 'boiler',
    'locksmith',
    'tow truck', 'towing', 'roadside assistance',
    'water damage', 'flood restoration', 'fire damage', 'fire restoration',
    'emergency dental', 'emergency dentist',
    'emergency vet', 'emergency veterinarian',
    'gas leak', 'sewer',
  ];
  // NOTE: roofing and tree service are intentionally excluded.
  // People plan roofing projects — they do not search "emergency roofer fastest."
  // Tree removal after a storm may be urgent but "fastest tree service" is not a real query.
  const serviceTypeLower = serviceType.toLowerCase();
  const seedsLower = (allSeedKeywords ?? []).join(' ').toLowerCase();
  const isEmergencyService = EMERGENCY_SERVICES.some(e =>
    serviceTypeLower.includes(e) || seedsLower.includes(e)
  );

  const bucket1Label = isEmergencyService
    ? 'TRANSACTIONAL/URGENT (7 queries): The person needs someone NOW. Urgency is implied.'
    : 'TRANSACTIONAL/READY TO ACT (7 queries): The person has decided they want this and is looking for the right place, person, or business to use. They are not researching — they want a specific name or recommendation.';

  // Build dynamic examples from the actual seed keywords so GPT-4o
  // pattern-matches off the real business type, not hardcoded fence examples.
  const seed1 = servicesList[0] ?? serviceType;
  const seed2 = servicesList[1] ?? servicesList[0] ?? serviceType;
  const bucket1Examples = isEmergencyService
    ? `- "Who does emergency ${seed1} in ${location}?"
- "I need ${seed1} help right now in ${location} — who should I call?"
- "Best ${seed1} available now in ${location}"`
    : isLocal
      ? `- "Who does ${seed1} in ${location}?"
- "Looking for ${seed2} in ${location}"
- "I need ${seed1} in ${location} — who do you recommend?"`
      : `- "Who does ${seed1}?"
- "Best ${seed2} with good reviews"
- "I need ${seed1} — who do you recommend?"`;

  const noUrgencyRule = isEmergencyService ? '' : `
7. NEVER use urgency, speed, or emergency framing. Do NOT use words like: emergency, urgent, ASAP, fastest, quickest, today, tonight, right now, immediately, hurry, rush, quick. This service is NOT emergency-based. Real people do not search for it with urgency.`;

  const systemPrompt = `You are an expert at writing the exact phrases real people type into ChatGPT, Gemini, and Perplexity when they are ready to take action — find a specific business, call someone, visit a place, or get something done. You understand the difference between someone who is ready to act vs. someone who is still researching.

BUSINESS CONTEXT — use this to understand what the business does and generate queries that reflect their specific services:
${contextBlock}

Your task: Generate exactly ${FAN_OUT_CANDIDATES} queries from someone who has already decided they want this and is now looking for the right place or person to use${locationClause}.

${locationInstruction}

Generate queries across these 3 intent buckets:

BUCKET 1 — ${bucket1Label} Examples of good queries:
${bucket1Examples}

BUCKET 2 — COMMERCIAL/COMPARISON (7 queries): The person is vetting options, comparing businesses, or looking for the best. Examples:
- "Best ${seed1}${isLocal ? ` in ${location}` : ''} with good reviews"
- "Who are the most trusted ${seed2}${isLocal ? ` in ${location}` : ''}?"
- "Top rated ${seed1}${isLocal ? ` near ${location}` : ''}"

BUCKET 3 — SPECIFIC QUALIFYING QUESTION (6 queries): The person has a specific requirement, preference, or constraint that goes beyond just "who's best." They are asking about availability, specialties, scope, extras, or a particular situation. Examples:
- "${isLocal ? `Who does ${seed1} in ${location}` : `Who does ${seed1}`} and also does repairs?"
- "${isLocal ? `${seed2} in ${location}` : seed2} that offer free estimates"
- "${isLocal ? `Best ${seed1} in ${location}` : `Best ${seed1}`} for a large property"

CRITICAL RULES — violating any of these will make the query useless:
1. Write EXACTLY how a real person types on their phone. Natural, conversational, sometimes incomplete sentences.
2. NEVER stack two business-category words together as modifiers. "fence installation company" is ok. "fence company contractor" is NOT ok. "restaurant dining provider" is NOT ok.
3. NEVER include price, cost, budget, or how-to questions. Those are informational, not service-seeking intent.
4. NEVER use corporate jargon: "provider", "meeting these requirements", "solutions", "services" as a standalone noun.
5. SPREAD ACROSS ALL SERVICES — if multiple services are listed in the context, you MUST use each service in at least 2-3 queries. Do NOT use the same service in more than 4 queries total. This is mandatory.
6. Each query must be a complete, grammatically correct phrase that stands alone.
7. BUCKET 3 queries MUST be genuinely different from Bucket 2. Bucket 2 = "who's best / most trusted." Bucket 3 = a specific requirement, constraint, or qualifier (availability, specialty, scope, extras, situation). Do NOT repeat Bucket 2 phrasing in Bucket 3.${noUrgencyRule}

Output format: Number each query 1-${FAN_OUT_CANDIDATES}. One query per line. No explanations, no bucket labels, no extra text. NEVER wrap a query in quotation marks.`;

  const userPrompt = `Generate ${FAN_OUT_CANDIDATES} queries from someone who has decided they want this and is actively looking for the right business to use${locationClause}. Use the business context above. Follow all rules exactly. Do NOT use quotation marks around any query.`;

  try {
    const response = await callAI(
      "openai",
      openaiKey,
      "gpt-4o",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]
    );

    const text = response.content || "";
    const lines = text.split("\n");
    const URGENCY_WORDS = /\b(emergency|emergencies|urgent|urgently|asap|fastest|quickest|quick|quickly|today|tonight|right now|immediately|hurry|rush|on the spot|same.?day)\b/i;
    const queries: string[] = [];
    let filteredCount = 0;
    for (const line of lines) {
      const cleaned = line.replace(/^\d+[\.\)\s]+/, "").replace(/\*\*/g, "").replace(/^["']+|["']+$/g, "").trim();
      if (cleaned.length > 10 && cleaned.length < 200) {
        // Strip urgency framing for non-emergency services
        if (!isEmergencyService && URGENCY_WORDS.test(cleaned)) {
          filteredCount++;
          console.log(`[ProspectAudit] Filtered urgency query (non-emergency service): "${cleaned}"`);
          continue;
        }
        queries.push(cleaned);
      }
    }
    if (filteredCount > 0) {
      console.log(`[ProspectAudit] Removed ${filteredCount} urgency queries for non-emergency service "${serviceType}"`);
    }
    console.log(`[ProspectAudit] GPT-4o fan-out generated ${queries.length} candidates for "${serviceType}"${locationClause}`);
    return queries.slice(0, FAN_OUT_CANDIDATES);
  } catch (err: any) {
    console.warn(`[ProspectAudit] GPT-4o fan-out failed: ${err.message}`);
    return [];
  }
}

/**
 * Score each candidate query for service-seeking intent and natural language quality.
 * Returns the top `needed` candidates sorted by score descending.
 *
 * Scoring is done with a fast keyword heuristic (no LLM call needed):
 * - Service-seeking signals: +2 each (recommend, who does, who should, find me, looking for, best X in, near me, near [city])
 * - Informational penalty: -3 each (cost, price, how much, how to, diy, what is, define)
 * - Unnatural phrase penalty: -2 each (provider, meeting these requirements, solutions provider, services provider)
 */
function scoreAndRankCandidates(candidates: string[], needed: number, allSeedKeywords: string[] = []): string[] {
  const HIRE_SIGNALS = [
    /\b(recommend|recommendation)\b/i,
    /\bwho (does|do|should|can|will)\b/i,
    /\bfind (me|a|the)\b/i,
    /\blooking for\b/i,
    /\bbest .+ (in|near)\b/i,
    /\bnear me\b/i,
    /\bnear [A-Z]/i,
    /\b(top.rated|top rated|highest.rated|highest rated)\b/i,
    /\bwho (are|is) the\b/i,
    /\bany recommendations\b/i,
    /\bwho (to|should I) call\b/i,
    /\bI need\b/i,
    /\bI want\b/i,
    /\bI'm (looking|getting|trying)\b/i,
    /\bcan you (recommend|suggest|find)\b/i,
  ];

  const INFO_PENALTIES = [
    /\b(cost|costs|price|pricing|how much|budget|cheap|affordable|expensive)\b/i,
    /\bhow to\b/i,
    /\bdiy\b/i,
    /\bwhat is\b/i,
    /\bwhat are\b/i,
    /\bdefine\b/i,
    /\blaw(s)?\b/i,
    /\bregulation\b/i,
    /\bpermit\b/i,
  ];

  const UNNATURAL_PENALTIES = [
    /\bprovider\b/i,
    /meeting these requirements/i,
    /solutions provider/i,
    /services provider/i,
    /\bservice provider\b/i,
  ];

  const scored = candidates.map((q) => {
    let score = 0;
    for (const re of HIRE_SIGNALS) if (re.test(q)) score += 2;
    for (const re of INFO_PENALTIES) if (re.test(q)) score -= 3;
    for (const re of UNNATURAL_PENALTIES) if (re.test(q)) score -= 2;
    return { q, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // ── Enforce service diversity ─────────────────────────────────────────────
  // After sorting by score, ensure queries are distributed across the provided seed keywords.
  // We check which seed keyword the query most closely matches.
  const diverse: typeof scored = [];
  const overflow: typeof scored = [];

  if (allSeedKeywords.length > 1) {
    // If we have multiple seed keywords, cap each one to ensure spread
    const maxPerSeed = Math.ceil(needed / allSeedKeywords.length) + 1; // e.g. 3 seeds, 5 needed -> max 3 per seed
    const seedCount: Record<string, number> = {};
    
    // Normalize seeds for matching
    const normalizedSeeds = allSeedKeywords.map(s => ({
      original: s,
      words: s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/).filter(w => w.length > 2)
    }));

    for (const item of scored) {
      const qLower = item.q.toLowerCase();
      
      // Find the best matching seed keyword
      let bestSeed = "unknown";
      let maxOverlap = 0;
      
      for (const seed of normalizedSeeds) {
        // Exact substring match is strongest
        if (qLower.includes(seed.original.toLowerCase())) {
          bestSeed = seed.original;
          break;
        }
        
        // Otherwise count word overlap
        let overlap = 0;
        for (const w of seed.words) {
          if (qLower.includes(w)) overlap++;
        }
        if (overlap > maxOverlap) {
          maxOverlap = overlap;
          bestSeed = seed.original;
        }
      }

      if ((seedCount[bestSeed] ?? 0) < maxPerSeed) {
        seedCount[bestSeed] = (seedCount[bestSeed] ?? 0) + 1;
        diverse.push(item);
      } else {
        overflow.push(item);
      }

      if (diverse.length >= needed) break;
    }
  } else {
    // If only 1 or 0 seed keywords, just take the top scores
    diverse.push(...scored.slice(0, needed));
  }

  // If diversity filtering left us short, fill from overflow
  const result = diverse.length >= needed
    ? diverse.slice(0, needed)
    : [...diverse, ...overflow].slice(0, needed);

  return result.map((s) => s.q);
}

/**
 * Generate exactly PROSPECT_QUERY_COUNT (15) buying-intent queries for a prospect.
 *
 * Strategy:
 * 1. PRIMARY — GPT-4o fan-out: generate FAN_OUT_CANDIDATES (20) query candidates
 *    per location across 3 intent buckets (transactional, commercial/comparison,
 *    reputation/trust). Score each candidate on service-seeking intent and natural language
 *    quality. Take the top N by score.
 *
 * 2. FALLBACK — If GPT-4o fails, use hardcoded natural-language sentences.
 *    These are grammatically correct and include the city name naturally.
 *
 * Campaign scope controls query framing:
 * - local: queries include city name, service-seeking intent is geo-specific
 * - national: no location in queries, brand/service intent
 * - ecommerce: no location, purchase/product intent
 */
export async function generateProspectQueries(
  input: ProspectQueryInput
): Promise<ProspectQueryResult[]> {
  const { location, seedKeywords, campaignScope = "local" } = input;

  // Deduplicate and filter blank locations; always include primary
  const allLocations = [
    location,
    ...(input.locations ?? []).filter((l) => l.trim() && l.trim() !== location.trim()),
  ].filter(Boolean);

  // For national/ecommerce, we only generate one set of queries (no location variation)
  const locationsToProcess = campaignScope === "local" ? allLocations : [allLocations[0]];

  // Determine the primary service type (seed keyword preferred over industry).
  // serviceType comes from keywords only — industry is not used here.
  if (!seedKeywords) {
    throw new Error("Audit requires at least one seed keyword to generate queries.");
  }
  const seedList = seedKeywords.split(",").map(s => s.trim()).filter(Boolean);
  if (seedList.length === 0) {
    throw new Error("Audit requires at least one seed keyword to generate queries.");
  }
  const serviceType = seedList[0];

  const totalCount = PROSPECT_QUERY_COUNT; // 15
  const numLocations = locationsToProcess.length;
  const queriesPerLocation = Math.ceil(totalCount / numLocations);

  // Resolve OpenAI key
  let openaiKey: string | null = null;
  try {
    const keyRecord = await getApiKeyByProvider("openai");
    if (keyRecord) openaiKey = decrypt(keyRecord.encryptedKey);
  } catch { /* will use heuristic fallback */ }

  // Use the first seed keyword as the primary service type for fallback queries.
  // No conversion needed — fanOutQueriesForLocation receives the raw seed and the
  // GPT-4o prompt handles natural phrasing internally.
  const serviceDesc = seedList[0];

  const normalized: ProspectQueryResult[] = [];

  for (const loc of locationsToProcess) {
    const needed = Math.min(queriesPerLocation, totalCount - normalized.length);
    if (needed <= 0) break;

    let queriesForLoc: string[] = [];

    // ── PRIMARY: GPT-4o fan-out — one call PER seed keyword ───────────────
    // We call fanOutQueriesForLocation once per seed so each seed gets its own
    // pool of candidates. Without this, GPT-4o gravitates toward the most
    // actionable seed and ignores the others.
    if (openaiKey) {
      const seedsToUse = seedList;
      const queriesNeededPerSeed = Math.ceil(needed / seedsToUse.length);

      const perSeedResults: string[][] = [];

      for (const seed of seedsToUse) {
        // Pass the raw seed directly — no toServiceDescription conversion.
        // The GPT-4o system prompt in fanOutQueriesForLocation handles natural phrasing.
        const seedCandidates = await fanOutQueriesForLocation(
          seed,
          loc,
          queriesNeededPerSeed,
          campaignScope,
          openaiKey,
          [seed]  // pass only THIS seed so GPT-4o focuses on it
        );
        console.log(`[ProspectAudit] Fan-out got ${seedCandidates.length} candidates for seed "${seed}" in ${loc}`);
        // Score and take the best N for this seed
        const topForSeed = scoreAndRankCandidates(seedCandidates, queriesNeededPerSeed, [seed]);
        perSeedResults.push(topForSeed);
      }

      // Interleave results from each seed so diversity is preserved in order
      // e.g. seed1[0], seed2[0], seed3[0], seed1[1], seed2[1], seed3[1] ...
      const maxLen = Math.max(...perSeedResults.map(r => r.length));
      for (let i = 0; i < maxLen; i++) {
        for (const seedResult of perSeedResults) {
          if (i < seedResult.length) queriesForLoc.push(seedResult[i]);
          if (queriesForLoc.length >= needed) break;
        }
        if (queriesForLoc.length >= needed) break;
      }

      console.log(`[ProspectAudit] Fan-out merged ${queriesForLoc.length} queries across ${seedsToUse.length} seeds for ${loc}`);
    }

    // ── FALLBACK: hardcoded natural sentences ────────────────────────
    if (queriesForLoc.length < needed) {
      const stillNeeded = needed - queriesForLoc.length;
      const fallback = buildFallbackQueries(serviceDesc, loc, campaignScope, stillNeeded);
      queriesForLoc = [...queriesForLoc, ...fallback];
    }

    for (const q of queriesForLoc) {
      // For national/ecommerce, assign the primary location as the display location
      // but it won't appear in the query text itself
      normalized.push({ searchQuery: q, location: loc });
    }
  }

  return normalized.slice(0, totalCount);
}

/**
 * Hardcoded fallback queries — only used when GPT-4o is unavailable.
 * Uses natural English sentences, never the raw seed keyword as a noun phrase.
 */
function buildFallbackQueries(
  serviceDesc: string,
  city: string,
  scope: "local" | "national" | "ecommerce",
  count: number
): string[] {
  const s = serviceDesc;
  const c = city;
  let pool: string[];

  if (scope === "local") {
    pool = [
      `Best ${s} companies in ${c}`,
      `Who does ${s} in ${c}?`,
      `Looking for a good ${s} contractor in ${c}`,
      `Who are the most trusted ${s} companies in ${c}?`,
      `I need ${s} done in ${c} — who do you recommend?`,
      `Can you recommend a ${s} contractor in ${c} that does good work?`,
      `Who are the top-rated ${s} companies near ${c}?`,
      `Any recommendations for ${s} contractors in ${c}?`,
      `Who do you recommend for ${s} in ${c}?`,
      `I'm getting quotes for ${s} in ${c} — who should I call?`,
      `Who does ${s} near ${c} with good reviews?`,
      `Find me a licensed ${s} contractor in ${c}`,
      `Who is the most reputable ${s} company in ${c}?`,
      `Best reviewed ${s} company near ${c}, Alabama`,
      `Who are the top ${s} contractors in ${c}?`,
    ];
  } else if (scope === "national") {
    pool = [
      `Best ${s} companies in the US`,
      `Who are the top ${s} agencies?`,
      `Recommend a good ${s} company`,
      `Who do you recommend for ${s}?`,
      `Top-rated ${s} companies with good reviews`,
      `Who does ${s} for small businesses?`,
      `Best ${s} for growing companies`,
      `Who are the most trusted ${s} providers?`,
      `Compare the best ${s} companies`,
      `Any recommendations for a good ${s} agency?`,
    ];
  } else {
    pool = [
      `Best ${s} online`,
      `Where can I buy ${s}?`,
      `Top-rated ${s} brands`,
      `Who sells the best ${s}?`,
      `Recommend a good ${s} store`,
      `Best ${s} with fast shipping`,
      `Compare ${s} brands`,
      `Who has the best ${s} deals?`,
    ];
  }

  const result: string[] = [];
  for (let i = 0; i < count; i++) result.push(pool[i % pool.length]);
  return result;
}

// ─── Audit Runner ─────────────────────────────────────────────────────────────

/**
 * Run a baseline visibility check for a prospect.
 * Checks each of the provided queries across ChatGPT, Gemini, and AI Overview.
 * Saves results to the prospectAudits table and returns the computed scores.
 *
 * onProgress is called after each query completes so the frontend can show
 * a live progress indicator.
 */
export async function runProspectAudit(
  auditId: number,
  businessName: string,
  website: string | null | undefined,
  phone: string | null | undefined,
  agencyId: number | null | undefined,
  queries: ProspectQueryResult[],
  onProgress?: (completed: number, total: number, latest: ProspectSnapshotResult) => void,
  serviceType?: string,
  campaignScope?: "local" | "national" | "ecommerce",
  businessLocation?: string | null
): Promise<{
  snapshots: ProspectSnapshotResult[];
  scores: ProspectAuditScores;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Mark audit as running
  await db
    .update(prospectAudits)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(prospectAudits.id, auditId));

  const snapshots: ProspectSnapshotResult[] = [];
  const scope = campaignScope ?? "local";
  // No default — if serviceType is missing the router has a bug; fail loudly.
  if (!serviceType) {
    throw new Error("runProspectAudit called without a serviceType — check that the router passes audit.seedKeywords.");
  }
  const svcType = serviceType;

  // ── Topic-level volume lookup (per location) ─────────────────────────────
  // We look up volume for SHORT SEED PHRASES (e.g. "fence installation Cullman")
  // rather than per-query, because long conversational queries have no indexed
  // volume. The aggregate seed volume is divided evenly across all queries for
  // that location.
  const locationGroups = new Map<string, number[]>();
  for (let i = 0; i < queries.length; i++) {
    const loc = queries[i].location;
    if (!locationGroups.has(loc)) locationGroups.set(loc, []);
    locationGroups.get(loc)!.push(i);
  }

  // Map from query index → { estimatedVolume, usedFallback }
  const queryVolumeMap = new Map<number, { estimatedVolume: number; usedFallback: boolean }>();

  for (const [loc, indices] of locationGroups) {
    // Use county-level location code for volume lookups — gives realistic market-size
    // data for both small towns (city limits too small) and large cities (residential
    // population lives in surrounding suburbs, not city limits).
    const { locationCode: locCode, populationRatio, resolvedAs, countyPop } = await getCityCountyLocationCode(loc);
    const cpop = (countyPop as number | undefined) ?? 0;
    console.log(`[ProspectAudit] Volume lookup for "${loc}" using location code ${locCode} (${resolvedAs}, ratio ${(populationRatio * 100).toFixed(1)}%, countyPop=${cpop.toLocaleString()})`);
    const topicVol = await fetchTopicVolume(svcType, loc, locCode, populationRatio, indices.length, scope, cpop);
    for (const idx of indices) {
      queryVolumeMap.set(idx, {
        estimatedVolume: topicVol.estimatedVolumePerQuery,
        usedFallback: topicVol.usedFallback,
      });
    }
  }

  try {
    for (let i = 0; i < queries.length; i++) {
      const { searchQuery, location } = queries[i];
      // The query already has the location baked in naturally by the LLM
      // (e.g. "Who does fence installation in Cullman, AL?").
      // Do NOT append " in {location}" again — that produces broken English.
      const mention = await checkLLMVisibilityDirect(
        searchQuery,
        businessName,
        agencyId ?? null,
        website ?? null,
        phone ?? null,
        null,
        businessLocation ?? null
      );

      const snapshot: ProspectSnapshotResult = {
        searchQuery,
        location,
        chatgptMentioned: mention.llmResponses.chatgpt?.mentioned || false,
        chatgptPosition: mention.llmResponses.chatgpt?.position || null,
        chatgptSnippet: mention.llmResponses.chatgpt?.snippet || null,
        chatgptRecommendationRank: mention.llmResponses.chatgpt?.recommendationRank ?? null,
        chatgptCitedUrl: mention.llmResponses.chatgpt?.citedUrl ?? false,
        chatgptSentiment: mention.llmResponses.chatgpt?.sentiment ?? null,
        geminiMentioned: mention.llmResponses.gemini?.mentioned || false,
        geminiPosition: mention.llmResponses.gemini?.position || null,
        geminiSnippet: mention.llmResponses.gemini?.snippet || null,
        geminiRecommendationRank: mention.llmResponses.gemini?.recommendationRank ?? null,
        geminiCitedUrl: mention.llmResponses.gemini?.citedUrl ?? false,
        geminiSentiment: mention.llmResponses.gemini?.sentiment ?? null,
        aiOverviewMentioned: mention.llmResponses.aiOverview?.mentioned || false,
        aiOverviewPosition: mention.llmResponses.aiOverview?.position || null,
        aiOverviewSnippet: mention.llmResponses.aiOverview?.snippet || null,
        aiOverviewRecommendationRank: mention.llmResponses.aiOverview?.recommendationRank ?? null,
        aiOverviewCitedUrl: mention.llmResponses.aiOverview?.citedUrl ?? false,
        aiOverviewSentiment: mention.llmResponses.aiOverview?.sentiment ?? null,
      };

      snapshots.push(snapshot);

      if (onProgress) {
        onProgress(i + 1, queries.length, snapshot);
      }
    }

    // Compute scores using the same logic as the campaign rank engine
    const scoreInput = snapshots.map((s) => ({
      chatgptMentioned: s.chatgptMentioned,
      chatgptPosition: s.chatgptPosition,
      geminiMentioned: s.geminiMentioned,
      geminiPosition: s.geminiPosition,
      aiOverviewMentioned: s.aiOverviewMentioned,
      aiOverviewPosition: s.aiOverviewPosition,
    }));

    const vis = calculateVisibilityScore(scoreInput, snapshots.length);

    // ── Search volume pain-point calculation ─────────────────────────────────
    // For each query, determine the estimated monthly AI searches.
    // If DataForSEO returned a real AI volume (> 0), use it.
    // Otherwise apply the 25% fallback against a conservative baseline of
    // 100 searches/month (typical for long-tail local queries with no data).
    // Visible searches = queries where the business was mentioned on ANY platform.
    let totalAISearches = 0;
    let visibleSearches = 0;
    let volumeUsedFallback = false;

    for (let i = 0; i < queries.length; i++) {
      const volData = queryVolumeMap.get(i) ?? { estimatedVolume: Math.round(100 * AI_VOLUME_FALLBACK_RATE), usedFallback: true };

      if (volData.usedFallback) volumeUsedFallback = true;
      totalAISearches += volData.estimatedVolume;

      const s = snapshots[i];
      const mentioned = s.chatgptMentioned || s.geminiMentioned || s.aiOverviewMentioned;
      if (mentioned) {
        visibleSearches += volData.estimatedVolume;
      }
    }

    const lostOpportunities = Math.max(0, totalAISearches - visibleSearches);

    const scores: ProspectAuditScores = {
      overall: vis.overall,
      chatgpt: vis.chatgpt,
      gemini: vis.gemini,
      aiOverview: vis.aiOverview,
      mentionedQueries: vis.mentionedQueries,
      totalQueries: snapshots.length,
      totalAISearches,
      visibleSearches,
      lostOpportunities,
      volumeUsedFallback,
    };

    // Persist results (also store normalizedDomain for prospect-to-client matching)
    const nd = normalizeDomain(website);
    await db
      .update(prospectAudits)
      .set({
        snapshotResults: snapshots as any,
        overallScore: scores.overall,
        chatgptScore: scores.chatgpt,
        geminiScore: scores.gemini,
        aiOverviewScore: scores.aiOverview,
        queriesMentioned: scores.mentionedQueries,
        // Volume summary — persisted so the public share URL can show the same numbers
        totalAISearches: scores.totalAISearches,
        visibleSearches: scores.visibleSearches,
        lostOpportunities: scores.lostOpportunities,
        volumeUsedFallback: scores.volumeUsedFallback,
        ...(nd ? { normalizedDomain: nd } : {}),
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(prospectAudits.id, auditId));

    console.log(
      `[ProspectAudit] Audit ${auditId} completed — overall: ${scores.overall}/100, ` +
        `${scores.mentionedQueries}/${queries.length} queries mentioned`
    );

    return { snapshots, scores };
  } catch (err: any) {
    // Mark as failed
    await db
      .update(prospectAudits)
      .set({
        status: "failed",
        errorMessage: err.message,
        updatedAt: new Date(),
      })
      .where(eq(prospectAudits.id, auditId));

    throw err;
  }
}
