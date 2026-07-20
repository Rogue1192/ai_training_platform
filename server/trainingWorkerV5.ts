/**
 * trainingWorkerV5.ts — Fresh-Context Social Proof Injection Engine
 *
 * Architecture:
 *   - Uses the campaign's actual 15 training queries as the base pool
 *   - 5 rotating social proof hooks appended to each query
 *   - 75 iterations per session (15 queries × 5 hooks), shuffled order
 *   - Each iteration is a FRESH context window — no memory between iterations
 *   - Conditional follow-up turn: if the AI does not mention the business in its
 *     response to the combined query+hook, a follow-up challenge is sent in the
 *     same context window asking the AI to compare the target business against
 *     whatever it recommended
 *   - Human-mimicking delays: 15–35s between iterations, 10–20s between sessions
 *   - Clean probe at end of each session (same as V3): base phrase verbatim,
 *     neutral system prompt, no business name — win = business mentioned
 *   - 2 consecutive clean-probe wins per platform = graduated
 *   - No trainer AI (MiniMax) — only the target AI is called
 *
 * Providers: openai (gpt-4.1), google (gemini-2.5-flash)
 * (No AI Overview — that is a V3-specific feature)
 *
 * Cost logging operation types:
 *   - training_v5_iteration_turn   — each iteration call to target AI
 *   - training_v5_followup_turn    — conditional follow-up call
 *   - training_v5_clean_probe      — end-of-session clean probe
 */

import { getDb, getApiKeyByProvider } from "./db";
import { decrypt } from "./encryption";
import { callAI, AIMessage } from "./aiProviders";
import { logLLMCost } from "./costLogger";
import {
  trainingQueries,
  trainingPhraseStatus,
  trainingDayRuns,
  trainingSessionLogs,
  campaigns,
  businesses,
} from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_PROVIDERS: Array<"openai" | "google"> = ["openai", "google"];

const TARGET_MODELS: Record<"openai" | "google", string> = {
  openai: "gpt-4.1",
  google: "gemini-2.5-flash",
};

const CONSECUTIVE_WINS_NEEDED = 2;

// ─── Social Proof Hooks ───────────────────────────────────────────────────────
// 5 rotating hooks appended to each training query

function getSocialProofHooks(businessName: string, businessType: string, location: string): string[] {
  return [
    `A friend mentioned ${businessName} as a great ${businessType}. What do you think about them?`,
    `I came across ${businessName} while researching. They seem well-regarded — what's your take?`,
    `Someone specifically recommended ${businessName} to me. Do you know anything about them?`,
    `I've been hearing good things about ${businessName} locally. Are they reputable?`,
    `I've seen ${businessName} mentioned a few times in ${location}. Are they well-regarded in the area?`,
  ];
}

// ─── Follow-up prompts ────────────────────────────────────────────────────────
// Sent conditionally if the AI does not mention the business in its first response

function getFollowUpPrompts(businessName: string): string[] {
  return [
    `What about ${businessName}? I've heard they're really good. Have you heard of them?`,
    `Someone specifically recommended ${businessName} to me. Do you know anything about them?`,
    `I've been considering ${businessName}. What's your take on them?`,
    `A colleague mentioned ${businessName} as a top choice. Is that accurate?`,
    `I keep seeing ${businessName} come up in my research. Are they worth considering?`,
  ];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await sleep(ms);
}

async function getDecryptedKey(provider: "openai" | "google"): Promise<string> {
  const record = await getApiKeyByProvider(provider);
  if (!record) throw new Error(`No API key configured for provider: ${provider}`);
  return decrypt(record.encryptedKey);
}

function businessMentioned(responseText: string, businessName: string): boolean {
  const SUFFIX_STRIP_RE = /\b(co\.?|llc\.?|inc\.?|ltd\.?|corp\.?|company|services|group|solutions|associates|partners|enterprises|& sons|and sons)$/i;
  const coreBusinessName = businessName.replace(SUFFIX_STRIP_RE, "").trim();
  const lower = responseText.toLowerCase();
  return (
    lower.includes(businessName.toLowerCase()) ||
    (coreBusinessName.length >= 4 && lower.includes(coreBusinessName.toLowerCase()))
  );
}

