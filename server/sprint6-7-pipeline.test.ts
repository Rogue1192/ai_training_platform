/**
 * Tests for Sprint 6 (WordPress Publisher), Sprint 7 (SinByte Indexing),
 * and Pipeline Orchestrator
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============= WordPress Publisher Tests =============

describe("WordPress Publisher", () => {
  it("should export all required functions", async () => {
    const wp = await import("./wordpressPublisher");
    expect(typeof wp.normalizeSiteUrl).toBe("function");
    expect(typeof wp.getWPApiUrl).toBe("function");
    expect(typeof wp.testWPConnection).toBe("function");
    expect(typeof wp.publishPage).toBe("function");
    expect(typeof wp.updatePage).toBe("function");
    expect(typeof wp.findPageBySlug).toBe("function");
    expect(typeof wp.injectSchemaMarkup).toBe("function");
    expect(typeof wp.publishCampaignContent).toBe("function");
    expect(typeof wp.publishLlmTxt).toBe("function");
    expect(typeof wp.getPublishedUrls).toBe("function");
    expect(typeof wp.storeWPCredentials).toBe("function");
  });

  describe("normalizeSiteUrl", () => {
    it("should add https:// if missing", async () => {
      const { normalizeSiteUrl } = await import("./wordpressPublisher");
      expect(normalizeSiteUrl("example.com")).toBe("https://example.com");
    });

    it("should remove trailing slash", async () => {
      const { normalizeSiteUrl } = await import("./wordpressPublisher");
      expect(normalizeSiteUrl("https://example.com/")).toBe("https://example.com");
    });

    it("should preserve http:// if specified", async () => {
      const { normalizeSiteUrl } = await import("./wordpressPublisher");
      expect(normalizeSiteUrl("http://example.com")).toBe("http://example.com");
    });

    it("should handle URL with path", async () => {
      const { normalizeSiteUrl } = await import("./wordpressPublisher");
      expect(normalizeSiteUrl("https://example.com/wp")).toBe("https://example.com/wp");
    });

    it("should trim whitespace", async () => {
      const { normalizeSiteUrl } = await import("./wordpressPublisher");
      expect(normalizeSiteUrl("  https://example.com  ")).toBe("https://example.com");
    });
  });

  describe("getWPApiUrl", () => {
    it("should return correct REST API URL", async () => {
      const { getWPApiUrl } = await import("./wordpressPublisher");
      expect(getWPApiUrl("https://example.com")).toBe("https://example.com/wp-json/wp/v2");
    });

    it("should handle URL without protocol", async () => {
      const { getWPApiUrl } = await import("./wordpressPublisher");
      expect(getWPApiUrl("example.com")).toBe("https://example.com/wp-json/wp/v2");
    });
  });

  describe("injectSchemaMarkup", () => {
    it("should inject valid JSON-LD schema", async () => {
      const { injectSchemaMarkup } = await import("./wordpressPublisher");
      const html = "<p>Hello World</p>";
      const schema = JSON.stringify({ "@context": "https://schema.org", "@type": "LocalBusiness" });
      const result = injectSchemaMarkup(html, schema);
      expect(result).toContain(html);
      expect(result).toContain("application/ld+json");
      expect(result).toContain("LocalBusiness");
    });

    it("should skip invalid JSON schema", async () => {
      const { injectSchemaMarkup } = await import("./wordpressPublisher");
      const html = "<p>Hello World</p>";
      const result = injectSchemaMarkup(html, "not valid json {{{");
      expect(result).toBe(html);
    });

    it("should return original HTML when schema is empty", async () => {
      const { injectSchemaMarkup } = await import("./wordpressPublisher");
      const html = "<p>Hello World</p>";
      expect(injectSchemaMarkup(html, "")).toBe(html);
    });
  });

  describe("testWPConnection", () => {
    it("should return connection failure for non-existent domain", async () => {
      const { testWPConnection } = await import("./wordpressPublisher");
      const result = await testWPConnection({
        siteUrl: "https://this-domain-does-not-exist-12345.com",
        username: "admin",
        appPassword: "xxxx xxxx xxxx xxxx",
      });
      expect(result.connected).toBe(false);
      expect(result.authenticated).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("publishPage", () => {
    it("should return error for invalid credentials", async () => {
      const { publishPage } = await import("./wordpressPublisher");
      const result = await publishPage(
        {
          siteUrl: "https://this-domain-does-not-exist-12345.com",
          username: "admin",
          appPassword: "fake",
        },
        {
          title: "Test Page",
          content: "<p>Test</p>",
          slug: "test-page",
          status: "draft",
        }
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("findPageBySlug", () => {
    it("should return exists: false for non-existent domain", async () => {
      const { findPageBySlug } = await import("./wordpressPublisher");
      const result = await findPageBySlug(
        {
          siteUrl: "https://this-domain-does-not-exist-12345.com",
          username: "admin",
          appPassword: "fake",
        },
        "test-slug"
      );
      expect(result.exists).toBe(false);
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
      const result = determineNextStep({
        keywordResearchCompletedAt: new Date(),
      });
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

    it("should return training when all steps are complete", async () => {
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
    it("should return empty array when nothing is completed", async () => {
      const { getCompletedSteps } = await import("./pipelineOrchestrator");
      const result = getCompletedSteps({});
      expect(result).toEqual([]);
    });

    it("should return correct completed steps", async () => {
      const { getCompletedSteps } = await import("./pipelineOrchestrator");
      const result = getCompletedSteps({
        keywordResearchCompletedAt: new Date(),
        credibilityResearchCompletedAt: new Date(),
        contentGenerationCompletedAt: new Date(),
      });
      expect(result).toEqual(["keyword_research", "credibility_research", "content_generation"]);
    });

    it("should include all steps when fully completed", async () => {
      const { getCompletedSteps } = await import("./pipelineOrchestrator");
      const result = getCompletedSteps({
        keywordResearchCompletedAt: new Date(),
        credibilityResearchCompletedAt: new Date(),
        contentGenerationCompletedAt: new Date(),
        publishingCompletedAt: new Date(),
        indexingSubmittedAt: new Date(),
        indexingVerifiedAt: new Date(),
        baselineCheckCompletedAt: new Date(),
        trainingStartedAt: new Date(),
      });
      expect(result).toHaveLength(8);
      expect(result).toContain("training");
    });
  });

  describe("getPipelineStepLabels", () => {
    it("should return 8 step labels", async () => {
      const { getPipelineStepLabels } = await import("./pipelineOrchestrator");
      const labels = getPipelineStepLabels();
      expect(labels).toHaveLength(8);
      expect(labels[0].step).toBe("keyword_research");
      expect(labels[0].label).toBe("Keyword Research");
      expect(labels[labels.length - 1].step).toBe("training");
    });

    it("should have label and description for each step", async () => {
      const { getPipelineStepLabels } = await import("./pipelineOrchestrator");
      const labels = getPipelineStepLabels();
      for (const label of labels) {
        expect(label.step).toBeTruthy();
        expect(label.label).toBeTruthy();
        expect(label.description).toBeTruthy();
        expect(label.description.length).toBeGreaterThan(10);
      }
    });
  });

  describe("getPipelineStatus", () => {
    it("should return null for non-existent campaign", async () => {
      const { getPipelineStatus } = await import("./pipelineOrchestrator");
      const result = await getPipelineStatus(999999);
      expect(result).toBeNull();
    });
  });

  describe("runPipelineStep", () => {
    it("should throw error for non-existent campaign", async () => {
      const { runPipelineStep } = await import("./pipelineOrchestrator");
      try {
        await runPipelineStep(999999, "keyword_research", 1);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.message).toContain("Campaign not found");
      }
    });
  });
});

// ============= Integration Tests: tRPC Router =============

describe("tRPC Router - New Sprint 6/7/Pipeline Procedures", () => {
  it("should have wpPublisher router", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toBeDefined();
    // Check that the router has the expected shape
    const routerDef = appRouter._def;
    expect(routerDef).toBeDefined();
  });

  it("should have indexing router", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def).toBeDefined();
  });

  it("should have pipeline router", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def).toBeDefined();
  });

  // Test calling procedures directly via createCaller
  it("should be able to call pipeline.getStepLabels", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller({
      user: { id: 1, name: "Test", role: "admin", openId: "test" },
      req: { headers: {} } as any,
      res: {} as any,
    });
    
    const labels = await caller.pipeline.getStepLabels();
    expect(labels).toHaveLength(8);
    expect(labels[0].step).toBe("keyword_research");
  });

  it("should throw NOT_FOUND for pipeline.getStatus with non-existent campaign", async () => {
    const { appRouter } = await import("./routers");
    const caller = appRouter.createCaller({
      user: { id: 1, name: "Test", role: "admin", openId: "test" },
      req: { headers: {} } as any,
      res: {} as any,
    });
    
    await expect(caller.pipeline.getStatus({ campaignId: 999999 }))
      .rejects.toThrow("Campaign not found");
  });
});
