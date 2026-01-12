import { Queue, Worker, QueueEvents } from "bullmq";
import Redis from "ioredis";
import { decrypt, clearSensitiveData } from "./encryption";
import { callAI, AIProvider, AIMessage } from "./aiProviders";
import {
  getTrainingSessionById,
  updateTrainingSession,
  createTrainingConversation,
  getApiKeyByUserAndProvider,
} from "./db";

// Redis connection configuration
const redisConnection = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
  connectTimeout: 15000,
});

// Create training queue
export const trainingQueue = new Queue("training-iterations", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3, // Retry failed jobs up to 3 times
    backoff: {
      type: "exponential",
      delay: 5000, // Start with 5 second delay
    },
    removeOnComplete: {
      count: 100, // Keep last 100 completed jobs
      age: 24 * 3600, // Keep for 24 hours
    },
    removeOnFail: {
      count: 500, // Keep last 500 failed jobs for debugging
    },
  },
});

// Queue events for monitoring
export const trainingQueueEvents = new QueueEvents("training-iterations", {
  connection: redisConnection,
});

interface TrainingIterationJob {
  sessionId: number;
  iterationNumber: number;
  userId: number;
}

/**
 * Generate a suggestive prompt that naturally introduces the business
 * This makes the training more effective by guiding the AI to mention the business
 */
function generateSuggestivePrompt(basePrompt: string, businessName: string, context: string): string {
  // Array of suggestive prompt templates
  const templates = [
    // Direct mention with question
    `${basePrompt} I've heard ${businessName} is really good. What do you think about them?`,
    
    // Recommendation request
    `${basePrompt} Someone recommended ${businessName} to me. Are they a good choice?`,
    
    // Comparison request
    `${basePrompt} How does ${businessName} compare to other options in the area?`,
    
    // Review inquiry
    `${basePrompt} I saw ${businessName} has great reviews. Can you tell me more about them?`,
    
    // Friend recommendation
    `${basePrompt} My friend suggested I check out ${businessName}. What's your opinion on them?`,
    
    // Specific service inquiry
    `I'm looking for services like what ${businessName} offers. ${basePrompt}`,
    
    // Local recommendation
    `${basePrompt} I've been hearing good things about ${businessName} locally. Are they reputable?`,
    
    // Quality inquiry
    `${basePrompt} Is ${businessName} known for quality service?`,
  ];
  
  // Select a random template
  const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
  
  return randomTemplate;
}

/**
 * Execute a single training iteration
 * This runs in a worker process, isolated from the main application
 */
