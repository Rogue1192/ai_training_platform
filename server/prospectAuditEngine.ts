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
 * The 10 prompt family templates from ChatGPT research, ranked by purchase intent.
 * These are the exact conversational queries real users type into AI assistants.
 */
const PROMPT_FAMILY_TEMPLATES = [
  "Who are the best {service} providers near me?",
  "Find me a reputable local {service} contractor",
  "Recommend a good {service} company for my project",
  "Compare the top local {service} companies",
  "How much should {service} cost and who should I hire?",
  "Find a {service} provider meeting these requirements",
  "Who can fix this {service} issue today?",
  "Give me {service} companies to contact for quotes",
  "Is this particular {service} company reputable?",
  "Which {service} quote or contractor should I choose?"
];

/**
 * Generate exactly PROSPECT_QUERY_COUNT (15) buying-intent queries for a prospect
 * using the 10 prompt family templates.
 *
 * Flow:
 *   1. Determine the primary service term (from seedKeywords or industry)
 *   2. Generate base queries using the 10 templates
 *   3. If we need more than 10 base queries (e.g. 1 location needs 15 queries),
 *      we cycle through the templates again with a slight variation or just repeat.
 *   4. Distribute locations across those base queries until we hit exactly 15 pairs.
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

  // Determine the primary service term
  let primaryService = "service";
  if (seedKeywords) {
    const seeds = seedKeywords.split(",").map(s => s.trim()).filter(Boolean);
    if (seeds.length > 0) {
      primaryService = seeds[0];
    }
  } else if (industry) {
    primaryService = industry;
  }

  const totalCount = PROSPECT_QUERY_COUNT; // 15
  const numLocations = allLocations.length;

  // How many unique base keywords do we need?
  const baseKeywordsNeeded = Math.ceil(totalCount / numLocations);

  try {
    const baseKeywords: string[] = [];
    
    // Fill baseKeywords using the templates
    for (let i = 0; i < baseKeywordsNeeded; i++) {
      const template = PROMPT_FAMILY_TEMPLATES[i % PROMPT_FAMILY_TEMPLATES.length];
      // If we loop past the 10 templates, we could add variations, but for now we just reuse them
      // The location will make the final query unique
      let query = template.replace(/{service}/g, primaryService);
      
      // If we are reusing templates, add a slight variation to make the base query unique
      if (i >= PROMPT_FAMILY_TEMPLATES.length) {
          if (i % 2 === 0) {
              query = query.replace("best", "top").replace("reputable", "trusted").replace("good", "reliable");
          } else {
              query = query.replace("near me", "in my area").replace("local", "nearby");
          }
      }
      
      baseKeywords.push(query);
    }

    console.log(`[ProspectAudit] Generated ${baseKeywords.length} base queries using prompt family templates for service: "${primaryService}"`);

    // ── Distribute locations across base keywords → exactly 15 pairs ─
    const normalized: ProspectQueryResult[] = [];
    let ki = 0; // base keyword index
    let li = 0; // location index

    while (normalized.length < totalCount) {
      const kw = baseKeywords[ki % baseKeywords.length];
      const loc = allLocations[li % numLocations];
      normalized.push({ searchQuery: kw, location: loc });
      // Advance: fill all locations for a keyword before moving to next keyword
      li++;
      if (li % numLocations === 0) ki++;
    }

    return normalized;

  } catch (err: any) {
    console.error("[ProspectAudit] generateProspectQueries failed:", err.message);
    throw new Error(`Failed to generate queries: ${err.message}`);
  }
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
      const queryWithLocation = `${searchQuery} in ${location}`;

      const mention = await checkLLMVisibilityDirect(
        queryWithLocation,
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
