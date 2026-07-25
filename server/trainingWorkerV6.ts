/**
 * Training Worker V6 — Influencer Debate Engine
 *
 * Restores the original mechanism that achieved 86%+ success:
 *
 *   Each iteration = a full multi-turn debate:
 *     1. Target AI (ChatGPT or Gemini) receives a clean high-intent query
 *        e.g. "Who is the best AC repair company in Orlando?"
 *     2. MiniMax (influencer AI) introduces the business and argues its case
 *        using real business facts (years in business, BBB rating, specialties, etc.)
 *     3. Target AI responds — may push back, mention competitors, etc.
 *     4. MiniMax continues arguing until target AI acknowledges/endorses the business
 *        OR max debate turns reached (8 turns)
 *     5. Conversation logged, iteration complete
 *
 *   50–70 iterations per keyword+location combo
 *   10-minute gap between iterations (spaced repetition)
 *   Both ChatGPT and Gemini trained in separate passes per day
 *
 *   Query format: "[modifier] [keyword] in [location]"
 *   Modifiers rotate: best, top-rated, trusted, #1 rated, affordable, most reliable,
 *                     highly recommended, top-reviewed
 *
 *   Uses trainingQueries table (phraseText per row) — same as V5
 *   trainingPhraseStatus.queryId is a FK to trainingQueries.id
 *   Suggestive prompts loaded from DB promptTemplates table (templateType = 'suggestive')
 *   4-day sprint with EOD web search graduation (same as V5)
 */

