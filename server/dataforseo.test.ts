import { describe, it, expect } from "vitest";

describe("DataForSEO API Credentials", () => {
  it("should authenticate successfully with DataForSEO API", async () => {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    expect(login).toBeTruthy();
    expect(password).toBeTruthy();

    // Use a lightweight endpoint to validate credentials
    const credentials = Buffer.from(`${login}:${password}`).toString("base64");
    const response = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    // Check that we get a successful response
    expect(response.ok).toBe(true);
    expect(data.status_code).toBe(20000);
    expect(data.status_message).toBe("Ok.");

    // Log account info for reference
    const userData = data.tasks?.[0]?.result?.[0];
    if (userData) {
      console.log(`DataForSEO Account: ${userData.login}`);
      console.log(`Balance: $${userData.money?.balance ?? "N/A"}`);
      console.log(`Rate limit: ${userData.rate_limit ?? "N/A"} req/sec`);
    }
  });

  it("should be able to call the Keywords For Site API", async () => {
    const login = process.env.DATAFORSEO_LOGIN;
    const password = process.env.DATAFORSEO_PASSWORD;

    const credentials = Buffer.from(`${login}:${password}`).toString("base64");

    // Test a lightweight call to the DataForSEO Labs endpoint
    const response = await fetch(
      "https://api.dataforseo.com/v3/dataforseo_labs/locations_and_languages",
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();
    expect(response.ok).toBe(true);
    expect(data.status_code).toBe(20000);
  });
});