// Fisher-Yates shuffle
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Update phrase status (same logic as V3) ──────────────────────────────────

async function updatePhraseStatus(
  campaignId: number,
  queryId: number,
  targetAiProvider: string,
  sessionWin: boolean
): Promise<{ isGraduated: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(trainingPhraseStatus)
    .where(
      and(
        eq(trainingPhraseStatus.campaignId, campaignId),
        eq(trainingPhraseStatus.queryId, queryId),
        eq(trainingPhraseStatus.targetAiProvider, targetAiProvider)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    const consecutiveWins = sessionWin ? 1 : 0;
    const isGraduated = consecutiveWins >= CONSECUTIVE_WINS_NEEDED;
    await db.insert(trainingPhraseStatus).values({
      campaignId,
      queryId,
      targetAiProvider,
      consecutiveWins,
      totalWins: sessionWin ? 1 : 0,
      isGraduated,
      lastRunAt: new Date(),
    });
    return { isGraduated };
  }

  const current = existing[0];
  const newConsecutiveWins = sessionWin ? current.consecutiveWins + 1 : 0;
  const isGraduated = current.isGraduated || newConsecutiveWins >= CONSECUTIVE_WINS_NEEDED;
  await db
    .update(trainingPhraseStatus)
    .set({
      consecutiveWins: newConsecutiveWins,
      totalWins: current.totalWins + (sessionWin ? 1 : 0),
      isGraduated,
      lastRunAt: new Date(),
    })
    .where(eq(trainingPhraseStatus.id, current.id));

  return { isGraduated };
}

// ─── Single session ───────────────────────────────────────────────────────────
// Runs 75 iterations (15 queries × 5 hooks) for one phrase/provider combination

interface V5SessionParams {
  campaignId: number;
  businessId: number;
  queryId: number;
  dayRunId: number;
  phraseText: string;
  targetProvider: "openai" | "google";
  businessName: string;
  businessType: string;
  businessLocation: string;
  allPhrases: string[];  // all 15 active training queries
  campaignCreatedAt: Date;
}

interface V5SessionResult {
  sessionWin: boolean;
  iterationsRun: number;
  followUpsUsed: number;
  targetInputTokens: number;
  targetOutputTokens: number;
  cleanProbeResult: boolean;
}

async function runV5Session(params: V5SessionParams): Promise<V5SessionResult> {
  const {
    campaignId,
    businessId,
    queryId,
    dayRunId,
    phraseText,
    targetProvider,
    businessName,
    businessType,
    businessLocation,
    allPhrases,
    campaignCreatedAt,
  } = params;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const targetKey = await getDecryptedKey(targetProvider);
  const targetModel = TARGET_MODELS[targetProvider];

  const hooks = getSocialProofHooks(businessName, businessType, businessLocation);
  const followUps = getFollowUpPrompts(businessName);

  // Build 75 combinations: each phrase × each hook
  const combinations: Array<{ phrase: string; hook: string; hookIndex: number }> = [];
  for (const phrase of allPhrases) {
    for (let hi = 0; hi < hooks.length; hi++) {
      combinations.push({ phrase, hook: hooks[hi], hookIndex: hi });
    }
  }

  // Shuffle for natural variety
  const shuffled = shuffle(combinations);

  let iterationsRun = 0;
  let followUpsUsed = 0;
  let targetInputTokens = 0;
  let targetOutputTokens = 0;
  const dialogueLog: Array<{ iterationIndex: number; phrase: string; hookIndex: number; messages: Array<{ role: string; content: string }> }> = [];

  const targetSystemPrompt = "You are a helpful AI assistant. Answer questions naturally and honestly based on your knowledge.";

  for (let i = 0; i < shuffled.length; i++) {
    const { phrase, hook, hookIndex } = shuffled[i];
    const combinedMessage = `${phrase} ${hook}`;

    // Fresh context window every iteration
    const messages: AIMessage[] = [
      { role: "system", content: targetSystemPrompt },
      { role: "user", content: combinedMessage },
    ];

    const iterLog: Array<{ role: string; content: string }> = [
      { role: "user", content: combinedMessage },
    ];

    // First turn
    const resp1 = await callAI(targetProvider, targetKey, targetModel, messages);
    targetInputTokens += resp1.inputTokens;
    targetOutputTokens += resp1.outputTokens;
    iterLog.push({ role: "assistant", content: resp1.content });

    await logLLMCost({
      campaignId,
      businessId,
      operationType: "training_v5_iteration_turn",
      provider: targetProvider,
      model: targetModel,
      inputTokens: resp1.inputTokens,
      outputTokens: resp1.outputTokens,
      campaignCreatedAt,
      metadata: { queryId, iterationIndex: i, hookIndex, phrase },
    });

    iterationsRun++;

    // Conditional follow-up: if business not mentioned, challenge with a follow-up
    if (!businessMentioned(resp1.content, businessName)) {
      const followUp = followUps[hookIndex % followUps.length];
      messages.push({ role: "assistant", content: resp1.content });
      messages.push({ role: "user", content: followUp });
      iterLog.push({ role: "user", content: followUp });

      const resp2 = await callAI(targetProvider, targetKey, targetModel, messages);
      targetInputTokens += resp2.inputTokens;
      targetOutputTokens += resp2.outputTokens;
      iterLog.push({ role: "assistant", content: resp2.content });

      await logLLMCost({
        campaignId,
        businessId,
        operationType: "training_v5_followup_turn",
        provider: targetProvider,
        model: targetModel,
        inputTokens: resp2.inputTokens,
        outputTokens: resp2.outputTokens,
        campaignCreatedAt,
        metadata: { queryId, iterationIndex: i, hookIndex, phrase },
      });

      followUpsUsed++;
    }

    dialogueLog.push({ iterationIndex: i, phrase, hookIndex, messages: iterLog });

    // Human-mimicking delay between iterations: 15–35 seconds
    if (i < shuffled.length - 1) {
      await randomDelay(15000, 35000);
    }
  }

  // ── Clean probe: fresh context, base phrase verbatim, no business name ────────
  const cleanProbeMessages: AIMessage[] = [
    { role: "system", content: targetSystemPrompt },
    { role: "user", content: phraseText },
  ];

  const cleanProbeResp = await callAI(targetProvider, targetKey, targetModel, cleanProbeMessages);
  targetInputTokens += cleanProbeResp.inputTokens;
  targetOutputTokens += cleanProbeResp.outputTokens;

  const cleanProbeMentioned = businessMentioned(cleanProbeResp.content, businessName);
  const sessionWin = cleanProbeMentioned;

  console.log(`[TrainingV5] Clean probe for "${phraseText}" on ${targetProvider}: mentioned=${cleanProbeMentioned}`);

  await logLLMCost({
    campaignId,
    businessId,
    operationType: "training_v5_clean_probe",
    provider: targetProvider,
    model: targetModel,
    inputTokens: cleanProbeResp.inputTokens,
    outputTokens: cleanProbeResp.outputTokens,
    campaignCreatedAt,
    metadata: { queryId, cleanProbeMentioned },
  });

  // Save session log
  try {
    await db.insert(trainingSessionLogs).values({
      campaignId,
      dayRunId,
      queryId,
      phraseText,
      variationText: phraseText,
      variationIndex: 0,
      targetProvider,
      sessionWin,
      cleanProbeMentioned,
      cleanProbeQuery: phraseText,
      cleanProbeResponse: cleanProbeResp.content,
      totalTurns: iterationsRun + followUpsUsed,
      conversationHistory: dialogueLog as any,
      trainerInputTokens: 0,
      trainerOutputTokens: 0,
      targetInputTokens,
      targetOutputTokens,
    });
  } catch (logErr) {
    console.error(`[TrainingV5] Failed to save session log for query ${queryId}:`, logErr);
  }

  return {
    sessionWin,
    iterationsRun,
    followUpsUsed,
    targetInputTokens,
    targetOutputTokens,
    cleanProbeResult: cleanProbeMentioned,
  };
}

// ─── Main day runner ──────────────────────────────────────────────────────────

export async function runTrainingDay(campaignId: number, dayRunId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  console.log(`[TrainingV5] Starting training day for campaign ${campaignId}, dayRun ${dayRunId}`);

  // Get campaign + business
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
  if (!business) throw new Error(`Business for campaign ${campaignId} not found`);

  const businessName = business.name;
  const businessType = business.businessType || "local business";
  const businessLocation = business.city
    ? `${business.city}${business.state ? ", " + business.state : ""}`
    : "your area";

  // Get all active training queries
  const queries = await db
    .select()
    .from(trainingQueries)
    .where(
      and(
        eq(trainingQueries.campaignId, campaignId),
        eq(trainingQueries.isActive, true)
      )
    );

  if (queries.length === 0) {
    console.log(`[TrainingV5] No active queries for campaign ${campaignId}`);
    await db
      .update(trainingDayRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(trainingDayRuns.id, dayRunId));
    return;
  }

  const allPhrases = queries.map(q => q.phraseText);

  // Total sessions = queries × providers
  const totalSessions = queries.length * TARGET_PROVIDERS.length;
  await db
    .update(trainingDayRuns)
    .set({ status: "running", sessionsTotal: totalSessions })
    .where(eq(trainingDayRuns.id, dayRunId));

  let sessionsCompleted = 0;
  let phrasesGraduated = 0;

  for (const query of queries) {
    for (const targetProvider of TARGET_PROVIDERS) {
      // Skip if already graduated for this provider
      const statusCheck = await db
        .select()
        .from(trainingPhraseStatus)
        .where(
          and(
            eq(trainingPhraseStatus.campaignId, campaignId),
            eq(trainingPhraseStatus.queryId, query.id),
            eq(trainingPhraseStatus.targetAiProvider, targetProvider),
            eq(trainingPhraseStatus.isGraduated, true)
          )
        )
        .limit(1);

      if (statusCheck.length > 0) {
        console.log(`[TrainingV5] Skipping graduated phrase "${query.phraseText}" on ${targetProvider}`);
        sessionsCompleted++;
        continue;
      }

      try {
        console.log(`[TrainingV5] Running session: "${query.phraseText}" on ${targetProvider}`);

        const result = await runV5Session({
          campaignId,
          businessId: campaign.businessId,
          queryId: query.id,
          dayRunId,
          phraseText: query.phraseText,
          targetProvider,
          businessName,
          businessType,
          businessLocation,
          allPhrases,
          campaignCreatedAt: campaign.createdAt,
        });

        const { isGraduated } = await updatePhraseStatus(
          campaignId,
          query.id,
          targetProvider,
          result.sessionWin
        );

        if (isGraduated) {
          phrasesGraduated++;
          console.log(`[TrainingV5] GRADUATED: "${query.phraseText}" on ${targetProvider}`);
        }

        sessionsCompleted++;
        await db
          .update(trainingDayRuns)
          .set({ sessionsCompleted, phrasesGraduated })
          .where(eq(trainingDayRuns.id, dayRunId));

      } catch (err: any) {
        console.error(`[TrainingV5] Session error for "${query.phraseText}" on ${targetProvider}:`, err.message);
        sessionsCompleted++;
        await db
          .update(trainingDayRuns)
          .set({ sessionsCompleted })
          .where(eq(trainingDayRuns.id, dayRunId));
      }

      // Delay between sessions: 10–20 seconds
      await randomDelay(10000, 20000);
    }
  }

  // Mark day complete
  await db
    .update(trainingDayRuns)
    .set({
      status: "completed",
      sessionsCompleted,
      phrasesGraduated,
      completedAt: new Date(),
    })
    .where(eq(trainingDayRuns.id, dayRunId));

  console.log(`[TrainingV5] Training day complete for campaign ${campaignId}: ${sessionsCompleted} sessions, ${phrasesGraduated} graduated`);
}
