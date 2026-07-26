/**
 * trainingUtils.ts
 *
 * Shared training utility functions used across all training versions.
 * Extracted from trainingWorkerV3 when V3/V4/V5 were removed.
 */

import { getDb, getApiKeyByProvider } from "./db";
import { decrypt } from "./encryption";
import { callAI } from "./aiProviders";
import {
  trainingQueries,
  trainingPhraseStatus,
  trainingDayRuns,
  campaigns,
  businesses,
} from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// ─── Key Cache ────────────────────────────────────────────────────────────────
const utilKeyCache: { openai?: string } = {};

async function getDecryptedKey(provider: "openai"): Promise<string> {
  if (utilKeyCache[provider]) return utilKeyCache[provider]!;
  const record = await getApiKeyByProvider(provider);
  if (!record) throw new Error(`No API key configured for ${provider}`);
  const key = decrypt(record.encryptedKey);
  utilKeyCache[provider] = key;
  return key;
}

// ─── Query Variation Generator ────────────────────────────────────────────────
function buildVariationPrompt(phraseText: string, count: number): string {
  return `Generate ${count} natural variations of this search query. Each variation should express the same commercial intent but use different phrasing. Return ONLY a JSON array of strings, no other text.
Original query: "${phraseText}"
Requirements:
- Same intent (finding the best local business for this service)
- Different phrasing (question form, statement form, "I'm looking for", "who is", "what is", etc.)
- Keep the location if present
- Sound like something a real person would type or say to an AI
- No duplicates
Return format: ["variation 1", "variation 2", "variation 3"]`;
}

export async function generateQueryVariations(
  phraseText: string,
  count: number = 3
): Promise<string[]> {
  const openaiKey = await getDecryptedKey("openai");
  const prompt = buildVariationPrompt(phraseText, count);
  const resp = await callAI("openai", openaiKey, "gpt-4o-mini", [
    { role: "system", content: "You are a helpful assistant that generates search query variations. Always return valid JSON arrays." },
    { role: "user", content: prompt },
  ]);
  try {
    const match = resp.content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in response");
    const variations: string[] = JSON.parse(match[0]);
    return variations.slice(0, count);
  } catch (err) {
    console.error("[TrainingUtils] Failed to parse variations:", err);
    return [
      `What is the best ${phraseText}?`,
      `Who is the best ${phraseText}?`,
      `I'm looking for the best ${phraseText}`,
    ].slice(0, count);
  }
}

// ─── Sprint Schedule Creator ──────────────────────────────────────────────────
export async function createSprintSchedule(campaignId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { getFutureDateCentral } = await import('./dateUtils');
  for (let day = 1; day <= 4; day++) {
    const dateStr = getFutureDateCentral(day - 1); // day 1=today, 2=tomorrow, etc.
    await db.insert(trainingDayRuns).values({
      campaignId,
      runType: "sprint",
      runDay: day,
      scheduledDate: dateStr,
      status: "pending",
      webSearchStatus: "pending",
    });
  }
  console.log(`[TrainingUtils] Created 4-day sprint schedule for campaign ${campaignId}`);
}

// ─── End-of-Day Web Search ────────────────────────────────────────────────────
/**
 * Runs a DataForSEO web search probe for all active phrases in a campaign.
 * Confirms or reverts graduation based on real-world search results.
 * V7 uses clean probe wins (3 consecutive) as the primary graduation gate,
 * but this EOD check serves as a real-world confirmation layer.
 */
export async function runEndOfDayWebSearch(campaignId: number, dayRunId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { checkLLMVisibilityDirect } = await import("./dataforseoService");

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const [business] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
  if (!business) throw new Error(`Business for campaign ${campaignId} not found`);

  await db.update(trainingDayRuns)
    .set({ webSearchStatus: "running" })
    .where(eq(trainingDayRuns.id, dayRunId));

  const queries = await db.select().from(trainingQueries)
    .where(and(eq(trainingQueries.campaignId, campaignId), eq(trainingQueries.isActive, true)));

  let phrasesInRotation = 0;
  let phrasesGraduated = 0;

  for (const query of queries) {
    try {
      console.log(`[TrainingUtils] EOD web search probe: "${query.phraseText}"`);
      const result = await checkLLMVisibilityDirect(
        query.phraseText,
        business.name,
        business.agencyId ?? null,
        business.website ?? null,
        null,
        null,
        business.location ?? null
      );

      // V7 providers mapped to web search results
      const providerMap: Record<string, boolean> = {
        chatgpt: result.llmResponses?.chatgpt?.mentioned ?? false,
        gemini: result.llmResponses?.gemini?.mentioned ?? false,
        google_ai_mode: result.llmResponses?.aiOverview?.mentioned ?? false,
      };

      for (const [provider, webMentioned] of Object.entries(providerMap)) {
        const statusRows = await db.select().from(trainingPhraseStatus)
          .where(and(eq(trainingPhraseStatus.queryId, query.id), eq(trainingPhraseStatus.targetAiProvider, provider)))
          .limit(1);

        if (statusRows.length > 0) {
          const status = statusRows[0]!;
          if (status.isGraduated && !webMentioned) {
            // Graduated in training but not confirmed in real search — revert
            await db.update(trainingPhraseStatus)
              .set({ isGraduated: false, consecutiveWins: 0, updatedAt: new Date() })
              .where(eq(trainingPhraseStatus.id, status.id));
            console.log(`[TrainingUtils] Reverted graduation: "${query.phraseText}" on ${provider} — not in web search`);
            phrasesInRotation++;
          } else {
            const nowGraduated = webMentioned;
            await db.update(trainingPhraseStatus)
              .set({
                consecutiveWins: webMentioned ? (status.consecutiveWins ?? 0) + 1 : 0,
                isGraduated: nowGraduated,
                updatedAt: new Date(),
              })
              .where(eq(trainingPhraseStatus.id, status.id));
            if (nowGraduated) {
              phrasesGraduated++;
              console.log(`[TrainingUtils] WEB-SEARCH GRADUATED: "${query.phraseText}" on ${provider}`);
            } else {
              phrasesInRotation++;
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[TrainingUtils] Web search error for "${query.phraseText}":`, err.message);
    }
  }

  await db.update(trainingDayRuns)
    .set({ webSearchStatus: "completed", phrasesInRotation } as any)
    .where(eq(trainingDayRuns.id, dayRunId));

  console.log(`[TrainingUtils] EOD web search complete for campaign ${campaignId}: ${phrasesGraduated} graduated, ${phrasesInRotation} in rotation`);
}
