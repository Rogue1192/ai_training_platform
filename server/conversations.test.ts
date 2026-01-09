import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "./db";
import { trainingConversations, trainingSessions, users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Training Conversations", () => {
  let testUserId: number;
  let testSessionId: number;
  let testConversationId: number;

  beforeAll(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Create a test user
    const [user] = await db
      .insert(users)
      .values({
        openId: `test-conv-user-${Date.now()}`,
        name: "Test Conversation User",
        email: "testconv@example.com",
      })
      .returning();
    testUserId = user.id;

    // Create a test training session
    const [session] = await db
      .insert(trainingSessions)
      .values({
        userId: testUserId,
        trainingName: "Test Session for Conversations",
        topic: "Test topic",
        targetAiProvider: "openai",
        targetAiModel: "gpt-4o",
        influencerAiProvider: "openai",
        influencerAiModel: "gpt-4o",
        trainingPrompts: ["Test prompt"],
        trainingGoal: "Test goal",
        iterations: 3,
        retryInterval: 10,
      })
      .returning();
    testSessionId = session.id;

    // Create test conversations
    const [conversation] = await db
      .insert(trainingConversations)
      .values({
        trainingSessionId: testSessionId,
        iterationNumber: 1,
        conversationHistory: [
          { role: "user", content: "Test prompt", timestamp: Date.now() },
          { role: "assistant", content: "Test response", timestamp: Date.now() },
        ],
        promptUsed: "Test prompt",
        goalAchieved: true,
        responseTime: 1500,
      })
      .returning();
    testConversationId = conversation.id;
  });

  afterAll(async () => {
    const db = await getDb();
    if (!db) return;

    // Clean up test data
    if (testConversationId) {
      await db.delete(trainingConversations).where(eq(trainingConversations.id, testConversationId));
    }
    if (testSessionId) {
      await db.delete(trainingSessions).where(eq(trainingSessions.id, testSessionId));
    }
    if (testUserId) {
      await db.delete(users).where(eq(users.id, testUserId));
    }
  });

  it("should create a training conversation", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const conversations = await db
      .select()
      .from(trainingConversations)
      .where(eq(trainingConversations.id, testConversationId));

    expect(conversations).toHaveLength(1);
    expect(conversations[0].trainingSessionId).toBe(testSessionId);
    expect(conversations[0].iterationNumber).toBe(1);
    expect(conversations[0].goalAchieved).toBe(true);
    expect(conversations[0].responseTime).toBe(1500);
  });

  it("should have valid conversation history structure", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const conversations = await db
      .select()
      .from(trainingConversations)
      .where(eq(trainingConversations.id, testConversationId));

    const history = conversations[0].conversationHistory as Array<{
      role: string;
      content: string;
      timestamp: number;
    }>;

    expect(Array.isArray(history)).toBe(true);
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
    expect(history[0].content).toBe("Test prompt");
    expect(history[1].content).toBe("Test response");
  });

  it("should fetch conversations by session ID", async () => {
    const { getConversationsBySessionId } = await import("./db");
    
    const conversations = await getConversationsBySessionId(testSessionId);
    
    expect(conversations).toHaveLength(1);
    expect(conversations[0].trainingSessionId).toBe(testSessionId);
    expect(conversations[0].promptUsed).toBe("Test prompt");
  });

  it("should return empty array for non-existent session", async () => {
    const { getConversationsBySessionId } = await import("./db");
    
    const conversations = await getConversationsBySessionId(999999);
    
    expect(conversations).toHaveLength(0);
  });

  it("should order conversations by iteration number", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Add a second conversation with higher iteration number
    const [conv2] = await db
      .insert(trainingConversations)
      .values({
        trainingSessionId: testSessionId,
        iterationNumber: 2,
        conversationHistory: [
          { role: "user", content: "Test prompt 2", timestamp: Date.now() },
          { role: "assistant", content: "Test response 2", timestamp: Date.now() },
        ],
        promptUsed: "Test prompt 2",
        goalAchieved: false,
        responseTime: 2000,
      })
      .returning();

    const { getConversationsBySessionId } = await import("./db");
    const conversations = await getConversationsBySessionId(testSessionId);

    expect(conversations).toHaveLength(2);
    expect(conversations[0].iterationNumber).toBe(1);
    expect(conversations[1].iterationNumber).toBe(2);

    // Clean up the second conversation
    await db.delete(trainingConversations).where(eq(trainingConversations.id, conv2.id));
  });
});
