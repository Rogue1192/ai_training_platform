/**
 * Sprint 14: Admin Dashboard Overhaul Tests
 * 
 * Tests for the new Campaign Detail pipeline view, Prompt Templates management,
 * and navigation updates.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ============= Pipeline Orchestrator Status Tests =============

describe("Pipeline Status", () => {
  it("should define all 8 pipeline steps", () => {
    const steps = [
      "keyword_research",
      "credibility_research",
      "content_generation",
      "publishing",
      "indexing",
      "indexing_verification",
      "baseline_check",
      "training",
    ];
    expect(steps).toHaveLength(8);
    expect(steps[0]).toBe("keyword_research");
    expect(steps[7]).toBe("training");
  });

  it("should map status timestamps correctly", () => {
    const statusTimestampMap: Record<string, string> = {
      keyword_research: "keywordResearchCompletedAt",
      credibility_research: "credibilityResearchCompletedAt",
      content_generation: "contentGenerationCompletedAt",
      publishing: "publishingCompletedAt",
      indexing: "indexingSubmittedAt",
      indexing_verification: "indexingVerifiedAt",
      baseline_check: "baselineCheckCompletedAt",
      training: "trainingStartedAt",
    };
    expect(Object.keys(statusTimestampMap)).toHaveLength(8);
    expect(statusTimestampMap.keyword_research).toBe("keywordResearchCompletedAt");
    expect(statusTimestampMap.training).toBe("trainingStartedAt");
  });

  it("should compute pipeline progress correctly", () => {
    const campaign = {
      keywordResearchCompletedAt: new Date(),
      credibilityResearchCompletedAt: new Date(),
      contentGenerationCompletedAt: new Date(),
      publishingCompletedAt: null,
      indexingSubmittedAt: null,
      indexingVerifiedAt: null,
      baselineCheckCompletedAt: null,
      trainingStartedAt: null,
    };
    
    const completed = Object.values(campaign).filter(Boolean).length;
    expect(completed).toBe(3);
    expect(Math.round((completed / 8) * 100)).toBe(38);
  });

  it("should determine step status correctly", () => {
    const getStepStatus = (
      campaign: { status: string; lastError?: string },
      stepKey: string,
      isCompleted: boolean
    ) => {
      if (isCompleted) return "completed";
      if (campaign.status === stepKey) return "active";
      if (campaign.status === "error" && campaign.lastError) return "error";
      return "pending";
    };

    expect(getStepStatus({ status: "publishing" }, "keyword_research", true)).toBe("completed");
    expect(getStepStatus({ status: "publishing" }, "publishing", false)).toBe("active");
    expect(getStepStatus({ status: "error", lastError: "Failed" }, "indexing", false)).toBe("error");
    expect(getStepStatus({ status: "publishing" }, "training", false)).toBe("pending");
  });
});

// ============= Training Mode Configuration Tests =============

describe("Training Mode Configuration", () => {
  const modeConfigs: Record<string, { trainingsPerDay: number; iterationsPerSession: number; rankCheckFrequency: string }> = {
    aggressive: { trainingsPerDay: 3, iterationsPerSession: 10, rankCheckFrequency: "daily" },
    moderate: { trainingsPerDay: 1, iterationsPerSession: 5, rankCheckFrequency: "weekly" },
    maintenance: { trainingsPerDay: 0.14, iterationsPerSession: 3, rankCheckFrequency: "biweekly" },
  };

  it("should have correct aggressive mode config", () => {
    expect(modeConfigs.aggressive.trainingsPerDay).toBe(3);
    expect(modeConfigs.aggressive.iterationsPerSession).toBe(10);
    expect(modeConfigs.aggressive.rankCheckFrequency).toBe("daily");
  });

  it("should have correct moderate mode config", () => {
    expect(modeConfigs.moderate.trainingsPerDay).toBe(1);
    expect(modeConfigs.moderate.iterationsPerSession).toBe(5);
  });

  it("should have correct maintenance mode config", () => {
    expect(modeConfigs.maintenance.iterationsPerSession).toBe(3);
    expect(modeConfigs.maintenance.rankCheckFrequency).toBe("biweekly");
  });

  it("should validate mode transitions", () => {
    const validModes = ["aggressive", "moderate", "maintenance"];
    validModes.forEach((mode) => {
      expect(modeConfigs[mode]).toBeDefined();
    });
  });
});

// ============= Prompt Template Type Tests =============

describe("Prompt Template Types", () => {
  const templateTypes = ["clean", "suggestive", "follow_up", "category_based"];

  it("should support all 4 template types", () => {
    expect(templateTypes).toHaveLength(4);
    expect(templateTypes).toContain("clean");
    expect(templateTypes).toContain("suggestive");
    expect(templateTypes).toContain("follow_up");
    expect(templateTypes).toContain("category_based");
  });

  it("should have type descriptions", () => {
    const typeDescriptions: Record<string, string> = {
      clean: "Natural, conversational prompts",
      suggestive: "Prompts that guide the AI toward mentioning the business",
      follow_up: "Prompts that build on previous conversation context",
      category_based: "Prompts organized by industry or service category",
    };
    templateTypes.forEach((type) => {
      expect(typeDescriptions[type]).toBeDefined();
      expect(typeDescriptions[type].length).toBeGreaterThan(10);
    });
  });

  it("should support template variables", () => {
    const variables = ["{{business_name}}", "{{industry}}", "{{location}}", "{{website}}", "{{service_area}}"];
    expect(variables).toHaveLength(5);
    
    // Test variable replacement
    const template = "What are the best {{industry}} companies in {{location}}?";
    const result = template
      .replace("{{industry}}", "plumbing")
      .replace("{{location}}", "Dallas, TX");
    expect(result).toBe("What are the best plumbing companies in Dallas, TX?");
  });
});

// ============= Campaign Status Colors Tests =============

describe("Campaign Status Display", () => {
  const statusColors: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    keyword_research: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    credibility_research: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    content_generation: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
    publishing: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
    indexing: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    baseline_check: "bg-teal-500/10 text-teal-500 border-teal-500/20",
    training: "bg-primary/10 text-primary border-primary/20",
    monitoring: "bg-green-500/10 text-green-500 border-green-500/20",
    paused: "bg-muted text-muted-foreground border-border",
    error: "bg-destructive/10 text-destructive border-destructive/20",
  };

  it("should have colors for all 11 statuses", () => {
    expect(Object.keys(statusColors)).toHaveLength(11);
  });

  it("should have unique colors for each status", () => {
    const colors = Object.values(statusColors);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(colors.length);
  });

  it("should include error status styling", () => {
    expect(statusColors.error).toContain("destructive");
  });
});

// ============= Navigation Structure Tests =============

describe("Navigation Structure", () => {
  const navigationItems = [
    { href: "/", label: "Dashboard" },
    { href: "/campaigns", label: "Campaigns" },
    { href: "/businesses", label: "Businesses" },
    { href: "/training", label: "Training" },
    { href: "/schedule", label: "Schedule" },
    { href: "/packages", label: "Packages" },
    { href: "/client-dashboards", label: "Client Links" },
    { href: "/prompts", label: "Prompts" },
    { href: "/settings", label: "Settings" },
  ];

  it("should have 9 navigation items", () => {
    expect(navigationItems).toHaveLength(9);
  });

  it("should include the new Prompts page", () => {
    const promptsItem = navigationItems.find((n) => n.href === "/prompts");
    expect(promptsItem).toBeDefined();
    expect(promptsItem?.label).toBe("Prompts");
  });

  it("should include Client Links page", () => {
    const clientLinksItem = navigationItems.find((n) => n.href === "/client-dashboards");
    expect(clientLinksItem).toBeDefined();
    expect(clientLinksItem?.label).toBe("Client Links");
  });

  it("should have unique hrefs", () => {
    const hrefs = navigationItems.map((n) => n.href);
    const uniqueHrefs = new Set(hrefs);
    expect(uniqueHrefs.size).toBe(hrefs.length);
  });
});

// ============= Visibility Score Display Tests =============

describe("Visibility Score Display", () => {
  it("should compute score change correctly", () => {
    const currentScore = { overall: 72, chatgpt: 80, gemini: 65, aiOverview: 70, totalQueries: 10, mentionedQueries: 7, averagePosition: 2.5 };
    const baselineScore = { overall: 15, chatgpt: 10, gemini: 20, aiOverview: 15, totalQueries: 10, mentionedQueries: 2, averagePosition: 5.0 };
    
    const change = currentScore.overall - baselineScore.overall;
    expect(change).toBe(57);
    expect(change > 0 ? "+" + change : String(change)).toBe("+57");
  });

  it("should handle null baseline gracefully", () => {
    const currentScore = { overall: 45 };
    const baselineScore = null;
    
    const change = currentScore && baselineScore ? currentScore.overall - (baselineScore as any).overall : null;
    expect(change).toBeNull();
  });

  it("should format negative changes", () => {
    const change = -12;
    const formatted = change > 0 ? "+" + change : String(change);
    expect(formatted).toBe("-12");
  });
});

// ============= Win Display Tests =============

describe("Win Display", () => {
  const significanceLevels = ["minor", "moderate", "major", "breakthrough"];

  it("should support all significance levels", () => {
    expect(significanceLevels).toHaveLength(4);
  });

  it("should map significance to colors", () => {
    const colorMap: Record<string, string> = {
      breakthrough: "text-yellow-400",
      major: "text-green-400",
      moderate: "text-blue-400",
      minor: "text-blue-400",
    };
    significanceLevels.forEach((level) => {
      expect(colorMap[level]).toBeDefined();
    });
  });
});
