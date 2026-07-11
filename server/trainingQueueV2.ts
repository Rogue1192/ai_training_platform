/**
 * Training Queue V2 - Phase-Based Training System
 * 
 * This module implements the corrected training logic with three distinct phases:
 * 1. BASELINE: Test with clean prompts to see if AI already knows the business
 * 2. TRAINING: Use suggestive prompts to expose AI to positive associations (no scoring)
 * 3. EVALUATION: Test with clean prompts to measure if AI now mentions business unprompted
 * 
 * The influence score is calculated as: evaluation_mentioned - baseline_mentioned
 * A positive score indicates the training had an effect.
 */

import { Queue, Worker, QueueEvents } from "bullmq";
import Redis from "ioredis";
import { decrypt, clearSensitiveData } from "./encryption";
import { callAI, AIProvider, AIMessage } from "./aiProviders";
import {
  getTrainingSessionById,
  updateTrainingSession,
  createTrainingConversation,
  getApiKeyByProvider,
  getBusinessById,
  getActiveRunBySessionId,
  updateScheduledJobRun,
} from "./db";
import { getAgencyById } from "./dbAgencies";
import { sendAgencyKeyErrorEmail } from "./agencyKeyErrorEmail";
import {
  generateCleanPromptAsync,
  generateSuggestivePromptAsync,
  generateFollowUpPromptAsync,
  selectRandomPrompt,
  BusinessInfo,
} from "./promptGeneration";
import {
  getTrainingContextForSession,
  buildEnrichedSystemMessage,
  buildSourceCitationBlock,
  buildSpecialtiesReinforcementBlock,
  isAiOverviewSession,
  buildAiOverviewSystemMessage,
  toSearchQueryStyle,
} from "./trainingContextEnricher";
import { isModelDeprecatedError, buildDeprecationAlert, getModelConfig } from "./modelConfigService";
import { logLLMCost } from "./costLogger";
import { getCampaignById } from "./dbCampaigns";

// Types for the new phase-based system
export type TrainingPhase = 'pending' | 'baseline' | 'training' | 'evaluation' | 'completed';
export type ConversationType = 'baseline' | 'training' | 'evaluation';
export type PromptType = 'clean' | 'suggestive' | 'follow_up';

// Redis connection configuration
const redisConnection = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  connectTimeout: 15000,
});

// Create training queue for V2
export const trainingQueueV2 = new Queue("training-iterations-v2", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 500,
    },
  },
});

export const trainingQueueV2Events = new QueueEvents("training-iterations-v2", {
  connection: redisConnection,
});

interface PhaseBasedJob {
  sessionId: number;
  userId: number;
  phase: TrainingPhase;
  iterationNumber?: number; // Only used during training phase
}

/**
 * Extract business name from topic or use business entity name
 */
function extractBusinessName(session: any, business: any): string {
  // If we have a linked business entity, use its name
  if (business?.name) {
    return business.name;
  }
  
  // Fallback: extract from topic
  if (session.topic.includes(' is ')) {
    return session.topic.split(' is ')[0].trim();
  } else if (session.topic.includes(' - ')) {
    return session.topic.split(' - ')[0].trim();
  } else if (session.trainingName.includes(' - ')) {
    return session.trainingName.split(' - ')[0].trim();
  }
  
  return session.topic.split('.')[0].split(',')[0].trim();
}

/**
 * Resolve the target AI API key for a training session.
 * If the business belongs to an agency AND that agency has provided their own key
 * for this provider, use the agency's key.
 * Otherwise use the platform key.
 * HARD STOP: if an agency key is expected but missing/invalid, throw — never fall back.
 */
