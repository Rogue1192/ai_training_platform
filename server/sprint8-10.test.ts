/**
 * Tests for Sprint 8 (Rank Tracking Engine), Sprint 9/10 (Visibility Reports & Client Dashboard)
 */
import { describe, it, expect, vi } from "vitest";

// ============= Rank Tracking Engine Tests =============

describe("Rank Tracking Engine", () => {
  it("should export all required functions", async () => {
    const rt = await import("./rankTrackingEngine");
    expect(typeof rt.calculateVisibilityScore).toBe("function");
    expect(typeof rt.runScheduledRankCheck).toBe("function");
    expect(typeof rt.getVisibilityTrends).toBe("function");
    expect(typeof rt.generateCampaignRankReport).toBe("function");
  });

  describe("calculateVisibilityScore", () => {
    it("should return 0 for empty snapshots", async () => {
      const { calculateVisibilityScore } = await import("./rankTrackingEngine");
      const score = calculateVisibilityScore([], 0);
      expect(score.overall).toBe(0);
      expect(score.chatgpt).toBe(0);
      expect(score.gemini).toBe(0);
      expect(score.aiOverview).toBe(0);
      expect(score.totalQueries).toBe(0);
      expect(score.mentionedQueries).toBe(0);
      expect(score.averagePosition).toBeNull();
    });

    it("should return 0 when no queries are mentioned", async () => {
      const { calculateVisibilityScore } = await import("./rankTrackingEngine");
      const snapshots = [
        { chatgptMentioned: false, chatgptPosition: null, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: false, aiOverviewPosition: null },
        { chatgptMentioned: false, chatgptPosition: null, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: false, aiOverviewPosition: null },
      ];
      const score = calculateVisibilityScore(snapshots, 2);
      expect(score.overall).toBe(0);
      expect(score.mentionedQueries).toBe(0);
    });

    it("should calculate correct score for all mentioned queries", async () => {
      const { calculateVisibilityScore } = await import("./rankTrackingEngine");
      const snapshots = [
        { chatgptMentioned: true, chatgptPosition: 1, geminiMentioned: true, geminiPosition: 1, aiOverviewMentioned: true, aiOverviewPosition: 1 },
        { chatgptMentioned: true, chatgptPosition: 1, geminiMentioned: true, geminiPosition: 1, aiOverviewMentioned: true, aiOverviewPosition: 1 },
      ];
      const score = calculateVisibilityScore(snapshots, 2);
      expect(score.overall).toBe(100);
      expect(score.chatgpt).toBe(100);
      expect(score.gemini).toBe(100);
      expect(score.aiOverview).toBe(100);
      expect(score.mentionedQueries).toBe(2);
      expect(score.totalQueries).toBe(2);
    });

    it("should weight platforms correctly (ChatGPT 40%, Gemini 30%, AI Overview 30%)", async () => {
      const { calculateVisibilityScore } = await import("./rankTrackingEngine");
      // Only ChatGPT mentioned, position 1
      const snapshots = [
        { chatgptMentioned: true, chatgptPosition: 1, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: false, aiOverviewPosition: null },
      ];
      const score = calculateVisibilityScore(snapshots, 1);
      // ChatGPT = 100, Gemini = 0, AI Overview = 0
      // Overall = 100 * 0.4 + 0 * 0.3 + 0 * 0.3 = 40
      expect(score.overall).toBe(40);
      expect(score.chatgpt).toBe(100);
      expect(score.gemini).toBe(0);
      expect(score.aiOverview).toBe(0);
    });

    it("should give higher scores for better positions", async () => {
      const { calculateVisibilityScore } = await import("./rankTrackingEngine");
      // Position 1 = 100 points
      const pos1 = [
        { chatgptMentioned: true, chatgptPosition: 1, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: false, aiOverviewPosition: null },
      ];
      // Position 5 = 70 points
      const pos5 = [
        { chatgptMentioned: true, chatgptPosition: 5, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: false, aiOverviewPosition: null },
      ];
      // Mentioned but no position = 60 points
      const noPos = [
        { chatgptMentioned: true, chatgptPosition: null, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: false, aiOverviewPosition: null },
      ];

      const score1 = calculateVisibilityScore(pos1, 1);
      const score5 = calculateVisibilityScore(pos5, 1);
      const scoreNoPos = calculateVisibilityScore(noPos, 1);

      expect(score1.chatgpt).toBeGreaterThan(score5.chatgpt);
      expect(score5.chatgpt).toBeGreaterThan(scoreNoPos.chatgpt);
    });

    it("should calculate average position correctly", async () => {
      const { calculateVisibilityScore } = await import("./rankTrackingEngine");
      const snapshots = [
        { chatgptMentioned: true, chatgptPosition: 1, geminiMentioned: true, geminiPosition: 3, aiOverviewMentioned: false, aiOverviewPosition: null },
        { chatgptMentioned: true, chatgptPosition: 2, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: true, aiOverviewPosition: 4 },
      ];
      const score = calculateVisibilityScore(snapshots, 2);
      // Positions: 1, 3, 2, 4 → avg = 10/4 = 2.5
      expect(score.averagePosition).toBe(2.5);
    });

    it("should handle mixed mentioned/not-mentioned correctly", async () => {
      const { calculateVisibilityScore } = await import("./rankTrackingEngine");
      const snapshots = [
        { chatgptMentioned: true, chatgptPosition: 2, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: true, aiOverviewPosition: 1 },
        { chatgptMentioned: false, chatgptPosition: null, geminiMentioned: true, geminiPosition: 3, aiOverviewMentioned: false, aiOverviewPosition: null },
        { chatgptMentioned: false, chatgptPosition: null, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: false, aiOverviewPosition: null },
      ];
      const score = calculateVisibilityScore(snapshots, 3);
      expect(score.mentionedQueries).toBe(2); // 2 out of 3 have at least one platform
      expect(score.overall).toBeGreaterThan(0);
      expect(score.overall).toBeLessThan(100);
    });

    it("should handle null values in snapshots", async () => {
      const { calculateVisibilityScore } = await import("./rankTrackingEngine");
      const snapshots = [
        { chatgptMentioned: null, chatgptPosition: null, geminiMentioned: null, geminiPosition: null, aiOverviewMentioned: null, aiOverviewPosition: null },
      ];
      const score = calculateVisibilityScore(snapshots, 1);
      expect(score.overall).toBe(0);
      expect(score.mentionedQueries).toBe(0);
    });
  });

  describe("getVisibilityTrends", () => {
    it("should return empty array for non-existent campaign", async () => {
      const { getVisibilityTrends } = await import("./rankTrackingEngine");
      const trends = await getVisibilityTrends(999999);
      expect(trends).toEqual([]);
    });
  });

  describe("generateCampaignRankReport", () => {
    it("should throw for non-existent campaign", async () => {
      const { generateCampaignRankReport } = await import("./rankTrackingEngine");
      try {
        await generateCampaignRankReport(999999);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.message).toContain("not found");
      }
    });
  });

  describe("runScheduledRankCheck", () => {
    it("should throw for non-existent campaign", async () => {
      const { runScheduledRankCheck } = await import("./rankTrackingEngine");
      try {
        await runScheduledRankCheck(999999);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.message).toContain("not found");
      }
    });
  });
});

