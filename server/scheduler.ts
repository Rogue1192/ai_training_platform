/**
 * Scheduler Service
 * 
 * Handles automatic execution of scheduled training jobs.
 * Runs on a timer and checks for due jobs, then triggers training sessions.
 * 
 * Features:
 * - Exact date/time scheduling with timezone support
 * - Proper session reset before each re-run (clears all V2 fields)
 * - Run history logging for every execution
 * - Duplicate run protection (skips if session already in_progress)
 */

import { getDb } from "./db";
import {
  createScheduledJobRun,
  updateScheduledJobRun,
  getTrainingSessionById,
  updateTrainingSession,
} from "./db";
import { resolveModel } from "./aiProviders";
import { scheduledJobs, trainingSessions, trainingConversations, campaigns, users } from "../drizzle/schema";
import { eq, and, lte, isNull, lt, sql, desc } from "drizzle-orm";
import { startTrainingSession } from "./trainingEngine";
import { trainingQueueV2 } from "./trainingQueueV2";

// Scheduler interval in milliseconds (1 minute)
const SCHEDULER_INTERVAL = 60 * 1000;

// Staleness detection: dynamic per-session threshold based on retryInterval
// Floor: 30 minutes — even fast sessions get a grace period
// Ceiling: 24 hours — no session should be in_progress longer than this
// Formula: retryInterval (minutes) × 3, clamped to [30min, 24h]
const STALE_FLOOR_MS = 30 * 60 * 1000;       // 30 minutes
const STALE_CEILING_MS = 24 * 60 * 60 * 1000; // 24 hours

// Scheduled rank tracking cadence. runScheduledRankCheck records a fresh
// rankSnapshot (positions + mentions) per query-location and updates the
// currentRank* fields LLM Insights reads. Nothing scheduled it before, so no
// positions were ever tracked. Cadence is data-driven: a campaign is only
// re-checked if its most recent snapshot is older than the min gap, so app
// restarts / Railway redeploys don't trigger duplicate DataForSEO calls.
const RANK_TRACK_TICK_MS = 6 * 60 * 60 * 1000;      // re-evaluate every 6 hours
const RANK_TRACK_MIN_GAP_MS = 23 * 60 * 60 * 1000;  // but skip if checked within ~23h (≈ once/day)

let schedulerTimer: NodeJS.Timeout | null = null;

// Day name mapping for display
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Calculate the next run time based on schedule type and exact time settings.
 * All calculations respect the job's configured timezone.
 */
