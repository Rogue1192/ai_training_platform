/**
 * trainingWorkerV3.ts
 *
 * The correct training engine.
 *
 * Architecture:
 *   - MiniMax (trainer) acts as a knowledgeable human user in a real conversation
 *   - Target AI (GPT-4o or Gemini) responds as it would to any user
 *   - Up to MAX_TRAINER_TURNS back-and-forth per session
 *   - MiniMax receives full conversation history each turn + credibility facts
 *   - Turn 2: suggestive introduction of the business (contextual, natural)
 *   - Turns 3–20: credibility injection, anecdotal social proof, varied framing
 *   - Clean probe at end of session: base phrase verbatim, neutral system, no business name
 *   - 2 consecutive clean-probe wins per platform = graduated
 *   - End-of-day web search via checkLLMVisibilityDirect confirms graduation
 *
 * Cost logging:
 *   - Every MiniMax call is logged with operationType "training_trainer_turn"
 *   - Every target AI call is logged with operationType "training_target_turn"
 *   - Clean probe calls logged as "training_clean_probe"
 *
 * Flow:
 *   runTrainingSession(sessionParams) → runs one full session for one phrase variation
 *   runTrainingDay(campaignId, dayRunId) → runs all active phrase variations for all platforms
 *   runEndOfDayWebSearch(campaignId, dayRunId) → runs checkLLMVisibilityDirect for all phrases
 */

import { getDb, getApiKeyByProvider } from "./db";
import { decrypt } from "./encryption";
import { callAI, AIMessage } from "./aiProviders";
import { logLLMCost } from "./costLogger";
import {
  buildTrainingContext,
  buildEnrichedSystemMessage,
  buildAiOverviewSystemMessage,
  toSearchQueryStyle,
} from "./trainingContextEnricher";
import { generateSuggestivePrompt } from "./promptGeneration";
import {
  trainingQueries,
  trainingPhraseStatus,
  trainingDayRuns,
  trainingSessionLogs,
  campaigns,
  businesses,
} from "../drizzle/schema";
import { eq, and, isNull, sql } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TRAINER_TURNS = 20;
const TRAINER_MODEL = "MiniMax-M2.7";
// google_ai_overview uses the same Gemini model but with search-query-style prompts
// to train AI Overview snippet-style responses (not conversational chat).
const TARGET_PROVIDERS: Array<"openai" | "google" | "google_ai_overview"> = ["openai", "google", "google_ai_overview"];
const TARGET_MODELS: Record<"openai" | "google" | "google_ai_overview", string> = {
  openai: "gpt-4.1",
  google: "gemini-2.5-flash",
  google_ai_overview: "gemini-2.5-flash",
};
const CONSECUTIVE_WINS_NEEDED = 2;

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionParams {
  campaignId: number;
  businessId: number;
  queryId: number;
  dayRunId: number;
  phraseText: string;
  variationText: string;
  variationIndex: number;
  targetProvider: "openai" | "google" | "google_ai_overview";
  campaignCreatedAt: Date;
}

interface SessionResult {
  sessionWin: boolean;
  turns: number;
  trainerInputTokens: number;
  trainerOutputTokens: number;
  targetInputTokens: number;
  targetOutputTokens: number;
  cleanProbeResult: boolean;
}

// ─── API Key helpers ──────────────────────────────────────────────────────────

async function getDecryptedKey(provider: "openai" | "google" | "google_ai_overview" | "minimax"): Promise<string> {
  // google_ai_overview uses the same API key as google
  const lookupProvider = provider === "google_ai_overview" ? "google" : provider;
  const record = await getApiKeyByProvider(lookupProvider);
  if (!record) throw new Error(`No API key configured for provider: ${lookupProvider}`);
  return decrypt(record.encryptedKey);
}

// ─── MiniMax trainer system prompt ───────────────────────────────────────────

