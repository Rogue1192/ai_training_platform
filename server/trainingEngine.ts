/**
 * Training Engine - Routes to appropriate training system
 * 
 * V1 (Legacy): Original queue-based system with suggestive prompts
 * V2 (New): Phase-based system with baseline/training/evaluation
 * 
 * New sessions use V2 by default. Legacy sessions continue with V1.
 */

import { getTrainingSessionById } from "./db";
import { 
  startTrainingSession as startV1, 
  pauseTrainingSession as pauseV1, 
  getQueueStats as getQueueStatsV1 
} from "./trainingQueue";
import { 
  startTrainingSessionV2, 
  trainingQueueV2 
} from "./trainingQueueV2";

/**
 * Start a training session - routes to V2 for new sessions, V1 for legacy
 */
export async function startTrainingSession(sessionId: number, userId: number): Promise<void> {
  const session = await getTrainingSessionById(sessionId);
  if (!session) {
    throw new Error("Training session not found");
  }
  
  // Use V2 for new sessions (isLegacy = false), V1 for legacy sessions
  if (session.isLegacy) {
    console.log(`[Training Engine] Starting legacy session ${sessionId} with V1`);
    await startV1(sessionId, userId);
  } else {
    console.log(`[Training Engine] Starting session ${sessionId} with V2 (phase-based)`);
    await startTrainingSessionV2(sessionId, userId);
  }
}

/**
 * Pause a training session
 */
export async function pauseTrainingSession(sessionId: number): Promise<void> {
  // Pause in both queues to be safe
  await pauseV1(sessionId);
  
  // Also remove from V2 queue
  const jobs = await trainingQueueV2.getJobs(["waiting", "delayed"]);
  for (const job of jobs) {
    if (job.data.sessionId === sessionId) {
      await job.remove();
      console.log(`[Training Engine] Removed V2 job ${job.id} for session ${sessionId}`);
    }
  }
}

/**
 * Get combined queue statistics
 */
export async function getQueueStats() {
  const v1Stats = await getQueueStatsV1();
  
  const v2Waiting = await trainingQueueV2.getWaitingCount();
  const v2Active = await trainingQueueV2.getActiveCount();
  const v2Completed = await trainingQueueV2.getCompletedCount();
  const v2Failed = await trainingQueueV2.getFailedCount();
  const v2Delayed = await trainingQueueV2.getDelayedCount();
  
  return {
    v1: v1Stats,
    v2: {
      waiting: v2Waiting,
      active: v2Active,
      completed: v2Completed,
      failed: v2Failed,
      delayed: v2Delayed,
      total: v2Waiting + v2Active + v2Completed + v2Failed + v2Delayed,
    },
    total: v1Stats.total + v2Waiting + v2Active + v2Completed + v2Failed + v2Delayed,
  };
}
