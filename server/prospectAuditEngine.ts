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
import { checkLLMVisibilityDirect, getAIKeywordSearchVolume, getGoogleAdsSearchVolume, getKeywordsForSite, getKeywordSuggestionsForProspect, getCityLocationCode } from "./dataforseoService";
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
 * Two-pass volume lookup for the prospect audit report.
 *
 * Pass 1: AI volume endpoint on the final query+location strings.
 * Pass 2: For any query that comes back zero from AI volume, hit Google Ads
 *         search volume and multiply by 25% to estimate AI searches.
 *
 * Returns a map of lowercased query string → { estimatedVolume, usedFallback }.
 *
 * 25% blended estimate rationale:
 *   - AI Overviews trigger on ~40% of local-intent queries
 *   - ChatGPT at ~12% of Google volume
 *   - Gemini at ~5-8% of Google volume
 *   - Overlap between platforms
 * Source: industry research June 2026
 */
const AI_VOLUME_FALLBACK_RATE = 0.25;

/**
 * Suburban uplift: city-limits data from Google Ads/AI volume endpoints
 * captures only searches originating within city limits. Service businesses
 * draw customers from suburbs, surrounding towns, and rural areas that
 * Google's geo-targeting excludes. We apply a flat 20% uplift to all
 * volume figures to account for this systematic under-reporting.
 */
const SUBURBAN_UPLIFT = 1.20;

async function fetchQueryAIVolumes(
  queries: string[], // final query+location strings, e.g. "aluminum fence installation Cullman AL"
  locationCode: number
): Promise<Map<string, { estimatedVolume: number; usedFallback: boolean }>> {
  const result = new Map<string, { estimatedVolume: number; usedFallback: boolean }>();

  // ── Pass 1: AI volume endpoint ────────────────────────────────────────────
  const aiVolumeMap = new Map<string, number>();
  try {
    const aiVolumes = await getAIKeywordSearchVolume(queries, { locationCode });
    for (const v of aiVolumes) {
      aiVolumeMap.set(v.keyword.toLowerCase(), v.aiSearchVolume || 0);
    }
  } catch (err: any) {
    console.warn("[ProspectAudit] AI volume fetch failed, falling back to Google Ads:", err.message);
  }

  // Separate queries with real AI volume from those that need Google fallback
  const needsGoogleFallback: string[] = [];
  for (const q of queries) {
    const aiVol = aiVolumeMap.get(q.toLowerCase()) ?? 0;
    if (aiVol > 0) {
      result.set(q.toLowerCase(), { estimatedVolume: Math.round(aiVol * SUBURBAN_UPLIFT), usedFallback: false });
    } else {
      needsGoogleFallback.push(q);
    }
  }

  // ── Pass 2: Google Ads volume × 25% for zero-AI-volume queries ───────────
  if (needsGoogleFallback.length > 0) {
    try {
      const googleVolMap = await getGoogleAdsSearchVolume(needsGoogleFallback, { locationCode });
      for (const q of needsGoogleFallback) {
        const googleVol = googleVolMap.get(q.toLowerCase()) ?? 0;
        if (googleVol > 0) {
          // Real Google volume × 25% AI estimate × 20% suburban uplift
          result.set(q.toLowerCase(), {
            estimatedVolume: Math.round(googleVol * AI_VOLUME_FALLBACK_RATE * SUBURBAN_UPLIFT),
            usedFallback: true,
          });
        } else {
          // Last resort: conservative floor of 100/mo × 25% × 20% uplift = 30
          result.set(q.toLowerCase(), {
            estimatedVolume: Math.round(100 * AI_VOLUME_FALLBACK_RATE * SUBURBAN_UPLIFT),
            usedFallback: true,
          });
        }
      }
    } catch (err: any) {
      console.warn("[ProspectAudit] Google Ads volume fallback failed, using floor:", err.message);
      for (const q of needsGoogleFallback) {
        result.set(q.toLowerCase(), {
          estimatedVolume: Math.round(100 * AI_VOLUME_FALLBACK_RATE),
          usedFallback: true,
        });
      }
    }
  }

  return result;
}

