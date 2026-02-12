import { describe, expect, it } from "vitest";
import { calculateNextRun, getScheduleDescription, getStaleThresholdMs } from "./scheduler";
import { parseTrainingPrompts, selectRandomPrompt } from "./promptGeneration";

// ============= calculateNextRun tests =============

describe("calculateNextRun", () => {
  describe("hourly schedule", () => {
    it("returns the next hour on the hour when minutes are :00", () => {
      const fromDate = new Date("2026-02-11T06:30:00Z");
      const result = calculateNextRun("hourly", {
        timeOfDay: "00:00",
        timezone: "UTC",
        fromDate,
      });

      expect(result.getUTCHours()).toBe(7);
      expect(result.getUTCMinutes()).toBe(0);
    });

    it("returns the next occurrence at :15 past", () => {
      const fromDate = new Date("2026-02-11T06:20:00Z");
      const result = calculateNextRun("hourly", {
        timeOfDay: "00:15",
        timezone: "UTC",
        fromDate,
      });

      // Already past :15 this hour, so next is 7:15
      expect(result.getUTCHours()).toBe(7);
      expect(result.getUTCMinutes()).toBe(15);
    });

    it("returns current hour if minute mark has not yet passed", () => {
      const fromDate = new Date("2026-02-11T06:10:00Z");
      const result = calculateNextRun("hourly", {
        timeOfDay: "00:30",
        timezone: "UTC",
        fromDate,
      });

      expect(result.getUTCHours()).toBe(6);
      expect(result.getUTCMinutes()).toBe(30);
    });
  });

  describe("daily schedule", () => {
    it("returns the next occurrence of the specified time", () => {
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("daily", {
        timeOfDay: "09:00",
        timezone: "UTC",
        fromDate,
      });

      expect(result.getUTCHours()).toBe(9);
      expect(result.getUTCMinutes()).toBe(0);
      expect(result.getUTCDate()).toBe(11);
    });

    it("rolls to next day if time has already passed", () => {
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

      expect(result.getUTCDay()).toBe(5);
      expect(result.getUTCDate()).toBe(13);
      expect(result.getUTCHours()).toBe(9);
    });

    it("rolls to next week if the day has already passed", () => {
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("weekly", {
        timeOfDay: "09:00",
        dayOfWeek: 1, // Monday
        timezone: "UTC",
        fromDate,
      });

      expect(result.getUTCDay()).toBe(1);
      expect(result.getUTCDate()).toBe(16);
    });

    it("rolls to next week if same day but time has passed", () => {
      const fromDate = new Date("2026-02-11T10:00:00Z");
      const result = calculateNextRun("weekly", {
        timeOfDay: "09:00",
        dayOfWeek: 3, // Wednesday
        timezone: "UTC",
        fromDate,
      });

      expect(result.getUTCDay()).toBe(3);
      expect(result.getUTCDate()).toBe(18);
    });
  });

  describe("monthly schedule", () => {
    it("returns the target day of the current month if not yet passed", () => {
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("monthly", {
        timeOfDay: "09:00",
        dayOfMonth: 15,
        timezone: "UTC",
        fromDate,
      });

      expect(result.getUTCDate()).toBe(15);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it("rolls to next month if the target day has passed", () => {
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("monthly", {
        timeOfDay: "09:00",
        dayOfMonth: 5,
        timezone: "UTC",
        fromDate,
      });

      expect(result.getUTCDate()).toBe(5);
      expect(result.getUTCMonth()).toBe(2); // March
    });

    // Batch 7a: Monthly day overflow tests
    it("clamps day 31 to Feb 28 in a non-leap year", () => {
      // Feb 2026 has 28 days (not a leap year)
      const fromDate = new Date("2026-02-01T06:00:00Z");
      const result = calculateNextRun("monthly", {
        timeOfDay: "09:00",
        dayOfMonth: 31,
        timezone: "UTC",
        fromDate,
      });

      // Should clamp to Feb 28
      expect(result.getUTCDate()).toBe(28);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it("clamps day 31 to Feb 29 in a leap year", () => {
      // Feb 2028 is a leap year
      const fromDate = new Date("2028-02-01T06:00:00Z");
      const result = calculateNextRun("monthly", {
        timeOfDay: "09:00",
        dayOfMonth: 31,
        timezone: "UTC",
        fromDate,
      });

      // Should clamp to Feb 29
      expect(result.getUTCDate()).toBe(29);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it("clamps day 31 to 30 for April (30-day month)", () => {
      const fromDate = new Date("2026-04-01T06:00:00Z");
      const result = calculateNextRun("monthly", {
        timeOfDay: "09:00",
        dayOfMonth: 31,
        timezone: "UTC",
        fromDate,
      });

      // April has 30 days, should clamp to 30
      expect(result.getUTCDate()).toBe(30);
      expect(result.getUTCMonth()).toBe(3); // April
    });

    it("handles day 29 rolling from Feb to March correctly", () => {
      // In Feb 2026 (non-leap), day 29 should clamp to 28 for this month
      // But if already past the 28th, it should go to March 29
      const fromDate = new Date("2026-02-28T10:00:00Z"); // Already past the clamped day
      const result = calculateNextRun("monthly", {
        timeOfDay: "09:00",
        dayOfMonth: 29,
        timezone: "UTC",
        fromDate,
      });

      // Should be March 29 (March has 31 days, so 29 is valid)
      expect(result.getUTCDate()).toBe(29);
      expect(result.getUTCMonth()).toBe(2); // March
    });
  });

  describe("timezone handling", () => {
    it("correctly handles Pacific Time offset", () => {
      const fromDate = new Date("2026-02-11T06:00:00Z");
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

  describe("custom schedule fallback", () => {
    it("falls back to daily when cron expression is empty", () => {
      const fromDate = new Date("2026-02-11T06:00:00Z");
      const result = calculateNextRun("custom", {
        timeOfDay: "09:00",
        timezone: "UTC",
        fromDate,
      });

      // Should fall back to daily behavior
      expect(result.getUTCHours()).toBe(9);
      expect(result.getUTCDate()).toBe(11);
    });
  });
});

// ============= getScheduleDescription tests =============

describe("getScheduleDescription", () => {
  it("describes an hourly schedule on the hour", () => {
    const desc = getScheduleDescription({
      scheduleType: "hourly",
      timeOfDay: "00:00",
      timezone: "America/Los_Angeles",
    });
    expect(desc).toContain("Every hour");
    expect(desc).toContain("on the hour");
  });

  it("describes an hourly schedule with minutes past", () => {
    const desc = getScheduleDescription({
      scheduleType: "hourly",
      timeOfDay: "00:15",
      timezone: "UTC",
    });
    expect(desc).toContain("Every hour");
    expect(desc).toContain(":15");
  });

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
    const desc1 = getScheduleDescription({ scheduleType: "monthly", timeOfDay: "09:00", dayOfMonth: 1, timezone: "UTC" });
    expect(desc1).toContain("1st");

    const desc2 = getScheduleDescription({ scheduleType: "monthly", timeOfDay: "09:00", dayOfMonth: 2, timezone: "UTC" });
    expect(desc2).toContain("2nd");

    const desc3 = getScheduleDescription({ scheduleType: "monthly", timeOfDay: "09:00", dayOfMonth: 3, timezone: "UTC" });
    expect(desc3).toContain("3rd");

    const desc11 = getScheduleDescription({ scheduleType: "monthly", timeOfDay: "09:00", dayOfMonth: 11, timezone: "UTC" });
    expect(desc11).toContain("11th");
  });
});

// ============= getStaleThresholdMs tests (dynamic staleness) =============

describe("getStaleThresholdMs", () => {
  it("returns 30 min floor for very short retry intervals (1 min)", () => {
    // 1 min * 3 = 3 min, but floor is 30 min
    expect(getStaleThresholdMs(1)).toBe(30 * 60 * 1000);
  });

  it("returns 30 min floor for 5-min retry interval", () => {
    // 5 min * 3 = 15 min, but floor is 30 min
    expect(getStaleThresholdMs(5)).toBe(30 * 60 * 1000);
  });

  it("returns 30 min for 10-min retry interval (10*3=30)", () => {
    // 10 min * 3 = 30 min — exactly the floor
    expect(getStaleThresholdMs(10)).toBe(30 * 60 * 1000);
  });

  it("returns dynamic value for 15-min retry interval", () => {
    // 15 min * 3 = 45 min — above floor, below ceiling
    expect(getStaleThresholdMs(15)).toBe(45 * 60 * 1000);
  });

  it("returns dynamic value for 60-min retry interval", () => {
    // 60 min * 3 = 180 min = 3 hours
    expect(getStaleThresholdMs(60)).toBe(3 * 60 * 60 * 1000);
  });

  it("returns dynamic value for 120-min retry interval", () => {
    // 120 min * 3 = 360 min = 6 hours
    expect(getStaleThresholdMs(120)).toBe(6 * 60 * 60 * 1000);
  });

  it("returns 24h ceiling for very large retry intervals (600 min)", () => {
    // 600 min * 3 = 1800 min = 30 hours, but ceiling is 24 hours
    expect(getStaleThresholdMs(600)).toBe(24 * 60 * 60 * 1000);
  });

  it("returns 24h ceiling for extreme retry intervals (1440 min = 1 day)", () => {
    expect(getStaleThresholdMs(1440)).toBe(24 * 60 * 60 * 1000);
  });

  it("correctly handles the 10-min retry interval used by Copper & Cable sessions", () => {
    // This is the critical case: 10 min * 3 = 30 min
    // A session with 50 iterations at 10-min intervals takes ~8.3 hours
    // The old fixed 2-hour threshold would kill it at iteration 12
    // The new 30-min threshold only kills it if no progress for 30 min
    const threshold = getStaleThresholdMs(10);
    expect(threshold).toBe(30 * 60 * 1000); // 30 minutes
    // This is much less than the old 2-hour fixed threshold,
    // but it's based on updatedAt (last progress), not session start time
    // So a session making progress every 10 min will never trigger this
  });
});

// ============= parseTrainingPrompts tests (Batch 1b) =============

describe("parseTrainingPrompts", () => {
  it("handles a normal string array", () => {
    const result = parseTrainingPrompts(["prompt1", "prompt2", "prompt3"]);
    expect(result).toEqual(["prompt1", "prompt2", "prompt3"]);
  });

  it("handles a JSON-encoded string (double-encoding)", () => {
    const jsonString = JSON.stringify(["What is the best cleaning service?", "Who cleans offices?"]);
    const result = parseTrainingPrompts(jsonString);
    expect(result).toEqual(["What is the best cleaning service?", "Who cleans offices?"]);
  });

  it("handles a doubly-encoded JSON string", () => {
    const inner = JSON.stringify(["prompt1", "prompt2"]);
    const doubleEncoded = JSON.stringify(inner);
    // After first parse, it's a string. After second parse, it's an array.
    const result = parseTrainingPrompts(doubleEncoded);
    // parseTrainingPrompts only does one level of parsing, so it should get the inner string
    // and then treat it as a single prompt (since it's > 10 chars)
    expect(result.length).toBeGreaterThan(0);
    // Each result should be a proper string, not a single character
    result.forEach(p => expect(p.length).toBeGreaterThan(1));
  });

  it("filters out empty strings", () => {
    const result = parseTrainingPrompts(["valid", "", "also valid", ""]);
    expect(result).toEqual(["valid", "also valid"]);
  });

  it("returns empty array for null/undefined", () => {
    expect(parseTrainingPrompts(null)).toEqual([]);
    expect(parseTrainingPrompts(undefined)).toEqual([]);
  });

  it("handles a single string longer than 10 chars as a prompt", () => {
    const result = parseTrainingPrompts("This is a long prompt that should be treated as a single item");
    expect(result).toEqual(["This is a long prompt that should be treated as a single item"]);
  });

  it("returns empty for short non-JSON strings", () => {
    const result = parseTrainingPrompts("abc");
    expect(result).toEqual([]);
  });
});

describe("selectRandomPrompt", () => {
  it("returns a valid prompt from an array", () => {
    const prompts = ["prompt1", "prompt2", "prompt3"];
    const result = selectRandomPrompt(prompts);
    expect(prompts).toContain(result);
    expect(result.length).toBeGreaterThan(1);
  });

  it("handles JSON-encoded prompts without returning single characters", () => {
    const jsonString = JSON.stringify(["What is the best service?", "Who provides cleaning?"]);
    const result = selectRandomPrompt(jsonString);
    // Should return a full prompt, not a single character
    expect(result.length).toBeGreaterThan(5);
  });

  it("throws for empty input", () => {
    expect(() => selectRandomPrompt([])).toThrow("No prompts available");
    expect(() => selectRandomPrompt(null)).toThrow("No prompts available");
  });
});
