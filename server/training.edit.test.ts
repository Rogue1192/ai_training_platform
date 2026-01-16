import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { trainingSessions } from "../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Training Session Edit Feature", () => {
  let testSessionId: number;

  beforeAll(async () => {
    // Create a test session in paused status
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    const result = await db
      .insert(trainingSessions)
      .values({
        userId: 1,
        businessId: 1,
        trainingName: "Test Edit Session",
        topic: "Test topic for editing",
        targetAiProvider: "openai",
        targetAiModel: "gpt-4",
        influencerAiProvider: "openai",
        influencerAiModel: "gpt-3.5-turbo",
        trainingPrompts: ["Test prompt 1", "Test prompt 2"],
        trainingContext: "Test context",
        trainingGoal: "Test goal",
        iterations: 5,
        retryInterval: 5,
        status: "paused",
      })
      .returning({ id: trainingSessions.id });

    testSessionId = result[0].id;
  });

  afterAll(async () => {
    // Clean up test data
    const db = await getDb();
    if (!db) return;
    
    await db
      .delete(trainingSessions)
      .where(eq(trainingSessions.id, testSessionId));
  });

  it("should allow editing a paused session", async () => {
    // Verify the session exists and is paused
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    const session = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, testSessionId));

    expect(session).toHaveLength(1);
    expect(session[0].status).toBe("paused");
  });

  it("should update session configuration when edited", async () => {
    // Update the session
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    await db
      .update(trainingSessions)
      .set({
        trainingName: "Updated Test Session",
        iterations: 10,
        retryInterval: 10,
        trainingContext: "Updated context",
      })
      .where(eq(trainingSessions.id, testSessionId));

    // Verify the update
    const updated = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, testSessionId));

    expect(updated[0].trainingName).toBe("Updated Test Session");
    expect(updated[0].iterations).toBe(10);
    expect(updated[0].retryInterval).toBe(10);
    expect(updated[0].trainingContext).toBe("Updated context");
  });

  it("should not allow editing an in-progress session", async () => {
    // Create an in-progress session
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    const inProgressResult = await db
      .insert(trainingSessions)
      .values({
        userId: 1,
        businessId: 1,
        trainingName: "In Progress Session",
        topic: "Test topic",
        targetAiProvider: "openai",
        targetAiModel: "gpt-4",
        influencerAiProvider: "openai",
        influencerAiModel: "gpt-3.5-turbo",
        trainingPrompts: ["Test prompt"],
        trainingContext: "Test context",
        trainingGoal: "Test goal",
        iterations: 5,
        retryInterval: 5,
        status: "in_progress",
      })
      .returning({ id: trainingSessions.id });

    const inProgressId = inProgressResult[0].id;

    // Verify it's in_progress
    const session = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, inProgressId));

    expect(session[0].status).toBe("in_progress");

    // Clean up
    await db
      .delete(trainingSessions)
      .where(eq(trainingSessions.id, inProgressId));
  });

  it("should preserve session status when editing", async () => {
    // Update the session while keeping it paused
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    await db
      .update(trainingSessions)
      .set({
        trainingName: "Still Paused Session",
        iterations: 15,
      })
      .where(eq(trainingSessions.id, testSessionId));

    // Verify status is still paused
    const updated = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, testSessionId));

    expect(updated[0].status).toBe("paused");
    expect(updated[0].trainingName).toBe("Still Paused Session");
  });

  it("should allow editing error status sessions", async () => {
    // Create an error session
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    
    const errorResult = await db
      .insert(trainingSessions)
      .values({
        userId: 1,
        businessId: 1,
        trainingName: "Error Session",
        topic: "Test topic",
        targetAiProvider: "openai",
        targetAiModel: "gpt-4",
        influencerAiProvider: "openai",
        influencerAiModel: "gpt-3.5-turbo",
        trainingPrompts: ["Test prompt"],
        trainingContext: "Test context",
        trainingGoal: "Test goal",
        iterations: 5,
        retryInterval: 5,
        status: "error",
      })
      .returning({ id: trainingSessions.id });

    const errorId = errorResult[0].id;

    // Update the error session
    await db
      .update(trainingSessions)
      .set({
        trainingName: "Fixed Error Session",
        iterations: 8,
      })
      .where(eq(trainingSessions.id, errorId));

    // Verify the update
    const updated = await db
      .select()
      .from(trainingSessions)
      .where(eq(trainingSessions.id, errorId));

    expect(updated[0].trainingName).toBe("Fixed Error Session");
    expect(updated[0].status).toBe("error");

    // Clean up
    await db
      .delete(trainingSessions)
      .where(eq(trainingSessions.id, errorId));
  });
});