const PROSPECT_QUERY_COUNT = 15;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProspectQueryInput {
  businessName: string;
  /** Primary location (first in list) — kept for backward compat */
  location: string;
  /** All target locations — if provided, queries are generated for each */
  locations?: string[];
  industry?: string;
  seedKeywords?: string; // comma-separated
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
  geminiMentioned: boolean;
  geminiPosition: number | null;
  geminiSnippet: string | null;
  aiOverviewMentioned: boolean;
  aiOverviewPosition: number | null;
  aiOverviewSnippet: string | null;
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
 * Ask GPT-4o-mini to write `count` natural, location-aware queries for a given
 * service type and city. The city is baked into the query text itself so the
 * question reads like a real person asking a chatbot — never a keyword suffix.
 */
async function generateQueriesForLocation(
  serviceType: string,
  city: string,
  count: number,
  openaiKey: string
): Promise<string[]> {
  const systemPrompt = `You write search queries that real homeowners type into AI assistants like ChatGPT or Google Gemini when they need to hire a local contractor.

Rules:
- Every query must sound like a real person talking — casual and natural
- The city/area must be woven naturally into the query (e.g. "Who does fence installation in Cullman, AL?" or "Best fence contractors near Cullman?")
- NEVER stack the service name as a noun modifier (e.g. NEVER write "fence company contractor", "fence company provider", "fence company companies" — these are not English)
- Vary the phrasing: mix questions about finding someone, getting quotes, checking reputation, cost, comparing options
- Some short and direct, some longer and conversational
- Output ONLY a JSON array of strings, no explanation, no numbering, no extra text`;

  const userPrompt = `Write ${count} unique, natural-sounding search queries that someone in or near "${city}" would type into ChatGPT or Gemini when they need to hire someone for "${serviceType}".

The city must appear naturally in each query. Return a JSON array of exactly ${count} strings.`;

  const resp = await callAI("openai", openaiKey, "gpt-4o-mini", [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);

  const raw = resp.content.trim();
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed)) throw new Error("LLM did not return an array");
  return parsed
    .map((q: any) => String(q).trim())
    .filter((q: string) => q.length > 0)
    .slice(0, count);
}

/**
 * Fallback queries when the LLM call fails — written as real English sentences
 * with the city baked in, never template concatenations.
 */
function fallbackQueriesForLocation(serviceType: string, city: string, count: number): string[] {
  const s = serviceType;
  const c = city;
  const pool = [
    `Who does ${s} in ${c}?`,
    `Best ${s} companies near ${c}`,
    `How much does ${s} cost in ${c}?`,
    `Who should I hire for ${s} in ${c}?`,
    `Looking for a good ${s} contractor near ${c}`,
    `Who are the most trusted ${s} companies in ${c}?`,
    `I need ${s} done in ${c} — who do you recommend?`,
    `How do I find a reliable ${s} contractor in ${c}?`,
    `What should I look for when hiring someone for ${s} near ${c}?`,
    `Can you recommend a ${s} contractor in ${c} that does good work?`,
    `Who are the top-rated ${s} companies near ${c}?`,
    `I'm getting quotes for ${s} in ${c} — who should I call?`,
    `What does ${s} typically cost in ${c} and who's worth hiring?`,
    `Any recommendations for ${s} contractors in ${c}?`,
    `Who's the best local contractor for ${s} in ${c}?`,
  ];
  const result: string[] = [];
  for (let i = 0; i < count; i++) result.push(pool[i % pool.length]);
  return result;
}

/**
 * Generate exactly PROSPECT_QUERY_COUNT (15) buying-intent queries for a prospect.
 *
 * For each target location, GPT-4o-mini writes queries with the city baked in
 * naturally — so the final query sent to ChatGPT/Gemini is already a complete,
 * grammatically correct question like "Who does fence installation in Cullman, AL?"
 * rather than a query with a location suffix tacked on afterward.
 */
