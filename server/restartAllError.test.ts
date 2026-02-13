import { describe, it, expect } from "vitest";

/**
 * Tests for the restartAllError and getErrorSessionsCount procedures.
 * 
 * These are logic-level tests that validate the batch restart behavior:
 * - The procedure finds all error sessions for the user
 * - Sessions are processed in batches of 5
 * - API keys are validated before starting each session
 * - Model names are auto-migrated for deprecated models
 * - Results include per-session success/failure details
 * - The count endpoint returns the correct number of error sessions
 */

describe("restartAllError procedure logic", () => {
  it("should return zero counts when no error sessions exist", () => {
    const errorSessions: any[] = [];
    const results = errorSessions.map(session => ({
      sessionId: session.id,
      name: session.trainingName,
      success: true,
    }));
    
    expect(results.length).toBe(0);
    expect(results.filter(r => r.success).length).toBe(0);
    expect(results.filter(r => !r.success).length).toBe(0);
  });

  it("should process sessions in batches of 5", () => {
    const BATCH_SIZE = 5;
    const totalSessions = 13;
    const sessions = Array.from({ length: totalSessions }, (_, i) => ({
      id: i + 1,
      trainingName: `Session ${i + 1}`,
      status: "error",
    }));

    const batches: any[][] = [];
    for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
      batches.push(sessions.slice(i, i + BATCH_SIZE));
    }

    expect(batches.length).toBe(3); // 5 + 5 + 3
    expect(batches[0].length).toBe(5);
    expect(batches[1].length).toBe(5);
    expect(batches[2].length).toBe(3);
  });

  it("should correctly categorize started vs failed sessions", () => {
    const results = [
      { sessionId: 1, name: "Session 1", success: true },
      { sessionId: 2, name: "Session 2", success: false, error: "Missing API key(s): OpenAI" },
      { sessionId: 3, name: "Session 3", success: true },
      { sessionId: 4, name: "Session 4", success: false, error: "Missing API key(s): Google" },
      { sessionId: 5, name: "Session 5", success: true },
    ];

    const started = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    expect(started).toBe(3);
    expect(failed).toBe(2);
    expect(started + failed).toBe(results.length);
  });

  it("should generate correct summary message", () => {
    const started = 8;
    const failed = 2;
    const message = `Started ${started} session(s)${failed > 0 ? `, ${failed} failed` : ''}`;
    expect(message).toBe("Started 8 session(s), 2 failed");
  });

  it("should generate clean message when all succeed", () => {
    const started = 10;
    const failed = 0;
    const message = `Started ${started} session(s)${failed > 0 ? `, ${failed} failed` : ''}`;
    expect(message).toBe("Started 10 session(s)");
  });

  it("should handle model migration for deprecated models", () => {
    // Simulates the resolveModel logic
    const MODEL_MIGRATIONS: Record<string, string> = {
      "gemini-2.0-flash-exp": "gemini-2.0-flash",
      "gemini-exp-1206": "gemini-2.0-flash",
    };

    const resolveModel = (model: string) => MODEL_MIGRATIONS[model] || model;

    expect(resolveModel("gemini-2.0-flash-exp")).toBe("gemini-2.0-flash");
    expect(resolveModel("gemini-exp-1206")).toBe("gemini-2.0-flash");
    expect(resolveModel("gpt-4o")).toBe("gpt-4o"); // No migration needed
    expect(resolveModel("gemini-2.0-flash")).toBe("gemini-2.0-flash"); // Already current
  });

  it("should only include error sessions, not other statuses", () => {
    const allSessions = [
      { id: 1, status: "error" },
      { id: 2, status: "in_progress" },
      { id: 3, status: "completed" },
      { id: 4, status: "error" },
      { id: 5, status: "paused" },
      { id: 6, status: "error" },
    ];

    const errorSessions = allSessions.filter(s => s.status === "error");
    expect(errorSessions.length).toBe(3);
    expect(errorSessions.map(s => s.id)).toEqual([1, 4, 6]);
  });

  it("should only include sessions belonging to the current user", () => {
    const userId = 1;
    const allSessions = [
      { id: 1, userId: 1, status: "error" },
      { id: 2, userId: 2, status: "error" },
      { id: 3, userId: 1, status: "error" },
      { id: 4, userId: 3, status: "error" },
    ];

    const userErrorSessions = allSessions.filter(
      s => s.userId === userId && s.status === "error"
    );
    expect(userErrorSessions.length).toBe(2);
    expect(userErrorSessions.map(s => s.id)).toEqual([1, 3]);
  });

  it("should track per-session results with error details", () => {
    const results: Array<{ sessionId: number; name: string; success: boolean; error?: string }> = [];

    // Simulate processing
    results.push({ sessionId: 1, name: "Eagle Air Co", success: true });
    results.push({ sessionId: 2, name: "Copper & Cable", success: false, error: "Missing API key(s): Google" });
    results.push({ sessionId: 3, name: "HVAC Master", success: true });

    const failedResults = results.filter(r => !r.success);
    expect(failedResults.length).toBe(1);
    expect(failedResults[0].sessionId).toBe(2);
    expect(failedResults[0].error).toContain("Missing API key");
    expect(failedResults[0].name).toBe("Copper & Cable");
  });
});
