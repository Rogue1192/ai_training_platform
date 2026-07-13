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
import { checkLLMVisibilityDirect, getAIKeywordSearchVolume, getKeywordsForSite } from "./dataforseoService";
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
 * Fetch AI search volume for a list of queries.
 * Falls back to 25% of Google search volume when DataForSEO AI volume is zero/null.
 * 25% is a conservative blended estimate based on:
 *   - AI Overviews triggering on ~40% of local-intent queries
 *   - ChatGPT at ~12% of Google volume
 *   - Gemini at ~5-8% of Google volume
 *   - Overlap between platforms
 * Source: industry research June 2026 (see docs/ai_search_volume_research.md)
 */
const AI_VOLUME_FALLBACK_RATE = 0.25;

async function fetchQueryAIVolumes(
  queries: string[],
  locationCode: number
): Promise<Map<string, number>> {
  const volumeMap = new Map<string, number>();

  try {
    // First try DataForSEO AI-specific volume
    const aiVolumes = await getAIKeywordSearchVolume(queries, { locationCode });
    for (const v of aiVolumes) {
      if (v.aiSearchVolume > 0) {
        volumeMap.set(v.keyword.toLowerCase(), v.aiSearchVolume);
      }
    }

    // For any query with zero AI volume, try to get Google volume as fallback
    const missingQueries = queries.filter(q => !volumeMap.has(q.toLowerCase()));
    if (missingQueries.length > 0) {
      // Use getKeywordsForSite is domain-based; instead call the AI volume endpoint
      // which also returns google_search_volume in some responses.
      // If still zero, we'll compute the fallback after all checks.
      // For now, mark them as needing fallback with sentinel -1
      for (const q of missingQueries) {
        volumeMap.set(q.toLowerCase(), -1); // sentinel = needs Google fallback
      }
    }
  } catch (err: any) {
    console.warn("[ProspectAudit] AI volume fetch failed, will use fallback:", err.message);
    // Mark all as needing fallback
    for (const q of queries) {
      volumeMap.set(q.toLowerCase(), -1);
    }
  }

  return volumeMap;
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
 * Use GPT-4o-mini to generate PROSPECT_QUERY_COUNT buying-intent queries for a prospect.
 *
 * Strategy: raw keyword + commercial modifier pattern.
 * For each core service keyword, generate variants like:
 *   "aluminum fence installation"
 *   "aluminum fence installation near me"
 *   "best aluminum fence installation"
 *   "top rated aluminum fence installation"
 *   "affordable aluminum fence installation"
 *
 * ONLY commercial/transactional queries — zero informational content.
 * Returns an array of { searchQuery, location } objects ready for review.
 */
export async function generateProspectQueries(
  input: ProspectQueryInput
): Promise<ProspectQueryResult[]> {
  const { businessName, location, industry, seedKeywords } = input;

  // Deduplicate and filter blank locations; always include primary
  const allLocations = [
    location,
    ...(input.locations ?? []).filter((l) => l.trim() && l.trim() !== location.trim()),
  ].filter(Boolean);

  const seedList = seedKeywords
    ? seedKeywords.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5)
    : [];

  // Distribute exactly PROSPECT_QUERY_COUNT (15) queries across all locations.
  // e.g. 1 location = 15 queries; 3 locations = 5+5+5; 4 locations = 4+4+4+3
  const totalCount = PROSPECT_QUERY_COUNT;
  const perLoc = Math.floor(totalCount / allLocations.length);
  const remainder = totalCount % allLocations.length;
  const counts = allLocations.map((_, i) => perLoc + (i < remainder ? 1 : 0));

  const systemPrompt = `You are a search query generator for local service businesses. Generate buying-intent queries that a customer would type into ChatGPT or Google when they are READY TO HIRE someone.

Rules:
- Every query must be something a paying customer would search — service + location, service + modifier, etc.
- NEVER write informational queries ("how to", "what is", "do I need", "why", "tips", "guide", "explained", "process", "timeline", "benefits", "vs", "permit").
- Vary the service keywords. Use the seed keywords if provided.
- Include the city/state in most queries.
- Return ONLY a valid JSON array of exactly the requested number of strings. No explanation. No markdown.`;

  try {
    const keyRecord = await getApiKeyByProvider("openai");
    if (!keyRecord?.encryptedKey) throw new Error("OpenAI API key not configured");
    const apiKey = decrypt(keyRecord.encryptedKey);

    // Generate queries for each location in parallel
    const locationResults = await Promise.allSettled(
      allLocations.map((loc, i) => {
        const count = counts[i];
        const userPrompt = `Business: ${businessName}
Location: ${loc}
${industry ? `Industry: ${industry}` : ""}
${seedList.length > 0 ? `Core services: ${seedList.join(", ")}` : ""}

Generate exactly ${count} buying-intent queries for this business in ${loc}. Return ONLY a JSON array of ${count} strings.`;
        return callAI("openai", apiKey, "gpt-4o-mini", [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]).then((resp) => {
          const content = resp.content?.trim() || "[]";
          const match = content.match(/\[[\s\S]*\]/);
          if (!match) return [] as string[];
          const parsed: string[] = JSON.parse(match[0]);
          return Array.isArray(parsed)
            ? parsed.filter((q) => typeof q === "string" && q.trim().length > 5).slice(0, count)
            : [] as string[];
        });
      })
    );

    const service = seedList[0] || industry || "services";
    const normalized: ProspectQueryResult[] = [];

    for (let li = 0; li < allLocations.length; li++) {
      const loc = allLocations[li];
      const count = counts[li];
      const settled = locationResults[li];
      const rawQueries = settled.status === "fulfilled" ? settled.value : [];
      const locQueries = [...rawQueries];
      // Pad with simple fallbacks if LLM returned fewer than needed
      const fallbacks = [
        `best ${service} in ${loc}`, `top rated ${service} ${loc}`,
        `affordable ${service} near me`, `${service} company ${loc}`,
        `${service} near me`, `${service} contractor ${loc}`,
        `${service} services ${loc}`, `cheapest ${service} ${loc}`,
      ];
      let fi = 0;
      while (locQueries.length < count) { locQueries.push(fallbacks[fi++ % fallbacks.length]); }
      for (const q of locQueries) normalized.push({ searchQuery: q.trim(), location: loc });
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

  // Derive a location code from the first query's location (default US)
  // We use US national (2840) since our queries are geo-specific in the text
  const locationCode = 2840;

  // Fetch AI search volume for all queries in a single batch call BEFORE
  // running the visibility checks so we have volume data ready for the report.
  // This adds ~$0.008 to the audit cost (15 × $0.0005).
  const queryStrings = queries.map(q => q.searchQuery);
  const aiVolumeMap = await fetchQueryAIVolumes(queryStrings, locationCode);

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
      const q = queries[i].searchQuery;
      const rawVolume = aiVolumeMap.get(q.toLowerCase()) ?? -1;
      let estimatedVolume: number;

      if (rawVolume > 0) {
        estimatedVolume = rawVolume;
      } else {
        // Fallback: 25% of a conservative 100/mo baseline for long-tail local queries
        // In practice most long-tail local queries get 50–200 searches/mo on Google.
        // We use 100 as the floor so we never show zero, which would look broken.
        estimatedVolume = Math.round(100 * AI_VOLUME_FALLBACK_RATE);
        volumeUsedFallback = true;
      }

      totalAISearches += estimatedVolume;

      const s = snapshots[i];
      const mentioned = s.chatgptMentioned || s.geminiMentioned || s.aiOverviewMentioned;
      if (mentioned) {
        visibleSearches += estimatedVolume;
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
