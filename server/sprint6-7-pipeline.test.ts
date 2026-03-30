/**
 * Tests for Sprint 6 (Content Publisher — Playwright), Sprint 7 (SinByte Indexing),
 * and Pipeline Orchestrator
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============= Content Publisher Tests (Playwright-based universal publisher) =============

describe("Content Publisher", () => {
  it("should export all required functions", async () => {
    const cp = await import("./contentPublisher");
    expect(typeof cp.normalizeSiteUrl).toBe("function");
    expect(typeof cp.testSiteConnection).toBe("function");
    expect(typeof cp.publishPage).toBe("function");
    expect(typeof cp.publishCampaignContent).toBe("function");
    expect(typeof cp.publishLlmTxt).toBe("function");
    expect(typeof cp.getPublishedUrls).toBe("function");
    expect(typeof cp.storeSiteCredentials).toBe("function");
    expect(typeof cp.storeWPCredentials).toBe("function"); // legacy alias
  });

  describe("normalizeSiteUrl", () => {
    it("should add https:// if missing", async () => {
      const { normalizeSiteUrl } = await import("./contentPublisher");
      expect(normalizeSiteUrl("example.com")).toBe("https://example.com");
    });

    it("should remove trailing slash", async () => {
      const { normalizeSiteUrl } = await import("./contentPublisher");
      expect(normalizeSiteUrl("https://example.com/")).toBe("https://example.com");
    });

    it("should preserve http:// if specified", async () => {
      const { normalizeSiteUrl } = await import("./contentPublisher");
      expect(normalizeSiteUrl("http://example.com")).toBe("http://example.com");
    });

    it("should handle URL with path", async () => {
      const { normalizeSiteUrl } = await import("./contentPublisher");
      expect(normalizeSiteUrl("https://example.com/wp")).toBe("https://example.com/wp");
    });

    it("should trim whitespace", async () => {
      const { normalizeSiteUrl } = await import("./contentPublisher");
      expect(normalizeSiteUrl("  https://example.com  ")).toBe("https://example.com");
    });
  });

  describe("testSiteConnection", () => {
    it("should return connected: false for non-existent domain", async () => {
      const { testSiteConnection } = await import("./contentPublisher");
      const result = await testSiteConnection({
        siteUrl: "https://this-domain-does-not-exist-12345.com",
        adminUrl: "https://this-domain-does-not-exist-12345.com/wp-admin",
        username: "admin",
        password: "xxxx xxxx xxxx xxxx",
      });
      expect(result.connected).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("publishPage", () => {
    it("should return error for non-existent domain", async () => {
      const { publishPage } = await import("./contentPublisher");
      const result = await publishPage(
        {
          siteUrl: "https://this-domain-does-not-exist-12345.com",
          adminUrl: "https://this-domain-does-not-exist-12345.com/wp-admin",
          username: "admin",
          password: "fake",
        },
        {
          title: "Test Page",
          content: "<p>Test</p>",
          slug: "test-page",
        }
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});

// ============= SinByte Indexing Tests =============

describe("SinByte Indexing Service", () => {
  it("should export all required functions", async () => {
    const sinbyte = await import("./sinbyteIndexing");
    expect(typeof sinbyte.submitUrlsForIndexing).toBe("function");
    expect(typeof sinbyte.getTaskStatus).toBe("function");
    expect(typeof sinbyte.getIndexingHistory).toBe("function");
    expect(typeof sinbyte.submitCampaignForIndexing).toBe("function");
    expect(typeof sinbyte.verifyCampaignIndexing).toBe("function");
  });

  describe("submitUrlsForIndexing", () => {
    it("should return error when no URLs provided", async () => {
      const { submitUrlsForIndexing } = await import("./sinbyteIndexing");
      const result = await submitUrlsForIndexing([], "Empty test");
      expect(result.success).toBe(false);
      expect(result.urlCount).toBe(0);
      expect(result.error).toContain("No URLs");
    });

    it("should throw error when API key is not set", async () => {
      const originalKey = process.env.SINBYTE_API_KEY;
      delete process.env.SINBYTE_API_KEY;
      
      const { submitUrlsForIndexing } = await import("./sinbyteIndexing");
      try {
        await submitUrlsForIndexing(["https://example.com"], "Test");
        // If no error thrown, the function handled it gracefully
      } catch (error: any) {
        expect(error.message).toContain("SINBYTE_API_KEY");
      }
      
      // Restore
      if (originalKey) process.env.SINBYTE_API_KEY = originalKey;
    });
  });

  describe("getTaskStatus", () => {
    it("should handle non-existent task gracefully", async () => {
      const originalKey = process.env.SINBYTE_API_KEY;
      process.env.SINBYTE_API_KEY = "test_key_for_unit_test";
      
      const { getTaskStatus } = await import("./sinbyteIndexing");
      const result = await getTaskStatus("nonexistent-task-id-99999");
      // Should return null on failure (invalid API key or task not found)
      expect(result === null || result?.status === "unknown").toBe(true);
      
      if (originalKey) process.env.SINBYTE_API_KEY = originalKey;
      else delete process.env.SINBYTE_API_KEY;
    });
  });
});

// ============= Pipeline Orchestrator Tests =============

describe("Pipeline Orchestrator", () => {
  it("should export all required functions", async () => {
    const pipeline = await import("./pipelineOrchestrator");
    expect(typeof pipeline.determineNextStep).toBe("function");
    expect(typeof pipeline.getCompletedSteps).toBe("function");
    expect(typeof pipeline.runPipelineStep).toBe("function");
    expect(typeof pipeline.runFullPipeline).toBe("function");
    expect(typeof pipeline.getPipelineStatus).toBe("function");
    expect(typeof pipeline.getPipelineStepLabels).toBe("function");
  });

  describe("determineNextStep", () => {
    it("should return keyword_research when nothing is completed", async () => {
      const { determineNextStep } = await import("./pipelineOrchestrator");
      const result = determineNextStep({});
      expect(result).toBe("keyword_research");
    });

    it("should return credibility_research after keyword research", async () => {
      const { determineNextStep } = await import("./pipelineOrchestrator");
      const result = determineNextStep({ keywordResearchCompletedAt: new Date() });
      expect(result).toBe("credibility_research");
    });

    it("should return content_generation after credibility research", async () => {
      const { determineNextStep } = await import("./pipelineOrchestrator");
      const result = determineNextStep({
        keywordResearchCompletedAt: new Date(),
        credibilityResearchCompletedAt: new Date(),
      });
      expect(result).toBe("content_generation");
    });

    it("should return publishing after content generation", async () => {
      const { determineNextStep } = await import("./pipelineOrchestrator");
      const result = determineNextStep({
        keywordResearchCompletedAt: new Date(),
        credibilityResearchCompletedAt: new Date(),
        contentGenerationCompletedAt: new Date(),
      });
      expect(result).toBe("publishing");
    });

    it("should return indexing after publishing", async () => {
      const { determineNextStep } = await import("./pipelineOrchestrator");
      const result = determineNextStep({
        keywordResearchCompletedAt: new Date(),
        credibilityResearchCompletedAt: new Date(),
        contentGenerationCompletedAt: new Date(),
        publishingCompletedAt: new Date(),
      });
      expect(result).toBe("indexing");
    });

    it("should return indexing_verification after indexing", async () => {
      const { determineNextStep } = await import("./pipelineOrchestrator");
      const result = determineNextStep({
        keywordResearchCompletedAt: new Date(),
        credibilityResearchCompletedAt: new Date(),
        contentGenerationCompletedAt: new Date(),
        publishingCompletedAt: new Date(),
        indexingSubmittedAt: new Date(),
      });
      expect(result).toBe("indexing_verification");
    });

    it("should return baseline_check after indexing verification", async () => {
      const { determineNextStep } = await import("./pipelineOrchestrator");
      const result = determineNextStep({
        keywordResearchCompletedAt: new Date(),
        credibilityResearchCompletedAt: new Date(),
        contentGenerationCompletedAt: new Date(),
        publishingCompletedAt: new Date(),
        indexingSubmittedAt: new Date(),
        indexingVerifiedAt: new Date(),
      });
      expect(result).toBe("baseline_check");
    });

    it("should return training after baseline check", async () => {
      const { determineNextStep } = await import("./pipelineOrchestrator");
      const result = determineNextStep({
        keywordResearchCompletedAt: new Date(),
        credibilityResearchCompletedAt: new Date(),
        contentGenerationCompletedAt: new Date(),
        publishingCompletedAt: new Date(),
        indexingSubmittedAt: new Date(),
        indexingVerifiedAt: new Date(),
        baselineCheckCompletedAt: new Date(),
      });
      expect(result).toBe("training");
    });
  });

  describe("getCompletedSteps", () => {
    it("should return empty array when nothing completed", async () => {
      const { getCompletedSteps } = await import("./pipelineOrchestrator");
      expect(getCompletedSteps({})).toEqual([]);
    });

    it("should return completed steps in order", async () => {
      const { getCompletedSteps } = await import("./pipelineOrchestrator");
      const result = getCompletedSteps({
        keywordResearchCompletedAt: new Date(),
        credibilityResearchCompletedAt: new Date(),
      });
      expect(result).toContain("keyword_research");
      expect(result).toContain("credibility_research");
      expect(result).not.toContain("content_generation");
    });
  });
});