export function calculateNextRun(
  scheduleType: "hourly" | "daily" | "weekly" | "monthly" | "custom",
  options: {
    timeOfDay?: string;       // "HH:mm" format
    dayOfWeek?: number | null; // 0=Sun, 1=Mon, ..., 6=Sat
    dayOfMonth?: number | null; // 1-31
    timezone?: string;
    cronExpression?: string;
    fromDate?: Date;
  } = {}
): Date {
  const {
    timeOfDay = "09:00",
    dayOfWeek = null,
    dayOfMonth = null,
    timezone = "America/Los_Angeles",
    cronExpression,
    fromDate,
  } = options;

  const now = fromDate || new Date();
  const [hours, minutes] = timeOfDay.split(":").map(Number);

  // Get the current date/time in the target timezone
  const nowInTz = getDateInTimezone(now, timezone);

  switch (scheduleType) {
    case "hourly": {
      // Next occurrence at the top of the next hour (or specified minutes past)
      const [, minutesPast] = timeOfDay.split(":").map(Number);
      const minuteMark = minutesPast || 0;
      const nextHour = new Date(now);
      nextHour.setMinutes(minuteMark, 0, 0);
      if (nextHour <= now) {
        nextHour.setTime(nextHour.getTime() + 60 * 60 * 1000);
      }
      return nextHour;
    }

    case "daily": {
      // Next occurrence of HH:mm in the target timezone
      let next = setTimeInTimezone(now, hours, minutes, timezone);
      if (next <= now) {
        // Move to tomorrow
        next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
      }
      return next;
    }

    case "weekly": {
      const targetDay = dayOfWeek ?? 1; // Default Monday
      let next = setTimeInTimezone(now, hours, minutes, timezone);
      const currentDay = getDayOfWeekInTimezone(now, timezone);
      
      let daysUntilTarget = targetDay - currentDay;
      if (daysUntilTarget < 0) {
        daysUntilTarget += 7;
      }
      if (daysUntilTarget === 0 && next <= now) {
        daysUntilTarget = 7;
      }
      
      next = new Date(next.getTime() + daysUntilTarget * 24 * 60 * 60 * 1000);
      return next;
    }

    case "monthly": {
      const targetDay = dayOfMonth ?? 1; // Default 1st
      
      // Helper: clamp day to the last valid day of a given month
      const clampDay = (year: number, month: number, day: number): number => {
        // month is 0-indexed (JS Date convention)
        const lastDay = new Date(year, month + 1, 0).getDate(); // last day of month
        return Math.min(day, lastDay);
      };
      
      const currentDayOfMonth = getDayOfMonthInTimezone(now, timezone);
      
      // Try current month first
      const nowYear = now.getFullYear();
      const nowMonth = now.getMonth();
      const clampedThisMonth = clampDay(nowYear, nowMonth, targetDay);
      
      let next = setTimeInTimezone(now, hours, minutes, timezone);
      
      if (currentDayOfMonth < clampedThisMonth || (currentDayOfMonth === clampedThisMonth && next > now)) {
        // Still this month
        const daysToAdd = clampedThisMonth - currentDayOfMonth;
        next = new Date(next.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      } else {
        // Next month — clamp to that month's last day
        const nextMonthDate = new Date(nowYear, nowMonth + 1, 1);
        const clampedNextMonth = clampDay(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), targetDay);
        next = setTimeInTimezone(nextMonthDate, hours, minutes, timezone);
        const daysToAdd = clampedNextMonth - 1;
        next = new Date(next.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      }
      return next;
    }

    case "custom": {
      if (cronExpression) {
        const nextFromCron = parseSimpleCron(cronExpression, now);
        if (nextFromCron) return nextFromCron;
      }
      // Fallback to daily if no valid cron expression
      console.warn(`[Scheduler] Custom cron expression "${cronExpression}" could not be parsed, falling back to daily at ${timeOfDay}`);
      let next = setTimeInTimezone(now, hours, minutes, timezone);
      if (next <= now) {
        next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
      }
      return next;
    }
  }
}

/**
 * Get the current time components in a specific timezone
 */
function getDateInTimezone(date: Date, timezone: string): { hours: number; minutes: number; day: number; date: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    day: "numeric",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hourPart = parts.find(p => p.type === "hour");
  const minutePart = parts.find(p => p.type === "minute");
  const dayPart = parts.find(p => p.type === "day");
  
  return {
    hours: parseInt(hourPart?.value || "0"),
    minutes: parseInt(minutePart?.value || "0"),
    day: date.getDay(), // We'll use a different approach for day of week
    date: parseInt(dayPart?.value || "1"),
  };
}

function getDayOfWeekInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
  });
  const dayName = formatter.format(date);
  const dayMap: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3,
    Thursday: 4, Friday: 5, Saturday: 6,
  };
  return dayMap[dayName] ?? 0;
}

function getDayOfMonthInTimezone(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    day: "numeric",
  });
  return parseInt(formatter.format(date));
}

/**
 * Set a specific time (hours:minutes) in a timezone, returning a UTC Date
 */
function setTimeInTimezone(baseDate: Date, hours: number, minutes: number, timezone: string): Date {
  // Get the date string in the target timezone
  const dateFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const dateStr = dateFormatter.format(baseDate); // "YYYY-MM-DD"
  
  // Construct a datetime string in the target timezone
  const timeStr = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  const dateTimeStr = `${dateStr}T${timeStr}`;
  
  // Use Intl to figure out the UTC offset for this timezone at this time
  // Create a date assuming UTC, then adjust
  const tempDate = new Date(`${dateTimeStr}Z`); // Treat as UTC first
  
  // Get the offset by comparing formatted time with UTC
  const utcFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const tzFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  
  // Use a reference point to calculate offset
  const refDate = new Date(`${dateStr}T12:00:00Z`);
  const utcParts = utcFormatter.formatToParts(refDate);
  const tzParts = tzFormatter.formatToParts(refDate);
  
  const utcHour = parseInt(utcParts.find(p => p.type === "hour")?.value || "12");
  const utcMin = parseInt(utcParts.find(p => p.type === "minute")?.value || "0");
  const tzHour = parseInt(tzParts.find(p => p.type === "hour")?.value || "12");
  const tzMin = parseInt(tzParts.find(p => p.type === "minute")?.value || "0");
  
  const offsetMinutes = (tzHour * 60 + tzMin) - (utcHour * 60 + utcMin);
  
  // The target UTC time = local time - offset
  const targetUTC = new Date(`${dateTimeStr}Z`);
  targetUTC.setMinutes(targetUTC.getMinutes() - offsetMinutes);
  
  return targetUTC;
}

