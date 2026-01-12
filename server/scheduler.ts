/**
 * Scheduler Service
 * 
 * Handles automatic execution of scheduled training jobs.
 * Runs on a timer and checks for due jobs, then triggers training sessions.
 */

import { getDb } from "./db";
import { scheduledJobs, trainingSessions } from "../drizzle/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { startTrainingSession } from "./trainingQueue";

// Scheduler interval in milliseconds (1 minute)
const SCHEDULER_INTERVAL = 60 * 1000;

let schedulerTimer: NodeJS.Timeout | null = null;

/**
 * Calculate the next run time based on schedule type
 */
export function calculateNextRun(
  scheduleType: "daily" | "weekly" | "monthly" | "custom",
  cronExpression?: string,
  fromDate?: Date
): Date {
  const now = fromDate || new Date();
  const next = new Date(now);

  switch (scheduleType) {
    case "daily":
      // Run at the same time tomorrow
      next.setDate(next.getDate() + 1);
      break;

    case "weekly":
      // Run at the same time next week
      next.setDate(next.getDate() + 7);
      break;

    case "monthly":
      // Run at the same time next month
      next.setMonth(next.getMonth() + 1);
      break;

    case "custom":
      if (cronExpression) {
        // Parse simple cron expression (minute hour day month weekday)
        // For now, support basic patterns
        const nextFromCron = parseSimpleCron(cronExpression, now);
        if (nextFromCron) {
          return nextFromCron;
        }
      }
      // Default to daily if cron parsing fails
      next.setDate(next.getDate() + 1);
      break;
  }

  return next;
}

/**
 * Parse a simple cron expression and return the next run time
 * Format: minute hour day month weekday (5 fields)
 * Supports: numbers, * (any), and basic patterns
 */
function parseSimpleCron(cronExpression: string, fromDate: Date): Date | null {
  try {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length < 5) return null;

    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const next = new Date(fromDate);
    next.setSeconds(0);
    next.setMilliseconds(0);

    // Simple implementation: if specific hour/minute given, use those
    // Otherwise default to same time tomorrow
    if (hour !== "*" && minute !== "*") {
      const targetHour = parseInt(hour, 10);
      const targetMinute = parseInt(minute, 10);

      if (!isNaN(targetHour) && !isNaN(targetMinute)) {
        next.setHours(targetHour, targetMinute, 0, 0);

        // If the time has passed today, move to tomorrow
        if (next <= fromDate) {
          next.setDate(next.getDate() + 1);
        }

        return next;
      }
    }

    // For complex patterns, default to next day
    next.setDate(next.getDate() + 1);
    return next;
  } catch {
    return null;
  }
}

/**
 * Get human-readable description of next run
 */
export function getNextRunDescription(nextRun: Date | null): string {
  if (!nextRun) return "Not scheduled";

  const now = new Date();
  const diff = nextRun.getTime() - now.getTime();

  if (diff < 0) return "Overdue";
  if (diff < 60 * 1000) return "In less than a minute";
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `In ${minutes} minute${minutes > 1 ? "s" : ""}`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `In ${hours} hour${hours > 1 ? "s" : ""}`;
  }

  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  return `In ${days} day${days > 1 ? "s" : ""}`;
}

/**
 * Process all due scheduled jobs
 */
async function processDueJobs(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.log("[Scheduler] Database not available, skipping job check");
    return;
  }

  const now = new Date();

  try {
    // Find all active jobs that are due (nextRun <= now)
    const dueJobs = await db
      .select()
      .from(scheduledJobs)
      .where(
        and(
          eq(scheduledJobs.isActive, true),
          lte(scheduledJobs.nextRun, now)
        )
      );

    if (dueJobs.length === 0) {
      return;
    }

    console.log(`[Scheduler] Found ${dueJobs.length} due job(s) to process`);

    for (const job of dueJobs) {
      try {
        await executeScheduledJob(job);
      } catch (error) {
        console.error(`[Scheduler] Error executing job ${job.id}:`, error);
      }
    }
  } catch (error) {
    console.error("[Scheduler] Error processing due jobs:", error);
  }
}

/**
 * Execute a single scheduled job
 */
async function executeScheduledJob(job: typeof scheduledJobs.$inferSelect): Promise<void> {
  const db = await getDb();
  if (!db) return;

  console.log(`[Scheduler] Executing job: ${job.jobName} (ID: ${job.id})`);

  if (!job.trainingSessionId) {
    console.log(`[Scheduler] Job ${job.id} has no training session linked, skipping`);
    return;
  }

  // Get the training session
  const sessions = await db
    .select()
    .from(trainingSessions)
    .where(eq(trainingSessions.id, job.trainingSessionId))
    .limit(1);

  const session = sessions[0];
  if (!session) {
    console.log(`[Scheduler] Training session ${job.trainingSessionId} not found for job ${job.id}`);
    return;
  }

  // Reset the training session to run again
  await db
    .update(trainingSessions)
    .set({
      status: "in_progress",
      currentProgress: 0,
    })
    .where(eq(trainingSessions.id, session.id));

  // Start the training session
  await startTrainingSession(session.id, session.userId);

  // Calculate next run time
  const nextRun = calculateNextRun(
    job.scheduleType as "daily" | "weekly" | "monthly" | "custom",
    job.cronExpression ?? undefined
  );

  // Update job with lastRun, nextRun, and increment runCount
  await db
    .update(scheduledJobs)
    .set({
      lastRun: new Date(),
      nextRun,
      runCount: sql`${scheduledJobs.runCount} + 1`,
    })
    .where(eq(scheduledJobs.id, job.id));

  console.log(`[Scheduler] Job ${job.id} executed successfully. Next run: ${nextRun.toISOString()}`);
}

/**
 * Manually trigger a scheduled job (Run Now)
 */
export async function runJobNow(jobId: number): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  const jobs = await db
    .select()
    .from(scheduledJobs)
    .where(eq(scheduledJobs.id, jobId))
    .limit(1);

  const job = jobs[0];
  if (!job) {
    return { success: false, error: "Job not found" };
  }

  try {
    await executeScheduledJob(job);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Start the scheduler
 */
export function startScheduler(): void {
  if (schedulerTimer) {
    console.log("[Scheduler] Scheduler already running");
    return;
  }

  console.log("[Scheduler] Starting scheduler service...");
  console.log(`[Scheduler] Checking for due jobs every ${SCHEDULER_INTERVAL / 1000} seconds`);

  // Run immediately on start
  processDueJobs();

  // Then run on interval
  schedulerTimer = setInterval(() => {
    processDueJobs();
  }, SCHEDULER_INTERVAL);

  console.log("[Scheduler] Scheduler started successfully");
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    console.log("[Scheduler] Scheduler stopped");
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerTimer !== null;
}
