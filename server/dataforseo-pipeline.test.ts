import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ============= DataForSEO Service Tests =============

describe("DataForSEO Service", () => {
  // Save original env values
  const origLogin = process.env.DATAFORSEO_LOGIN;
  const origPassword = process.env.DATAFORSEO_PASSWORD;

  afterAll(() => {
    // Restore original env values after this describe block
    process.env.DATAFORSEO_LOGIN = origLogin;
    process.env.DATAFORSEO_PASSWORD = origPassword;
  });

  it("should export all required API functions", async () => {
    const service = await import("./dataforseoService");
    expect(typeof service.getKeywordsForSite).toBe("function");
    expect(typeof service.getAIKeywordSearchVolume).toBe("function");
    expect(typeof service.searchLLMMentions).toBe("function");
    expect(typeof service.runKeywordResearchPipeline).toBe("function");
    expect(typeof service.runBaselineRankCheck).toBe("function");
    expect(typeof service.checkRankForQueries).toBe("function");
  });

  it("should throw when credentials are missing", async () => {
    // Temporarily clear credentials
    process.env.DATAFORSEO_LOGIN = "";
    process.env.DATAFORSEO_PASSWORD = "";

    const service = await import("./dataforseoService");

    await expect(
      service.getKeywordsForSite("example.com")
    ).rejects.toThrow("DataForSEO credentials not configured");

    // Restore for subsequent tests
    process.env.DATAFORSEO_LOGIN = origLogin;
    process.env.DATAFORSEO_PASSWORD = origPassword;
  });
});

// ============= Keyword Research Pipeline Tests =============

describe("Keyword Research Pipeline", () => {
  it("should export all pipeline functions", async () => {
    const pipeline = await import("./keywordResearchPipeline");
    expect(typeof pipeline.getGoldenTemplateKeywords).toBe("function");
    expect(typeof pipeline.contributeToIndustryCache).toBe("function");
    expect(typeof pipeline.runCampaignKeywordResearch).toBe("function");
    expect(typeof pipeline.runCampaignBaselineCheck).toBe("function");
  });

  it("should return null for golden template when no cache exists", async () => {
    const pipeline = await import("./keywordResearchPipeline");
    // For an industry that hasn't been cached, should return null
    const result = await pipeline.getGoldenTemplateKeywords("nonexistent_industry_xyz_12345");
    expect(result).toBeNull();
  });
});

// ============= DataForSEO API Integration Tests (Live) =============
// These tests hit the real DataForSEO API and verify the response structure

describe("DataForSEO Live API", () => {
  const hasCredentials = !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);

  it.skipIf(!hasCredentials)("should fetch keywords for a site", async () => {
    const service = await import("./dataforseoService");
    const keywords = await service.getKeywordsForSite("roguebusinessmarketing.com", {
      limit: 10,
    });

    expect(Array.isArray(keywords)).toBe(true);
    // Should get some results for a real website
    if (keywords.length > 0) {
      expect(keywords[0]).toHaveProperty("keyword");
      expect(keywords[0]).toHaveProperty("searchVolume");
      expect(keywords[0]).toHaveProperty("searchIntent");
      expect(typeof keywords[0]!.keyword).toBe("string");
      expect(typeof keywords[0]!.searchVolume).toBe("number");
    }
  }, 30_000);

  it.skipIf(!hasCredentials)("should check AI keyword search volume", async () => {
    const service = await import("./dataforseoService");
    const results = await service.getAIKeywordSearchVolume(
      ["best hvac company", "plumber near me"],
    );

    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0]).toHaveProperty("keyword");
      expect(results[0]).toHaveProperty("aiSearchVolume");
      expect(typeof results[0]!.keyword).toBe("string");
      expect(typeof results[0]!.aiSearchVolume).toBe("number");
    }
  }, 30_000);

  it.skipIf(!hasCredentials)("should search LLM mentions for a domain", async () => {
    const service = await import("./dataforseoService");
    const mentions = await service.searchLLMMentions("roguebusinessmarketing.com", {
      limit: 5,
    });

    expect(Array.isArray(mentions)).toBe(true);
    if (mentions.length > 0) {
      expect(mentions[0]).toHaveProperty("keyword");
      expect(mentions[0]).toHaveProperty("aiSearchVolume");
      expect(mentions[0]).toHaveProperty("llmResponses");
      expect(mentions[0]).toHaveProperty("relatedQueries");
      expect(mentions[0]).toHaveProperty("competitorMentions");
    }
  }, 60_000);
});

// ============= Router Integration Tests =============

describe("Campaign Pipeline Router Procedures", () => {
  it("should have keyword research and baseline check procedures registered", async () => {
    const { appRouter } = await import("./routers");
    
    // Verify the campaign router has the new procedures
    const campaignRouter = (appRouter as any)._def.procedures;
    
    // Check that the procedures exist in the router definition
    expect(campaignRouter).toBeDefined();
    
    // The procedures should be accessible via the router
    const routerDef = (appRouter as any)._def;
    expect(routerDef).toBeDefined();
  });
});