/**
 * Parse a simple cron expression and return the next run time
 */
function parseSimpleCron(cronExpression: string, fromDate: Date): Date | null {
  try {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length < 5) return null;

    const [minute, hour] = parts;
    const next = new Date(fromDate);
    next.setSeconds(0);
    next.setMilliseconds(0);

    if (hour !== "*" && minute !== "*") {
      const targetHour = parseInt(hour, 10);
      const targetMinute = parseInt(minute, 10);

      if (!isNaN(targetHour) && !isNaN(targetMinute)) {
        next.setHours(targetHour, targetMinute, 0, 0);
        if (next <= fromDate) {
          next.setDate(next.getDate() + 1);
        }
        return next;
      }
    }

    next.setDate(next.getDate() + 1);
    return next;
  } catch {
    return null;
  }
}

/**
 * Get human-readable description of the schedule
 */
export function getScheduleDescription(job: {
  scheduleType: string;
  timeOfDay: string;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  timezone: string;
}): string {
  const time12h = formatTime12h(job.timeOfDay);
  
  switch (job.scheduleType) {
    case "hourly": {
      const [, mins] = job.timeOfDay.split(":").map(Number);
      if (mins > 0) {
        return `Every hour at :${String(mins).padStart(2, "0")} past (${job.timezone})`;
      }
      return `Every hour on the hour (${job.timezone})`;
    }
    case "daily":
      return `Every day at ${time12h} (${job.timezone})`;
    case "weekly":
      const dayName = DAY_NAMES[job.dayOfWeek ?? 1];
      return `Every ${dayName} at ${time12h} (${job.timezone})`;
    case "monthly":
      const day = job.dayOfMonth ?? 1;
      const suffix = getOrdinalSuffix(day);
      return `${day}${suffix} of every month at ${time12h} (${job.timezone})`;
    case "custom":
      return `Custom schedule at ${time12h} (${job.timezone})`;
    default:
      return "Unknown schedule";
  }
}

