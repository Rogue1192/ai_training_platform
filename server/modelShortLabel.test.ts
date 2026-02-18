import { describe, it, expect } from "vitest";

/**
 * Tests for the getModelShortLabel helper used in the ScheduledJobs
 * training session picker. Validates that AI model names are correctly
 * mapped to short, readable labels.
 */

// Mirror of the client-side function for testing
function getModelShortLabel(model: string): string {
  const map: Record<string, string> = {
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-3.5-turbo": "GPT-3.5",
    "claude-sonnet-4-20250514": "Claude Sonnet 4",
    "claude-3-5-sonnet-20241022": "Claude 3.5 Sonnet",
    "claude-3-haiku-20240307": "Claude 3 Haiku",
    "gemini-2.0-flash": "Gemini 2.0 Flash",
    "gemini-2.0-flash-exp": "Gemini 2.0 Flash",
    "gemini-1.5-pro": "Gemini 1.5 Pro",
    "gemini-1.5-flash": "Gemini 1.5 Flash",
  };
  return map[model] || model;
}

describe("getModelShortLabel", () => {
  it("should map OpenAI models to short labels", () => {
    expect(getModelShortLabel("gpt-4o")).toBe("GPT-4o");
    expect(getModelShortLabel("gpt-4o-mini")).toBe("GPT-4o Mini");
    expect(getModelShortLabel("gpt-4-turbo")).toBe("GPT-4 Turbo");
    expect(getModelShortLabel("gpt-3.5-turbo")).toBe("GPT-3.5");
  });

  it("should map Anthropic models to short labels", () => {
    expect(getModelShortLabel("claude-sonnet-4-20250514")).toBe("Claude Sonnet 4");
    expect(getModelShortLabel("claude-3-5-sonnet-20241022")).toBe("Claude 3.5 Sonnet");
    expect(getModelShortLabel("claude-3-haiku-20240307")).toBe("Claude 3 Haiku");
  });

  it("should map Google models to short labels", () => {
    expect(getModelShortLabel("gemini-2.0-flash")).toBe("Gemini 2.0 Flash");
    expect(getModelShortLabel("gemini-1.5-pro")).toBe("Gemini 1.5 Pro");
    expect(getModelShortLabel("gemini-1.5-flash")).toBe("Gemini 1.5 Flash");
  });

  it("should map deprecated models to their current label", () => {
    expect(getModelShortLabel("gemini-2.0-flash-exp")).toBe("Gemini 2.0 Flash");
  });

  it("should return the raw model name for unknown models", () => {
    expect(getModelShortLabel("some-future-model")).toBe("some-future-model");
    expect(getModelShortLabel("gpt-5")).toBe("gpt-5");
  });

  it("should handle empty string", () => {
    expect(getModelShortLabel("")).toBe("");
  });
});