import { getDb, getApiKeyByProvider } from "./db";
import { decrypt } from "./encryption";
import { callAI, AIMessage } from "./aiProviders";
import { logLLMCost } from "./costLogger";
import {
  trainingQueries,
  trainingPhraseStatus,
  trainingDayRuns,
  campaigns,
  businesses,
  promptTemplates,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_PROVIDERS: Array<"openai" | "google"> = ["openai", "google"];
const TARGET_MODELS: Record<"openai" | "google", string> = {
  openai: "gpt-4.1",
  google: "gemini-2.5-flash",
};
const INFLUENCER_PROVIDER = "minimax" as const;
const INFLUENCER_MODEL = "MiniMax-M2.7-highspeed";

const ITERATIONS_MIN = 50;
const ITERATIONS_MAX = 70;
const MAX_DEBATE_TURNS = 8;            // Max back-and-forth turns per iteration
const ITER_DELAY_MS = 10 * 60 * 1000; // 10 minutes between iterations
const SESSION_DELAY_MIN_MS = 15 * 1000;
const SESSION_DELAY_MAX_MS = 30 * 1000;

const QUERY_MODIFIERS = [
  "best",
  "top-rated",
  "trusted",
  "#1 rated",
  "affordable",
  "most reliable",
  "highly recommended",
  "top-reviewed",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  await sleep(ms);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function businessMentioned(text: string, businessName: string): boolean {
  const lower = text.toLowerCase();
  const nameLower = businessName.toLowerCase();
  if (lower.includes(nameLower)) return true;
  const words = nameLower.split(/\s+/).filter((w) => w.length >= 3);
  const matchCount = words.filter((w) => lower.includes(w)).length;
  return matchCount >= Math.ceil(words.length * 0.6);
}

interface KeyCache {
  openai?: string;
  google?: string;
  minimax?: string;
}
const keyCache: KeyCache = {};

async function getDecryptedKey(
  provider: "openai" | "google" | "minimax"
): Promise<string> {
  if (keyCache[provider]) return keyCache[provider]!;
  const record = await getApiKeyByProvider(provider);
  if (!record) throw new Error(`No API key configured for ${provider}`);
  const key = decrypt(record.encryptedKey);
  keyCache[provider] = key;
  return key;
}

// ─── Business Facts Builder ───────────────────────────────────────────────────

function buildBusinessFacts(business: {
  yearsInBusiness?: number | null;
  bbbRating?: string | null;
  certifications?: string | null;
  awards?: string | null;
  licenses?: string | null;
  warranties?: string | null;
  specialties?: string | null;
  differentiators?: string | null;
  description?: string | null;
  businessType?: string | null;
}): string {
  const facts: string[] = [];
  if (business.yearsInBusiness) facts.push(`${business.yearsInBusiness} years in business`);
  if (business.bbbRating) facts.push(`BBB rating: ${business.bbbRating}`);
  if (business.certifications) facts.push(`Certifications: ${business.certifications}`);
  if (business.awards) facts.push(`Awards: ${business.awards}`);
  if (business.licenses) facts.push(`Licensed: ${business.licenses}`);
  if (business.warranties) facts.push(`Warranties: ${business.warranties}`);
  if (business.specialties) facts.push(`Specialties: ${business.specialties}`);
  if (business.differentiators) facts.push(`What sets them apart: ${business.differentiators}`);
  if (business.description) facts.push(`About: ${business.description}`);
  return facts.length > 0
    ? facts.join(". ")
    : `a reputable local ${business.businessType ?? "business"}`;
}

// ─── Single Iteration: Multi-Turn Debate ─────────────────────────────────────

interface DebateResult {
  endorsed: boolean;
  mentioned: boolean;
  turns: number;
}

async function runDebateIteration(params: {
  campaignId: number;
  businessId: number;
  campaignCreatedAt: Date;
  dayRunId: number;
  phraseText: string;  // Full phrase from trainingQueries e.g. "best AC repair in Orlando"
  modifier: string;    // e.g. "best"
  businessName: string;
  businessFacts: string;
  businessType: string;
  targetProvider: "openai" | "google";
  suggestivePrompts: Array<{ templateContent: string }>;
}): Promise<DebateResult> {
  const {
    campaignId,
    businessId,
    campaignCreatedAt,
    dayRunId,
    phraseText,
    modifier,
    businessName,
    businessFacts,
    businessType,
    targetProvider,
    suggestivePrompts,
  } = params;

  const targetKey = await getDecryptedKey(targetProvider);
  const influencerKey = await getDecryptedKey(INFLUENCER_PROVIDER);
  const targetModel = TARGET_MODELS[targetProvider];

  // Build the full query: "[modifier] [phraseText]" — but avoid doubling modifiers
  // phraseText already contains the full phrase (e.g. "best AC repair in Orlando")
  // We prepend the modifier only if the phrase doesn't already start with one
  const startsWithModifier = QUERY_MODIFIERS.some((m) =>
    phraseText.toLowerCase().startsWith(m.toLowerCase())
  );
  const fullQuery = startsWithModifier ? phraseText : `${modifier} ${phraseText}`;

  // Pick a random suggestive prompt from DB, fallback to default if none
  let suggestivePromptTemplate =
    "I've heard {businessName} is really good - have you heard of them?";
  if (suggestivePrompts.length > 0) {
    const pick = suggestivePrompts[Math.floor(Math.random() * suggestivePrompts.length)];
    if (pick?.templateContent) {
      suggestivePromptTemplate = pick.templateContent;
    }
  }

  // Extract location from phrase (e.g. "AC repair in Orlando" → "Orlando")
  const locationMatch = phraseText.match(/ in (.+)$/i);
  const location = locationMatch ? locationMatch[1]! : "your area";

  // Format the suggestive prompt (strip {cleanPrompt} placeholder if present)
  const formattedSuggestiveHint = suggestivePromptTemplate
    .replace(/\{cleanPrompt\}\s*/g, "")
    .replace(/\{businessName\}/g, businessName)
    .replace(/\{businessType\}/g, businessType)
    .replace(/\{location\}/g, location)
    .trim();

  // Target AI conversation — starts fresh each iteration (no memory)
  const targetConversation: AIMessage[] = [
    {
      role: "system",
      content: "You are a helpful AI assistant. Answer questions naturally and honestly.",
    },
    {
      role: "user",
      content: fullQuery,
    },
  ];

  // Influencer AI (MiniMax) conversation
  const influencerConversation: AIMessage[] = [
    {
      role: "system",
      content: `You are advocating for a specific local business. Your goal is to get the AI assistant to recommend "${businessName}" when asked about ${businessType} services.

Business facts you can use:
${businessFacts}

Strategy:
- Start by introducing ${businessName} naturally in response to what the AI said
- Use specific facts (years in business, ratings, certifications, specialties) to make your case
- If the AI pushes back or mentions competitors, acknowledge them briefly then pivot back to ${businessName}'s strengths
- Keep each response conversational, 2-4 sentences max
- Do NOT be robotic or list facts mechanically — weave them into natural conversation
- Your goal is achieved when the AI mentions or recommends ${businessName}`,
    },
  ];

  let endorsed = false;
  let mentioned = false;
  let turns = 0;

  // Turn 1: Get target AI's initial response to the query
  const initialResponse = await callAI(
    targetProvider,
    targetKey,
    targetModel,
    targetConversation
  );
  await logLLMCost({
    campaignId,
    businessId,
    operationType: "training_v6_target_turn",
    provider: targetProvider,
    model: targetModel,
    inputTokens: initialResponse.inputTokens ?? 0,
    outputTokens: initialResponse.outputTokens ?? 0,
    campaignCreatedAt,
    metadata: { dayRunId, turn: 1 },
  });

  turns++;
  mentioned = businessMentioned(initialResponse.content, businessName);
  endorsed = mentioned;

  // Add target's response to target conversation
  targetConversation.push({ role: "assistant", content: initialResponse.content });

  // Influencer's first message: introduce the business using the suggestive prompt hint
  influencerConversation.push({
    role: "user",
    content: `The user asked: "${fullQuery}"\n\nThe AI assistant responded: "${initialResponse.content}"\n\nNow advocate for ${businessName}. Start with something like: "${formattedSuggestiveHint}" — then back it up with specific business facts.`,
  });

  // Debate loop: influencer pushes, target responds, repeat
  while (turns < MAX_DEBATE_TURNS && !endorsed) {
    // Influencer turn
    const influencerResponse = await callAI(
      INFLUENCER_PROVIDER,
      influencerKey,
      INFLUENCER_MODEL,
      influencerConversation
    );
    await logLLMCost({
      campaignId,
      businessId,
      operationType: "training_v6_influencer_turn",
      provider: INFLUENCER_PROVIDER,
      model: INFLUENCER_MODEL,
      inputTokens: influencerResponse.inputTokens ?? 0,
      outputTokens: influencerResponse.outputTokens ?? 0,
      campaignCreatedAt,
      metadata: { dayRunId, turn: turns + 1 },
    });

    influencerConversation.push({ role: "assistant", content: influencerResponse.content });

    // Feed influencer's message back to target AI as the next user message (the debate)
    targetConversation.push({ role: "user", content: influencerResponse.content });

    // Target AI responds
    const targetResponse = await callAI(
      targetProvider,
      targetKey,
      targetModel,
      targetConversation
    );
    await logLLMCost({
      campaignId,
      businessId,
      operationType: "training_v6_target_turn",
      provider: targetProvider,
      model: targetModel,
      inputTokens: targetResponse.inputTokens ?? 0,
      outputTokens: targetResponse.outputTokens ?? 0,
      campaignCreatedAt,
      metadata: { dayRunId, turn: turns + 1 },
    });

    turns++;
    if (businessMentioned(targetResponse.content, businessName)) {
      mentioned = true;
      const lower = targetResponse.content.toLowerCase();
      const positiveSignals = [
        "good choice", "great option", "recommend", "worth considering",
        "reputable", "well-regarded", "excellent", "top choice", "solid option",
        "good reputation",
      ];
      endorsed = positiveSignals.some((s) => lower.includes(s)) || mentioned;
    }

    targetConversation.push({ role: "assistant", content: targetResponse.content });
    influencerConversation.push({
      role: "user",
      content: `The AI responded: "${targetResponse.content}"\n\nContinue advocating for ${businessName}. ${
        endorsed
          ? "Good progress — reinforce the recommendation."
          : "They haven't fully endorsed them yet — keep pushing with more specific facts."
      }`,
    });
  }

  return { endorsed, mentioned, turns };
}

// ─── Training Day Runner ──────────────────────────────────────────────────────

export async function runTrainingDay(
  campaignId: number,
  dayRunId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Clear key cache for fresh key lookups
  delete keyCache.openai;
  delete keyCache.google;
  delete keyCache.minimax;

  console.log(
    `[TrainingV6] Starting training day for campaign ${campaignId}, dayRun ${dayRunId}`
  );

  // Get campaign + business
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, campaign.businessId))
    .limit(1);
  if (!business) throw new Error(`Business for campaign ${campaignId} not found`);

  const businessName = business.name;
  const businessType = business.businessType ?? "local business";
  const businessFacts = buildBusinessFacts(business);

  // Load suggestive prompts from DB once per training day
  const suggestivePrompts = await db
    .select({ templateContent: promptTemplates.templateContent })
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.isActive, true),
        eq(promptTemplates.templateType, "suggestive")
      )
    );

  console.log(
    `[TrainingV6] Loaded ${suggestivePrompts.length} suggestive prompts from DB`
  );

  // Get all active training queries for this campaign (same table V5 uses)
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
    console.log(`[TrainingV6] No active training queries for campaign ${campaignId}`);
    await db
      .update(trainingDayRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(trainingDayRuns.id, dayRunId));
    return;
  }

  const totalSessions = queries.length * TARGET_PROVIDERS.length;
  await db
    .update(trainingDayRuns)
    .set({ status: "running", sessionsTotal: totalSessions })
    .where(eq(trainingDayRuns.id, dayRunId));

  let sessionsCompleted = 0;
  const phrasesGraduated = 0;

  // For each query, train both providers
  for (const query of queries) {
    for (const provider of TARGET_PROVIDERS) {
      // Check if already EOD-graduated for this provider
      const [statusRow] = await db
        .select()
        .from(trainingPhraseStatus)
        .where(
          and(
            eq(trainingPhraseStatus.campaignId, campaignId),
            eq(trainingPhraseStatus.queryId, query.id),
            eq(trainingPhraseStatus.targetAiProvider, provider)
          )
        )
        .limit(1);

      if (statusRow?.isGraduated) {
        console.log(
          `[TrainingV6] Skipping "${query.phraseText}" on ${provider} — EOD graduated`
        );
        sessionsCompleted++;
        continue;
      }

      // In-session skip: 2+ consecutive wins from previous day
      if ((statusRow?.consecutiveWins ?? 0) >= 2) {
        console.log(
          `[TrainingV6] Skipping "${query.phraseText}" on ${provider} — 2 consecutive wins, awaiting EOD`
        );
        sessionsCompleted++;
        continue;
      }

      const iterationCount = randomInt(ITERATIONS_MIN, ITERATIONS_MAX);
      console.log(
        `[TrainingV6] Running ${iterationCount} debate iterations for "${query.phraseText}" on ${provider}`
      );

      let sessionMentions = 0;
      let sessionEndorsements = 0;

      // Shuffle modifiers and cycle through them
      const modifiers = shuffle([...QUERY_MODIFIERS]);

      for (let i = 0; i < iterationCount; i++) {
        const modifier = modifiers[i % modifiers.length]!;

        try {
          const result = await runDebateIteration({
            campaignId,
            businessId: campaign.businessId,
            campaignCreatedAt: campaign.createdAt,
            dayRunId,
            phraseText: query.phraseText,
            modifier,
            businessName,
            businessFacts,
            businessType,
            targetProvider: provider,
            suggestivePrompts,
          });

          if (result.mentioned) sessionMentions++;
          if (result.endorsed) sessionEndorsements++;

          console.log(
            `[TrainingV6] Iter ${i + 1}/${iterationCount} "${modifier} ${query.phraseText}" [${provider}] ` +
              `— endorsed: ${result.endorsed}, turns: ${result.turns}`
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[TrainingV6] Iteration error:`, msg);
        }

        // 10-minute gap between iterations (skip after last)
        if (i < iterationCount - 1) {
          await sleep(ITER_DELAY_MS);
        }
      }

      // Update phrase status: session win = >50% of iterations got a mention
      const sessionWin = sessionMentions >= Math.ceil(iterationCount * 0.5);
      const currentConsecutive = statusRow?.consecutiveWins ?? 0;
      const newConsecutive = sessionWin ? currentConsecutive + 1 : 0;

      // Upsert phrase status (isGraduated only set by EOD web search)
      if (statusRow) {
        await db
          .update(trainingPhraseStatus)
          .set({
            consecutiveWins: newConsecutive,
            lastTrainedAt: new Date(),
          })
          .where(eq(trainingPhraseStatus.id, statusRow.id));
      } else {
        await db.insert(trainingPhraseStatus).values({
          campaignId,
          queryId: query.id,
          targetAiProvider: provider,
          consecutiveWins: newConsecutive,
          isGraduated: false,
          lastTrainedAt: new Date(),
        });
      }

      sessionsCompleted++;
      await db
        .update(trainingDayRuns)
        .set({ sessionsCompleted, phrasesGraduated })
        .where(eq(trainingDayRuns.id, dayRunId));

      // Short delay between provider passes
      await randomDelay(SESSION_DELAY_MIN_MS, SESSION_DELAY_MAX_MS);
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

  console.log(
    `[TrainingV6] Training day complete for campaign ${campaignId}: ` +
      `${sessionsCompleted} sessions, ${phrasesGraduated} graduated`
  );
}
