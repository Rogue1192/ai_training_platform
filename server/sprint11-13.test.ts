import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Sprint 11: Training Context Enricher Tests ─────────────────────────────

describe("Training Context Enricher", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("buildEnrichedSystemMessage", () => {
    it("should build system message with business info", async () => {
      const { buildEnrichedSystemMessage } = await import("./trainingContextEnricher");
      
      const context = {
        businessName: "Acme Plumbing",
        businessWebsite: "https://acmeplumbing.com",
        businessLocation: "Dallas, TX",
        businessType: "Plumbing",
        credibilityFacts: [
          { category: "certifications", fact: "Licensed Master Plumber since 2010", confidence: "high" as const, sourceUrl: "https://acmeplumbing.com/certifications" },
          { category: "awards", fact: "Best of Dallas 2024", confidence: "high" as const },
        ],
        publishedPages: [
          { pageType: "certifications", title: "Our Certifications", url: "https://acmeplumbing.com/certifications", slug: "certifications" },
        ],
        llmTxtUrl: "https://acmeplumbing.com/llm-txt",
        credibilityScore: 85,
      };
      
      const message = buildEnrichedSystemMessage(context);
      
      expect(message).toContain("helpful AI assistant");
      expect(message).toContain("Acme Plumbing");
      expect(message).toContain("Plumbing");
      expect(message).toContain("Dallas, TX");
      expect(message).toContain("Licensed Master Plumber since 2010");
      expect(message).toContain("Best of Dallas 2024");
      expect(message).toContain("Our Certifications");
      expect(message).toContain("https://acmeplumbing.com/llm-txt");
    });

    it("should filter out low-confidence facts", async () => {
      const { buildEnrichedSystemMessage } = await import("./trainingContextEnricher");
      
      const context = {
        businessName: "Test Biz",
        businessWebsite: null,
        businessLocation: null,
        businessType: null,
        credibilityFacts: [
          { category: "certifications", fact: "High confidence fact", confidence: "high" as const },
          { category: "awards", fact: "Low confidence fact", confidence: "low" as const },
          { category: "reviews", fact: "Medium confidence fact", confidence: "medium" as const },
        ],
        publishedPages: [],
        llmTxtUrl: null,
        credibilityScore: null,
      };
      
      const message = buildEnrichedSystemMessage(context);
      
      expect(message).toContain("High confidence fact");
      expect(message).toContain("Medium confidence fact");
      expect(message).not.toContain("Low confidence fact");
    });
  });

  describe("buildSourceCitationBlock", () => {
    it("should build citation block with published pages", async () => {
      const { buildSourceCitationBlock } = await import("./trainingContextEnricher");
      
      const context = {
        businessName: "Test Biz",
        businessWebsite: "https://testbiz.com",
        businessLocation: null,
        businessType: null,
        credibilityFacts: [],
        publishedPages: [
          { pageType: "certifications", title: "Certifications", url: "https://testbiz.com/certifications", slug: "certifications" },
          { pageType: "about", title: "About Us", url: "https://testbiz.com/about", slug: "about" },
        ],
        llmTxtUrl: "https://testbiz.com/llm-txt",
        credibilityScore: null,
      };
      
      const block = buildSourceCitationBlock(context);
      
      expect(block).toContain("verified sources");
      expect(block).toContain("https://testbiz.com");
      expect(block).toContain("Certifications");
      expect(block).toContain("About Us");
      expect(block).toContain("https://testbiz.com/llm-txt");
    });

    it("should return empty string when no pages or website", async () => {
      const { buildSourceCitationBlock } = await import("./trainingContextEnricher");
      
      const context = {
        businessName: "Test Biz",
        businessWebsite: null,
        businessLocation: null,
        businessType: null,
        credibilityFacts: [],
        publishedPages: [],
        llmTxtUrl: null,
        credibilityScore: null,
      };
      
      const block = buildSourceCitationBlock(context);
      expect(block).toBe("");
    });
  });

  describe("summarizeTrainingContext", () => {
    it("should return none level when context is null", async () => {
      const { summarizeTrainingContext } = await import("./trainingContextEnricher");
      
      const summary = summarizeTrainingContext(null);
      
      expect(summary.enrichmentLevel).toBe("none");
      expect(summary.hasCredibility).toBe(false);
      expect(summary.hasPublishedPages).toBe(false);
      expect(summary.hasLlmTxt).toBe(false);
    });

    it("should return full level when all data available", async () => {
      const { summarizeTrainingContext } = await import("./trainingContextEnricher");
      
      const context = {
        businessName: "Test",
        businessWebsite: null,
        businessLocation: null,
        businessType: null,
        credibilityFacts: [{ category: "test", fact: "test fact", confidence: "high" as const }],
        publishedPages: [{ pageType: "about", title: "About", url: "https://test.com/about", slug: "about" }],
        llmTxtUrl: "https://test.com/llm-txt",
        credibilityScore: 80,
      };
      
      const summary = summarizeTrainingContext(context);
      
      expect(summary.enrichmentLevel).toBe("full");
      expect(summary.hasCredibility).toBe(true);
      expect(summary.hasPublishedPages).toBe(true);
      expect(summary.hasLlmTxt).toBe(true);
      expect(summary.credibilityFactCount).toBe(1);
      expect(summary.publishedPageCount).toBe(1);
    });

    it("should return basic level with only credibility", async () => {
      const { summarizeTrainingContext } = await import("./trainingContextEnricher");
      
      const context = {
        businessName: "Test",
        businessWebsite: null,
        businessLocation: null,
        businessType: null,
        credibilityFacts: [{ category: "test", fact: "test", confidence: "high" as const }],
        publishedPages: [],
        llmTxtUrl: null,
        credibilityScore: null,
      };
      
      const summary = summarizeTrainingContext(context);
      expect(summary.enrichmentLevel).toBe("basic");
    });

    it("should return moderate level with credibility + pages but no llm.txt", async () => {
      const { summarizeTrainingContext } = await import("./trainingContextEnricher");
      
      const context = {
        businessName: "Test",
        businessWebsite: null,
        businessLocation: null,
        businessType: null,
        credibilityFacts: [{ category: "test", fact: "test", confidence: "high" as const }],
        publishedPages: [{ pageType: "about", title: "About", url: "https://test.com/about", slug: "about" }],
        llmTxtUrl: null,
        credibilityScore: null,
      };
      
      const summary = summarizeTrainingContext(context);
      expect(summary.enrichmentLevel).toBe("moderate");
    });
  });
});

