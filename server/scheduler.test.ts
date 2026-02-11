import { describe, expect, it } from "vitest";
import { calculateNextRun, getScheduleDescription } from "./scheduler";
import { parseTrainingPrompts, selectRandomPrompt } from "./promptGeneration";

// ============= calculateNextRun tests =============

describe("calculateNextRun", () => {
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
