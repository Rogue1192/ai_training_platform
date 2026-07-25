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
// V2 training system removed — all training runs through V3 (trainingWorkerV3)

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
const RANK_TRACK_MIN_GAP_MS = 7 * 24 * 60 * 60 * 1000; // post-sprint: once per 7 days

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
 * V2 stale session detector — DISABLED.
 * V2 training sessions are no longer supported. Stuck run recovery is handled
 * by detectAndRecoverStuckV3Runs() for V3 trainingDayRuns.
 */
async function detectAndRecoverStaleSessions(): Promise<void> {
  // V2 removed — no-op. V3 equivalent: detectAndRecoverStuckV3Runs()
}

/**
 * V2 stuck session re-queue — DISABLED.
 * V2 training sessions are no longer supported. Stuck run recovery is handled
 * by detectAndRecoverStuckV3Runs() for V3 trainingDayRuns.
 */
async function recoverStuckSessions(): Promise<void> {
  // V2 removed — no-op. V3 equivalent: detectAndRecoverStuckV3Runs()
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
    // V2 training sessions are no longer supported. All training runs through V3 (trainingWorkerV3).
    // Deactivate this scheduled job so it never fires again.
    throw new Error('V2 training sessions are no longer supported. This scheduled job has been deactivated. Training now runs automatically through the V3 sprint engine.');
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
        // If this is a V2 deprecation error, deactivate the job permanently
    if (error.message.includes('V2 training sessions are no longer supported')) {
      await db.update(scheduledJobs).set({ isActive: false, updatedAt: new Date() }).where(eq(scheduledJobs.id, job.id));
      console.log(`[Scheduler] Deactivated V2 scheduled job ${job.id} permanently`);
    } else {
      await db.update(scheduledJobs).set({ nextRun, updatedAt: new Date() }).where(eq(scheduledJobs.id, job.id));
    }
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

  // Auto-run keyword research for campaigns stuck in 'keyword_research' status.
  // Fires immediately on start and every 5 minutes — catches campaigns reset after
  // a query quality fix or created via createManual without approveQueryReview.
  checkPendingKeywordResearch().catch((err: Error) => console.error("[Scheduler] Keyword research check failed:", err));
  setInterval(() => {
    checkPendingKeywordResearch().catch((err: Error) => console.error("[Scheduler] Keyword research check failed:", err));
  }, 5 * 60 * 1000); // every 5 minutes

  // Auto-run baseline check for campaigns stuck in baseline_check status.
  // Fires immediately on start and every 5 minutes — catches any campaign where
  // the fire-and-forget runFullPipeline call from approveQueryReview failed.
  checkPendingBaselineChecks().catch((err: Error) => console.error("[Scheduler] Baseline check failed:", err));
  setInterval(() => {
    checkPendingBaselineChecks().catch((err: Error) => console.error("[Scheduler] Baseline check failed:", err));
  }, 5 * 60 * 1000); // every 5 minutes

  // Auto-advance previously-blocked publishing campaigns (llm.txt/schema now fixed)
  checkBlockedPublishingCampaigns().catch((err: Error) => console.error("[Scheduler] Blocked publishing check failed:", err));
  setInterval(() => {
    checkBlockedPublishingCampaigns().catch((err: Error) => console.error("[Scheduler] Blocked publishing check failed:", err));
  }, 10 * 60 * 1000); // every 10 minutes

  // Safety net: kick off training for campaigns where indexing was submitted
  // but training hasn't started yet (llm.txt + schema gate cleared).
  checkPendingTrainingKickoffs().catch((err: Error) => console.error("[Scheduler] Training kickoff check failed:", err));
  setInterval(() => {
    checkPendingTrainingKickoffs().catch((err: Error) => console.error("[Scheduler] Training kickoff check failed:", err));
  }, 10 * 60 * 1000); // every 10 minutes

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

  // Bi-weekly bonus query discovery scan — checks semantically adjacent untracked
  // queries to find new places the business is appearing organically.
  // Runs every 6 hours but the per-campaign gap guard enforces the real 14-day cadence.
  checkBonusQueryScans().catch((err: Error) => console.error("[Scheduler] Bonus query scan failed:", err));
  setInterval(() => {
    checkBonusQueryScans().catch((err: Error) => console.error("[Scheduler] Bonus query scan failed:", err));
  }, 6 * 60 * 60 * 1000); // re-evaluate every 6 hours

  // Agency self-publishing reminder emails — checks once per day for campaigns
  // stuck in 'publishing' status for 3 or 7 days without all URLs submitted.
  checkPublishingReminders().catch((err: Error) => console.error("[Scheduler] Publishing reminder check failed:", err));
  setInterval(() => {
    checkPublishingReminders().catch((err: Error) => console.error("[Scheduler] Publishing reminder check failed:", err));
  }, 24 * 60 * 60 * 1000); // once per day

  // Stuck prospect audit cleanup — runs every 5 minutes.
  // Any audit stuck in 'running' for > 10 minutes is marked failed so the UI
  // doesn't show an indefinite spinner.
  cleanupStuckProspectAudits().catch((err: Error) => console.error("[Scheduler] Stuck audit cleanup failed:", err));
  setInterval(() => {
    cleanupStuckProspectAudits().catch((err: Error) => console.error("[Scheduler] Stuck audit cleanup failed:", err));
  }, 5 * 60 * 1000); // every 5 minutes

  // V3 Training Engine — sprint and maintenance day runs.
  // Checks every 30 minutes for pending training day runs scheduled for today.
  checkV3SprintRuns().catch((err: Error) => console.error("[SchedulerV3] Sprint run check failed:", err));
  setInterval(() => {
    checkV3SprintRuns().catch((err: Error) => console.error("[SchedulerV3] Sprint run check failed:", err));
  }, 30 * 60 * 1000); // every 30 minutes
  // V3 Stuck run recovery — resets any day runs stuck in 'running' for >2h back to 'pending'.
  detectAndRecoverStuckV3Runs().catch((err: Error) => console.error("[SchedulerV3] Stuck run recovery failed:", err));
  setInterval(() => {
    detectAndRecoverStuckV3Runs().catch((err: Error) => console.error("[SchedulerV3] Stuck run recovery failed:", err));
  }, 30 * 60 * 1000); // every 30 minutes

  // V3 Weekly maintenance — creates new maintenance run records once per day.
  checkV3WeeklyMaintenance().catch((err: Error) => console.error("[SchedulerV3] Weekly maintenance check failed:", err));
  setInterval(() => {
    checkV3WeeklyMaintenance().catch((err: Error) => console.error("[SchedulerV3] Weekly maintenance check failed:", err));
  }, 24 * 60 * 60 * 1000); // once per day

  console.log("[Scheduler] Scheduler started successfully");
}