async function resolveTargetApiKey(
  session: any,
  business: any | null,
  provider: AIProvider
): Promise<{ key: string; agencyId: number | null }> {
  const agencyId: number | null = business?.agencyId ?? null;

  if (agencyId) {
    const agency = await getAgencyById(agencyId);
    if (agency) {
      const encryptedAgencyKey =
        provider === 'openai' ? agency.agencyOpenAiKey :
        provider === 'google'  ? agency.agencyGeminiKey :
        null;

      if (encryptedAgencyKey) {
        // Agency has provided their own key — use it, no fallback
        try {
          const key = decrypt(encryptedAgencyKey);
          return { key, agencyId };
        } catch (err: any) {
          // Decryption failed — notify agency and hard stop
          await sendAgencyKeyErrorEmail({
            agencyName: agency.name,
            agencyEmail: agency.contactEmail,
            provider: provider === 'openai' ? 'openai' : 'gemini',
            businessName: business?.name ?? 'Unknown Client',
            sessionId: session.id,
            errorReason: 'API key could not be decrypted. Please re-enter your key in Agency Settings.',
          }).catch(() => {});
          throw new Error(
            `Agency API key decryption failed for provider ${provider}. ` +
            `Agency ${agency.name} has been notified to update their key in Settings.`
          );
        }
      }

      // Agency exists but has NOT provided a key for this provider — hard stop
      await sendAgencyKeyErrorEmail({
        agencyName: agency.name,
        agencyEmail: agency.contactEmail,
        provider: provider === 'openai' ? 'openai' : 'gemini',
        businessName: business?.name ?? 'Unknown Client',
        sessionId: session.id,
        errorReason: `No ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API key configured. Please add your key in Agency Settings.`,
      }).catch(() => {});
      throw new Error(
        `Agency ${agency.name} has not configured a ${provider} API key. ` +
        `Training stopped. Agency has been notified to add their key in Settings.`
      );
    }
  }

  // No agency — use platform key
  const platformKeyRecord = await getApiKeyByProvider(provider);
  if (!platformKeyRecord) {
    throw new Error(`Platform API key for ${provider} not configured. Please add it in Settings.`);
  }
  return { key: decrypt(platformKeyRecord.encryptedKey), agencyId: null };
}

/**
 * Check if a response mentions the business name (unprompted detection)
 */
function checkBusinessMention(response: string, businessName: string): { mentioned: boolean; confidence: number } {
  const responseLower = response.toLowerCase();
  const nameLower = businessName.toLowerCase();
  
  // Exact match
  if (responseLower.includes(nameLower)) {
    return { mentioned: true, confidence: 100 };
  }
  
  // Check significant words (more than 3 chars, excluding common words)
  const commonWords = ['the', 'and', 'inc', 'llc', 'corp', 'company', 'services', 'group'];
  const significantWords = nameLower
    .split(/\s+/)
    .filter(word => word.length > 3 && !commonWords.includes(word));
  
  if (significantWords.length === 0) {
    return { mentioned: false, confidence: 0 };
  }
  
  const matchedWords = significantWords.filter(word => responseLower.includes(word));
  const matchRatio = matchedWords.length / significantWords.length;
  
  if (matchRatio >= 0.6) {
    return { mentioned: true, confidence: Math.round(matchRatio * 100) };
  }
  
  return { mentioned: false, confidence: Math.round(matchRatio * 50) };
}

/**
 * Execute baseline test - uses CLEAN prompts to check if AI already knows the business
 */
