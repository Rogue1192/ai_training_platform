/**
 * DEPRECATED: This file has been replaced by trainingQueue.ts
 * 
 * The new queue-based system provides:
 * - No memory leaks (jobs run in isolated workers)
 * - Persistence (jobs survive server restarts)
 * - Rate limiting (prevents API throttling)
 * - Retry logic (automatic retry on failures)
 * - Scalability (can run on multiple servers)
 * 
 * Import from trainingQueue.ts instead:
 * - startTrainingSession(sessionId, userId)
 * - pauseTrainingSession(sessionId)
 * - getQueueStats()
 */

export { startTrainingSession, pauseTrainingSession, getQueueStats } from "./trainingQueue";