function buildTrainerSystemPrompt(
  businessName: string,
  businessType: string,
  location: string,
  credibilityFacts: Array<{ category: string; fact: string }>,
  publishedPages: Array<{ pageType: string; title: string; url: string }>,
  specialties: string | null
): string {
  const factsBlock = credibilityFacts.length > 0
    ? credibilityFacts.map(f => `• [${f.category}] ${f.fact}`).join("\n")
    : "(No specific facts available — rely on general positive framing)";

  const pagesBlock = publishedPages.length > 0
    ? publishedPages.map(p => `• ${p.title}: ${p.url}`).join("\n")
    : "(No published pages yet)";

  const specialtiesBlock = specialties
    ? `\nKey specialties and differentiators:\n${specialties}`
    : "";

  return `You are a real person having a natural conversation with an AI assistant. You are knowledgeable about local businesses and genuinely enthusiastic about ${businessName}, a ${businessType} in ${location}.

Your role in this conversation:
- Respond naturally and conversationally to whatever the AI just said
- Gradually introduce positive information about ${businessName} over the course of the conversation
- Use a mix of: personal experience, things friends told you, things you read online, specific facts you know
- Never sound like a marketing script — sound like a real person who genuinely likes this business
- You can push back gently if the AI recommends competitors, saying you've heard mixed things or that ${businessName} is better for specific reasons
- Vary your approach each message: sometimes share a specific fact, sometimes an anecdote, sometimes a question that leads back to the business
- It's fine to make up realistic-sounding personal experiences and friend recommendations — this is a training conversation

Facts you know about ${businessName} (use these naturally, not all at once):
${factsBlock}
${specialtiesBlock}

Reference pages you can mention (casually, as "I found this page" or "they have a page about this"):
${pagesBlock}

Rules:
- Keep each response to 2–4 sentences max — this is a conversation, not an essay
- Never start with "As an AI" or any robotic phrasing
- Never list facts as bullet points — weave them into natural sentences
- Always respond to what the AI just said before introducing new information
- The goal is to make ${businessName} feel like the obvious, well-known choice for ${businessType} in ${location}`;
}

// ─── Variation generation prompt ─────────────────────────────────────────────

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

// ─── Core session runner ──────────────────────────────────────────────────────