// ─── Sprint 12: Smart Scheduler Tests ────────────────────────────────────────

describe("Smart Scheduler", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("getScheduleConfig", () => {
    it("should return aggressive config", async () => {
      const { getScheduleConfig } = await import("./smartScheduler");
      
      const config = getScheduleConfig("aggressive");
      
      expect(config.mode).toBe("aggressive");
      expect(config.trainingsPerDay).toBe(3);
      expect(config.rankCheckFrequency).toBe("daily");
      expect(config.retryIntervalMinutes).toBe(15);
      expect(config.iterationsPerSession).toBe(10);
    });

    it("should return moderate config", async () => {
      const { getScheduleConfig } = await import("./smartScheduler");
      
      const config = getScheduleConfig("moderate");
      
      expect(config.mode).toBe("moderate");
      expect(config.trainingsPerDay).toBe(1);
      expect(config.rankCheckFrequency).toBe("daily");
    });

    it("should return maintenance config", async () => {
      const { getScheduleConfig } = await import("./smartScheduler");
      
      const config = getScheduleConfig("maintenance");
      
      expect(config.mode).toBe("maintenance");
      expect(config.trainingsPerDay).toBeLessThan(1);
      expect(config.rankCheckFrequency).toBe("weekly");
    });
  });

  describe("getAllScheduleConfigs", () => {
    it("should return all three configs", async () => {
      const { getAllScheduleConfigs } = await import("./smartScheduler");
      
      const configs = getAllScheduleConfigs();
      
      expect(configs).toHaveProperty("aggressive");
      expect(configs).toHaveProperty("moderate");
      expect(configs).toHaveProperty("maintenance");
      expect(configs.aggressive.trainingsPerDay).toBeGreaterThan(configs.moderate.trainingsPerDay);
      expect(configs.moderate.trainingsPerDay).toBeGreaterThan(configs.maintenance.trainingsPerDay);
    });
  });

  describe("schedule progression logic", () => {
    it("aggressive should have more iterations than moderate", async () => {
      const { getScheduleConfig } = await import("./smartScheduler");
      
      const aggressive = getScheduleConfig("aggressive");
      const moderate = getScheduleConfig("moderate");
      const maintenance = getScheduleConfig("maintenance");
      
      expect(aggressive.iterationsPerSession).toBeGreaterThan(moderate.iterationsPerSession);
      expect(moderate.iterationsPerSession).toBeGreaterThan(maintenance.iterationsPerSession);
    });

    it("retry intervals should increase with less aggressive modes", async () => {
      const { getScheduleConfig } = await import("./smartScheduler");
      
      const aggressive = getScheduleConfig("aggressive");
      const moderate = getScheduleConfig("moderate");
      const maintenance = getScheduleConfig("maintenance");
      
      expect(aggressive.retryIntervalMinutes).toBeLessThan(moderate.retryIntervalMinutes);
      expect(moderate.retryIntervalMinutes).toBeLessThan(maintenance.retryIntervalMinutes);
    });
  });
});

// ─── Sprint 13: Win Notifications Tests ──────────────────────────────────────

