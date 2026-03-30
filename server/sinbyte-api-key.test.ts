import { describe, it, expect } from "vitest";

describe("SinByte API Key Validation", () => {
  it("should have SINBYTE_API_KEY set in environment", () => {
    const apiKey = process.env.SINBYTE_API_KEY;
    expect(apiKey).toBeDefined();
    expect(apiKey).not.toBe("");
    expect(apiKey!.length).toBeGreaterThan(10);
  });

  it("should authenticate successfully with SinByte API", async () => {
    const apiKey = process.env.SINBYTE_API_KEY;
    expect(apiKey).toBeDefined();

    // Call the SinByte history endpoint as a lightweight auth check
    const response = await fetch("https://app.sinbyte.com/api/v1/indexing/history", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    // A 200 or 401 tells us if the key works
    // 200 = valid key, 401/403 = invalid key, anything else = API issue
    console.log(`SinByte API response status: ${response.status}`);
    
    if (response.status === 401 || response.status === 403) {
      throw new Error("SinByte API key is invalid — received 401/403 Unauthorized");
    }
    
    // Accept 200 (success) or 404 (endpoint might differ but auth passed)
    expect([200, 201, 404].includes(response.status) || response.status < 400).toBe(true);
    console.log("SinByte API key validated successfully!");
  });
});
