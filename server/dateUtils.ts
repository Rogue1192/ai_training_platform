/**
 * dateUtils.ts
 * Shared date/timezone utilities for the AI Answer Forge platform.
 *
 * All scheduling, date comparisons, and sprint schedule generation use
 * America/Chicago (Central Time) so the dashboard and scheduler are
 * always congruent with the user's timezone.
 */

export const PLATFORM_TIMEZONE = "America/Chicago";

/**
 * Returns today's date string (YYYY-MM-DD) in Central Time.
 * Use this instead of `new Date().toISOString().split('T')[0]` everywhere
 * scheduling decisions are made.
 */
export function getTodayCentral(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: PLATFORM_TIMEZONE,
  });
}

/**
 * Returns a date string (YYYY-MM-DD) for N days from now in Central Time.
 * @param daysFromNow - 0 = today, 1 = tomorrow, etc.
 */
export function getFutureDateCentral(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toLocaleDateString("en-CA", {
    timeZone: PLATFORM_TIMEZONE,
  });
}

/**
 * Formats a Date or ISO string for display in Central Time.
 * Returns a human-readable string like "Jul 19, 2026, 8:30 PM CDT"
 */
export function formatCentral(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    timeZone: PLATFORM_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
