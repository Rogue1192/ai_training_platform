import { describe, it, expect } from "vitest";
import { Resend } from "resend";

describe("Resend API Key Validation", () => {
  it("should authenticate successfully with Resend API", async () => {
    const apiKey = process.env.RESEND_API_KEY;
    expect(apiKey).toBeDefined();
    expect(apiKey!.length).toBeGreaterThan(0);

    const resend = new Resend(apiKey);

    // List domains to validate the API key works
    const { data, error } = await resend.domains.list();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    console.log("Resend API key is valid. Domains:", data?.data?.map(d => d.name).join(", ") || "none");
  });
});