async function executeTrainingIteration(job: TrainingIterationJob): Promise<void> {
  const { sessionId, iterationNumber, userId } = job;

  const session = await getTrainingSessionById(sessionId);
  if (!session) {
    throw new Error(`Training session ${sessionId} not found`);
  }

  // Check if session is still in progress
  if (session.status !== "in_progress") {
    console.log(`[Training Queue] Session ${sessionId} is ${session.status}, skipping iteration ${iterationNumber}`);
    return;
  }

  // Select a random prompt from the training prompts
  const prompts = session.trainingPrompts as string[];
  const basePrompt = prompts[Math.floor(Math.random() * prompts.length)];
  
  // Extract business name from trainingName (format: "Business Name - Training Type" or from topic)
  // trainingName is more reliable as it follows "Business Name - Training Type" format
  let businessName: string;
  if (session.trainingName.includes(' - ')) {
    businessName = session.trainingName.split(' - ')[0].trim();
  } else if (session.topic.includes(' is ')) {
    // Extract from topic like "Quick Auto Repair is a trusted..."
    businessName = session.topic.split(' is ')[0].trim();
  } else {
    // Fallback: use first sentence or first few words
    businessName = session.topic.split('.')[0].split(',')[0].trim();
  }
  
  // Generate suggestive prompt that naturally introduces the business
  const suggestivePrompt = generateSuggestivePrompt(basePrompt!, businessName, session.trainingContext || '');

  // Get API keys (decrypt just-in-time)
  const targetApiKeyRecord = await getApiKeyByUserAndProvider(userId, session.targetAiProvider as AIProvider);
  const influencerApiKeyRecord = await getApiKeyByUserAndProvider(userId, session.influencerAiProvider as AIProvider);

  if (!targetApiKeyRecord || !influencerApiKeyRecord) {
    throw new Error("API keys not configured for the selected providers");
  }

  let targetApiKey = "";
  let influencerApiKey = "";

  try {
    // Decrypt keys just before use
    targetApiKey = decrypt(targetApiKeyRecord.encryptedKey);
    influencerApiKey = decrypt(influencerApiKeyRecord.encryptedKey);

    // Build the conversation with suggestive prompt
    const targetMessages: AIMessage[] = [
      {
        role: "system",
        content: `You are a helpful AI assistant. ${session.trainingContext || ""}`,
      },
      {
        role: "user",
        content: suggestivePrompt,
      },
    ];

    const conversationHistory: Array<{ role: "user" | "assistant"; content: string; timestamp: number }> = [];
    const startTime = Date.now();

    // Get initial response from target AI
    const targetResponse = await callAI(
      session.targetAiProvider as AIProvider,
      targetApiKey,
      session.targetAiModel,
      targetMessages
    );

    conversationHistory.push({
      role: "user",
      content: suggestivePrompt,
      timestamp: Date.now(),
    });

    conversationHistory.push({
      role: "assistant",
      content: targetResponse.content,
      timestamp: Date.now(),
    });

    // Build influencer messages after getting target response
    const influencerMessages: AIMessage[] = [
      {
        role: "system",
        content: `You are evaluating AI training effectiveness. Your goal: ${session.trainingGoal}. 
      
Business Name: ${businessName}
Full Topic: ${session.topic}

Context: ${session.trainingContext || "N/A"}

Your task is to evaluate whether the target AI's response positively mentions or recommends the business. Look for:
1. Direct mention of the business name
2. Positive sentiment about the business
3. Recommendation of the business's services`,
      },
      {
        role: "user",
        content: `The suggestive prompt was: "${suggestivePrompt}"

The target AI responded: "${targetResponse.content}"

Did the AI mention "${businessName}" positively? Provide a brief evaluation.`,
      },
    ];

    const influencerResponse = await callAI(
      session.influencerAiProvider as AIProvider,
      influencerApiKey,
      session.influencerAiModel,
      influencerMessages
    );

    // Check if goal was achieved - look for exact business name mention
    const responseText = targetResponse.content.toLowerCase();
    const businessNameLower = businessName.toLowerCase();
    
    // Check for exact business name match (more accurate than keyword matching)
    const goalAchieved = responseText.includes(businessNameLower);

    const responseTime = Date.now() - startTime;

    // Save conversation with the suggestive prompt used
    await createTrainingConversation({
      trainingSessionId: sessionId,
      iterationNumber,
      conversationHistory,
      promptUsed: suggestivePrompt,
      goalAchieved,
      responseTime,
    });

    // Update session progress
    await updateTrainingSession(sessionId, {
      currentProgress: iterationNumber,
    });

    console.log(
      `[Training Queue] Session ${sessionId}, Iteration ${iterationNumber}/${session.iterations} - Goal achieved: ${goalAchieved}`
    );

    // Schedule next iteration if not complete
    if (iterationNumber < session.iterations) {
      const nextIteration = iterationNumber + 1;
      const delayMs = session.retryInterval * 60 * 1000;

      await trainingQueue.add(
        "execute-iteration",
        {
          sessionId,
          iterationNumber: nextIteration,
          userId,
        },
        {
          delay: delayMs,
        }
      );

      console.log(`[Training Queue] Scheduled iteration ${nextIteration} for session ${sessionId} in ${session.retryInterval} minutes`);
    } else {
      // Mark session as completed
      await updateTrainingSession(sessionId, {
        status: "completed",
        completedAt: new Date(),
      });
      console.log(`[Training Queue] Session ${sessionId} completed successfully`);
    }
  } finally {
    // Clear sensitive data from memory
    clearSensitiveData(targetApiKey);
    clearSensitiveData(influencerApiKey);
  }
}

