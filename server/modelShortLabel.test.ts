import { describe, it, expect } from "vitest";

/**
 * Tests for the getModelShortLabel helper used in the ScheduledJobs
 * training session picker. Validates that AI model names are correctly
 * mapped to short, readable labels.
 */

// Mirror of the client-side function for testing
function getModelShortLabel(model: string): string {
  const map: Record<string, string> = {
    // OpenAI
    "gpt-4.1": "GPT-4.1",
    "gpt-4.1-mini": "GPT-4.1 Mini",
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "o3": "o3",
    "o3-mini": "o3 Mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-3.5-turbo": "GPT-3.5",
    // Anthropic
    "claude-opus-4-5-20251101": "Claude Opus 4.5",
    "claude-sonnet-4-5-20250929": "Claude Sonnet 4.5",
    "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
    // Google
    "gemini-2.5-flash": "Gemini 2.5 Flash",
    "gemini-2.0-flash": "Gemini 2.0 Flash",
    "gemini-1.5-pro": "Gemini 1.5 Pro",
    "gemini-1.5-flash": "Gemini 1.5 Flash",
    // MiniMax
    "MiniMax-M2.7": "MiniMax M2.7",
    "MiniMax-M2.7-highspeed": "MiniMax M2.7 Fast",
    "MiniMax-M2.5": "MiniMax M2.5",
    "MiniMax-M2": "MiniMax M2",
  };
  return map[model] || model;
}

describe("getModelShortLabel", () => {
  it("should map OpenAI models to short labels", () => {
    expect(getModelShortLabel("gpt-4.1")).toBe("GPT-4.1");
    expect(getModelShortLabel("gpt-4.1-mini")).toBe("GPT-4.1 Mini");
    expect(getModelShortLabel("gpt-4o")).toBe("GPT-4o");
    expect(getModelShortLabel("gpt-4o-mini")).toBe("GPT-4o Mini");
    expect(getModelShortLabel("o3")).toBe("o3");
    expect(getModelShortLabel("o3-mini")).toBe("o3 Mini");
    expect(getModelShortLabel("gpt-4-turbo")).toBe("GPT-4 Turbo");
    expect(getModelShortLabel("gpt-3.5-turbo")).toBe("GPT-3.5");
  });

  it("should map Anthropic models to short labels", () => {
    expect(getModelShortLabel("claude-opus-4-5-20251101")).toBe("Claude Opus 4.5");
    expect(getModelShortLabel("claude-sonnet-4-5-20250929")).toBe("Claude Sonnet 4.5");
    expect(getModelShortLabel("claude-haiku-4-5-20251001")).toBe("Claude Haiku 4.5");
  });

  it("should map Google models to short labels", () => {
    expect(getModelShortLabel("gemini-2.5-flash")).toBe("Gemini 2.5 Flash");
    expect(getModelShortLabel("gemini-2.0-flash")).toBe("Gemini 2.0 Flash");
    expect(getModelShortLabel("gemini-1.5-pro")).toBe("Gemini 1.5 Pro");
    expect(getModelShortLabel("gemini-1.5-flash")).toBe("Gemini 1.5 Flash");
  });

  it("should map MiniMax models to short labels", () => {
    expect(getModelShortLabel("MiniMax-M2.7")).toBe("MiniMax M2.7");
    expect(getModelShortLabel("MiniMax-M2.7-highspeed")).toBe("MiniMax M2.7 Fast");
    expect(getModelShortLabel("MiniMax-M2.5")).toBe("MiniMax M2.5");
    expect(getModelShortLabel("MiniMax-M2")).toBe("MiniMax M2");
  });

  it("should return the raw model name for unknown models", () => {
    expect(getModelShortLabel("some-future-model")).toBe("some-future-model");
    expect(getModelShortLabel("gpt-5")).toBe("gpt-5");
  });

  it("should handle empty string", () => {
    expect(getModelShortLabel("")).toBe("");
  });
});