function formatTime12h(timeOfDay: string): string {
  const [h, m] = timeOfDay.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`;
}

function getOrdinalSuffix(n: number): string {
  if (n >= 11 && n <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

/**
 * Fully reset a training session for re-run.
 * Clears all V2 phase fields, progress, and old conversations.
 */
async function resetTrainingSessionForRerun(sessionId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Delete old conversations from previous runs
  await db.delete(trainingConversations)
    .where(eq(trainingConversations.trainingSessionId, sessionId));

  // Reset all session fields to initial state
  await db.update(trainingSessions).set({
    status: "paused",
    currentProgress: 0,
    trainingPhase: "pending",
    baselineMentioned: null,
    evaluationMentioned: null,
    influenceScore: null,
    trainingIterationsCompleted: 0,
    errorMessage: null,
    completedAt: null,
    updatedAt: new Date(),
  }).where(eq(trainingSessions.id, sessionId));

  console.log(`[Scheduler] Reset session ${sessionId} for re-run (cleared conversations and all phase data)`);
}

/**
 * Calculate the dynamic stale threshold for a session based on its retryInterval.
 * Formula: retryInterval (minutes) × 3, clamped between 30 min and 24 hours.
 * Exported for testing.
 */
export function getStaleThresholdMs(retryIntervalMinutes: number): number {
  const dynamicMs = retryIntervalMinutes * 3 * 60 * 1000;
  return Math.max(STALE_FLOOR_MS, Math.min(dynamicMs, STALE_CEILING_MS));
}

/**
 * Detect and recover stale training sessions that have been in_progress for too long.
 * Uses a dynamic per-session threshold based on each session's retryInterval so that
 * long-running sessions with large retry intervals are not prematurely killed.
 */
async function detectAndRecoverStaleSessions(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // Fetch ALL in_progress sessions — we'll evaluate staleness individually
    const inProgressSessions = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.status, "in_progress"));

    let recoveredCount = 0;

    for (const session of inProgressSessions) {
      const timeSinceUpdate = Date.now() - new Date(session.updatedAt).getTime();
      const thresholdMs = getStaleThresholdMs(session.retryInterval);

      if (timeSinceUpdate < thresholdMs) {
        // Session is still within its expected window — skip
        continue;
      }

      const runningHours = (timeSinceUpdate / (1000 * 60 * 60)).toFixed(1);
      const thresholdMin = Math.round(thresholdMs / (60 * 1000));
      
      console.warn(
        `[Scheduler] Stale session detected: ID ${session.id} ` +
        `has had no progress for ${runningHours} hours ` +
        `(threshold: ${thresholdMin} min based on ${session.retryInterval}-min retry interval, ` +
        `last updated: ${session.updatedAt})`
      );
      
      // Mark as error so the scheduler can re-run it or the user can restart
      await db.update(trainingSessions).set({
        status: "error",
        errorMessage:
          `Session had no progress for ${runningHours} hours ` +
          `(expected update every ${session.retryInterval} min). ` +
          `Automatically marked as stale. You can restart it manually or wait for the next scheduled run.`,
        updatedAt: new Date(),
      }).where(eq(trainingSessions.id, session.id));
      
      console.log(`[Scheduler] Marked session ${session.id} as error (stale recovery)`);
      recoveredCount++;
    }

    if (recoveredCount > 0) {
      console.log(`[Scheduler] Recovered ${recoveredCount} stale session(s)`);
    }
  } catch (error) {
    console.error("[Scheduler] Error detecting stale sessions:", error);
  }
}

/**
 * Recover stuck in_progress sessions where BullMQ delayed jobs were lost.
 * Checks for sessions that are in_progress but haven't had a new conversation
 * in retryInterval × 1.5 minutes. If found, re-queues the next iteration.
 * This runs BEFORE the staleness detector so we can rescue sessions before they're killed.
 */
async function recoverStuckSessions(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const inProgressSessions = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.status, "in_progress"));

    for (const session of inProgressSessions) {
      // Skip sessions that are in baseline or evaluation phase (no retry interval applies)
      if (session.trainingPhase !== "training") continue;

      // Check the latest conversation for this session
      const latestConvos = await db
        .select()
        .from(trainingConversations)
        .where(eq(trainingConversations.trainingSessionId, session.id))
        .orderBy(desc(trainingConversations.createdAt))
        .limit(1);

      if (latestConvos.length === 0) continue;

      const latestConvo = latestConvos[0];
      const timeSinceLastConvo = Date.now() - new Date(latestConvo.createdAt).getTime();
      const recoveryThresholdMs = session.retryInterval * 1.5 * 60 * 1000; // retryInterval × 1.5

      if (timeSinceLastConvo < recoveryThresholdMs) {
        // Session had a recent conversation — it's fine, delayed job is probably pending
        continue;
      }

      // Session is stuck — the delayed job was lost
      // Figure out which iteration to re-queue
      const nextIteration = latestConvo.iterationNumber + 1;

      // Don't re-queue if we've already completed all iterations
      if (nextIteration > session.iterations) {
        // Should be in evaluation phase — re-queue evaluation
        console.log(
          `[Scheduler] Session ${session.id} stuck after all iterations, re-queuing evaluation`
        );
        await trainingQueueV2.add("phase-job", {
          sessionId: session.id,
          userId: session.userId ?? 0,
          phase: "evaluation",
        }, {
          delay: 2000,
        });
      } else {
        const minutesSinceConvo = Math.round(timeSinceLastConvo / (60 * 1000));
        console.log(
          `[Scheduler] Recovering stuck session ${session.id}: ` +
          `last conversation was iter ${latestConvo.iterationNumber} ` +
          `${minutesSinceConvo} min ago (threshold: ${Math.round(recoveryThresholdMs / 60000)} min). ` +
          `Re-queuing iteration ${nextIteration}`
        );

        await trainingQueueV2.add("phase-job", {
          sessionId: session.id,
          userId: session.userId ?? 0,
          phase: "training",
          iterationNumber: nextIteration,
        }, {
          delay: 2000, // Small delay to avoid race conditions
        });
      }

      // Update the session's updatedAt so the staleness detector doesn't kill it
      await db.update(trainingSessions).set({
        updatedAt: new Date(),
      }).where(eq(trainingSessions.id, session.id));

      console.log(`[Scheduler] Re-queued session ${session.id} and refreshed updatedAt`);
    }
  } catch (error) {
    console.error("[Scheduler] Error recovering stuck sessions:", error);
  }
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

  // First, try to recover any stuck sessions (re-queue lost delayed jobs)
  await recoverStuckSessions();

  // Then, detect and mark truly stale sessions
  await detectAndRecoverStaleSessions();

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
        await executeScheduledJob(job, "scheduler");
      } catch (error) {
        console.error(`[Scheduler] Error executing job ${job.id}:`, error);
      }
    }
  } catch (error) {
    console.error("[Scheduler] Error processing due jobs:", error);
  }
}

/**
 * Execute a single scheduled job with full history tracking
 */
async function executeScheduledJob(
  job: typeof scheduledJobs.$inferSelect,
  triggeredBy: "scheduler" | "manual" = "scheduler"
): Promise<{ success: boolean; error?: string; runId?: number }> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not available" };

  console.log(`[Scheduler] Executing job: ${job.jobName} (ID: ${job.id}) [${triggeredBy}]`);

  if (!job.trainingSessionId) {
    console.log(`[Scheduler] Job ${job.id} has no training session linked, skipping`);
    return { success: false, error: "No training session linked" };
  }

  // Get the training session
  const session = await getTrainingSessionById(job.trainingSessionId);
  if (!session) {
    console.log(`[Scheduler] Training session ${job.trainingSessionId} not found for job ${job.id}`);
    return { success: false, error: "Training session not found" };
  }

  // Duplicate run protection: skip if session is already in_progress
  if (session.status === "in_progress") {
    console.log(`[Scheduler] Session ${session.id} is already in_progress, skipping (duplicate protection)`);
    
    // Log as skipped
    const run = await createScheduledJobRun({
      scheduledJobId: job.id,
      trainingSessionId: session.id,
      status: "skipped",
      triggeredBy,
      errorMessage: "Training session is already running",
      completedAt: new Date(),
    });

    // Still calculate next run so we don't keep hitting this
    const nextRun = calculateNextRun(
      job.scheduleType as "daily" | "weekly" | "monthly" | "custom",
      {
        timeOfDay: job.timeOfDay,
        dayOfWeek: job.dayOfWeek,
        dayOfMonth: job.dayOfMonth,
        timezone: job.timezone,
      }
    );
    await db.update(scheduledJobs).set({ nextRun }).where(eq(scheduledJobs.id, job.id));

    return { success: false, error: "Session already running", runId: run.id };
  }

  // Create run history record
  const run = await createScheduledJobRun({
    scheduledJobId: job.id,
    trainingSessionId: session.id,
    status: "running",
    triggeredBy,
  });

  try {
    // Auto-migrate deprecated model names before resetting
    const resolvedTarget = resolveModel(session.targetAiModel);
    const resolvedInfluencer = resolveModel(session.influencerAiModel);
    const modelUpdates: Record<string, string> = {};
    if (resolvedTarget !== session.targetAiModel) {
      modelUpdates.targetAiModel = resolvedTarget;
      console.log(`[Scheduler] Auto-migrating target model: ${session.targetAiModel} → ${resolvedTarget}`);
    }
    if (resolvedInfluencer !== session.influencerAiModel) {
      modelUpdates.influencerAiModel = resolvedInfluencer;
      console.log(`[Scheduler] Auto-migrating influencer model: ${session.influencerAiModel} → ${resolvedInfluencer}`);
    }
    if (Object.keys(modelUpdates).length > 0) {
      await updateTrainingSession(session.id, modelUpdates);
    }

    // Fully reset the training session
    await resetTrainingSessionForRerun(session.id);

    // Start the training session
    await startTrainingSession(session.id, session.userId);

    // Calculate next run time
    const nextRun = calculateNextRun(
      job.scheduleType as "daily" | "weekly" | "monthly" | "custom",
      {
        timeOfDay: job.timeOfDay,
        dayOfWeek: job.dayOfWeek,
        dayOfMonth: job.dayOfMonth,
        timezone: job.timezone,
      }
    );

    // Update job with lastRun, nextRun, and increment runCount
    await db.update(scheduledJobs).set({
      lastRun: new Date(),
      nextRun,
      runCount: sql`${scheduledJobs.runCount} + 1`,
      updatedAt: new Date(),
    }).where(eq(scheduledJobs.id, job.id));

    // Update run record (training is now in_progress, we'll update to completed when session finishes)
    // For now mark as "running" - a separate process can update this when the session completes
    await updateScheduledJobRun(run.id, {
      status: "completed", // The session was successfully started
    });

    console.log(`[Scheduler] Job ${job.id} executed successfully. Next run: ${nextRun.toISOString()}`);
    return { success: true, runId: run.id };
  } catch (error: any) {
    console.error(`[Scheduler] Job ${job.id} failed:`, error.message);

    // Update run with error
    await updateScheduledJobRun(run.id, {
      status: "failed",
      completedAt: new Date(),
      errorMessage: error.message,
    });

    // Still calculate next run so the scheduler continues
    const nextRun = calculateNextRun(
      job.scheduleType as "daily" | "weekly" | "monthly" | "custom",
      {
        timeOfDay: job.timeOfDay,
        dayOfWeek: job.dayOfWeek,
        dayOfMonth: job.dayOfMonth,
        timezone: job.timezone,
      }
    );
    await db.update(scheduledJobs).set({ nextRun, updatedAt: new Date() }).where(eq(scheduledJobs.id, job.id));

    return { success: false, error: error.message, runId: run.id };
  }
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

  return executeScheduledJob(job, "manual");
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

  // Check for trial upgrades immediately on start
  import("./trialManager").then(({ checkAndUpgradeTrials }) => {
    checkAndUpgradeTrials().catch((err: Error) => console.error("[Scheduler] Trial upgrade check failed:", err));
  });

  // Then run on interval
  schedulerTimer = setInterval(() => {
    processDueJobs();
  }, SCHEDULER_INTERVAL);

  // Run trial upgrade check once per day (every 24 hours)
  setInterval(() => {
    import("./trialManager").then(({ checkAndUpgradeTrials }) => {
      checkAndUpgradeTrials().catch((err: Error) => console.error("[Scheduler] Daily trial upgrade check failed:", err));
    });
  }, 24 * 60 * 60 * 1000);

  // Auto-advance indexing_verification every 3 minutes — Monkey Indexer makes URLs
  // accessible almost immediately after submission, so we poll frequently and advance
  // to training as soon as 80%+ of URLs are reachable.
  checkPendingIndexingVerifications().catch((err: Error) => console.error("[Scheduler] Indexing verification check failed:", err));
  setInterval(() => {
    checkPendingIndexingVerifications().catch((err: Error) => console.error("[Scheduler] Indexing verification check failed:", err));
  }, 3 * 60 * 1000); // every 3 minutes

  // Check for campaigns ready for training kickoff — runs every 6 hours.
  // Catches any campaigns that slipped through the indexing_verification auto-advance.
  checkPendingTrainingKickoffs().catch((err: Error) => console.error("[Scheduler] Training kickoff check failed:", err));
  setInterval(() => {
    checkPendingTrainingKickoffs().catch((err: Error) => console.error("[Scheduler] Training kickoff check failed:", err));
  }, 6 * 60 * 60 * 1000);

  // Advance training cycles every hour:
  // - Fires 24h LLM polls after each run, advances to next run, detects wins
  // - Handles weekly monitoring polls and recovery runs
  checkTrainingCycleAdvances().catch((err: Error) => console.error("[Scheduler] Training cycle advance failed:", err));
  setInterval(() => {
    checkTrainingCycleAdvances().catch((err: Error) => console.error("[Scheduler] Training cycle advance failed:", err));
  }, 60 * 60 * 1000); // every hour

  // Scheduled rank tracking — records positions/mentions per campaign ~daily.
  // Runs immediately on start so a newly-added campaign (e.g. Titan) gets a
  // baseline snapshot right away, then re-evaluates on a tick (the per-campaign
  // gap guard enforces the real once-a-day cadence).
  checkScheduledRankTracking().catch((err: Error) => console.error("[Scheduler] Rank tracking failed:", err));
  setInterval(() => {
    checkScheduledRankTracking().catch((err: Error) => console.error("[Scheduler] Rank tracking failed:", err));
  }, RANK_TRACK_TICK_MS);

  console.log("[Scheduler] Scheduler started successfully");
}

/**
 * Auto-advance campaigns stuck in indexing_verification.
 *
 * Monkey Indexer makes URLs accessible within minutes of submission.
 * This runs every 3 minutes and calls verifyCampaignIndexing for any campaign
 * that has submitted indexing but not yet verified it. Once 80%+ of URLs are
 * accessible, verifyCampaignIndexing sets indexingVerifiedAt and advances
 * the campaign status to training automatically.
 */
export async function checkPendingIndexingVerifications(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // Find campaigns that have submitted indexing but not yet verified AND haven't started training yet.
    // Critically: exclude campaigns that already have trainingStartedAt set — those are already
    // past this step and re-running would overwrite their rank data with a fresh baseline check.
    const pendingCampaigns = await db
      .select()
      .from(campaigns)
      .where(
        and(
          sql`${campaigns.indexingSubmittedAt} IS NOT NULL`,
          isNull(campaigns.indexingVerifiedAt),
          isNull(campaigns.trainingStartedAt)  // ← safety: never re-trigger for active campaigns
        )
      );

    if (pendingCampaigns.length === 0) return;

    const { verifyCampaignIndexing } = await import('./monkeyIndexer');
    const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    const ownerId = adminUsers[0]?.id ?? 0;

    for (const campaign of pendingCampaigns) {
      try {
        const result = await verifyCampaignIndexing(campaign.id);
        if (result.verified) {
          console.log(`[Scheduler] Indexing verified for campaign ${campaign.id} (${result.accessibleUrls}/${result.totalUrls} URLs accessible) — advancing pipeline`);
          const { runPipelineStep, determineNextStep } = await import('./pipelineOrchestrator');
          // Re-fetch campaign to get the latest state (verifyCampaignIndexing may have updated it)
          const { getCampaignById } = await import('./dbCampaigns');
          const freshCampaign = await getCampaignById(campaign.id);
          if (!freshCampaign) continue;
          // Use determineNextStep so we always run the correct next step, not hardcoded 'training'.
          // This respects the new pipeline order (baseline_check comes before credibility_research)
          // and won't re-run steps that are already completed.
          const nextStep = determineNextStep(freshCampaign);
          if (nextStep === 'indexing_verification') {
            // Still waiting — shouldn't happen but guard against infinite loop
            console.log(`[Scheduler] Campaign ${campaign.id} indexing verified but determineNextStep still returns indexing_verification — skipping`);
            continue;
          }
          const stepResult = await runPipelineStep(campaign.id, nextStep, ownerId);
          console.log(`[Scheduler] Pipeline step '${nextStep}' for campaign ${campaign.id}: ${stepResult.message}`);
        }
      } catch (err: any) {
        console.error(`[Scheduler] Indexing verification failed for campaign ${campaign.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[Scheduler] checkPendingIndexingVerifications error:', err.message);
  }
}

