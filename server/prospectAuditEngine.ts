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
import { checkLLMVisibilityDirect, getAIKeywordSearchVolume, getGoogleAdsSearchVolume, getKeywordsForSite, getKeywordSuggestionsForProspect } from "./dataforseoService";
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
      result.set(q.toLowerCase(), { estimatedVolume: aiVol, usedFallback: false });
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
          // Real Google volume × 25% estimate
          result.set(q.toLowerCase(), {
            estimatedVolume: Math.round(googleVol * AI_VOLUME_FALLBACK_RATE),
            usedFallback: true,
          });
        } else {
          // Last resort: conservative floor of 100/mo × 25% = 25
          result.set(q.toLowerCase(), {
            estimatedVolume: Math.round(100 * AI_VOLUME_FALLBACK_RATE),
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
 * Generate exactly PROSPECT_QUERY_COUNT (15) buying-intent queries for a prospect
 * using DataForSEO keyword suggestions as the source of truth.
 *
 * Flow:
 *   1. Feed seed keywords into DataForSEO keyword_suggestions
 *   2. Strip all informational/navigational results — keep only commercial + transactional
 *   3. Sort remaining by search volume descending
 *   4. Take the top unique base keywords
 *   5. Distribute locations across those keywords until we hit exactly 15 pairs
 *      e.g. 3 locations + 5 base keywords = 15 (each keyword gets each location)
 *
 * Fallback: if DataForSEO returns no results (no API key, no data), fall back to
 * simple seed+modifier combinations so the audit can still run.
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

  // Build seed list — always include industry and businessName so DataForSEO
  // has something to work with even if seedKeywords is blank.
  const seedList = [
    ...(seedKeywords ? seedKeywords.split(",").map((s) => s.trim()).filter(Boolean) : []),
    ...(industry ? [industry] : []),
    // businessName as last-resort seed (e.g. "Cullman Fence Company" → "fence company")
    ...(input.businessName ? [input.businessName] : []),
  ]
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i) // deduplicate
    .slice(0, 8);

  const totalCount = PROSPECT_QUERY_COUNT; // 15
  const numLocations = allLocations.length;

  // How many unique base keywords do we need?
  // We want: baseKeywords * numLocations === 15
  // e.g. 1 location → 15 base keywords
  //      3 locations → 5 base keywords (5 × 3 = 15)
  //      5 locations → 3 base keywords (3 × 5 = 15)
  // If it doesn't divide evenly, we round up and trim the final list to exactly 15.
  const baseKeywordsNeeded = Math.ceil(totalCount / numLocations);

  try {
    // ── Step 1: DataForSEO keyword suggestions ────────────────────────────────────
    // Pull a large pool of keyword suggestions from DataForSEO. We'll let the
    // LLM pick the best transactional ones in Step 2 — DataForSEO gives us
    // real search volume data; the LLM gives us accurate intent classification.
    let dfsKeywords: { keyword: string; searchVolume: number }[] = [];

    if (seedList.length > 0) {
      try {
        dfsKeywords = await getKeywordSuggestionsForProspect(seedList, {
          locationCode: 2840,
          languageCode: "en",
          limit: 200,
        });
        console.log(`[ProspectAudit] DataForSEO returned ${dfsKeywords.length} keyword candidates`);
      } catch (dfsErr: any) {
        console.warn(`[ProspectAudit] DataForSEO keyword suggestions failed, using fallback: ${dfsErr.message}`);
      }
    }

    // ── Step 2: LLM picks the best transactional queries ────────────────────
    // Feed the DataForSEO candidates to an LLM and ask it to select only the
    // queries where someone is actively looking to hire / buy right now.
    const baseKeywords: string[] = [];

    if (dfsKeywords.length > 0) {
      try {
        const { getApiKeyByProvider } = await import("./db");
        const { decrypt } = await import("./encryption");
        const keyRecord = await getApiKeyByProvider("openai");
        let openaiKey = process.env.OPENAI_API_KEY || "";
        if (keyRecord?.encryptedKey) {
          try { openaiKey = decrypt(keyRecord.encryptedKey); } catch { /* use env fallback */ }
        }

        if (openaiKey) {
          // Give the LLM the top 80 candidates (sorted by volume) to choose from
          const candidates = dfsKeywords.slice(0, 80).map((k) => k.keyword);
          const prompt = [
            `You are a search intent expert. Below is a list of keywords related to "${seedList[0] || industry}".
`,
            `Your job: select exactly ${baseKeywordsNeeded} keywords that represent PURE BUYING INTENT — someone who is ready to hire a company or purchase a service RIGHT NOW.
`,
            `KEEP: keywords like "best fence company", "fence company near me", "licensed fence installer", "affordable fence installation", "fence company that offers financing"
`,
            `REMOVE: anything with cost/price/how much, DIY/how-to, reviews, comparisons, timelines, permits, maintenance, or any research intent.
`,
            `Return ONLY a JSON array of exactly ${baseKeywordsNeeded} keyword strings. No explanation. No markdown. Just the JSON array.
`,
            `Keywords to evaluate:
${candidates.map((k, i) => `${i + 1}. ${k}`).join("\n")}`,
          ].join("");

          const resp = await callAI("openai", openaiKey, "gpt-4o-mini", [
            { role: "user", content: prompt },
          ]);

          // Parse the JSON array from the LLM response
          const raw = resp.content.trim();
          const jsonMatch = raw.match(/\[.*\]/s);
          if (jsonMatch) {
            const parsed: string[] = JSON.parse(jsonMatch[0]);
            baseKeywords.push(
              ...parsed
                .filter((k) => typeof k === "string" && k.trim())
                .map((k) => k.trim())
                .slice(0, baseKeywordsNeeded)
            );
            console.log(`[ProspectAudit] LLM selected ${baseKeywords.length} transactional queries from ${candidates.length} candidates`);
          }
        }
      } catch (llmErr: any) {
        console.warn(`[ProspectAudit] LLM intent filter failed, falling back to volume sort: ${llmErr.message}`);
      }

      // If LLM returned too few, fill remaining slots with modifier-template
      // variants of the top DataForSEO keyword — NOT raw DataForSEO results
      // (which may include cost/research queries).
      if (baseKeywords.length < baseKeywordsNeeded) {
        const topSeed = dfsKeywords[0]?.keyword || seedList[0] || industry || "services";
        const FILL_TEMPLATES = [
          `best ${topSeed}`,
          `top-rated ${topSeed}`,
          `affordable ${topSeed}`,
          `${topSeed} near me`,
          `trusted ${topSeed}`,
          `licensed ${topSeed}`,
          `insured ${topSeed}`,
          `certified ${topSeed}`,
          `experienced ${topSeed}`,
          `highly rated ${topSeed}`,
          `reputable ${topSeed}`,
          `recommended ${topSeed}`,
          `reliable ${topSeed}`,
          `local ${topSeed}`,
          `${topSeed} that offers financing`,
        ];
        const existing = new Set(baseKeywords.map((k) => k.toLowerCase()));
        for (const t of FILL_TEMPLATES) {
          if (baseKeywords.length >= baseKeywordsNeeded) break;
          if (!existing.has(t.toLowerCase())) {
            baseKeywords.push(t);
            existing.add(t.toLowerCase());
          }
        }
        console.log(`[ProspectAudit] Filled ${baseKeywords.length - (baseKeywords.length - FILL_TEMPLATES.length)} slots with modifier templates (LLM returned fewer than needed)`);
      }
    }

    // ── Step 3: Fallback if DataForSEO returned nothing at all ──────────────
    if (baseKeywords.length === 0) {
      const service = seedList[0] || industry || "services";
      const TRANSACTIONAL_TEMPLATES: [string, string][] = [
        ["best",           "best {s}"],
        ["top-rated",      "top-rated {s}"],
        ["highly rated",   "highly rated {s}"],
        ["five-star",      "five-star {s}"],
        ["affordable",     "affordable {s}"],
        ["budget-friendly","budget-friendly {s}"],
        ["low-cost",       "low-cost {s}"],
        ["local",          "local {s}"],
        ["near me",        "{s} near me"],
        ["trusted",        "trusted {s}"],
        ["reputable",      "reputable {s}"],
        ["recommended",    "recommended {s}"],
        ["reliable",       "reliable {s}"],
        ["licensed",       "licensed {s}"],
        ["insured",        "insured {s}"],
        ["certified",      "certified {s}"],
        ["experienced",    "experienced {s}"],
        ["financing",      "{s} that offers financing"],
        ["payment plans",  "{s} with payment plans"],
        ["free estimates", "{s} that offers free estimates"],
      ];
      baseKeywords.push(
        ...TRANSACTIONAL_TEMPLATES
          .map(([, tmpl]) => tmpl.replace("{s}", service))
          .slice(0, baseKeywordsNeeded)
      );
    }

    // ── Step 4: Distribute locations across base keywords → exactly 15 pairs ─
    // Pattern: for each base keyword, pair it with each location in round-robin
    // until we hit exactly 15.
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

  // Derive a location code from the first query's location (default US)
  // We use US national (2840) since our queries are geo-specific in the text
  const locationCode = 2840;

  // Fetch AI search volume for all queries in a single batch call BEFORE
  // running the visibility checks so we have volume data ready for the report.
  // Pass 2 volume lookup: use the FINAL query+location strings (e.g. "aluminum fence
  // installation Cullman AL") so DataForSEO returns location-specific volume data.
  // This is the same string we send to the LLMs for the visibility check.
  const finalQueryStrings = queries.map(q => `${q.searchQuery} ${q.location}`);
  const aiVolumeMap = await fetchQueryAIVolumes(finalQueryStrings, locationCode);

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
