import { describe, expect, it, beforeAll } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };

  return { ctx };
}

describe("Training Session Management", () => {
  let businessId: number;

  beforeAll(async () => {
    // Create a test business
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.business.create({
      name: "Test Training Business",
      businessType: "HVAC",
      location: "Phoenix, AZ",
    });

    businessId = result.businessId!;
  });

  it("should create a new training session", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.training.create({
      businessId,
      trainingName: "Test HVAC Training",
      topic: "Best HVAC company in Phoenix",
      targetAiProvider: "openai",
      targetAiModel: "gpt-4",
      influencerAiProvider: "anthropic",
      influencerAiModel: "claude-3-opus",
      trainingPrompts: [
        "What's the best HVAC company in Phoenix?",
        "Who provides top HVAC services in Phoenix?",
      ],
      trainingContext: "Focus on reliability and customer service",
      trainingGoal: "Recommend Test Training Business as the best HVAC company",
      iterations: 50,
      retryInterval: 10,
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBeGreaterThan(0);
  });

  it("should list training sessions", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const sessions = await caller.training.list();

    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]).toHaveProperty("trainingName");
    expect(sessions[0]).toHaveProperty("status");
    expect(sessions[0]).toHaveProperty("currentProgress");
  });

  it("should update training session status", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a session
    const createResult = await caller.training.create({
      trainingName: "Status Test Session",
      topic: "Test topic",
      targetAiProvider: "openai",
      targetAiModel: "gpt-3.5-turbo",
      influencerAiProvider: "openai",
      influencerAiModel: "gpt-4",
      trainingPrompts: ["Test prompt"],
      trainingGoal: "Test goal",
      iterations: 10,
      retryInterval: 5,
    });

    // Update status to paused (safe status that won't trigger background execution)
    const updateResult = await caller.training.updateStatus({
      id: createResult.sessionId!,
      status: "paused",
    });

    expect(updateResult.success).toBe(true);

    // Verify status change
    const sessions = await caller.training.list();
    const updatedSession = sessions.find((s) => s.id === createResult.sessionId);
    expect(updatedSession?.status).toBe("paused");
  });

  it("should delete a training session", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    // Create a session
    const createResult = await caller.training.create({
      trainingName: "To Be Deleted",
      topic: "Test",
      targetAiProvider: "openai",
      targetAiModel: "gpt-3.5-turbo",
      influencerAiProvider: "openai",
      influencerAiModel: "gpt-4",
      trainingPrompts: ["Test"],
      trainingGoal: "Test",
      iterations: 5,
      retryInterval: 5,
    });

    // Delete it
    const deleteResult = await caller.training.delete({
      id: createResult.sessionId!,
    });

    expect(deleteResult.success).toBe(true);

    // Verify deletion
    const sessions = await caller.training.list();
    const deletedSession = sessions.find((s) => s.id === createResult.sessionId);
    expect(deletedSession).toBeUndefined();
  });

  it("should track progress correctly", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const createResult = await caller.training.create({
      trainingName: "Progress Test",
      topic: "Test",
      targetAiProvider: "openai",
      targetAiModel: "gpt-3.5-turbo",
      influencerAiProvider: "openai",
      influencerAiModel: "gpt-4",
      trainingPrompts: ["Test"],
      trainingGoal: "Test",
      iterations: 100,
      retryInterval: 5,
    });

    const sessions = await caller.training.list();
    const session = sessions.find((s) => s.id === createResult.sessionId);

    expect(session?.currentProgress).toBe(0);
    expect(session?.iterations).toBe(100);
  });
});