describe("Win Notifications", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe("formatWinsForClient", () => {
    it("should format wins with human-readable platform names", async () => {
      const { formatWinsForClient } = await import("./winNotifications");
      
      const wins = [
        {
          campaignId: 1,
          businessName: "Test Biz",
          winType: "new_mention" as const,
          platform: "chatgpt",
          query: "best plumber dallas",
          location: "Dallas, TX",
          previousPosition: null,
          newPosition: 2,
          description: "Test Biz is now mentioned by ChatGPT!",
          significance: "major" as const,
          detectedAt: new Date("2025-01-15"),
        },
        {
          campaignId: 1,
          businessName: "Test Biz",
          winType: "first_position" as const,
          platform: "ai_overview",
          query: "plumber near me",
          location: "Dallas, TX",
          previousPosition: 3,
          newPosition: 1,
          description: "Test Biz moved to #1 on AI Overview!",
          significance: "breakthrough" as const,
          detectedAt: new Date("2025-01-15"),
        },
      ];
      
      const formatted = formatWinsForClient(wins);
      
      expect(formatted).toHaveLength(2);
      expect(formatted[0].platform).toBe("ChatGPT");
      expect(formatted[0].type).toBe("new mention");
      expect(formatted[1].platform).toBe("AI Overview");
      expect(formatted[1].type).toBe("first position");
    });

    it("should handle empty wins array", async () => {
      const { formatWinsForClient } = await import("./winNotifications");
      
      const formatted = formatWinsForClient([]);
      expect(formatted).toHaveLength(0);
    });
  });

  describe("getCelebrationMessage", () => {
    it("should return appropriate messages for each significance level", async () => {
      const { getCelebrationMessage } = await import("./winNotifications");
      
      expect(getCelebrationMessage("breakthrough")).toContain("breakthrough");
      expect(getCelebrationMessage("major")).toContain("progress");
      expect(getCelebrationMessage("moderate")).toContain("improvement");
      expect(getCelebrationMessage("minor")).toContain("steady");
      expect(getCelebrationMessage("unknown")).toContain("improving");
    });
  });

  describe("win type classification", () => {
    it("should correctly identify new mentions vs position improvements", async () => {
      const { formatWinsForClient } = await import("./winNotifications");
      
      const newMention = {
        campaignId: 1,
        businessName: "Test",
        winType: "new_mention" as const,
        platform: "gemini",
        query: "test query",
        location: "Test City",
        previousPosition: null,
        newPosition: 3,
        description: "New mention!",
        significance: "major" as const,
        detectedAt: new Date(),
      };
      
      const posImprovement = {
        campaignId: 1,
        businessName: "Test",
        winType: "position_improvement" as const,
        platform: "chatgpt",
        query: "test query",
        location: "Test City",
        previousPosition: 5,
        newPosition: 2,
        description: "Improved!",
        significance: "moderate" as const,
        detectedAt: new Date(),
      };
      
      const formatted = formatWinsForClient([newMention, posImprovement]);
      
      expect(formatted[0].type).toBe("new mention");
      expect(formatted[0].platform).toBe("Gemini");
      expect(formatted[1].type).toBe("position improvement");
      expect(formatted[1].platform).toBe("ChatGPT");
    });
  });

  describe("multi-platform win detection", () => {
    it("should format multi-platform wins correctly", async () => {
      const { formatWinsForClient } = await import("./winNotifications");
      
      const multiPlatformWin = {
        campaignId: 1,
        businessName: "Test",
        winType: "multi_platform" as const,
        platform: "multiple",
        query: "test query",
        location: "Test City",
        previousPosition: null,
        newPosition: null,
        description: "Now on ChatGPT + Gemini!",
        significance: "major" as const,
        detectedAt: new Date(),
      };
      
      const formatted = formatWinsForClient([multiPlatformWin]);
      
      expect(formatted[0].type).toBe("multi platform");
      expect(formatted[0].platform).toBe("multiple");
    });
  });
});

// ─── Integration: All Sprints Work Together ──────────────────────────────────

describe("Sprint 11-13 Integration", () => {
  it("training context enricher exports all required functions", async () => {
    const mod = await import("./trainingContextEnricher");
    
    expect(typeof mod.buildTrainingContext).toBe("function");
    expect(typeof mod.buildEnrichedSystemMessage).toBe("function");
    expect(typeof mod.buildSourceCitationBlock).toBe("function");
    expect(typeof mod.getTrainingContextForCampaign).toBe("function");
    expect(typeof mod.getTrainingContextForSession).toBe("function");
    expect(typeof mod.summarizeTrainingContext).toBe("function");
  });

  it("smart scheduler exports all required functions", async () => {
    const mod = await import("./smartScheduler");
    
    expect(typeof mod.getScheduleConfig).toBe("function");
    expect(typeof mod.getAllScheduleConfigs).toBe("function");
    expect(typeof mod.recommendMode).toBe("function");
    expect(typeof mod.applyCampaignModeChange).toBe("function");
    expect(typeof mod.getCampaignScheduleStatus).toBe("function");
    expect(typeof mod.getAllCampaignScheduleStatuses).toBe("function");
    expect(typeof mod.checkAutoRecovery).toBe("function");
    expect(typeof mod.evaluateAndApplyModeChanges).toBe("function");
  });

  it("win notifications exports all required functions", async () => {
    const mod = await import("./winNotifications");
    
    expect(typeof mod.detectWins).toBe("function");
    expect(typeof mod.generateWinReport).toBe("function");
    expect(typeof mod.notifyAdminOfWins).toBe("function");
    expect(typeof mod.checkAllCampaignsForWins).toBe("function");
    expect(typeof mod.formatWinsForClient).toBe("function");
    expect(typeof mod.getCelebrationMessage).toBe("function");
  });
});