// ─── Baseline Check Auto-Runner ─────────────────────────────────────────────
/**
 * checkPendingBaselineChecks
 *
 * Finds any campaign in `baseline_check` status where `baselineCheckCompletedAt`
 * is NULL and runs the baseline check pipeline step automatically.
 *
 * This is the safety net for the fire-and-forget `runFullPipeline` call that
 * fires from `approveQueryReview`. If that call fails (API error, timeout, etc.)
 * the campaign stays stuck in `baseline_check` forever without this poller.
 *
 * Runs every 5 minutes. Idempotent — the pipeline step itself guards against
 * re-running if `baselineCheckCompletedAt` is already set.
 */
export async function checkPendingBaselineChecks(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const { campaigns: cTable } = await import('../drizzle/schema');
    const { eq, and, isNull, isNotNull } = await import('drizzle-orm');

    // Case 1: Baseline hasn't run yet — run it now
    const needsBaseline = await db
      .select()
      .from(cTable)
      .where(
        and(
          eq(cTable.status, 'baseline_check'),
          isNull(cTable.baselineCheckCompletedAt)
        )
      );

    // Case 2: Baseline completed but pipeline stalled — advance to credibility_research
    const baselineDoneStuck = await db
      .select()
      .from(cTable)
      .where(
        and(
          eq(cTable.status, 'baseline_check'),
          isNotNull(cTable.baselineCheckCompletedAt)
        )
      );

    if (needsBaseline.length === 0 && baselineDoneStuck.length === 0) return;

    const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    const ownerId = adminUsers[0]?.id ?? 0;

    const { runPipelineStep, runFullPipeline } = await import('./pipelineOrchestrator');

    // Run baseline for campaigns that haven't had it yet
    if (needsBaseline.length > 0) {
      console.log(`[Scheduler] Found ${needsBaseline.length} campaign(s) pending baseline check — running now`);
      for (const campaign of needsBaseline) {
        try {
          console.log(`[Scheduler] Running baseline check for campaign ${campaign.id}`);
          const result = await runPipelineStep(campaign.id, 'baseline_check', ownerId);
          console.log(`[Scheduler] Baseline check for campaign ${campaign.id}: ${result.message}`);
          // After baseline completes, continue the pipeline (credibility_research → content_generation → ...)
          if (result.success) {
            console.log(`[Scheduler] Baseline done for campaign ${campaign.id} — continuing pipeline`);
            runFullPipeline(campaign.id, ownerId).catch((err: any) =>
              console.error(`[Scheduler] Post-baseline pipeline error for campaign ${campaign.id}:`, err.message)
            );
          }
        } catch (err: any) {
          console.error(`[Scheduler] Baseline check failed for campaign ${campaign.id}:`, err.message);
        }
      }
    }

    // Advance campaigns where baseline is done but status hasn't moved
    if (baselineDoneStuck.length > 0) {
      console.log(`[Scheduler] Found ${baselineDoneStuck.length} campaign(s) with baseline complete but stuck in baseline_check — advancing pipeline`);
      for (const campaign of baselineDoneStuck) {
        try {
          console.log(`[Scheduler] Advancing post-baseline pipeline for campaign ${campaign.id}`);
          runFullPipeline(campaign.id, ownerId).catch((err: any) =>
            console.error(`[Scheduler] Post-baseline pipeline error for campaign ${campaign.id}:`, err.message)
          );
        } catch (err: any) {
          console.error(`[Scheduler] Post-baseline advance failed for campaign ${campaign.id}:`, err.message);
        }
      }
    }
  } catch (err: any) {
    console.error('[Scheduler] checkPendingBaselineChecks error:', err.message);
  }
}

/**
 * Auto-run keyword research for campaigns stuck in 'keyword_research' status.
 *
 * Safety net for campaigns that were reset to keyword_research (e.g. after a
 * query quality fix) or created via createManual without going through the normal
 * approveQueryReview flow. Without this poller they sit at the Keywords badge
 * forever because nothing else triggers keyword research automatically.
 *
 * Runs every 5 minutes. Idempotent — the pipeline step guards against re-running
 * if keywordResearchCompletedAt is already set.
 */