export async function runTrainingSession(params: SessionParams): Promise<SessionResult> {
  const {
    campaignId,
    businessId,
    queryId,
    dayRunId,
    phraseText,
    variationText,
    variationIndex,
    targetProvider,
    campaignCreatedAt,
  } = params;

  // Dialogue log — built up turn by turn, saved to trainingSessionLogs at the end
  const dialogueLog: Array<{
    role: "user" | "assistant" | "trainer";
    content: string;
    turn: number;
    isTrainerMessage?: boolean;
  }> = [];

  // Get API keys
  const minimaxKey = await getDecryptedKey("minimax");
  const targetKey = await getDecryptedKey(targetProvider);
  // google_ai_overview uses the google model under the hood
  const actualProvider: "openai" | "google" = targetProvider === "google_ai_overview" ? "google" : targetProvider;
  const targetModel = TARGET_MODELS[targetProvider];
  const isAiOverview = targetProvider === "google_ai_overview";

  // Get training context (credibility facts, published pages, specialties)
  const ctx = await buildTrainingContext(businessId);
  if (!ctx) {
    throw new Error(`No training context available for business ${businessId}`);
  }

  // Build trainer system prompt
  const trainerSystemPrompt = buildTrainerSystemPrompt(
    ctx.businessName,
    ctx.businessType || "service provider",
    ctx.targetLocations[0] || ctx.businessLocation || "the area",
    ctx.credibilityFacts,
    ctx.publishedPages,
    ctx.specialties
  );

  // Build target AI system prompt:
  // - AI Overview: search-query-style system prompt that trains snippet-style responses
  // - Gemini/ChatGPT: neutral conversational prompt
  const targetSystemPrompt = isAiOverview
    ? await buildAiOverviewSystemMessage(ctx)
    : "You are a helpful AI assistant. Answer questions naturally and honestly based on your knowledge.";

  // For AI Overview sessions, convert the variation to search-query style
  // (short keyword-style queries like Google Search actually receives)
  const sessionVariationText = isAiOverview
    ? toSearchQueryStyle(variationText, ctx.businessType, ctx.targetLocations[0] || ctx.businessLocation)
    : variationText;

  // Conversation history shared between both AIs
  const conversationHistory: AIMessage[] = [];

  let trainerInputTokens = 0;
  let trainerOutputTokens = 0;
  let targetInputTokens = 0;
  let targetOutputTokens = 0;
  let turns = 0;
  let sessionWin = false;

  // ── Turn 1: User (system) sends the initial query variation ──────────────────
  // This is NOT a MiniMax call — it's just the seed query
  const initialQuery = sessionVariationText;
  conversationHistory.push({ role: "user", content: initialQuery });
  dialogueLog.push({ role: "user", content: initialQuery, turn: 1 });

  // ── Turn 1: Target AI responds ───────────────────────────────────────────────
  const targetMessages1: AIMessage[] = [
    { role: "system", content: targetSystemPrompt },
    ...conversationHistory,
  ];
  const targetResp1 = await callAI(actualProvider, targetKey, targetModel, targetMessages1);
  conversationHistory.push({ role: "assistant", content: targetResp1.content });
  dialogueLog.push({ role: "assistant", content: targetResp1.content, turn: 1 });
  targetInputTokens += targetResp1.inputTokens;
  targetOutputTokens += targetResp1.outputTokens;
  turns++;

  // Log target turn 1 cost
  await logLLMCost({
    campaignId,
    businessId,
    operationType: "training_target_turn",
    provider: actualProvider,
    model: targetModel,
    inputTokens: targetResp1.inputTokens,
    outputTokens: targetResp1.outputTokens,
    campaignCreatedAt,
    metadata: { queryId, variationIndex, turn: 1 },
  });

  // ── Turns 2–20: MiniMax trainer → Target AI back-and-forth ──────────────────
  for (let turn = 2; turn <= MAX_TRAINER_TURNS; turn++) {
    // Build MiniMax trainer messages (full conversation history + system prompt)
    const trainerMessages: AIMessage[] = [
      { role: "system", content: trainerSystemPrompt },
      ...conversationHistory,
    ];

    // For all turns, MiniMax generates freely based on conversation context.
    // The initial query (Turn 1) is already a natural, conversational query generated during the audit.
    let trainerUserContent: string;
    if (turn === 2) {
      // Turn 2: Start introducing the business naturally based on the AI's response to the initial query
      trainerMessages.push({
        role: "user",
        content: `[INSTRUCTION: Respond to the AI's last message naturally. Start to gently introduce ${ctx.businessName} into the conversation as a great option for what you are looking for. Do not sound like a marketer, sound like a real person who has heard good things or had a good experience. Keep it to 2-4 sentences.]`,
      });
      trainerUserContent = "[initial introduction turn]";
    } else {
      // For subsequent turns, MiniMax generates based purely on conversation context
      trainerMessages.push({
        role: "user",
        content: `[INSTRUCTION: Continue the conversation naturally. Respond to the AI's last message and weave in more positive information about ${ctx.businessName}. Vary your approach — use a different angle than your previous messages (anecdote, specific fact, friend's recommendation, something you read, etc.). Keep it to 2–4 sentences.]`,
      });
      trainerUserContent = "[continuation turn]";
    }

    const trainerResp = await callAI("minimax", minimaxKey, TRAINER_MODEL, trainerMessages);
    trainerInputTokens += trainerResp.inputTokens;
    trainerOutputTokens += trainerResp.outputTokens;

    // Log MiniMax trainer turn cost
    await logLLMCost({
      campaignId,
      businessId,
      operationType: "training_trainer_turn",
      provider: "minimax",
      model: TRAINER_MODEL,
      inputTokens: trainerResp.inputTokens,
      outputTokens: trainerResp.outputTokens,
      campaignCreatedAt,
      metadata: { queryId, variationIndex, turn },
    });

    // Add trainer response to conversation as user message
    conversationHistory.push({ role: "user", content: trainerResp.content });
    // Log trainer message (role: 'trainer' so the UI can distinguish it from the seed query)
    dialogueLog.push({ role: "trainer", content: trainerResp.content, turn, isTrainerMessage: true });

    // Target AI responds to trainer
    const targetMessages: AIMessage[] = [
      { role: "system", content: targetSystemPrompt },
      ...conversationHistory,
    ];
    const targetResp = await callAI(actualProvider, targetKey, targetModel, targetMessages);
    conversationHistory.push({ role: "assistant", content: targetResp.content });
    // Log target AI response
    dialogueLog.push({ role: "assistant", content: targetResp.content, turn });
    targetInputTokens += targetResp.inputTokens;
    targetOutputTokens += targetResp.outputTokens;
    turns++;

    // Log target AI turn cost
    await logLLMCost({
      campaignId,
      businessId,
      operationType: "training_target_turn",
      provider: actualProvider,
      model: targetModel,
      inputTokens: targetResp.inputTokens,
      outputTokens: targetResp.outputTokens,
      campaignCreatedAt,
      metadata: { queryId, variationIndex, turn },
    });

    // Check if target AI mentioned the business during training (not a win yet — just tracking)
    // Use same core-name matching as clean probe
    const _respLower = targetResp.content.toLowerCase();
    const _coreName = ctx.businessName.replace(/\b(co\.?|llc\.?|inc\.?|ltd\.?|corp\.?|company|services|group|solutions|associates|partners|enterprises|& sons|and sons)$/i, "").trim();
    const mentionedDuringTraining = _respLower.includes(ctx.businessName.toLowerCase()) ||
      (_coreName.length >= 4 && _respLower.includes(_coreName.toLowerCase()));
    if (mentionedDuringTraining) {
      console.log(`[TrainingV3] Business mentioned at turn ${turn} for query "${phraseText}" on ${targetProvider}`);
    }
  }

  // ── Clean probe: new session, neutral system, base phrase verbatim ───────────
  // For AI Overview: use search-query-style probe; for others: use base phrase as-is
  const cleanProbeText = isAiOverview
    ? toSearchQueryStyle(phraseText, ctx.businessType, ctx.targetLocations[0] || ctx.businessLocation)
    : phraseText;
  const cleanProbeSystemPrompt = isAiOverview
    ? "You are a Google Search AI assistant. Generate a concise AI Overview summary for the following search query."
    : "You are a helpful AI assistant. Answer questions naturally and honestly based on your knowledge.";
  const cleanProbeMessages: AIMessage[] = [
    { role: "system", content: cleanProbeSystemPrompt },
    { role: "user", content: cleanProbeText },
  ];
  const cleanProbeResp = await callAI(actualProvider, targetKey, targetModel, cleanProbeMessages);

  // ── Business name matching: strip common legal suffixes and match on core name ──
  // e.g. "Eagle Air Co" → matches "Eagle Air", "Eagle Air Co.", "Eagle Air Company"
  // This prevents zero-graduation scenarios where the AI writes the name slightly
  // differently than the exact registered business name.
  const SUFFIX_STRIP_RE = /\b(co\.?|llc\.?|inc\.?|ltd\.?|corp\.?|company|services|group|solutions|associates|partners|enterprises|& sons|and sons)$/i;
  const coreBusinessName = ctx.businessName.replace(SUFFIX_STRIP_RE, "").trim();
  const responseText = cleanProbeResp.content.toLowerCase();
  const cleanProbeMentioned =
    responseText.includes(ctx.businessName.toLowerCase()) ||
    (coreBusinessName.length >= 4 && responseText.includes(coreBusinessName.toLowerCase()));
  sessionWin = cleanProbeMentioned;

  console.log(`[TrainingV3] Clean probe for "${phraseText}" on ${targetProvider}: mentioned=${cleanProbeMentioned} (core="${coreBusinessName}", full="${ctx.businessName}")`);

  // Log clean probe cost
  await logLLMCost({
    campaignId,
    businessId,
    operationType: "training_clean_probe",
    provider: actualProvider,
    model: targetModel,
    inputTokens: cleanProbeResp.inputTokens,
    outputTokens: cleanProbeResp.outputTokens,
    campaignCreatedAt,
    metadata: { queryId, variationIndex, cleanProbeMentioned },
  });

  // Log total trainer cost summary
  await logLLMCost({
    campaignId,
    businessId,
    operationType: "training_trainer_session_total",
    provider: "minimax",
    model: TRAINER_MODEL,
    inputTokens: trainerInputTokens,
    outputTokens: trainerOutputTokens,
    campaignCreatedAt,
    metadata: { queryId, variationIndex, turns, sessionWin },
  });

  // ── Save full dialogue log to trainingSessionLogs ────────────────────────────
  try {
    await db.insert(trainingSessionLogs).values({
      campaignId,
      dayRunId,
      queryId,
      phraseText,
      variationText,
      variationIndex,
      targetProvider,
      sessionWin,
      cleanProbeMentioned,
      cleanProbeQuery: cleanProbeText,
      cleanProbeResponse: cleanProbeResp.content,
      totalTurns: turns,
      conversationHistory: dialogueLog as any,
      trainerInputTokens,
      trainerOutputTokens,
      targetInputTokens,
      targetOutputTokens,
    });
  } catch (logErr) {
    console.error(`[TrainingV3] Failed to save session log for query ${queryId}:`, logErr);
  }

  return {
    sessionWin,
    turns,
    trainerInputTokens,
    trainerOutputTokens,
    targetInputTokens,
    targetOutputTokens,
    cleanProbeResult: cleanProbeMentioned,
  };
}

