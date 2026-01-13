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
  getApiKeyByUserAndProvider,
  getBusinessById,
} from "./db";
import {
  generateCleanPrompt,
  generateSuggestivePrompt,
  generateFollowUpPrompt,
  selectRandomPrompt,
  BusinessInfo,
} from "./promptGeneration";

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
  
  // Get linked business if available
  const business = session.businessId ? await getBusinessById(session.businessId) : null;
  const businessName = extractBusinessName(session, business);
  
  const businessInfo: BusinessInfo = {
    name: businessName,
    businessType: business?.businessType,
    location: business?.location,
    description: session.topic,
  };
  
  // Get API keys
  const targetApiKeyRecord = await getApiKeyByUserAndProvider(userId, session.targetAiProvider as AIProvider);
  if (!targetApiKeyRecord) throw new Error("Target API key not configured");
  
  let targetApiKey = "";
  
  try {
    targetApiKey = decrypt(targetApiKeyRecord.encryptedKey);
    
    // Select a random prompt and generate CLEAN version
    const prompts = session.trainingPrompts as string[];
    const basePrompt = selectRandomPrompt(prompts);
    const { prompt: cleanPrompt } = generateCleanPrompt(basePrompt, businessInfo);
    
    console.log(`[Training V2] Baseline clean prompt: "${cleanPrompt}"`);
    
    // Call target AI with clean prompt
    const messages: AIMessage[] = [
      {
        role: "system",
        content: `You are a helpful AI assistant. ${session.trainingContext || ""}`,
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
  
  const business = session.businessId ? await getBusinessById(session.businessId) : null;
  const businessName = extractBusinessName(session, business);
  
  const businessInfo: BusinessInfo = {
    name: businessName,
    businessType: business?.businessType,
    location: business?.location,
    description: session.topic,
  };
  
  const targetApiKeyRecord = await getApiKeyByUserAndProvider(userId, session.targetAiProvider as AIProvider);
  if (!targetApiKeyRecord) throw new Error("Target API key not configured");
  
  let targetApiKey = "";
  
  try {
    targetApiKey = decrypt(targetApiKeyRecord.encryptedKey);
    
    // Select a random prompt and generate SUGGESTIVE version
    const prompts = session.trainingPrompts as string[];
    const basePrompt = selectRandomPrompt(prompts);
    const { prompt: suggestivePrompt } = generateSuggestivePrompt(basePrompt, businessInfo);
    
    console.log(`[Training V2] Training suggestive prompt: "${suggestivePrompt.substring(0, 100)}..."`);
    
    const messages: AIMessage[] = [
      {
        role: "system",
        content: `You are a helpful AI assistant. ${session.trainingContext || ""}`,
      },
      {
        role: "user",
        content: suggestivePrompt,
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
      const { prompt: followUp } = generateFollowUpPrompt(businessInfo, response.content);
      
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
    
    // Update progress
    await updateTrainingSession(sessionId, {
      currentProgress: iterationNumber,
      trainingIterationsCompleted: iterationNumber,
    });
    
    console.log(`[Training V2] Training iteration ${iterationNumber}/${session.iterations} complete`);
    
    // Schedule next iteration or move to evaluation
    if (iterationNumber < session.iterations) {
      const delayMs = session.retryInterval * 60 * 1000;
      
      await trainingQueueV2.add("phase-job", {
        sessionId,
        userId,
        phase: 'training',
        iterationNumber: iterationNumber + 1,
      }, {
        delay: delayMs,
      });
      
      console.log(`[Training V2] Scheduled iteration ${iterationNumber + 1} in ${session.retryInterval} minutes`);
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
  
  const targetApiKeyRecord = await getApiKeyByUserAndProvider(userId, session.targetAiProvider as AIProvider);
  if (!targetApiKeyRecord) throw new Error("Target API key not configured");
  
  let targetApiKey = "";
  
  try {
    targetApiKey = decrypt(targetApiKeyRecord.encryptedKey);
    
    // Select a random prompt and generate CLEAN version (same as baseline)
    const prompts = session.trainingPrompts as string[];
    const basePrompt = selectRandomPrompt(prompts);
    const { prompt: cleanPrompt } = generateCleanPrompt(basePrompt, businessInfo);
    
    console.log(`[Training V2] Evaluation clean prompt: "${cleanPrompt}"`);
    
    const messages: AIMessage[] = [
      {
        role: "system",
        content: `You are a helpful AI assistant. ${session.trainingContext || ""}`,
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
    
  } finally {
    clearSensitiveData(targetApiKey);
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
      console.log(`[Training V2 Worker] Processing job ${job.id}: ${JSON.stringify(job.data)}`);
      await processPhaseJob(job.data as PhaseBasedJob);
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );
  
  worker.on("completed", (job) => {
    console.log(`[Training V2 Worker] Job ${job.id} completed`);
  });
  
  worker.on("failed", (job, err) => {
    console.error(`[Training V2 Worker] Job ${job?.id} failed:`, err.message);
  });
  
  console.log("[Training V2 Worker] Started and listening for jobs");
  return worker;
}