/**
 * Check for campaigns that are ready to begin training (safety net).
 *
 * Logic: indexingVerifiedAt is set but trainingStartedAt is null.
 * This is a fallback for campaigns that slipped through the 3-minute
 * indexing verification poller.
 *
 * Runs every 6 hours.
 */
export async function checkPendingTrainingKickoffs(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // Find campaigns where indexing is verified but training hasn't started
    const readyCampaigns = await db
      .select()
      .from(campaigns)
      .where(
        and(
          sql`${campaigns.indexingVerifiedAt} IS NOT NULL`,
          isNull(campaigns.trainingStartedAt)
        )
      );

    if (readyCampaigns.length === 0) return;

    console.log(`[Scheduler] Found ${readyCampaigns.length} campaign(s) ready for training kickoff (indexing verified, training not started)`);

    const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    const ownerId = adminUsers[0]?.id ?? 0;

    const { runPipelineStep } = await import('./pipelineOrchestrator');

    for (const campaign of readyCampaigns) {
      try {
        console.log(`[Scheduler] Kicking off training for campaign ${campaign.id} (indexing verified ${campaign.indexingVerifiedAt?.toISOString()})`);
        const result = await runPipelineStep(campaign.id, 'training', ownerId);
        console.log(`[Scheduler] Training kickoff for campaign ${campaign.id}: ${result.message}`);
      } catch (err: any) {
        console.error(`[Scheduler] Training kickoff failed for campaign ${campaign.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[Scheduler] checkPendingTrainingKickoffs error:', err.message);
  }
}

/**
 * Advance training cycles for all active campaigns.
 * Runs every hour. Processes any combos whose nextPollAt has elapsed:
 *   - Initial phase: runs LLM poll, detects wins, fires next run (up to 4)
 *   - Monitoring phase: weekly LLM poll, fires recovery run if dropped out
 */
async function checkTrainingCycleAdvances(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const { advanceCampaignCycle } = await import('./trainingCycleOrchestrator');
    const { campaignQueryLocations: cqlTable } = await import('../drizzle/schema');
    const { lte: lteOp, or: orOp, eq: eqOp } = await import('drizzle-orm');

    // Get admin user for system-triggered sessions
    const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    const systemUserId = adminUsers[0]?.id ?? 0;

    const now = new Date();

    // Find distinct campaignIds that have combos with a due poll
    const dueCombos = await db
      .selectDistinct({ campaignId: cqlTable.campaignId })
      .from(cqlTable)
      .where(
        and(
          lteOp(cqlTable.nextPollAt, now),
          orOp(
            eqOp(cqlTable.trainingStatus, 'training'),
            eqOp(cqlTable.trainingStatus, 'monitoring'),
            eqOp(cqlTable.trainingStatus, 'recovering'),
          ),
        ),
      );

    if (dueCombos.length === 0) return;

    console.log(`[Scheduler] Advancing training cycles for ${dueCombos.length} campaign(s)`);

    for (const { campaignId } of dueCombos) {
      try {
        const result = await advanceCampaignCycle(campaignId, systemUserId);
        if (result.combosPolled > 0 || result.runsStarted > 0) {
          console.log(
            `[Scheduler] Campaign ${campaignId}: polled=${result.combosPolled}, wins=${result.newWins}, ` +
            `runsStarted=${result.runsStarted}, enteredMonitoring=${result.combosEnteredMonitoring}, ` +
            `recoveryRuns=${result.recoveryRunsStarted}`
          );
        }
        if (result.errors.length > 0) {
          console.warn(`[Scheduler] Campaign ${campaignId} cycle errors:`, result.errors);
        }
      } catch (err: any) {
        console.error(`[Scheduler] Cycle advance failed for campaign ${campaignId}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[Scheduler] checkTrainingCycleAdvances error:', err.message);
  }
}

/**
 * Scheduled rank tracking.
 *
 * Records a fresh rank snapshot (per-platform mention + position) for every
 * campaign that has query-locations, roughly once per day. runScheduledRankCheck
 * writes rankSnapshots and updates currentRank* on each query-location — the data
 * LLM Insights and the campaign rank report read. The first run for a campaign
 * seeds a baseline (no wins are emailed on the first check — win detection needs a
 * prior snapshot to compare against).
 *
 * The per-campaign gap guard makes this idempotent across restarts/redeploys.
 */
async function checkScheduledRankTracking(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const { runScheduledRankCheck } = await import("./rankTrackingEngine");
    const { campaignQueryLocations: cqlTable, rankSnapshots: rsTable } = await import("../drizzle/schema");

    // Every campaign that has at least one query-location is a rank-tracking target.
    const targets = await db
      .selectDistinct({ campaignId: cqlTable.campaignId })
      .from(cqlTable);

    if (targets.length === 0) return;

    const now = Date.now();
    let checked = 0;

    for (const { campaignId } of targets) {
      if (campaignId == null) continue;
      try {
        // Data-driven guard: skip if we already have a recent snapshot for this
        // campaign, so restarts / redeploys don't re-run the DataForSEO check.
        const [last] = await db
          .select({ checkedAt: rsTable.checkedAt })
          .from(rsTable)
          .where(eq(rsTable.campaignId, campaignId))
          .orderBy(desc(rsTable.checkedAt))
          .limit(1);

        if (last && now - new Date(last.checkedAt).getTime() < RANK_TRACK_MIN_GAP_MS) {
          continue;
        }

        const result = await runScheduledRankCheck(campaignId);
        checked++;
        console.log(
          `[Scheduler] Rank check campaign ${campaignId}: ${result.snapshotsCreated} snapshot(s), ` +
          `${result.winsDetected.length} win(s), score ${result.currentScore.overall}/100`
        );
      } catch (err: any) {
        console.error(`[Scheduler] Rank check failed for campaign ${campaignId}:`, err.message);
      }
    }

    if (checked > 0) console.log(`[Scheduler] Scheduled rank tracking checked ${checked} campaign(s)`);
  } catch (err: any) {
    console.error("[Scheduler] checkScheduledRankTracking error:", err.message);
  }
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
