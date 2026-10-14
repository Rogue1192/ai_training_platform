import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createAdminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-admin",
      email: "admin@example.test",
      name: "Test Admin",
      loginMethod: "test",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("training control integration safeguards", () => {
  it("does not register the former public auth diagnostic", () => {
    expect((appRouter as any)._def.procedures["auth.debug"]).toBeUndefined();
  });

  it("rejects unsupported engines at the campaign API boundary before database work", async () => {
    const caller = appRouter.createCaller(createAdminContext());
    await expect(
      caller.campaign.update({ id: 1, trainingVersion: "v3" as any }),
    ).rejects.toThrow();
  });

  it("keeps campaign-specific training-version writes out of startup code", async () => {
    const indexSource = await readFile(
      path.resolve(import.meta.dirname, "_core", "index.ts"),
      "utf8",
    );
    expect(indexSource).not.toContain('UPDATE "campaigns" SET "trainingVersion"');
    expect(indexSource).not.toContain("Eagle Air Co");
  });

  it("routes scheduler and pipeline execution through the shared safety policy", async () => {
    const [schedulerSource, pipelineSource] = await Promise.all([
      readFile(path.resolve(import.meta.dirname, "scheduler.ts"), "utf8"),
      readFile(path.resolve(import.meta.dirname, "pipelineOrchestrator.ts"), "utf8"),
    ]);

    expect(schedulerSource).toContain("getTrainingExecutionEligibility");
    expect(pipelineSource).toContain("getTrainingExecutionEligibility");
    expect(schedulerSource).not.toContain("defaulting to V7");
  });
});