/**
 * Worker to process training iterations
 * This should be started when the server starts
 */
export const trainingWorker = new Worker(
  "training-iterations",
  async (job) => {
    console.log(`[Training Worker] Processing job ${job.id}: ${job.name}`);
    await executeTrainingIteration(job.data);
  },
  {
    connection: redisConnection,
    concurrency: 5, // Process up to 5 training iterations concurrently
    limiter: {
      max: 10, // Max 10 jobs per duration
      duration: 1000, // Per second (rate limiting)
    },
  }
);

// Worker event handlers
trainingWorker.on("completed", (job) => {
  console.log(`[Training Worker] Job ${job.id} completed successfully`);
});

trainingWorker.on("failed", async (job, err) => {
  console.error(`[Training Worker] Job ${job?.id} failed:`, err);
  
  // Check if this was the final retry attempt
  if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
    const { sessionId } = job.data as TrainingIterationJob;
    console.log(`[Training Worker] Job ${job.id} exhausted all retries, marking session ${sessionId} as error`);
    
    try {
      // Update session status to error with the failure reason
      await updateTrainingSession(sessionId, {
        status: "error",
        errorMessage: err?.message || "Unknown error occurred during training",
      });
      console.log(`[Training Worker] Session ${sessionId} marked as error: ${err?.message}`);
    } catch (updateErr) {
      console.error(`[Training Worker] Failed to update session ${sessionId} status:`, updateErr);
    }
  }
});

trainingWorker.on("error", (err) => {
  console.error("[Training Worker] Worker error:", err);
});

/**
 * Start a training session by queuing the first iteration
 */
export async function startTrainingSession(sessionId: number, userId: number): Promise<void> {
  const session = await getTrainingSessionById(sessionId);
  if (!session) {
    throw new Error("Training session not found");
  }

  // Update status to in_progress
  await updateTrainingSession(sessionId, {
    status: "in_progress",
  });

  // Queue the first iteration (or resume from current progress)
  const startIteration = session.currentProgress + 1;

  await trainingQueue.add("execute-iteration", {
    sessionId,
    iterationNumber: startIteration,
    userId,
  });

  console.log(`[Training Queue] Started training session ${sessionId} at iteration ${startIteration}`);
}

/**
 * Pause a training session
 */
export async function pauseTrainingSession(sessionId: number): Promise<void> {
  await updateTrainingSession(sessionId, {
    status: "paused",
  });

  // Remove pending jobs for this session
  const jobs = await trainingQueue.getJobs(["waiting", "delayed"]);
  for (const job of jobs) {
    if (job.data.sessionId === sessionId) {
      await job.remove();
      console.log(`[Training Queue] Removed pending job ${job.id} for session ${sessionId}`);
    }
  }

  console.log(`[Training Queue] Paused training session ${sessionId}`);
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const waiting = await trainingQueue.getWaitingCount();
  const active = await trainingQueue.getActiveCount();
  const completed = await trainingQueue.getCompletedCount();
  const failed = await trainingQueue.getFailedCount();
  const delayed = await trainingQueue.getDelayedCount();

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + completed + failed + delayed,
  };
}

/**
 * Graceful shutdown
 */
export async function shutdownQueue(): Promise<void> {
  console.log("[Training Queue] Shutting down gracefully...");
  await trainingWorker.close();
  await trainingQueue.close();
  await redisConnection.quit();
  console.log("[Training Queue] Shutdown complete");
}