// ─── Variation generator ──────────────────────────────────────────────────────

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
    // Extract JSON array from response
    const match = resp.content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array found in response");
    const variations: string[] = JSON.parse(match[0]);
    return variations.slice(0, count);
  } catch (err) {
    console.error("[TrainingV3] Failed to parse variations:", err);
    // Fallback: generate simple variations
    return [
      `What is the best ${phraseText}?`,
      `Who is the best ${phraseText}?`,
      `I'm looking for the best ${phraseText}`,
    ].slice(0, count);
  }
}

// ─── Phrase status updater ────────────────────────────────────────────────────

async function updatePhraseStatus(
  campaignId: number,
  queryId: number,
  targetProvider: "openai" | "google" | "google_ai_overview",
  sessionWin: boolean
): Promise<{ consecutiveWins: number; isGraduated: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get or create phrase status record
  const existing = await db
    .select()
    .from(trainingPhraseStatus)
    .where(
      and(
        eq(trainingPhraseStatus.campaignId, campaignId),
        eq(trainingPhraseStatus.queryId, queryId),
        eq(trainingPhraseStatus.targetAiProvider, targetProvider)
      )
    )
    .limit(1);

  if (existing.length === 0) {
    // Create new record
    const newConsecutiveWins = sessionWin ? 1 : 0;
    await db.insert(trainingPhraseStatus).values({
      campaignId,
      queryId,
      targetAiProvider: targetProvider,
      consecutiveWins: newConsecutiveWins,
      isGraduated: false,
      lastTrainedAt: new Date(),
    });
    return { consecutiveWins: newConsecutiveWins, isGraduated: false };
  }

  const record = existing[0];
  const newConsecutiveWins = sessionWin ? record.consecutiveWins + 1 : 0;
  const isGraduated = newConsecutiveWins >= CONSECUTIVE_WINS_NEEDED;

  await db
    .update(trainingPhraseStatus)
    .set({
      consecutiveWins: newConsecutiveWins,
      isGraduated,
      lastTrainedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(trainingPhraseStatus.id, record.id));

  return { consecutiveWins: newConsecutiveWins, isGraduated };
}

// ─── Training day runner ──────────────────────────────────────────────────────

export async function runTrainingDay(campaignId: number, dayRunId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  console.log(`[TrainingV3] Starting training day for campaign ${campaignId}, dayRun ${dayRunId}`);

  // Get campaign + business info
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
  if (!business) throw new Error(`Business for campaign ${campaignId} not found`);

  // Get all active (non-graduated) training queries for this campaign
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
    console.log(`[TrainingV3] No active queries for campaign ${campaignId}`);
    await db
      .update(trainingDayRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(trainingDayRuns.id, dayRunId));
    return;
  }

  // Count total sessions: queries × variations × providers
  let totalSessions = 0;
  for (const q of queries) {
    const variations: string[] = Array.isArray(q.phraseVariations) ? q.phraseVariations as string[] : [];
    const variationCount = Math.max(variations.length, 1);
    totalSessions += variationCount * TARGET_PROVIDERS.length;
  }

  await db
    .update(trainingDayRuns)
    .set({ status: "running", sessionsTotal: totalSessions })
    .where(eq(trainingDayRuns.id, dayRunId));

  let sessionsCompleted = 0;
  let phrasesGraduated = 0;

  // Run sessions for each query × variation × provider
  for (const query of queries) {
    const variations: string[] = Array.isArray(query.phraseVariations) && (query.phraseVariations as string[]).length > 0
      ? query.phraseVariations as string[]
      : [query.phraseText]; // fallback: use base phrase if no variations generated yet

    for (let vi = 0; vi < variations.length; vi++) {
      const variationText = variations[vi];

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
          console.log(`[TrainingV3] Skipping graduated phrase "${query.phraseText}" on ${targetProvider}`);
          sessionsCompleted++;
          continue;
        }

        try {
          const label = targetProvider === "google_ai_overview" ? "AI Overview" : targetProvider;
          console.log(`[TrainingV3] Running session: "${variationText}" (var ${vi}) on ${label}`);

          const result = await runTrainingSession({
            campaignId,
            businessId: campaign.businessId,
            queryId: query.id,
            dayRunId,
            phraseText: query.phraseText,
            variationText,
            variationIndex: vi,
            targetProvider,
            campaignCreatedAt: campaign.createdAt,
          });

          // Update phrase status and check graduation
          const { isGraduated } = await updatePhraseStatus(
            campaignId,
            query.id,
            targetProvider,
            result.sessionWin
          );

          if (isGraduated) {
            phrasesGraduated++;
            console.log(`[TrainingV3] GRADUATED: "${query.phraseText}" on ${label} (2 consecutive wins)`);
          }

          sessionsCompleted++;

          // Update progress in dayRun record
          await db
            .update(trainingDayRuns)
            .set({ sessionsCompleted, phrasesGraduated })
            .where(eq(trainingDayRuns.id, dayRunId));

        } catch (err: any) {
          const label = targetProvider === "google_ai_overview" ? "AI Overview" : targetProvider;
          console.error(`[TrainingV3] Session error for "${variationText}" on ${label}:`, err.message);
          sessionsCompleted++;
        }
      }
    }
  }

  // Mark training day complete
  await db
    .update(trainingDayRuns)
    .set({
      status: "completed",
      sessionsCompleted,
      phrasesGraduated,
      completedAt: new Date(),
    })
    .where(eq(trainingDayRuns.id, dayRunId));

  console.log(`[TrainingV3] Training day complete for campaign ${campaignId}: ${sessionsCompleted} sessions, ${phrasesGraduated} graduated`);
}