// ============= tRPC Router Integration Tests =============

describe("tRPC Router - Rank Tracking & Client Dashboard", () => {
  it("should have rankTracking router procedures", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller({
      user: { id: 1, name: "Test", role: "admin", openId: "test" },
      req: { headers: {} } as any,
      res: {} as any,
    });

    // getTrends should return empty for non-existent campaign
    const trends = await caller.rankTracking.getTrends({ campaignId: 999999 });
    expect(trends).toEqual([]);
  });

  it("should have clientDashboard.getByToken return null for invalid token", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller({
      user: null as any,
      req: { headers: {} } as any,
      res: {} as any,
    });

    const result = await caller.clientDashboard.getByToken({ token: "nonexistent-token-12345" });
    expect(result).toBeNull();
  });

  it("should have clientDashboard.list return empty array", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller({
      user: { id: 1, name: "Test", role: "admin", openId: "test" },
      req: { headers: {} } as any,
      res: {} as any,
    });

    const dashboards = await caller.clientDashboard.list();
    expect(Array.isArray(dashboards)).toBe(true);
  });
});

// ============= Visibility Score Edge Cases =============

describe("Visibility Score Edge Cases", () => {
  it("should handle single query with all platforms at position 1", async () => {
    const { calculateVisibilityScore } = await import("./rankTrackingEngine");
    const snapshots = [
      { chatgptMentioned: true, chatgptPosition: 1, geminiMentioned: true, geminiPosition: 1, aiOverviewMentioned: true, aiOverviewPosition: 1 },
    ];
    const score = calculateVisibilityScore(snapshots, 1);
    expect(score.overall).toBe(100);
    expect(score.averagePosition).toBe(1);
  });

  it("should handle 100 queries with 50% mention rate", async () => {
    const { calculateVisibilityScore } = await import("./rankTrackingEngine");
    const snapshots = Array.from({ length: 100 }, (_, i) => ({
      chatgptMentioned: i < 50,
      chatgptPosition: i < 50 ? 2 : null,
      geminiMentioned: false,
      geminiPosition: null,
      aiOverviewMentioned: false,
      aiOverviewPosition: null,
    }));
    const score = calculateVisibilityScore(snapshots, 100);
    expect(score.mentionedQueries).toBe(50);
    // 50 queries * 85 points (pos 2) / 100 total = 42.5 → 43 for ChatGPT
    expect(score.chatgpt).toBeGreaterThan(40);
    expect(score.chatgpt).toBeLessThan(50);
  });

  it("should handle position 10+ with base score only", async () => {
    const { calculateVisibilityScore } = await import("./rankTrackingEngine");
    const snapshots = [
      { chatgptMentioned: true, chatgptPosition: 10, geminiMentioned: false, geminiPosition: null, aiOverviewMentioned: false, aiOverviewPosition: null },
    ];
    const score = calculateVisibilityScore(snapshots, 1);
    // Position 10 doesn't get bonus, but mentioned = 60 base
    expect(score.chatgpt).toBe(60);
  });
});
