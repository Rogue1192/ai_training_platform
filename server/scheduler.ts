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
} from "./db";
import { scheduledJobs, trainingSessions, trainingConversations } from "../drizzle/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { startTrainingSession } from "./trainingEngine";

// Scheduler interval in milliseconds (1 minute)
const SCHEDULER_INTERVAL = 60 * 1000;

let schedulerTimer: NodeJS.Timeout | null = null;

// Day name mapping for display
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Calculate the next run time based on schedule type and exact time settings.
 * All calculations respect the job's configured timezone.
 */
export function calculateNextRun(
  scheduleType: "daily" | "weekly" | "monthly" | "custom",
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
      let next = setTimeInTimezone(now, hours, minutes, timezone);
      
      // Set to target day of current month
      const currentDayOfMonth = getDayOfMonthInTimezone(now, timezone);
      
      if (currentDayOfMonth < targetDay || (currentDayOfMonth === targetDay && next > now)) {
        // Still this month
        const daysToAdd = targetDay - currentDayOfMonth;
        next = new Date(next.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      } else {
        // Next month
        const nextMonth = new Date(now);
        nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
        nextMonth.setUTCDate(1);
        next = setTimeInTimezone(nextMonth, hours, minutes, timezone);
        const daysToAdd = targetDay - 1;
        next = new Date(next.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
      }
      return next;
    }

    case "custom": {
      if (cronExpression) {
        const nextFromCron = parseSimpleCron(cronExpression, now);
        if (nextFromCron) return nextFromCron;
      }
      // Fallback to daily
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