export async function checkPendingKeywordResearch(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const { campaigns: cTable } = await import('../drizzle/schema');
    const { eq, and, isNull } = await import('drizzle-orm');
    const pending = await db
      .select()
      .from(cTable)
      .where(
        and(
          eq(cTable.status, 'keyword_research'),
          isNull(cTable.keywordResearchCompletedAt)
        )
      )
      .limit(5); // process at most 5 at a time to avoid overloading DataForSEO
    if (pending.length === 0) return;
    console.log(`[Scheduler] Found ${pending.length} campaign(s) pending keyword research — running now`);
    const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    const ownerId = adminUsers[0]?.id ?? 0;
    const { runPipelineStep, runFullPipeline } = await import('./pipelineOrchestrator');
    for (const campaign of pending) {
      try {
        console.log(`[Scheduler] Running keyword research for campaign ${campaign.id}`);
        const result = await runPipelineStep(campaign.id, 'keyword_research', ownerId);
        console.log(`[Scheduler] Keyword research for campaign ${campaign.id}: ${result.message}`);
        if (result.success) {
          console.log(`[Scheduler] Keyword research done for campaign ${campaign.id} — continuing pipeline`);
          runFullPipeline(campaign.id, ownerId).catch((err: any) =>
            console.error(`[Scheduler] Post-keyword pipeline error for campaign ${campaign.id}:`, err.message)
          );
        }
      } catch (err: any) {
        console.error(`[Scheduler] Keyword research failed for campaign ${campaign.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[Scheduler] checkPendingKeywordResearch error:', err.message);
  }
}

/**
 * Auto-advance campaigns that are stuck in 'publishing' status because they were
 * previously blocked by a missing llm.txt or schema, but those issues have since
 * been fixed.
 *
 * Scenario: admin submits all content URLs → auto-indexing fires → gate fails
 * (llm.txt/schema not yet live) → campaign stays in 'publishing'. Later the
 * agency adds llm.txt and schema and verifies them in the UI. Without this
 * poller the campaign would be stuck forever because the URL-submission trigger
 * already fired and won't fire again.
 *
 * Runs every 10 minutes. Only picks up campaigns where:
 *  - status = 'publishing'
 *  - publishingCompletedAt IS NOT NULL (all URLs are in)
 *  - indexingSubmittedAt IS NULL (indexing hasn't started yet)
 *  - llmTxtVerified = true AND schemaVerified = true (gate is now clear)
 */
export async function checkBlockedPublishingCampaigns(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const { campaigns } = await import('../drizzle/schema');
    const { eq, and, isNull, isNotNull } = await import('drizzle-orm');

    // Pick up campaigns where all URLs are in (publishingCompletedAt set) but
    // indexing hasn't been submitted yet. llm.txt and schema are NOT required
    // here — they can arrive before or after URL submission.
    const blocked = await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.status, 'publishing'),
          isNotNull(campaigns.publishingCompletedAt),
          isNull(campaigns.indexingSubmittedAt)
        )
      );

    if (blocked.length === 0) return;

    console.log(`[Scheduler] Found ${blocked.length} previously-blocked publishing campaign(s) now gate-clear — advancing to indexing`);

    const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    const ownerId = adminUsers[0]?.id ?? 0;
    const { runPipelineStep } = await import('./pipelineOrchestrator');

    for (const campaign of blocked) {
      try {
        const result = await runPipelineStep(campaign.id, 'indexing', ownerId);
        console.log(`[Scheduler] Auto-advanced campaign ${campaign.id} to indexing: ${result.message}`);
      } catch (err: any) {
        console.error(`[Scheduler] Auto-advance to indexing failed for campaign ${campaign.id}:`, err.message);
      }
    }
  } catch (err: any) {
    console.error('[Scheduler] checkBlockedPublishingCampaigns error:', err.message);
  }
}

/**
 * Check for campaigns that are ready to begin training (safety net).
 *
 * Logic: indexingSubmittedAt is set, llm.txt + schema are verified,
 * but trainingStartedAt is null. The enforcePublishingGate inside the
 * training pipeline step handles the llm.txt/schema check — this job
 * just ensures no campaign gets permanently stuck after indexing.
 *
 * Runs every 10 minutes.
 */
export async function checkPendingTrainingKickoffs(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    // Find campaigns where indexing has been submitted but training hasn't started
    const readyCampaigns = await db
      .select()
      .from(campaigns)
      .where(
        and(
          sql`${campaigns.indexingSubmittedAt} IS NOT NULL`,
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
        console.log(`[Scheduler] Kicking off training for campaign ${campaign.id} (indexing submitted ${campaign.indexingSubmittedAt?.toISOString()})`);
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
    const { campaignQueryLocations: cqlTable, campaigns: campaignsTable, businesses: businessesTable, contentPages: contentPagesTable } = await import('../drizzle/schema');
    const { lte: lteOp, or: orOp, eq: eqOp, ne: neOp, and: andOp, notInArray: notInArrayOp, isNull: isNullOp, notExists: notExistsOp } = await import('drizzle-orm');

    // Page types that do NOT require a publishedUrl (verified by scan instead)
    const NO_URL_REQUIRED_TYPES = ['llm_txt', 'schema_package', 'schema_audit', 'schema_delivery'];

    // Get admin user for system-triggered sessions
    const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
    const systemUserId = adminUsers[0]?.id ?? 0;

    const now = new Date();

    // Find distinct campaignIds that have combos with a due poll.
    // Join to campaigns + businesses to exclude archived clients — archiving a business
    // must immediately stop all training cycles.
    const dueCombos = await db
      .selectDistinct({ campaignId: cqlTable.campaignId })
      .from(cqlTable)
      .innerJoin(campaignsTable, eqOp(cqlTable.campaignId, campaignsTable.id))
      .innerJoin(businessesTable, eqOp(campaignsTable.businessId, businessesTable.id))
      .where(
        and(
          lteOp(cqlTable.nextPollAt, now),
          orOp(
            eqOp(cqlTable.trainingStatus, 'training'),
            eqOp(cqlTable.trainingStatus, 'monitoring'),
            eqOp(cqlTable.trainingStatus, 'recovering'),
          ),
          eqOp(businessesTable.isArchived, false),  // skip archived clients
          neOp(campaignsTable.status, 'paused'),     // skip manually paused campaigns
          eqOp(campaignsTable.llmTxtVerified, true), // HARD GATE: llm.txt must be verified before any training runs
          eqOp(campaignsTable.schemaVerified, true), // HARD GATE: schema must be verified before any training runs
          // HARD GATE: all credibility content pages must have a publishedUrl
          notExistsOp(
            db.select({ id: contentPagesTable.id })
              .from(contentPagesTable)
              .where(
                andOp(
                  eqOp(contentPagesTable.campaignId, campaignsTable.id),
                  notInArrayOp(contentPagesTable.pageType, NO_URL_REQUIRED_TYPES),
                  isNullOp(contentPagesTable.publishedUrl),
                )
              )
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
    const { campaignQueryLocations: cqlTable, rankSnapshots: rsTable, campaigns: campaignsTable, businesses: businessesTable, contentPages: contentPagesTableRank } = await import("../drizzle/schema");
    const { eq: eqRank, and: andRank, inArray: inArrayRank, or: orRank, ne: neRank, notInArray: notInArrayRank, isNull: isNullRank, notExists: notExistsRank } = await import('drizzle-orm');

    // Page types that do NOT require a publishedUrl (verified by scan instead)
    const NO_URL_REQUIRED_TYPES_RANK = ['llm_txt', 'schema_package', 'schema_audit', 'schema_delivery'];

    // Only run rank checks for campaigns that are actively in the pipeline past the
    // baseline check. Campaigns waiting on keyword approval (query_review), credibility
    // research, content generation, or blocked waiting on llm.txt/schema verification
    // should NOT burn API credits on rank checks — the data would be meaningless anyway
    // since no content has been published yet.
    //
    // Eligible statuses: publishing, indexing, baseline_check,
    // training, monitoring, paused (paused = was active, manually paused).
    // Ineligible: pending, keyword_research, query_review, credibility_research,
    //             content_generation, error.
    //
    // Additionally, skip campaigns that are blocked waiting on llm.txt or schema
    // verification (llmTxtVerified=false OR schemaVerified=false) AND have not yet
    // reached the publishing stage — they haven't gone live yet.
    // Only statuses that exist in the DB campaignStatusEnum AND indicate the campaign
    // is live/active. Excludes: pending, keyword_research, query_review,
    // credibility_research, content_generation, error.
    const RANK_ELIGIBLE_STATUSES = [
      "publishing",
      "indexing",
      "training",
      "monitoring",
      "paused",
    ] as ("error" | "pending" | "keyword_research" | "query_review" | "credibility_research" | "content_generation" | "publishing" | "indexing" | "baseline_check" | "training" | "monitoring" | "paused")[];

    const targets = await db
      .selectDistinct({ campaignId: cqlTable.campaignId })
      .from(cqlTable)
      .innerJoin(campaignsTable, eqRank(cqlTable.campaignId, campaignsTable.id))
      .innerJoin(businessesTable, eqRank(campaignsTable.businessId, businessesTable.id))
      .where(
        andRank(
          eqRank(businessesTable.isArchived, false),
          inArrayRank(campaignsTable.status, RANK_ELIGIBLE_STATUSES),
          eqRank(campaignsTable.llmTxtVerified, true), // HARD GATE: llm.txt must be verified
          eqRank(campaignsTable.schemaVerified, true), // HARD GATE: schema must be verified
          // HARD GATE: all credibility content pages must have a publishedUrl
          notExistsRank(
            db.select({ id: contentPagesTableRank.id })
              .from(contentPagesTableRank)
              .where(
                andRank(
                  eqRank(contentPagesTableRank.campaignId, campaignsTable.id),
                  notInArrayRank(contentPagesTableRank.pageType, NO_URL_REQUIRED_TYPES_RANK),
                  isNullRank(contentPagesTableRank.publishedUrl),
                )
              )
          ),
        )
      );

    if (targets.length === 0) return;

    const now = Date.now();
    let checked = 0;

    for (const { campaignId } of targets) {
      if (campaignId == null) continue;
      try {
        // Sprint-in-progress gate: skip rank tracking while the 4-day sprint is still running.
        // Rank tracking is only meaningful AFTER the sprint completes (sprintCompletedAt is set).
        // The post-sprint rank check is fired directly by checkV3SprintRuns when day 4 finishes.
        const [campaignRow] = await db
          .select({ sprintCompletedAt: campaignsTable.sprintCompletedAt, trainingStartedAt: campaignsTable.trainingStartedAt })
          .from(campaignsTable)
          .where(eqRank(campaignsTable.id, campaignId))
          .limit(1);
        if (campaignRow && !campaignRow.sprintCompletedAt && campaignRow.trainingStartedAt) {
          // Sprint has started but not yet completed — skip until day 4 fires the direct check
          continue;
        }

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
        // Send ONE consolidated weekly visibility report email to the client
        try {
          const { sendCampaignVisibilityReport } = await import('./emailService');
          const topWins = result.winsDetected.slice(0, 10).map((w: any) => ({
            query: w.searchQuery || '',
            platform: w.platform || '',
            position: null,
          }));
          await sendCampaignVisibilityReport(campaignId, {
            currentScore: result.currentScore.overall,
            baselineScore: null,
            previousScore: null,
            chatgptScore: result.currentScore.chatgpt ?? 0,
            geminiScore: result.currentScore.gemini ?? 0,
            aiOverviewScore: result.currentScore.aiOverview ?? 0,
            mentionedQueries: result.winsDetected.length,
            totalQueries: result.snapshotsCreated,
            topWins,
          });
          console.log(`[Scheduler] Weekly visibility report email sent for campaign ${campaignId}`);
        } catch (emailErr: any) {
          console.warn(`[Scheduler] Weekly report email failed for campaign ${campaignId} (non-fatal):`, emailErr.message);
        }
      } catch (err: any) {
        console.error(`[Scheduler] Rank check failed for campaign ${campaignId}:`, err.message);
      }
    }

    if (checked > 0) console.log(`[Scheduler] Scheduled rank tracking checked ${checked} campaign(s)`);
  } catch (err: any) {
    console.error("[Scheduler] checkScheduledRankTracking error:", err.message);
  }
}

// ─── Bonus Query Scan Scheduler ─────────────────────────────────────────────

const BONUS_SCAN_MIN_GAP_MS = 14 * 24 * 60 * 60 * 1000; // 14 days anchored to sprintCompletedAt

/**
 * Bi-weekly bonus query discovery scan.
 *
 * For each campaign that has tracked queries, generates semantically adjacent
 * untracked queries and checks ChatGPT + Gemini to find new places the business
 * is appearing organically. Skips campaigns scanned within the last 13 days.
 */
async function checkBonusQueryScans(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const { runBonusQueryScan } = await import("./bonusQueryScanner");
    const { campaignQueryLocations: cqlTable, bonusQueryResults: bqrTable, campaigns: campaignsTable, businesses: businessesTable } = await import("../drizzle/schema");
    const { eq: eqBonus } = await import('drizzle-orm');

    // Bonus scans only run AFTER the 4-day sprint is fully complete (sprintCompletedAt is set).
    // Rules:
    //   1. Never run while the sprint is still in progress.
    //   2. Only eligible if sprintCompletedAt is set (sprint done) AND campaign is 'training' or 'monitoring'.
    //   3. Business must not be archived.
    //   4. Per-campaign 14-day gap guard anchored to sprintCompletedAt (not last scan date).
    const { or: orBonus, and: andBonus, isNotNull: isNotNullBonus, inArray: inArrayBonus } = await import('drizzle-orm');
    const targets = await db
      .selectDistinct({ campaignId: cqlTable.campaignId })
      .from(cqlTable)
      .innerJoin(campaignsTable, eqBonus(cqlTable.campaignId, campaignsTable.id))
      .innerJoin(businessesTable, eqBonus(campaignsTable.businessId, businessesTable.id))
      .where(
        andBonus(
          eqBonus(businessesTable.isArchived, false),
          // Sprint must be fully complete
          isNotNullBonus(campaignsTable.sprintCompletedAt),
          orBonus(
            eqBonus(campaignsTable.status, 'monitoring'),
            eqBonus(campaignsTable.status, 'training')
          )
        )
      );

    if (targets.length === 0) return;

    const now = Date.now();
    let scanned = 0;

    for (const { campaignId } of targets) {
      if (campaignId == null) continue;
      try {
        // Gap guard: anchored to sprintCompletedAt.
        // First scan is allowed 14 days after sprint completion.
        // Subsequent scans are allowed 14 days after the last scan.
        const [campaignRow] = await db
          .select({ sprintCompletedAt: campaignsTable.sprintCompletedAt })
          .from(campaignsTable)
          .where(eqBonus(campaignsTable.id, campaignId))
          .limit(1);
        if (!campaignRow?.sprintCompletedAt) continue; // sprint not done yet
        const sprintAnchor = new Date(campaignRow.sprintCompletedAt).getTime();
        const [lastScan] = await db
          .select({ scanRunAt: bqrTable.scanRunAt })
          .from(bqrTable)
          .where(eq(bqrTable.campaignId, campaignId))
          .orderBy(desc(bqrTable.scanRunAt))
          .limit(1);
        const anchor = lastScan ? new Date(lastScan.scanRunAt).getTime() : sprintAnchor;
        if (now - anchor < BONUS_SCAN_MIN_GAP_MS) {
          continue;
        }

        const result = await runBonusQueryScan(campaignId);
        scanned++;
        console.log(
          `[Scheduler] Bonus scan campaign ${campaignId}: ${result.queriesChecked} checked, ` +
          `${result.bonusWinsFound} bonus win(s) found across ${result.queriesChecked} adjacent queries checked`
        );
      } catch (err: any) {
        console.error(`[Scheduler] Bonus scan failed for campaign ${campaignId}:`, err.message);
      }
    }

    if (scanned > 0) console.log(`[Scheduler] Bonus query scans completed for ${scanned} campaign(s)`);
  } catch (err: any) {
    console.error("[Scheduler] checkBonusQueryScans error:", err.message);
  }
}

/**
 * Send reminder emails to agencies whose campaigns have been stuck in 'publishing'
 * status for 3 or 7 days without all content page URLs being submitted.
 */
async function checkPublishingReminders(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const { campaigns: cpCampaigns, contentPages: cpContentPages, businesses: cpBusinesses, agencies: cpAgencies } = await import("../drizzle/schema");
    const { eq, and, isNull, lt, or, inArray } = await import("drizzle-orm");
    const now = new Date();
    const THREE_DAYS_AGO = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    const SEVEN_DAYS_AGO = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    // Find campaigns stuck in 'publishing' status for 3+ days
    const stuckCampaigns = await db
      .select({
        campaignId: cpCampaigns.id,
        campaignName: cpCampaigns.campaignName,
        businessId: cpCampaigns.businessId,
        updatedAt: cpCampaigns.updatedAt,
        businessName: cpBusinesses.name,
        agencyId: cpBusinesses.agencyId,
        agencyEmail: cpAgencies.contactEmail,
        agencyName: cpAgencies.name,
        agencyBrandName: cpAgencies.brandName,
      })
      .from(cpCampaigns)
      .innerJoin(cpBusinesses, eq(cpBusinesses.id, cpCampaigns.businessId))
      .innerJoin(cpAgencies, eq(cpAgencies.id, cpBusinesses.agencyId))
      .where(
        and(
          eq(cpCampaigns.status, "publishing"),
          lt(cpCampaigns.updatedAt, THREE_DAYS_AGO),
          isNull(cpCampaigns.publishingCompletedAt)
        )
      );
    if (!stuckCampaigns.length) return;
    // For each stuck campaign, check if any pages still lack URLs
    const INTERNAL_TYPES = new Set(["llm_txt", "schema_package", "schema_audit", "schema_delivery"]);
    for (const c of stuckCampaigns) {
      const pages = await db
        .select({ id: cpContentPages.id, publishedUrl: cpContentPages.publishedUrl, pageType: cpContentPages.pageType })
        .from(cpContentPages)
        .where(eq(cpContentPages.campaignId, c.campaignId));
      const visiblePages = pages.filter(p => !INTERNAL_TYPES.has(p.pageType));
      const missingUrls = visiblePages.filter(p => !p.publishedUrl).length;
      if (missingUrls === 0) continue; // all URLs already submitted, skip
      const daysStuck = Math.floor((now.getTime() - c.updatedAt.getTime()) / (24 * 60 * 60 * 1000));
      const isSevenDay = daysStuck >= 7;
      const isThreeDay = daysStuck >= 3 && daysStuck < 7;
      if (!isThreeDay && !isSevenDay) continue;
      // Only send on the exact day milestone (3 or 7), not every day after
      const exactDay = isSevenDay
        ? daysStuck >= 7 && daysStuck < 8
        : daysStuck >= 3 && daysStuck < 4;
      if (!exactDay) continue;
      const recipientEmail = c.agencyEmail;
      if (!recipientEmail) continue;
      const agencyLabel = c.agencyBrandName || c.agencyName || "Your Agency";
      const urgency = isSevenDay ? "⚠️ Urgent: " : "Reminder: ";
      try {
        const resendKey = process.env.RESEND_API_KEY;
        if (!resendKey) continue;
        const { Resend } = await import("resend");
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: `${agencyLabel} <noreply@${process.env.EMAIL_FROM_DOMAIN ?? "roguebusinessmarketing.com"}`,
          to: recipientEmail,
          subject: `${urgency}Content pages need URLs for ${c.businessName}`,
          html: `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
              <h2 style="color:#1e293b">${urgency}Content pages awaiting URL submission</h2>
              <p>The campaign <strong>${c.campaignName || `Campaign #${c.campaignId}`}</strong> for <strong>${c.businessName}</strong> has been waiting for ${daysStuck} day${daysStuck !== 1 ? "s" : ""} for live URLs to be submitted.</p>
              <p><strong>${missingUrls} page${missingUrls !== 1 ? "s" : ""}</strong> still need${missingUrls === 1 ? "s" : ""} a live URL before indexing and AI training can begin.</p>
              <p style="margin-top:24px">
                <a href="${process.env.APP_BASE_URL ?? ""}/agency/client/${c.businessId}" style="background:#4f46e5;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">Submit URLs Now</a>
              </p>
              <p style="color:#64748b;font-size:13px;margin-top:24px">Once all URLs are submitted, indexing and training will start automatically.</p>
            </div>
          `,
        });
        console.log(`[Scheduler] Publishing reminder sent to ${recipientEmail} for campaign ${c.campaignId} (${daysStuck} days stuck)`);
      } catch (emailErr: any) {
        console.error(`[Scheduler] Failed to send publishing reminder for campaign ${c.campaignId}:`, emailErr.message);
      }
    }
  } catch (err: any) {
    console.error("[Scheduler] checkPublishingReminders error:", err.message);
  }
}

/**
 * Clean up prospect audits stuck in 'running' status for more than 10 minutes.
 * Any audit that has been running for > 10 minutes without completing is almost
 * certainly dead (server restart, unhandled exception, etc.) — mark it failed so
 * the UI doesn't show an indefinite spinner to the user.
 */
async function cleanupStuckProspectAudits(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const { prospectAudits: paTable } = await import('../drizzle/schema');
    const { eq: eqAudit, and: andAudit, lt: ltAudit } = await import('drizzle-orm');

    const TEN_MINUTES_AGO = new Date(Date.now() - 10 * 60 * 1000);

    // Find audits stuck in 'running' for more than 10 minutes
    const stuckAudits = await db
      .select({ id: paTable.id })
      .from(paTable)
      .where(
        andAudit(
          eqAudit(paTable.status, 'running'),
          ltAudit(paTable.updatedAt, TEN_MINUTES_AGO)
        )
      );

    if (stuckAudits.length === 0) return;

    console.log(`[Scheduler] Marking ${stuckAudits.length} stuck prospect audit(s) as failed (running > 10 min)`);

    for (const { id } of stuckAudits) {
      await db
        .update(paTable)
        .set({
          status: 'failed',
          errorMessage: 'Audit timed out — please try again',
          updatedAt: new Date(),
        })
        .where(eqAudit(paTable.id, id));
      console.log(`[Scheduler] Marked stuck prospect audit ${id} as failed`);
    }
  } catch (err: any) {
    console.error('[Scheduler] cleanupStuckProspectAudits error:', err.message);
  }
}

// ─── V3 Training Scheduler ────────────────────────────────────────────────────

/**
 * checkV3SprintRuns
 *
 * Runs every 30 minutes. Finds any pending V3 sprint or maintenance day runs
 * scheduled for today or earlier and executes them:
 *   1. Run all training sessions for the day
 *   2. Run the end-of-day web search probe
 */
export async function checkV3SprintRuns(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const { trainingDayRuns: tdrTable, campaigns: cTable, contentPages: cpTable } = await import('../drizzle/schema');
    const { eq: eqV3, and: andV3, lte: lteV3, isNull: isNullV3, gte: gteV3 } = await import('drizzle-orm');
    const { getTodayCentral } = await import('./dateUtils');
    const today = getTodayCentral(); // Central Time (America/Chicago) — keeps scheduler and dashboard congruent

    const pendingRuns = await db
      .select()
      .from(tdrTable)
      .where(
        andV3(
          eqV3(tdrTable.status, 'pending'),
          lteV3(tdrTable.scheduledDate, today)
        )
      )
      .orderBy(tdrTable.scheduledDate, tdrTable.runDay);

    if (pendingRuns.length === 0) return;

    console.log(`[SchedulerV3] Found ${pendingRuns.length} pending training day run(s)`);

    // Non-publishable page types that never get a publishedUrl
    const { inArray: inArrayV3, not: notV3 } = await import('drizzle-orm');
    const NON_PUBLISHABLE = ['llm_txt', 'schema_package', 'schema_audit', 'schema_delivery'];

    for (const run of pendingRuns) {
      // Day 1 only: verify llm.txt and schema are verified before starting the sprint.
      // Days 2-4: these were already verified on Day 1 — skip the gate to avoid
      // blocking training if a flag was accidentally cleared.
      // Training hold gate — applies to ALL days. Admin must explicitly release the hold
      // via the campaign panel before the sprint fires (even if llm.txt/schema are verified).
      const [holdCheck] = await db
        .select({ trainingHeld: cTable.trainingHeld })
        .from(cTable)
        .where(eqV3(cTable.id, run.campaignId))
        .limit(1);

      if (holdCheck?.trainingHeld === true) {
        console.log(`[SchedulerV3] Campaign ${run.campaignId} is on training hold — skipping run ${run.id}`);
        continue;
      }

      if (run.runDay === 1) {
        const [campaign] = await db
          .select()
          .from(cTable)
          .where(
            andV3(
              eqV3(cTable.id, run.campaignId),
              eqV3(cTable.llmTxtVerified, true),
              eqV3(cTable.schemaVerified, true)
            )
          )
          .limit(1);

        if (!campaign) {
          console.log(`[SchedulerV3] Campaign ${run.campaignId} failed Day 1 gate check (llm.txt/schema not verified) — skipping run ${run.id}`);
          continue;
        }

        // Day 1 only: check all publishable content page URLs are present
        const missingUrlPages = await db
          .select({ id: cpTable.id })
          .from(cpTable)
          .where(
            andV3(
              eqV3(cpTable.campaignId, run.campaignId),
              isNullV3(cpTable.publishedUrl),
              notV3(inArrayV3(cpTable.pageType, NON_PUBLISHABLE))
            )
          )
          .limit(1);

        if (missingUrlPages.length > 0) {
          console.log(`[SchedulerV3] Campaign ${run.campaignId} has missing content URLs on Day 1 — skipping run ${run.id}`);
          continue;
        }
      }

      try {
        // Determine which training engine to use for this campaign
        const [runCampaign] = await db
          .select({ trainingVersion: cTable.trainingVersion })
          .from(cTable)
          .where(eqV3(cTable.id, run.campaignId))
          .limit(1);
        const trainingVersion = runCampaign?.trainingVersion ?? 'v3';

        console.log(`[SchedulerV3] Executing training day run ${run.id} (campaign ${run.campaignId}, day ${run.runDay}, engine ${trainingVersion})`);

        if (trainingVersion === 'v7') {
          const { runTrainingDay: runTrainingDayV7 } = await import('./trainingWorkerV7');
          await runTrainingDayV7(run.campaignId, run.id);
        } else if (trainingVersion === 'v6') {
          const { runTrainingDay: runTrainingDayV6 } = await import('./trainingWorkerV6');
          await runTrainingDayV6(run.campaignId, run.id);
        } else if (trainingVersion === 'v5') {
          const { runTrainingDay: runTrainingDayV5 } = await import('./trainingWorkerV5');
          await runTrainingDayV5(run.campaignId, run.id);
        } else if (trainingVersion === 'v4') {
          const { runTrainingDay: runTrainingDayV4 } = await import('./trainingWorkerV4');
          await runTrainingDayV4(run.campaignId, run.id);
        } else {
          const { runTrainingDay } = await import('./trainingWorkerV3');
          await runTrainingDay(run.campaignId, run.id);
        }
        // End-of-day web search runs on all engine versions — pure web search,
        // no trainer AI — so results are comparable across V3/V4/V5.
        const { runEndOfDayWebSearch } = await import('./trainingWorkerV3');
        await runEndOfDayWebSearch(run.campaignId, run.id);

        // After each sprint run completes, check if all 4 sprint days are now done.
        // If so: stamp sprintCompletedAt (anchors 7-day rank tracking + 14-day bonus scan)
        // and immediately fire the first post-sprint rank tracking check.
        if (run.runType === 'sprint') {
          // Only count sprint runs created AFTER trainingStartedAt to avoid false-positive
          // completions when a campaign is reset/restarted (old completed runs still exist in DB).
          const [currentCampaign] = await db
            .select({ trainingStartedAt: cTable.trainingStartedAt })
            .from(cTable)
            .where(eqV3(cTable.id, run.campaignId))
            .limit(1);
          const trainingStartedAt = currentCampaign?.trainingStartedAt ?? new Date(0);
          const allSprintRuns = await db
            .select()
            .from(tdrTable)
            .where(andV3(
              eqV3(tdrTable.campaignId, run.campaignId),
              eqV3(tdrTable.runType, 'sprint'),
              gteV3(tdrTable.createdAt, trainingStartedAt)
            ));
          const sprintComplete = allSprintRuns.length >= 4 && allSprintRuns.every(r => r.status === 'completed');
          if (sprintComplete) {
            const { updateCampaign } = await import('./dbCampaigns');
            await updateCampaign(run.campaignId, { sprintCompletedAt: new Date() });
            console.log(`[SchedulerV3] Sprint complete for campaign ${run.campaignId} — stamped sprintCompletedAt, firing post-sprint rank check`);
            // Fire the post-sprint rank check immediately (this is the Day 4 snapshot)
            try {
              const { runScheduledRankCheck } = await import('./rankTrackingEngine');
              const rankResult = await runScheduledRankCheck(run.campaignId);
              console.log(`[SchedulerV3] Post-sprint rank check for campaign ${run.campaignId}: ${rankResult.snapshotsCreated} snapshots, ${rankResult.winsDetected.length} wins`);
              // Send ONE consolidated visibility report email to the client (not per-win emails)
              try {
                const { sendCampaignVisibilityReport } = await import('./emailService');
                const topWins = rankResult.winsDetected.slice(0, 10).map((w: any) => ({
                  query: w.searchQuery || '',
                  platform: w.platform || '',
                  position: null,
                }));
                await sendCampaignVisibilityReport(run.campaignId, {
                  currentScore: rankResult.currentScore.overall,
                  baselineScore: null,
                  previousScore: null,
                  chatgptScore: rankResult.currentScore.chatgpt ?? 0,
                  geminiScore: rankResult.currentScore.gemini ?? 0,
                  aiOverviewScore: rankResult.currentScore.aiOverview ?? 0,
                  mentionedQueries: rankResult.winsDetected.length,
                  totalQueries: rankResult.snapshotsCreated,
                  topWins,
                });
                console.log(`[SchedulerV3] Day 4 consolidated visibility report email sent for campaign ${run.campaignId}`);
              } catch (emailErr: any) {
                console.warn(`[SchedulerV3] Day 4 report email failed for campaign ${run.campaignId} (non-fatal):`, emailErr.message);
              }
            } catch (rankErr: any) {
              console.warn(`[SchedulerV3] Post-sprint rank check failed for campaign ${run.campaignId} (non-fatal):`, rankErr.message);
            }
          }
        }
      } catch (err: any) {
        console.error(`[SchedulerV3] Training day run ${run.id} failed:`, err.message);
        await db
          .update(tdrTable)
          .set({ status: 'failed' })
          .where(eqV3(tdrTable.id, run.id));
      }
    }
  } catch (err: any) {
    console.error('[SchedulerV3] checkV3SprintRuns error:', err.message);
  }
}

/**
 * checkV3WeeklyMaintenance
 *
 * Runs once per day. For each active V3 campaign that has completed its
 * 4-day sprint and has no pending maintenance run and whose last completed
 * run was > 7 days ago, creates a new weekly maintenance run.
 */
export async function checkV3WeeklyMaintenance(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;

    const { trainingDayRuns: tdrTable, campaigns: cTable, trainingQueries: tqTable } = await import('../drizzle/schema');
    const { eq: eqV3, and: andV3, sql: sqlV3 } = await import('drizzle-orm');
    const { createWeeklyMaintenanceRun } = await import('./trainingWorkerV3');

    const SEVEN_DAYS_AGO = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const v3Campaigns = await db
      .selectDistinct({ campaignId: tqTable.campaignId })
      .from(tqTable)
      .where(eqV3(tqTable.isActive, true));

    for (const { campaignId } of v3Campaigns) {
      const [campaign] = await db
        .select()
        .from(cTable)
        .where(eqV3(cTable.id, campaignId))
        .limit(1);

      if (!campaign) continue;

      const sprintRuns = await db
        .select()
        .from(tdrTable)
        .where(andV3(eqV3(tdrTable.campaignId, campaignId), eqV3(tdrTable.runType, 'sprint')));

      const sprintComplete = sprintRuns.length >= 4 && sprintRuns.every(r => r.status === 'completed');
      if (!sprintComplete) continue;

      const pendingMaintenance = await db
        .select()
        .from(tdrTable)
        .where(andV3(eqV3(tdrTable.campaignId, campaignId), eqV3(tdrTable.runType, 'maintenance'), eqV3(tdrTable.status, 'pending')))
        .limit(1);

      if (pendingMaintenance.length > 0) continue;

      const lastCompleted = await db
        .select()
        .from(tdrTable)
        .where(andV3(eqV3(tdrTable.campaignId, campaignId), eqV3(tdrTable.status, 'completed')))
        .orderBy(sqlV3`${tdrTable.completedAt} DESC`)
        .limit(1);

      if (lastCompleted.length > 0 && lastCompleted[0].completedAt && lastCompleted[0].completedAt > SEVEN_DAYS_AGO) {
        continue;
      }

      await createWeeklyMaintenanceRun(campaignId);
      console.log(`[SchedulerV3] Created weekly maintenance run for campaign ${campaignId}`);
    }
  } catch (err: any) {
    console.error('[SchedulerV3] checkV3WeeklyMaintenance error:', err.message);
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

// ─── V3 Stuck Run Detector ────────────────────────────────────────────────────
/**
 * detectAndRecoverStuckV3Runs
 *
 * V3 equivalent of detectAndRecoverStaleSessions.
 * Finds any trainingDayRuns stuck in 'running' status for more than 2 hours
 * and resets them to 'pending' so checkV3SprintRuns picks them up again.
 *
 * Runs every 30 minutes alongside checkV3SprintRuns.
 */
export async function detectAndRecoverStuckV3Runs(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const { trainingDayRuns: tdrTable } = await import('../drizzle/schema');
    const { eq: eqV3, and: andV3, lt: ltV3 } = await import('drizzle-orm');
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    // trainingDayRuns has no updatedAt — use createdAt as the staleness signal
    const stuckRuns = await db
      .select()
      .from(tdrTable)
      .where(
        andV3(
          eqV3(tdrTable.status, 'running'),
          ltV3(tdrTable.createdAt, twoHoursAgo)
        )
      );
    if (stuckRuns.length === 0) return;
    console.log(`[SchedulerV3] Found ${stuckRuns.length} stuck V3 day run(s) — resetting to pending`);
    for (const run of stuckRuns) {
      await db
        .update(tdrTable)
        .set({ status: 'pending' })
        .where(eqV3(tdrTable.id, run.id));
      console.log(`[SchedulerV3] Reset stuck day run ${run.id} (campaign ${run.campaignId}, day ${run.runDay}) to pending`);
    }
  } catch (err: any) {
    console.error('[SchedulerV3] detectAndRecoverStuckV3Runs error:', err.message);
  }
}