export async function generateProspectQueries(
  input: ProspectQueryInput
): Promise<ProspectQueryResult[]> {
  const { location, industry, seedKeywords } = input;

  // Deduplicate and filter blank locations; always include primary
  const allLocations = [
    location,
    ...(input.locations ?? []).filter((l) => l.trim() && l.trim() !== location.trim()),
  ].filter(Boolean);

  // Determine the primary service type
  let serviceType = "home services";
  if (seedKeywords) {
    const seeds = seedKeywords.split(",").map(s => s.trim()).filter(Boolean);
    if (seeds.length > 0) serviceType = seeds[0];
  } else if (industry) {
    serviceType = industry;
  }

  const totalCount = PROSPECT_QUERY_COUNT; // 15
  const numLocations = allLocations.length;
  // Distribute queries as evenly as possible across locations
  const queriesPerLocation = Math.ceil(totalCount / numLocations);

  // Resolve OpenAI key once
  let openaiKey: string | null = null;
  try {
    const keyRecord = await getApiKeyByProvider("openai");
    if (keyRecord) openaiKey = decrypt(keyRecord.encryptedKey);
  } catch { /* will fall back to hardcoded */ }

  // ── Generate location-aware queries for each city ──────────────────────────
  const normalized: ProspectQueryResult[] = [];

  for (const loc of allLocations) {
    const needed = Math.min(queriesPerLocation, totalCount - normalized.length);
    if (needed <= 0) break;

    let queries: string[];
    if (openaiKey) {
      try {
        queries = await generateQueriesForLocation(serviceType, loc, needed, openaiKey);
        // Pad if LLM returned fewer than needed
        while (queries.length < needed) queries.push(queries[queries.length % queries.length]);
        console.log(`[ProspectAudit] LLM generated ${queries.length} queries for "${serviceType}" in ${loc}`);
      } catch (err: any) {
        console.warn(`[ProspectAudit] LLM failed for ${loc} (${err.message}), using fallback`);
        queries = fallbackQueriesForLocation(serviceType, loc, needed);
      }
    } else {
      console.warn(`[ProspectAudit] No OpenAI key — using fallback queries for ${loc}`);
      queries = fallbackQueriesForLocation(serviceType, loc, needed);
    }

    for (const q of queries) {
      normalized.push({ searchQuery: q, location: loc });
    }
  }

  return normalized.slice(0, totalCount);
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
  onProgress?: (completed: number, total: number, latest: ProspectSnapshotResult) => void
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

  // Fetch AI search volume for all queries BEFORE running visibility checks.
  // Group queries by location so each batch uses the correct state-level
  // DataForSEO location code (e.g. "Cullman, AL" → Alabama code 21167).
  // This gives local-market volume instead of US national.
  const finalQueryStrings = queries.map(q => `${q.searchQuery} ${q.location}`);

  // Build a combined volume map by running per-location batches
  const aiVolumeMap = new Map<string, { estimatedVolume: number; usedFallback: boolean }>();
  // Group query indices by location
  const locationGroups = new Map<string, number[]>();
  for (let i = 0; i < queries.length; i++) {
    const loc = queries[i].location;
    if (!locationGroups.has(loc)) locationGroups.set(loc, []);
    locationGroups.get(loc)!.push(i);
  }
  // Fetch volume for each location group with the correct city-level location code
  for (const [loc, indices] of locationGroups) {
    const locCode = await getCityLocationCode(loc);
    const groupQueryStrings = indices.map(i => finalQueryStrings[i]);
    const groupVolMap = await fetchQueryAIVolumes(groupQueryStrings, locCode);
    for (const [key, val] of groupVolMap) {
      aiVolumeMap.set(key, val);
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
        phone ?? null
      );

      const snapshot: ProspectSnapshotResult = {
        searchQuery,
        location,
        chatgptMentioned: mention.llmResponses.chatgpt?.mentioned || false,
        chatgptPosition: mention.llmResponses.chatgpt?.position || null,
        chatgptSnippet: mention.llmResponses.chatgpt?.snippet || null,
        geminiMentioned: mention.llmResponses.gemini?.mentioned || false,
        geminiPosition: mention.llmResponses.gemini?.position || null,
        geminiSnippet: mention.llmResponses.gemini?.snippet || null,
        aiOverviewMentioned: mention.llmResponses.aiOverview?.mentioned || false,
        aiOverviewPosition: mention.llmResponses.aiOverview?.position || null,
        aiOverviewSnippet: mention.llmResponses.aiOverview?.snippet || null,
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

    const vis = calculateVisibilityScore(scoreInput, queries.length);

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
      // Look up by the final query+location string used for the volume call
      const finalStr = finalQueryStrings[i].toLowerCase();
      const volData = aiVolumeMap.get(finalStr) ?? { estimatedVolume: Math.round(100 * AI_VOLUME_FALLBACK_RATE), usedFallback: true };

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
      totalQueries: queries.length,
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