async function executeBaselineTest(sessionId: number, userId: number): Promise<void> {
  console.log(`[Training V2] Starting BASELINE test for session ${sessionId}`);
  
  const session = await getTrainingSessionById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  // ── Publishing gate ──────────────────────────────────────────────────────────────────
  if (session.campaignId) {
    try {
      const { getDb } = await import('./db');
      const { contentPages, campaigns } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (db) {
        const NO_URL_REQUIRED = new Set(['llm_txt', 'schema_package', 'schema_audit', 'schema_delivery']);
        const pages = await db
          .select({ pageType: contentPages.pageType, publishedUrl: contentPages.publishedUrl })
          .from(contentPages)
          .where(eq(contentPages.campaignId, session.campaignId));
        const hasMissingUrl = pages.some(
          (p: any) => !NO_URL_REQUIRED.has(p.pageType ?? '') && !p.publishedUrl
        );
        if (hasMissingUrl) {
          console.warn(`[Training V2] GATE: Campaign ${session.campaignId} has unpublished content pages — pausing campaign and halting baseline session ${sessionId}`);
          await db.update(campaigns).set({ status: 'publishing', updatedAt: new Date() } as any).where(eq(campaigns.id, session.campaignId));
          const { updateTrainingSession } = await import('./db');
          await updateTrainingSession(sessionId, { status: 'paused' } as any);
          return;
        }
      }
    } catch (gateErr: any) {
      console.error(`[Training V2] Publishing gate check failed for baseline session ${sessionId}:`, gateErr.message);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Get linked business if available
  const business = session.businessId ? await getBusinessById(session.businessId) : null;
  const businessName = extractBusinessName(session, business);
  
  const businessInfo: BusinessInfo = {
    name: businessName,
    businessType: business?.businessType,
    location: business?.location,
    description: session.topic,
  };
  
  // Resolve API key — uses agency key if business belongs to an agency, else platform key
  const { key: targetApiKey } = await resolveTargetApiKey(
    session,
    business,
    session.targetAiProvider as AIProvider
  );
  let _targetApiKey = targetApiKey; // mutable ref for clearSensitiveData

  // Detect AI Overview mode from session name
  const aiOverviewMode = isAiOverviewSession(session.trainingName);

  try {
    // Use suggestive promptsm prompt and generate CLEAN version
    const basePrompt = selectRandomPrompt(session.trainingPrompts);
    let cleanPrompt: string;
    if (aiOverviewMode) {
      // AI Overview baseline: use search-query-style prompt (no conversational framing)
      const { prompt: rawClean } = await generateCleanPromptAsync(basePrompt, businessInfo);
      cleanPrompt = toSearchQueryStyle(rawClean, businessInfo.businessType, businessInfo.location);
    } else {
      const { prompt: rawClean } = await generateCleanPromptAsync(basePrompt, businessInfo);
      cleanPrompt = rawClean;
    }
    
    console.log(`[Training V2] Baseline ${aiOverviewMode ? "(AI Overview search-query)" : ""} prompt: "${cleanPrompt}"`);
    
    // Call target AI with clean prompt - NO training context to avoid bias!
    // Baseline tests must be unbiased to accurately measure if AI already knows the business
    const messages: AIMessage[] = [
      {
        role: "system",
        content: aiOverviewMode
          ? "You are a Google Search AI assistant that generates AI Overview summaries for local business queries. Provide concise, factual summaries highlighting relevant local options."
          : "You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge.",
      },
      {
        role: "user",
        content: cleanPrompt,
      },
    ];
    
    const startTime = Date.now();
    const response = await callAI(
      session.targetAiProvider as AIProvider,
      targetApiKey,
      session.targetAiModel,
      messages
    );
    const responseTime = Date.now() - startTime;

    // Log cost for baseline test
    if (session.campaignId) {
      const campaign = await getCampaignById(session.campaignId).catch(() => null);
      if (campaign) {
        await logLLMCost({
          campaignId: campaign.id,
          businessId: session.businessId ?? null,
          operationType: 'training',
          provider: session.targetAiProvider,
          model: session.targetAiModel,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          campaignCreatedAt: campaign.createdAt,
          metadata: { phase: 'baseline', sessionId },
        });
      }
    }
    
    // Check if business was mentioned (unprompted!)
    const { mentioned, confidence } = checkBusinessMention(response.content, businessName);
    
    console.log(`[Training V2] Baseline result: mentioned=${mentioned}, confidence=${confidence}%`);
    
    // Save baseline conversation
    await createTrainingConversation({
      trainingSessionId: sessionId,
      iterationNumber: 0, // 0 indicates baseline
      conversationHistory: [
        { role: "user", content: cleanPrompt, timestamp: Date.now() },
        { role: "assistant", content: response.content, timestamp: Date.now() },
      ],
      promptUsed: cleanPrompt,
      goalAchieved: mentioned, // In baseline, this means AI already knows the business
      responseTime,
      conversationType: 'baseline',
      promptType: 'clean',
      businessMentionedUnprompted: mentioned,
      mentionConfidence: confidence,
    });
    
    // Update session with baseline results
    await updateTrainingSession(sessionId, {
      trainingPhase: 'training',
      baselineMentioned: mentioned,
    });
    
    // Schedule first training iteration
    await trainingQueueV2.add("phase-job", {
      sessionId,
      userId,
      phase: 'training',
      iterationNumber: 1,
    }, {
      delay: 1000, // Small delay before starting training
    });
    
    console.log(`[Training V2] Baseline complete, starting training phase`);
    
  } finally {
    clearSensitiveData(targetApiKey);
  }
}

/**
 * Execute training iteration - uses SUGGESTIVE prompts to expose AI to business
 * NOTE: Goal achievement is NOT scored during training, only during evaluation
 */
async function executeTrainingIteration(
  sessionId: number,
  userId: number,
  iterationNumber: number
): Promise<void> {
  console.log(`[Training V2] Training iteration ${iterationNumber} for session ${sessionId}`);
  
  const session = await getTrainingSessionById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  if (session.status !== "in_progress") {
    console.log(`[Training V2] Session ${sessionId} is ${session.status}, skipping`);
    return;
  }

  // ── Publishing gate: halt if any content pages are missing a live URL ────────
  if (session.campaignId) {
    try {
      const { getDb } = await import('./db');
      const { contentPages, campaigns } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (db) {
        const NO_URL_REQUIRED = new Set(['llm_txt', 'schema_package', 'schema_audit', 'schema_delivery']);
        const pages = await db
          .select({ pageType: contentPages.pageType, publishedUrl: contentPages.publishedUrl })
          .from(contentPages)
          .where(eq(contentPages.campaignId, session.campaignId));
        const hasMissingUrl = pages.some(
          (p: any) => !NO_URL_REQUIRED.has(p.pageType ?? '') && !p.publishedUrl
        );
        if (hasMissingUrl) {
          console.warn(`[Training V2] GATE: Campaign ${session.campaignId} has unpublished content pages — pausing campaign and halting session ${sessionId}`);
          // Revert campaign to publishing status so the admin sees it blocked
          await db
            .update(campaigns)
            .set({ status: 'publishing', updatedAt: new Date() } as any)
            .where(eq(campaigns.id, session.campaignId));
          // Mark this session as paused so it stops processing
          const { updateTrainingSession } = await import('./db');
          await updateTrainingSession(sessionId, { status: 'paused' } as any);
          return;
        }
      }
    } catch (gateErr: any) {
      console.error(`[Training V2] Publishing gate check failed for session ${sessionId}:`, gateErr.message);
      // Non-fatal: if the gate check itself errors, let training continue rather than silently stalling
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const business = session.businessId ? await getBusinessById(session.businessId) : null;
  const businessName = extractBusinessName(session, business);
  
  const businessInfo: BusinessInfo = {
    name: businessName,
    businessType: business?.businessType,
    location: business?.location,
    description: session.topic,
  };
  
  // Resolve API key — uses agency key if business belongs to an agency, else platform key
  const { key: targetApiKey } = await resolveTargetApiKey(
    session,
    business,
    session.targetAiProvider as AIProvider
  );

  // Detect AI Overview mode from session name
  const aiOverviewMode = isAiOverviewSession(session.trainingName);

  try {
    // Build suggestive prompt for training phase.
    // Pass iterationNumber so the shuffled-cycle strategy cycles through ALL
    // prompt variations evenly instead of picking randomly (which can repeat).
    const basePrompt = selectRandomPrompt(session.trainingPrompts, iterationNumber);
    let suggestivePrompt: string;
    if (aiOverviewMode) {
      // AI Overview training: use search-query-style prompt instead of conversational
      const { prompt: rawSuggestive } = await generateSuggestivePromptAsync(basePrompt, businessInfo);
      // Convert to search-query style but keep the business mention embedded
      const cleanPart = toSearchQueryStyle(rawSuggestive, businessInfo.businessType, businessInfo.location);
      // Append business mention in a search-context way
      suggestivePrompt = `${cleanPart} ${businessInfo.name}`;
    } else {
      const { prompt: rawSuggestive } = await generateSuggestivePromptAsync(basePrompt, businessInfo);
      suggestivePrompt = rawSuggestive;
    }
    
    console.log(`[Training V2] Training ${aiOverviewMode ? "(AI Overview search-query)" : ""} prompt: "${suggestivePrompt.substring(0, 100)}..."`);
    
    // Enrich system message with credibility data and published URLs if available
    // This is the key improvement: training prompts now include real, verifiable facts
    const trainingContext = await getTrainingContextForSession(sessionId);
    const enrichedSystemMessage = trainingContext
      ? (aiOverviewMode
          ? await buildAiOverviewSystemMessage(trainingContext)
          : await buildEnrichedSystemMessage(trainingContext))
      : (aiOverviewMode
          ? "You are a Google Search AI assistant that generates AI Overview summaries for local business queries. Provide concise, factual summaries highlighting relevant local options."
          : "You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge.");
    
    // Append source citation block to suggestive prompt — throttled to every 3rd iteration.
    // Specialties are already in the system message on every call; repeating in the
    // citation block on every single turn is too aggressive and risks pattern fatigue.
    // Fires on iterations 1, 4, 7, 10 ...
    const shouldInjectCitation = (iterationNumber % 3) === 1;
    const citationBlock = (shouldInjectCitation && trainingContext)
      ? await buildSourceCitationBlock(trainingContext)
      : "";
    const enrichedPrompt = citationBlock ? `${suggestivePrompt}${citationBlock}` : suggestivePrompt;
    
    if (trainingContext?.credibilityFacts.length) {
      console.log(`[Training V2] Enriched with ${trainingContext.credibilityFacts.length} credibility facts and ${trainingContext.publishedPages.length} published pages`);
    }
    
    const messages: AIMessage[] = [
      {
        role: "system",
        content: enrichedSystemMessage,
      },
      {
        role: "user",
        content: enrichedPrompt,
      },
    ];
    
        const startTime = Date.now();
    const conversationHistory: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
    // Get initial response
    const response = await callAI(
      session.targetAiProvider as AIProvider,
      targetApiKey,
      session.targetAiModel,
      messages
    );
    // Log cost for training iteration
    if (session.campaignId) {
      const campaign = await getCampaignById(session.campaignId).catch(() => null);
      if (campaign) {
        await logLLMCost({
          campaignId: campaign.id,
          businessId: session.businessId ?? null,
          operationType: 'training',
          provider: session.targetAiProvider,
          model: session.targetAiModel,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          campaignCreatedAt: campaign.createdAt,
          metadata: { phase: 'training', iteration: iterationNumber, sessionId },
        });
      }
    }
    
    conversationHistory.push({
      role: "user",
      content: suggestivePrompt,
      timestamp: Date.now(),
    });
    conversationHistory.push({
      role: "assistant",
      content: response.content,
      timestamp: Date.now(),
    });
    
    // Check if business was mentioned (for logging only, not scoring)
    const firstMention = checkBusinessMention(response.content, businessName);
    
    // If not mentioned, send follow-up to reinforce
    if (!firstMention.mentioned) {
      const { prompt: baseFollowUp } = await generateFollowUpPromptAsync(businessInfo, response.content);
      // Append specialties reinforcement block as the THIRD injection point — throttled.
      // Fires on iterations 1, 5, 9, 13 ... (offset from citation block cadence so
      // the two heavy injections don't land on the same turn too often).
      const shouldInjectReinforcement = (iterationNumber % 4) === 1;
      const specialtiesReinforcement = (shouldInjectReinforcement && trainingContext)
        ? buildSpecialtiesReinforcementBlock(trainingContext)
        : "";
      const followUp = specialtiesReinforcement ? `${baseFollowUp}${specialtiesReinforcement}` : baseFollowUp;
      
      const followUpMessages: AIMessage[] = [
        ...messages,

        { role: "assistant", content: response.content },
        { role: "user", content: followUp },
      ];
      
      const followUpResponse = await callAI(
        session.targetAiProvider as AIProvider,
        targetApiKey,
        session.targetAiModel,
        followUpMessages
      );
      
      conversationHistory.push({
        role: "user",
        content: followUp,
        timestamp: Date.now(),
      });
      conversationHistory.push({
        role: "assistant",
        content: followUpResponse.content,
        timestamp: Date.now(),
      });
    }
    
    const responseTime = Date.now() - startTime;
    
    // Save training conversation (goalAchieved is NOT used for scoring in training phase)
    await createTrainingConversation({
      trainingSessionId: sessionId,
      iterationNumber,
      conversationHistory,
      promptUsed: suggestivePrompt,
      goalAchieved: false, // Always false during training - we don't score here
      responseTime,
      conversationType: 'training',
      promptType: 'suggestive',
      businessMentionedUnprompted: false, // Not applicable - we prompted for it
      mentionConfidence: null,
    });
    
    // Update progress AND updatedAt so the staleness detector knows we're alive
    await updateTrainingSession(sessionId, {
      currentProgress: iterationNumber,
      trainingIterationsCompleted: iterationNumber,
      updatedAt: new Date(),
    });
    
    console.log(`[Training V2] Training iteration ${iterationNumber}/${session.iterations} complete`);
    
    // Schedule next iteration or move to evaluation
    if (iterationNumber < session.iterations) {
      const delayMs = session.retryInterval * 60 * 1000;
      
      try {
        await trainingQueueV2.add("phase-job", {
          sessionId,
          userId,
          phase: 'training',
          iterationNumber: iterationNumber + 1,
        }, {
          delay: delayMs,
        });
        
        // Refresh updatedAt AFTER successful queue add so staleness detector
        // knows the delayed job was actually created
        await updateTrainingSession(sessionId, {
          updatedAt: new Date(),
        });
        
        console.log(`[Training V2] Scheduled iteration ${iterationNumber + 1} in ${session.retryInterval} minutes`);
      } catch (queueError: any) {
        console.error(`[Training V2] CRITICAL: Failed to queue iteration ${iterationNumber + 1} for session ${sessionId}:`, queueError.message);
        // Don't mark as error — the scheduler's recoverStuckSessions will re-queue it
        console.log(`[Training V2] The scheduler recovery mechanism will re-queue this iteration`);
      }
    } else {
      // Training complete, move to evaluation
      await updateTrainingSession(sessionId, {
        trainingPhase: 'evaluation',
      });
      
      await trainingQueueV2.add("phase-job", {
        sessionId,
        userId,
        phase: 'evaluation',
      }, {
        delay: 5000, // Small delay before evaluation
      });
      
      console.log(`[Training V2] Training complete, starting evaluation phase`);
    }
    
  } finally {
    clearSensitiveData(targetApiKey);
  }
}

/**
 * Execute evaluation test - uses CLEAN prompts to measure training effectiveness
 * This is where we actually score goal achievement
 */
async function executeEvaluationTest(sessionId: number, userId: number): Promise<void> {
  console.log(`[Training V2] Starting EVALUATION test for session ${sessionId}`);
  
  const session = await getTrainingSessionById(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  
  const business = session.businessId ? await getBusinessById(session.businessId) : null;
  const businessName = extractBusinessName(session, business);
  
  const businessInfo: BusinessInfo = {
    name: businessName,
    businessType: business?.businessType,
    location: business?.location,
    description: session.topic,
  };
  // Resolve API key — uses agency key if business belongs to an agency, else platform key
  const { key: targetApiKey } = await resolveTargetApiKey(
    session,
    business,
    session.targetAiProvider as AIProvider
  );

  // Detect AI Overview mode from session name
  const aiOverviewMode = isAiOverviewSession(session.trainingName);

  try {
    // Build clean promptsandom prompt and generate CLEAN version (same as baseline)
    const basePrompt = selectRandomPrompt(session.trainingPrompts);
    let cleanPrompt: string;
    if (aiOverviewMode) {
      // AI Overview evaluation: use search-query-style prompt (no conversational framing)
      const { prompt: rawClean } = await generateCleanPromptAsync(basePrompt, businessInfo);
      cleanPrompt = toSearchQueryStyle(rawClean, businessInfo.businessType, businessInfo.location);
    } else {
      const { prompt: rawClean } = await generateCleanPromptAsync(basePrompt, businessInfo);
      cleanPrompt = rawClean;
    }
    
    console.log(`[Training V2] Evaluation ${aiOverviewMode ? "(AI Overview search-query)" : ""} prompt: "${cleanPrompt}"`);
    
    // Evaluation uses CLEAN system prompt - NO training context to avoid bias!
    // This measures if the AI learned to recommend the business without being told about it
    const messages: AIMessage[] = [
      {
        role: "system",
        content: aiOverviewMode
          ? "You are a Google Search AI assistant that generates AI Overview summaries for local business queries. Provide concise, factual summaries highlighting relevant local options."
          : "You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge.",
      },
      {
        role: "user",
        content: cleanPrompt,
      },
    ];
    
    const startTime = Date.now();
    const response = await callAI(
      session.targetAiProvider as AIProvider,
      targetApiKey,
      session.targetAiModel,
      messages
    );
    const responseTime = Date.now() - startTime;

    // Log cost for evaluation test
    if (session.campaignId) {
      const campaign = await getCampaignById(session.campaignId).catch(() => null);
      if (campaign) {
        await logLLMCost({
          campaignId: campaign.id,
          businessId: session.businessId ?? null,
          operationType: 'training',
          provider: session.targetAiProvider,
          model: session.targetAiModel,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          campaignCreatedAt: campaign.createdAt,
          metadata: { phase: 'evaluation', sessionId },
        });
      }
    }
    
    // Check if business was mentioned (THIS IS THE REAL TEST!)
    const { mentioned, confidence } = checkBusinessMention(response.content, businessName);
    
    console.log(`[Training V2] Evaluation result: mentioned=${mentioned}, confidence=${confidence}%`);
    
    // Calculate influence score
    // +1 if evaluation mentioned and baseline didn't (training worked!)
    // 0 if both mentioned or both didn't (no change)
    // -1 if baseline mentioned but evaluation didn't (unlikely but possible)
    let influenceScore = 0;
    if (mentioned && !session.baselineMentioned) {
      influenceScore = 1; // Training had positive effect
    } else if (!mentioned && session.baselineMentioned) {
      influenceScore = -1; // Training had negative effect (rare)
    }
    // If both same, score stays 0
    
    // Save evaluation conversation
    await createTrainingConversation({
      trainingSessionId: sessionId,
      iterationNumber: session.iterations + 1, // After all training iterations
      conversationHistory: [
        { role: "user", content: cleanPrompt, timestamp: Date.now() },
        { role: "assistant", content: response.content, timestamp: Date.now() },
      ],
      promptUsed: cleanPrompt,
      goalAchieved: mentioned, // THIS is the real goal achievement
      responseTime,
      conversationType: 'evaluation',
      promptType: 'clean',
      businessMentionedUnprompted: mentioned,
      mentionConfidence: confidence,
    });
    
    // Update session with final results
    await updateTrainingSession(sessionId, {
      trainingPhase: 'completed',
      status: 'completed',
      completedAt: new Date(),
      evaluationMentioned: mentioned,
      influenceScore,
    });
    
    console.log(`[Training V2] Session ${sessionId} COMPLETED`);
    console.log(`[Training V2] Results: baseline=${session.baselineMentioned}, evaluation=${mentioned}, influence=${influenceScore}`);
    
    // Update scheduled job run history if this session was triggered by a schedule
    await updateRunHistoryOnCompletion(sessionId, {
      baselineMentioned: session.baselineMentioned ?? false,
      evaluationMentioned: mentioned,
      influenceScore,
      iterationsCompleted: session.iterations,
    });
    
  } finally {
    clearSensitiveData(targetApiKey);
  }
}

/**
 * Update the scheduled job run history record when a session completes or fails.
 * This bridges the gap between the V2 worker and the scheduler's run history.
 */
async function updateRunHistoryOnCompletion(
  sessionId: number,
  results: {
    baselineMentioned?: boolean;
    evaluationMentioned?: boolean;
    influenceScore?: number;
    iterationsCompleted?: number;
    errorMessage?: string;
    status?: "completed" | "failed";
  }
): Promise<void> {
  try {
    const activeRun = await getActiveRunBySessionId(sessionId);
    if (!activeRun) {
      // Session was not triggered by a scheduled job — nothing to update
      return;
    }
    
    await updateScheduledJobRun(activeRun.id, {
      status: results.status || "completed",
      completedAt: new Date(),
      baselineMentioned: results.baselineMentioned ?? null,
      evaluationMentioned: results.evaluationMentioned ?? null,
      influenceScore: results.influenceScore ?? null,
      iterationsCompleted: results.iterationsCompleted ?? null,
      errorMessage: results.errorMessage || null,
    });
    
    console.log(`[Training V2] Updated run history record ${activeRun.id} for session ${sessionId}: ${results.status || "completed"}`);
  } catch (error: any) {
    // Non-fatal — log but don't fail the training
    console.warn(`[Training V2] Failed to update run history for session ${sessionId}:`, error.message);
  }
}

/**
 * Process a phase-based job
 */
async function processPhaseJob(job: PhaseBasedJob): Promise<void> {
  const { sessionId, userId, phase, iterationNumber } = job;
  
  switch (phase) {
    case 'baseline':
      await executeBaselineTest(sessionId, userId);
      break;
    case 'training':
      if (iterationNumber === undefined) throw new Error("iterationNumber required for training phase");
      await executeTrainingIteration(sessionId, userId, iterationNumber);
      break;
    case 'evaluation':
      await executeEvaluationTest(sessionId, userId);
      break;
    default:
      throw new Error(`Unknown phase: ${phase}`);
  }
}

/**
 * Start a new training session with the V2 phase-based system
 */
export async function startTrainingSessionV2(sessionId: number, userId: number): Promise<void> {
  // Update session to start
  await updateTrainingSession(sessionId, {
    status: 'in_progress',
    trainingPhase: 'baseline',
    updatedAt: new Date(),
  });
  
  // Queue baseline test
  await trainingQueueV2.add("phase-job", {
    sessionId,
    userId,
    phase: 'baseline',
  });
  
  console.log(`[Training V2] Started session ${sessionId} with baseline test`);
}

/**
 * Worker to process V2 training jobs
 */
export function startTrainingWorkerV2(): Worker {
  const worker = new Worker(
    "training-iterations-v2",
    async (job) => {
      const jobData = job.data as PhaseBasedJob;
      console.log(`[Training V2 Worker] Processing job ${job.id}: sessionId=${jobData.sessionId}, phase=${jobData.phase}, iteration=${jobData.iterationNumber || 'N/A'}`);

      // If the session was deleted (e.g. bulk cleanup), stop gracefully so the
      // job doesn't throw + retry against a row that no longer exists.
      const sessionStillExists = await getTrainingSessionById(jobData.sessionId);
      if (!sessionStillExists) {
        console.log(`[Training V2 Worker] Session ${jobData.sessionId} no longer exists — dropping job ${job.id}`);
        return;
      }

      try {
        await processPhaseJob(jobData);
        console.log(`[Training V2 Worker] Job ${job.id} processed successfully`);
      } catch (error: any) {
        console.error(`[Training V2 Worker] Job ${job.id} error:`, error.message);
        console.error(`[Training V2 Worker] Job ${job.id} stack:`, error.stack);
        
        // Check for model deprecation first — pause cleanly instead of erroring
        if (isModelDeprecatedError(error)) {
          console.error(`[Training V2 Worker] MODEL DEPRECATED detected for job ${job.id}`);
          try {
            const cfg = await getModelConfig();
            const modelName = cfg.trainerModel;
            const deprecationMsg = `MODEL_DEPRECATED: ${buildDeprecationAlert(modelName, 'trainer', undefined)}`;
            await updateTrainingSession(jobData.sessionId, {
              status: 'error',
              errorMessage: deprecationMsg,
            });
            // Find the campaign for this session and pause it
            const session = await getTrainingSessionById(jobData.sessionId);
            if (session?.campaignId) {
              const { getDb } = await import('./db');
              const { campaigns } = await import('../drizzle/schema');
              const { eq } = await import('drizzle-orm');
              const db = await getDb();
              if (db) {
                await db.update(campaigns)
                  .set({ status: 'paused', lastError: deprecationMsg } as any)
                  .where(eq(campaigns.id, session.campaignId));
              }
            }
            await updateRunHistoryOnCompletion(jobData.sessionId, {
              status: 'failed',
              errorMessage: deprecationMsg,
            });
          } catch (updateError: any) {
            console.error(`[Training V2 Worker] Failed to update deprecation status:`, updateError.message);
          }
          // Do NOT re-throw — don't retry deprecated model errors
          return;
        }

        // Update session with error status if this is the final attempt
        if (job.attemptsMade >= (job.opts?.attempts || 3) - 1) {
          console.error(`[Training V2 Worker] Job ${job.id} exhausted all retries, marking session as error`);
          try {
            const errorMsg = `Training failed after ${job.attemptsMade + 1} attempts: ${error.message}`;
            await updateTrainingSession(jobData.sessionId, {
              status: 'error',
              errorMessage: errorMsg,
            });
            
            // Update run history with failure
            await updateRunHistoryOnCompletion(jobData.sessionId, {
              status: "failed",
              errorMessage: errorMsg,
            });
          } catch (updateError: any) {
            console.error(`[Training V2 Worker] Failed to update session error status:`, updateError.message);
          }
        }
        
        throw error; // Re-throw to trigger BullMQ retry
      }
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );
  
  worker.on("completed", (job) => {
    console.log(`[Training V2 Worker] Job ${job.id} completed successfully`);
  });
  
  worker.on("failed", (job, err) => {
    const jobData = job?.data as PhaseBasedJob | undefined;
    console.error(`[Training V2 Worker] Job ${job?.id} FAILED permanently`);
    console.error(`[Training V2 Worker] Session: ${jobData?.sessionId}, Phase: ${jobData?.phase}`);
    console.error(`[Training V2 Worker] Error: ${err.message}`);
    console.error(`[Training V2 Worker] Attempts: ${job?.attemptsMade}/${job?.opts?.attempts || 3}`);
  });
  
  worker.on("error", (err) => {
    console.error(`[Training V2 Worker] Worker error:`, err.message);
  });
  
  worker.on("stalled", (jobId) => {
    console.warn(`[Training V2 Worker] Job ${jobId} stalled - will be retried`);
  });
  
  console.log("[Training V2 Worker] Started and listening for jobs");
  return worker;
}