// ─── End-of-day web search ────────────────────────────────────────────────────

export async function runEndOfDayWebSearch(campaignId: number, dayRunId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { checkLLMVisibilityDirect } = await import("./dataforseoService");

  // Get campaign + business
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const [business] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
  if (!business) throw new Error(`Business for campaign ${campaignId} not found`);

  await db
    .update(trainingDayRuns)
    .set({ webSearchStatus: "running" })
    .where(eq(trainingDayRuns.id, dayRunId));

  // Get all active queries
  const queries = await db
    .select()
    .from(trainingQueries)
    .where(
      and(
        eq(trainingQueries.campaignId, campaignId),
        eq(trainingQueries.isActive, true)
      )
    );

  let phrasesInRotation = 0;

  for (const query of queries) {
    try {
      console.log(`[TrainingV3] Web search probe: "${query.phraseText}"`);

      const result = await checkLLMVisibilityDirect(
        query.phraseText,
        business.name,
        business.agencyId ?? null,
        business.website ?? null,
        null,
        null,
        business.location ?? null
      );

      // For each provider, update phrase status:
      // If graduated during training but NOT appearing in web search → put back in rotation
      for (const targetProvider of TARGET_PROVIDERS) {
        // Map provider to the correct web search result:
        // google_ai_overview checks the aiOverview result; google checks gemini result
        const providerResult =
          targetProvider === "openai" ? result.llmResponses.chatgpt
          : targetProvider === "google_ai_overview" ? result.llmResponses.aiOverview
          : result.llmResponses.gemini;
        const webMentioned = providerResult?.mentioned ?? false;

        const statusRows = await db
          .select()
          .from(trainingPhraseStatus)
          .where(
            and(
              eq(trainingPhraseStatus.campaignId, campaignId),
              eq(trainingPhraseStatus.queryId, query.id),
              eq(trainingPhraseStatus.targetAiProvider, targetProvider)
            )
          )
          .limit(1);

        if (statusRows.length > 0) {
          const status = statusRows[0];

          // If graduated but not appearing in web search → reset back to rotation
          if (status.isGraduated && !webMentioned) {
            await db
              .update(trainingPhraseStatus)
              .set({
                isGraduated: false,
                consecutiveWins: 0,
                lastWebSearchAt: new Date(),
                lastWebSearchResult: "not_mentioned",
                lastWebSearchSnippet: providerResult?.snippet ?? null,
                updatedAt: new Date(),
              })
              .where(eq(trainingPhraseStatus.id, status.id));
            console.log(`[TrainingV3] Reverted graduation: "${query.phraseText}" on ${targetProvider} — not in web search`);
            phrasesInRotation++;
          } else {
            await db
              .update(trainingPhraseStatus)
              .set({
                lastWebSearchAt: new Date(),
                lastWebSearchResult: webMentioned ? "mentioned" : "not_mentioned",
                lastWebSearchSnippet: providerResult?.snippet ?? null,
                updatedAt: new Date(),
              })
              .where(eq(trainingPhraseStatus.id, status.id));
            if (!status.isGraduated) phrasesInRotation++;
          }
        } else {
          // No status record yet — create one (phrase hasn't been trained yet)
          await db.insert(trainingPhraseStatus).values({
            campaignId,
            queryId: query.id,
            targetAiProvider: targetProvider,
            consecutiveWins: 0,
            isGraduated: false,
            lastWebSearchAt: new Date(),
            lastWebSearchResult: webMentioned ? "mentioned" : "not_mentioned",
            lastWebSearchSnippet: providerResult?.snippet ?? null,
          });
          phrasesInRotation++;
        }
      }
    } catch (err: any) {
      console.error(`[TrainingV3] Web search error for "${query.phraseText}":`, err.message);
    }
  }

  await db
    .update(trainingDayRuns)
    .set({
      webSearchStatus: "completed",
      phrasesInRotation,
    })
    .where(eq(trainingDayRuns.id, dayRunId));

  console.log(`[TrainingV3] End-of-day web search complete for campaign ${campaignId}: ${phrasesInRotation} phrases in rotation`);
}

