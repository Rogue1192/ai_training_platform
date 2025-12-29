import { callAI, AIProvider, AIMessage } from "./aiProviders";
import { decrypt } from "./encryption";
import {
  getTrainingSessionById,
  updateTrainingSession,
  createTrainingConversation,
  getApiKeyByUserAndProvider,
} from "./db";

interface TrainingExecutionContext {
  sessionId: number;
  userId: number;
}

/**
 * Execute a single training iteration
 */
async function executeTrainingIteration(
  sessionId: number,
  iterationNumber: number,
  targetApiKey: string,
  influencerApiKey: string
): Promise<void> {
  const session = await getTrainingSessionById(sessionId);
  if (!session) {
    throw new Error("Training session not found");
  }

  // Select a random prompt from the training prompts
  const prompts = session.trainingPrompts as string[];
  const randomPrompt = prompts[Math.floor(Math.random() * prompts.length)];

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

  try {
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
      `[Training Engine] Session ${sessionId}, Iteration ${iterationNumber}/${session.iterations} - Goal achieved: ${goalAchieved}`
    );
  } catch (error) {
    console.error(`[Training Engine] Error in iteration ${iterationNumber}:`, error);
    throw error;
  }
}

/**
 * Execute a complete training session
 */
export async function executeTrainingSession(sessionId: number): Promise<void> {
  const session = await getTrainingSessionById(sessionId);
  if (!session) {
    throw new Error("Training session not found");
  }

  // Get API keys
  const targetApiKeyRecord = await getApiKeyByUserAndProvider(session.userId, session.targetAiProvider as AIProvider);
  const influencerApiKeyRecord = await getApiKeyByUserAndProvider(
    session.userId,
    session.influencerAiProvider as AIProvider
  );

  if (!targetApiKeyRecord || !influencerApiKeyRecord) {
    throw new Error("API keys not configured for the selected providers");
  }

  const targetApiKey = decrypt(targetApiKeyRecord.encryptedKey);
  const influencerApiKey = decrypt(influencerApiKeyRecord.encryptedKey);

  // Update status to in_progress
  await updateTrainingSession(sessionId, {
    status: "in_progress",
  });

  try {
    // Execute iterations
    for (let i = session.currentProgress + 1; i <= session.iterations; i++) {
      // Check if session was paused
      const currentSession = await getTrainingSessionById(sessionId);
      if (currentSession?.status !== "in_progress") {
        console.log(`[Training Engine] Session ${sessionId} paused at iteration ${i}`);
        break;
      }

      await executeTrainingIteration(sessionId, i, targetApiKey, influencerApiKey);

      // Wait for retry interval (convert minutes to milliseconds)
      if (i < session.iterations) {
        const waitTime = session.retryInterval * 60 * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    // Check if completed
    const finalSession = await getTrainingSessionById(sessionId);
    if (finalSession?.currentProgress === finalSession?.iterations) {
      await updateTrainingSession(sessionId, {
        status: "completed",
        completedAt: new Date(),
      });
      console.log(`[Training Engine] Session ${sessionId} completed successfully`);
    }
  } catch (error: any) {
    console.error(`[Training Engine] Session ${sessionId} failed:`, error);
    await updateTrainingSession(sessionId, {
      status: "error",
      errorMessage: error.message || "Unknown error occurred",
    });
    throw error;
  }
}

/**
 * Start a training session in the background
 */
export function startTrainingSession(sessionId: number): void {
  // Execute in background without blocking
  executeTrainingSession(sessionId).catch((error) => {
    console.error(`[Training Engine] Background execution failed for session ${sessionId}:`, error);
  });
}
