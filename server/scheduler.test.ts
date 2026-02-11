import { describe, expect, it } from "vitest";
import { calculateNextRun, getScheduleDescription } from "./scheduler";

describe("calculateNextRun", () => {
  describe("daily schedule", () => {
    it("returns the next occurrence of the specified time", () => {
      // Use a fixed reference date: Feb 11, 2026, 6:00 AM UTC
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("daily", {
        timeOfDay: "09:00",
        timezone: "UTC",
        fromDate,
      });

      // Should be 9:00 AM UTC on Feb 11 (same day, since 6 AM < 9 AM)
      expect(result.getUTCHours()).toBe(9);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCDate()).toBe(11);
    });

    it("rolls to next day if time has already passed", () => {
      // 10:00 AM UTC, requesting 09:00 → should be tomorrow
      const fromDate = new Date("2026-02-11T10:00:00Z");
      const result = calculateNextRun("daily", {
        timeOfDay: "09:00",
        timezone: "UTC",
        fromDate,
      });

      expect(result.getUTCDate()).toBe(12);
      expect(result.getUTCHours()).toBe(9);
    });
  });

  describe("weekly schedule", () => {
    it("returns the next occurrence of the specified day and time", () => {
      // Feb 11, 2026 is a Wednesday (day 3)
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("weekly", {
        timeOfDay: "09:00",
        dayOfWeek: 5, // Friday
        timezone: "UTC",
        fromDate,
      });

      // Should be Friday Feb 13
      expect(result.getUTCDay()).toBe(5);
      expect(result.getUTCDate()).toBe(13);
      expect(result.getUTCHours()).toBe(9);
    });

    it("rolls to next week if the day has already passed", () => {
      // Feb 11, 2026 is Wednesday (day 3), requesting Monday (day 1)
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("weekly", {
        timeOfDay: "09:00",
        dayOfWeek: 1, // Monday
        timezone: "UTC",
        fromDate,
      });

      // Should be next Monday, Feb 16
      expect(result.getUTCDay()).toBe(1);
      expect(result.getUTCDate()).toBe(16);
    });

    it("rolls to next week if same day but time has passed", () => {
      // Feb 11, 2026 is Wednesday (day 3), requesting Wednesday at 09:00 but it's 10:00
      const fromDate = new Date("2026-02-11T10:00:00Z");
      const result = calculateNextRun("weekly", {
        timeOfDay: "09:00",
        dayOfWeek: 3, // Wednesday
        timezone: "UTC",
        fromDate,
      });

      // Should be next Wednesday, Feb 18
      expect(result.getUTCDay()).toBe(3);
      expect(result.getUTCDate()).toBe(18);
    });
  });

  describe("monthly schedule", () => {
    it("returns the target day of the current month if not yet passed", () => {
      // Feb 11, requesting the 15th
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("monthly", {
        timeOfDay: "09:00",
        dayOfMonth: 15,
        timezone: "UTC",
        fromDate,
      });

      expect(result.getUTCDate()).toBe(15);
      expect(result.getUTCMonth()).toBe(1); // February (0-indexed)
    });

    it("rolls to next month if the target day has passed", () => {
      // Feb 11, requesting the 5th (already passed)
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("monthly", {
        timeOfDay: "09:00",
        dayOfMonth: 5,
        timezone: "UTC",
        fromDate,
      });

      // Should be March 5
      expect(result.getUTCDate()).toBe(5);
      expect(result.getUTCMonth()).toBe(2); // March (0-indexed)
    });
  });

  describe("timezone handling", () => {
    it("correctly handles Pacific Time offset", () => {
      // 5:00 PM UTC = 9:00 AM PST (UTC-8)
      const fromDate = new Date("2026-02-11T06:00:00Z"); // 10 PM PST previous day
      const result = calculateNextRun("daily", {
        timeOfDay: "09:00",
        timezone: "America/Los_Angeles",
        fromDate,
      });

      // 9 AM PST = 5 PM UTC (PST is UTC-8)
      expect(result.getUTCHours()).toBe(17);
      expect(result.getUTCMinutes()).toBe(0);
    });
  });
});

describe("getScheduleDescription", () => {
  it("describes a daily schedule correctly", () => {
    const desc = getScheduleDescription({
      scheduleType: "daily",
      timeOfDay: "09:00",
      timezone: "America/Los_Angeles",
    });
    expect(desc).toContain("Every day");
    expect(desc).toContain("9:00 AM");
    expect(desc).toContain("America/Los_Angeles");
  });

  it("describes a weekly schedule correctly", () => {
    const desc = getScheduleDescription({
      scheduleType: "weekly",
      timeOfDay: "14:30",
      dayOfWeek: 1,
      timezone: "America/New_York",
    });
    expect(desc).toContain("Every Monday");
    expect(desc).toContain("2:30 PM");
  });

  it("describes a monthly schedule correctly", () => {
    const desc = getScheduleDescription({
      scheduleType: "monthly",
      timeOfDay: "08:00",
      dayOfMonth: 15,
      timezone: "UTC",
    });
    expect(desc).toContain("15th");
    expect(desc).toContain("every month");
    expect(desc).toContain("8:00 AM");
  });

  it("handles ordinal suffixes correctly", () => {
    const desc1 = getScheduleDescription({
      scheduleType: "monthly",
      timeOfDay: "09:00",
      dayOfMonth: 1,
      timezone: "UTC",
    });
    expect(desc1).toContain("1st");

    const desc2 = getScheduleDescription({
      scheduleType: "monthly",
      timeOfDay: "09:00",
      dayOfMonth: 2,
      timezone: "UTC",
    });
    expect(desc2).toContain("2nd");

    const desc3 = getScheduleDescription({
      scheduleType: "monthly",
      timeOfDay: "09:00",
      dayOfMonth: 3,
      timezone: "UTC",
    });
    expect(desc3).toContain("3rd");

    const desc11 = getScheduleDescription({
      scheduleType: "monthly",
      timeOfDay: "09:00",
      dayOfMonth: 11,
      timezone: "UTC",
    });
    expect(desc11).toContain("11th");
  });
});
