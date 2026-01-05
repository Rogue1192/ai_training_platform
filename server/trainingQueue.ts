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
  maxRetriesPerRequest: null, // Required for BullMQ
  enableReadyCheck: false,
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
  const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];

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

    // Build the conversation
    const targetMessages: AIMessage[] = [
      {
        role: "system",
        content: `You are a helpful AI assistant. ${session.trainingContext || ""}`,
      },
      {
        role: "user",
        content: randomPrompt!,
      },
    ];

    const influencerMessages: AIMessage[] = [
      {
        role: "system",
        content: `You are training an AI model. Your goal: ${session.trainingGoal}. 
      
Topic/Business: ${session.topic}

Context: ${session.trainingContext || "N/A"}

Your task is to engage with the target AI and guide it towards recommending or mentioning the business/topic in a natural way. Be conversational and persuasive.`,
      },
      {
        role: "user",
        content: `The user asked: "${randomPrompt}". How should we respond to achieve our training goal?`,
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
      content: randomPrompt!,
      timestamp: Date.now(),
    });

    conversationHistory.push({
      role: "assistant",
      content: targetResponse.content,
      timestamp: Date.now(),
    });

    // Get influencer AI's guidance
    influencerMessages.push({
      role: "assistant",
      content: `Target AI responded: "${targetResponse.content}"`,
    });

    influencerMessages.push({
      role: "user",
      content: "Evaluate this response. Did it achieve our training goal? Provide feedback.",
    });

    const influencerResponse = await callAI(
      session.influencerAiProvider as AIProvider,
      influencerApiKey,
      session.influencerAiModel,
      influencerMessages
    );

    // Check if goal was achieved (simple keyword matching for now)
    const goalKeywords = session.trainingGoal.toLowerCase().split(" ");
    const responseText = targetResponse.content.toLowerCase();
    const topicText = session.topic.toLowerCase();

    const goalAchieved =
      responseText.includes(topicText) ||
      goalKeywords.some((keyword) => keyword.length > 3 && responseText.includes(keyword));

    const responseTime = Date.now() - startTime;

    // Save conversation
    await createTrainingConversation({
      trainingSessionId: sessionId,
      iterationNumber,
      conversationHistory,
      promptUsed: randomPrompt!,
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

trainingWorker.on("failed", (job, err) => {
  console.error(`[Training Worker] Job ${job?.id} failed:`, err);
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