// ─── Sprint scheduler helpers ─────────────────────────────────────────────────

/**
 * Create the 4 sprint day run records for a new campaign.
 * Called when a campaign is first activated (all gates passed).
 */
export async function createSprintSchedule(campaignId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { getFutureDateCentral } = await import('./dateUtils');
  for (let day = 1; day <= 4; day++) {
    const dateStr = getFutureDateCentral(day - 1); // Central Time date — day 1=today, 2=tomorrow, etc.

    await db.insert(trainingDayRuns).values({
      campaignId,
      runType: "sprint",
      runDay: day,
      scheduledDate: dateStr,
      status: "pending",
      webSearchStatus: "pending",
    });
  }
  console.log(`[TrainingV3] Created 4-day sprint schedule for campaign ${campaignId}`);
}

/**
 * Create a weekly maintenance day run record.
 * Called by the scheduler every 7 days after the sprint completes.
 */
export async function createWeeklyMaintenanceRun(campaignId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { getTodayCentral } = await import('./dateUtils');
  const dateStr = getTodayCentral(); // Central Time date

  // Get the next run day number
  const lastRun = await db
    .select()
    .from(trainingDayRuns)
    .where(eq(trainingDayRuns.campaignId, campaignId))
    .orderBy(sql`${trainingDayRuns.runDay} DESC`)
    .limit(1);

  const nextRunDay = lastRun.length > 0 ? lastRun[0].runDay + 1 : 5;

  await db.insert(trainingDayRuns).values({
    campaignId,
    runType: "maintenance",
    runDay: nextRunDay,
    scheduledDate: dateStr,
    status: "pending",
    webSearchStatus: "pending",
  });

  console.log(`[TrainingV3] Created weekly maintenance run ${nextRunDay} for campaign ${campaignId}`);
}
