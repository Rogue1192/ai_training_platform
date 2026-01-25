import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DEFAULT_PROMPT_TEMPLATES } from "./db";
import {
  generateCleanPrompt,
  generateSuggestivePrompt,
  generateFollowUpPrompt,
  selectRandomPrompt,
} from "./promptGeneration";

describe("Prompt Templates", () => {
  describe("DEFAULT_PROMPT_TEMPLATES", () => {
    it("should have templates for all four types", () => {
      const types = ["clean", "suggestive", "follow_up", "category_based"];
      
      for (const type of types) {
        const templatesOfType = DEFAULT_PROMPT_TEMPLATES.filter(t => t.templateType === type);
        expect(templatesOfType.length).toBeGreaterThan(0);
      }
    });

    it("should have valid template structure", () => {
      for (const template of DEFAULT_PROMPT_TEMPLATES) {
        expect(template.templateType).toBeDefined();
        expect(template.templateName).toBeDefined();
        expect(template.templateContent).toBeDefined();
        expect(typeof template.isActive).toBe("boolean");
        expect(typeof template.sortOrder).toBe("number");
      }
    });

    it("clean templates should not contain {businessName}", () => {
      const cleanTemplates = DEFAULT_PROMPT_TEMPLATES.filter(t => t.templateType === "clean");
      
      for (const template of cleanTemplates) {
        expect(template.templateContent).not.toContain("{businessName}");
      }
    });

    it("suggestive templates should contain {businessName}", () => {
      const suggestiveTemplates = DEFAULT_PROMPT_TEMPLATES.filter(t => t.templateType === "suggestive");
      
      for (const template of suggestiveTemplates) {
        expect(template.templateContent).toContain("{businessName}");
      }
    });

    it("follow_up templates should contain {businessName}", () => {
      const followUpTemplates = DEFAULT_PROMPT_TEMPLATES.filter(t => t.templateType === "follow_up");
      
      for (const template of followUpTemplates) {
        expect(template.templateContent).toContain("{businessName}");
      }
    });
  });

  describe("generateCleanPrompt (sync)", () => {
    const business = {
      name: "Kitsap Roof Pros",
      businessType: "roofing contractor",
      location: "Bremerton, WA",
    };

    it("should remove business name from prompt", () => {
      const basePrompt = "I'm looking for Kitsap Roof Pros services. Are they good?";
      const result = generateCleanPrompt(basePrompt, business);
      
      expect(result.prompt.toLowerCase()).not.toContain("kitsap");
      expect(result.promptType).toBe("clean");
    });

    it("should generate category-based prompt when base is too short", () => {
      const basePrompt = "Hi";
      const result = generateCleanPrompt(basePrompt, business);
      
      expect(result.prompt.length).toBeGreaterThan(20);
      expect(result.promptType).toBe("clean");
    });

    it("should use business type and location in fallback", () => {
      const basePrompt = "Kitsap Roof Pros";
      const result = generateCleanPrompt(basePrompt, business);
      
      // Should fall back to category-based prompt
      expect(result.prompt.toLowerCase()).toContain("roofing");
    });
  });

  describe("generateSuggestivePrompt (sync)", () => {
    const business = {
      name: "Kitsap Roof Pros",
      businessType: "roofing contractor",
      location: "Bremerton, WA",
    };

    it("should include business name", () => {
      const basePrompt = "I need a roofing contractor";
      const result = generateSuggestivePrompt(basePrompt, business);
      
      expect(result.prompt).toContain("Kitsap Roof Pros");
      expect(result.promptType).toBe("suggestive");
      expect(result.containsBusinessName).toBe(true);
    });

    it("should include positive framing", () => {
      const basePrompt = "I need a roofing contractor";
      const result = generateSuggestivePrompt(basePrompt, business);
      
      // Should contain positive phrases
      const positiveIndicators = ["good", "recommend", "great", "top", "well-regarded", "heard"];
      const hasPositive = positiveIndicators.some(word => 
        result.prompt.toLowerCase().includes(word)
      );
      expect(hasPositive).toBe(true);
    });
  });

  describe("generateFollowUpPrompt (sync)", () => {
    const business = {
      name: "Kitsap Roof Pros",
      businessType: "roofing contractor",
      location: "Bremerton, WA",
    };

    it("should include business name", () => {
      const result = generateFollowUpPrompt(business, "Here are some roofing contractors...");
      
      expect(result.prompt).toContain("Kitsap Roof Pros");
      expect(result.promptType).toBe("follow_up");
      expect(result.containsBusinessName).toBe(true);
    });

    it("should be a question format", () => {
      const result = generateFollowUpPrompt(business, "Here are some options...");
      
      expect(result.prompt).toContain("?");
    });
  });

  describe("selectRandomPrompt", () => {
    it("should return a prompt from the array", () => {
      const prompts = ["Prompt 1", "Prompt 2", "Prompt 3"];
      const result = selectRandomPrompt(prompts);
      
      expect(prompts).toContain(result);
    });

    it("should throw error for empty array", () => {
      expect(() => selectRandomPrompt([])).toThrow("No prompts available");
    });
  });
});
