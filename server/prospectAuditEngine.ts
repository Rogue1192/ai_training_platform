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
import { checkLLMVisibilityDirect } from "./dataforseoService";
import { calculateVisibilityScore } from "./rankTrackingEngine";
import { prospectAudits } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROSPECT_QUERY_COUNT = 15;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProspectQueryInput {
  businessName: string;
  location: string;
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

export interface ProspectAuditScores {
  overall: number;
  chatgpt: number;
  gemini: number;
  aiOverview: number;
  mentionedQueries: number;
  totalQueries: number;
}

// ─── Query Generation ─────────────────────────────────────────────────────────

/**
 * Use GPT-4o-mini to generate 15 AI-search queries for a prospect business.
 * Returns an array of { searchQuery, location } objects ready for the user to
 * review and edit before running the audit.
 */
export async function generateProspectQueries(
  input: ProspectQueryInput
): Promise<ProspectQueryResult[]> {
  const { businessName, location, industry, seedKeywords } = input;

  const seedList = seedKeywords
    ? seedKeywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  const prompt = `You are an AI search query strategist. Generate exactly ${PROSPECT_QUERY_COUNT} search queries that a potential customer might type into ChatGPT or Google Gemini when looking for a business like this one.

Business: ${businessName}
Location: ${location}
${industry ? `Industry: ${industry}` : ""}
${seedList.length > 0 ? `Seed keywords: ${seedList.join(", ")}` : ""}

Rules:
- Queries should be natural conversational phrases a real person would ask an AI
- Mix intent types: service-specific, location-based, problem-solving, comparison, urgency
- Include the location naturally in most queries (e.g. "in ${location}", "near ${location}", "${location} area")
- Use long-tail phrasing — avoid single-word keywords
- Do NOT include competitor names
- Do NOT repeat the same query with minor word changes
- Return ONLY a valid JSON array of exactly ${PROSPECT_QUERY_COUNT} query strings, no explanation, no markdown

Example format: ["best HVAC company in Richmond VA", "emergency AC repair near me Richmond", ...]`;

  try {
    const keyRecord = await getApiKeyByProvider("openai");
    if (!keyRecord?.encryptedKey) {
      throw new Error("OpenAI API key not configured");
    }
    const apiKey = decrypt(keyRecord.encryptedKey);

    const response = await callAI("openai", apiKey, "gpt-4o-mini", [
      { role: "user", content: prompt },
    ]);

    const content = response.content?.trim() || "[]";
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("LLM did not return a JSON array");

    const queries: string[] = JSON.parse(match[0]);
    if (!Array.isArray(queries)) throw new Error("Invalid JSON array");

    // Normalize and cap at PROSPECT_QUERY_COUNT
    const normalized = queries
      .filter((q) => typeof q === "string" && q.trim().length > 5)
      .slice(0, PROSPECT_QUERY_COUNT)
      .map((q) => ({
        searchQuery: q.trim(),
        location,
      }));

    // Pad with generic fallbacks if LLM returned fewer than needed
    while (normalized.length < PROSPECT_QUERY_COUNT) {
      const idx = normalized.length + 1;
      normalized.push({
        searchQuery: `${industry || "business"} services in ${location} ${idx}`,
        location,
      });
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

    const scores: ProspectAuditScores = {
      overall: vis.overall,
      chatgpt: vis.chatgpt,
      gemini: vis.gemini,
      aiOverview: vis.aiOverview,
      mentionedQueries: vis.mentionedQueries,
      totalQueries: queries.length,
    };

    // Persist results
    await db
      .update(prospectAudits)
      .set({
        snapshotResults: snapshots as any,
        overallScore: scores.overall,
        chatgptScore: scores.chatgpt,
        geminiScore: scores.gemini,
        aiOverviewScore: scores.aiOverview,
        queriesMentioned: scores.mentionedQueries,
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
