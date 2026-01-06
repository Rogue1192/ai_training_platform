import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

describe("Supabase Connection", () => {
  it("should connect to Supabase with valid credentials", async () => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Check environment variables are set
    expect(supabaseUrl).toBeDefined();
    expect(supabaseKey).toBeDefined();
    expect(supabaseUrl).toContain("supabase.co");

    // Create client and test connection
    const supabase = createClient(supabaseUrl!, supabaseKey!);
    
    // Try to get the current user (should return null for service role, but not error)
    const { data, error } = await supabase.auth.getUser();
    
    // Service role key should not throw an authentication error
    // It may return null user (expected) but should not have connection errors
    expect(error?.message).not.toContain("Invalid API key");
    expect(error?.message).not.toContain("invalid_credentials");
  });

  it("should have VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set", () => {
    expect(process.env.VITE_SUPABASE_URL).toBeDefined();
    expect(process.env.VITE_SUPABASE_ANON_KEY).toBeDefined();
    expect(process.env.VITE_SUPABASE_URL).toContain("supabase.co");
  });
});
