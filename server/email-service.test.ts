import { describe, it, expect, vi, beforeEach } from "vitest";

// Must mock at top level before any imports
const mockSend = vi.fn();

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: mockSend },
    domains: { list: vi.fn().mockResolvedValue({ data: { data: [] }, error: null }) },
  })),
}));

// Reset module cache so emailService picks up fresh mock each time
beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.RESEND_API_KEY = "re_test_key_123";
  mockSend.mockResolvedValue({
    data: { id: "test-msg-id-123" },
    error: null,
  });
});

describe("Email Service", () => {
  describe("sendTestEmail", () => {
    it("should send a test email successfully", async () => {
      const { sendTestEmail } = await import("./emailService");
      const result = await sendTestEmail("test@example.com");
      expect(result.success).toBe(true);
      expect(result.messageId).toBe("test-msg-id-123");
      expect(mockSend).toHaveBeenCalledOnce();
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.to).toBe("test@example.com");
      expect(callArgs.from).toContain("my.aianswerforge.com");
    });
  });

  describe("sendWinNotificationEmail", () => {
    it("should send a win notification email with correct data", async () => {
      const { sendWinNotificationEmail } = await import("./emailService");
      const result = await sendWinNotificationEmail({
        businessName: "Acme HVAC",
        contactName: "John",
        contactEmail: "john@acmehvac.com",
        totalWins: 3,
        wins: [
          { platform: "ChatGPT", query: "best hvac repair dallas", location: "Dallas, TX", message: "Acme HVAC is now the #1 recommendation!", significance: "breakthrough" },
          { platform: "Gemini", query: "ac installation near me", location: "Dallas, TX", message: "Now mentioned by Gemini!", significance: "major" },
          { platform: "AI Overview", query: "emergency hvac service", location: "Dallas, TX", message: "Improved from #5 to #2", significance: "moderate" },
        ],
        currentScore: 72,
        previousScore: 35,
        dashboardUrl: "https://example.com/report/abc123",
      });
      expect(result.success).toBe(true);
      expect(result.messageId).toBe("test-msg-id-123");
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.to).toBe("john@acmehvac.com");
      expect(callArgs.subject).toContain("3 New AI Visibility Wins");
      expect(callArgs.html).toContain("Acme HVAC");
    });

    it("should handle wins with no previous score", async () => {
      const { sendWinNotificationEmail } = await import("./emailService");
      const result = await sendWinNotificationEmail({
        businessName: "Test Biz",
        contactName: "Jane",
        contactEmail: "jane@test.com",
        totalWins: 1,
        wins: [{ platform: "ChatGPT", query: "test query", location: "Austin, TX", message: "First mention!", significance: "major" }],
        currentScore: 15,
        previousScore: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("sendVisibilityReportEmail", () => {
    it("should send a visibility report with full data", async () => {
      const { sendVisibilityReportEmail } = await import("./emailService");
      const result = await sendVisibilityReportEmail({
        businessName: "Acme HVAC",
        contactName: "John",
        contactEmail: "john@acmehvac.com",
        currentScore: 65,
        baselineScore: 8,
        previousScore: 52,
        chatgptScore: 72,
        geminiScore: 58,
        aiOverviewScore: 61,
        mentionedQueries: 18,
        totalQueries: 25,
        topWins: [
          { query: "best hvac repair", platform: "ChatGPT", position: 1 },
          { query: "ac installation", platform: "Gemini", position: 2 },
        ],
        dashboardUrl: "https://example.com/report/abc123",
        reportPeriod: "March 2026",
      });
      expect(result.success).toBe(true);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.subject).toContain("AI Visibility Report");
      expect(callArgs.html).toContain("65"); // current score
      expect(callArgs.html).toContain("ChatGPT");
    });

    it("should handle report with no baseline", async () => {
      const { sendVisibilityReportEmail } = await import("./emailService");
      const result = await sendVisibilityReportEmail({
        businessName: "New Biz",
        contactName: "Jane",
        contactEmail: "jane@new.com",
        currentScore: 20,
        baselineScore: null,
        previousScore: null,
        chatgptScore: 25,
        geminiScore: 15,
        aiOverviewScore: 18,
        mentionedQueries: 5,
        totalQueries: 20,
        topWins: [],
        reportPeriod: "March 2026",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("sendWelcomeEmail", () => {
    it("should send a welcome email", async () => {
      const { sendWelcomeEmail } = await import("./emailService");
      const result = await sendWelcomeEmail({
        businessName: "Acme HVAC",
        contactName: "John",
        contactEmail: "john@acmehvac.com",
        packageName: "AI Visibility Pro",
        dashboardUrl: "https://example.com/report/abc123",
      });
      expect(result.success).toBe(true);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.subject).toContain("Welcome to AI Answer Forge");
    });
  });

  describe("sendMilestoneEmail", () => {
    it("should send a milestone email", async () => {
      const { sendMilestoneEmail } = await import("./emailService");
      const result = await sendMilestoneEmail({
        businessName: "Acme HVAC",
        contactName: "John",
        contactEmail: "john@acmehvac.com",
        milestone: "Content Published",
        milestoneDescription: "8 AI-optimized pages are now live on your website",
        nextStep: "We're now submitting URLs for fast Google indexing",
        dashboardUrl: "https://example.com/report/abc123",
      });
      expect(result.success).toBe(true);
      const callArgs = mockSend.mock.calls[0][0];
      expect(callArgs.subject).toContain("Content Published");
    });
  });

  describe("Preview Functions", () => {
    it("should generate win email preview HTML", async () => {
      const { previewWinEmail } = await import("./emailService");
      const html = previewWinEmail({
        businessName: "Test Biz",
        contactName: "John",
        contactEmail: "john@test.com",
        totalWins: 2,
        wins: [
          { platform: "ChatGPT", query: "test", location: "Dallas", message: "Win!", significance: "major" },
          { platform: "Gemini", query: "test2", location: "Dallas", message: "Win2!", significance: "minor" },
        ],
        currentScore: 50,
        previousScore: 20,
      });
      expect(html).toContain("AI Answer Forge");
      expect(html).toContain("Test Biz");
      expect(html).toContain("2 New Win");
      expect(html).toContain("50"); // current score
      expect(html).toContain("my.aianswerforge.com");
    });

    it("should generate visibility report preview HTML", async () => {
      const { previewVisibilityReportEmail } = await import("./emailService");
      const html = previewVisibilityReportEmail({
        businessName: "Test Biz",
        contactName: "John",
        contactEmail: "john@test.com",
        currentScore: 65,
        baselineScore: 8,
        previousScore: 52,
        chatgptScore: 72,
        geminiScore: 58,
        aiOverviewScore: 61,
        mentionedQueries: 18,
        totalQueries: 25,
        topWins: [],
        reportPeriod: "March 2026",
      });
      expect(html).toContain("Visibility Report");
      expect(html).toContain("Test Biz");
      expect(html).toContain("65");
      expect(html).toContain("ChatGPT");
      expect(html).toContain("Gemini");
      expect(html).toContain("AI Overview");
    });

    it("should generate welcome email preview HTML", async () => {
      const { previewWelcomeEmail } = await import("./emailService");
      const html = previewWelcomeEmail({
        businessName: "Test Biz",
        contactName: "John",
        contactEmail: "john@test.com",
        packageName: "AI Visibility Pro",
      });
      expect(html).toContain("Welcome to AI Answer Forge");
      expect(html).toContain("Test Biz");
      expect(html).toContain("AI Visibility Pro");
    });
  });

  describe("Score Color and Label Helpers", () => {
    it("should use correct colors in email HTML based on score", async () => {
      const { previewWinEmail } = await import("./emailService");

      // High score (green - dominating)
      const highHtml = previewWinEmail({
        businessName: "Test", contactName: "J", contactEmail: "j@t.com",
        totalWins: 1, wins: [{ platform: "ChatGPT", query: "q", location: "l", message: "m", significance: "major" }],
        currentScore: 75, previousScore: null,
      });
      expect(highHtml).toContain("#22c55e"); // green
      expect(highHtml).toContain("Dominating");

      // Low score (red - barely visible)
      const lowHtml = previewWinEmail({
        businessName: "Test", contactName: "J", contactEmail: "j@t.com",
        totalWins: 1, wins: [{ platform: "ChatGPT", query: "q", location: "l", message: "m", significance: "minor" }],
        currentScore: 5, previousScore: null,
      });
      expect(lowHtml).toContain("#ef4444"); // red
      expect(lowHtml).toContain("Barely Visible");
    });
  });

  describe("Error Handling", () => {
    it("should handle Resend API errors gracefully", async () => {
      mockSend.mockResolvedValueOnce({
        data: null,
        error: { message: "Rate limit exceeded", name: "rate_limit_error" },
      });
      const { sendTestEmail } = await import("./emailService");
      const result = await sendTestEmail("test@example.com");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Rate limit exceeded");
    });

    it("should handle thrown exceptions", async () => {
      mockSend.mockRejectedValueOnce(new Error("Network timeout"));
      const { sendTestEmail } = await import("./emailService");
      const result = await sendTestEmail("test@example.com");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Network timeout");
    });
  });
});
