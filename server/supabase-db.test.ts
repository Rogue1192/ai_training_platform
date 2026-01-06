import { describe, it, expect } from "vitest";
import postgres from "postgres";

describe("Supabase Database Connection", () => {
  it("should connect to Supabase PostgreSQL database", async () => {
    const databaseUrl = process.env.SUPABASE_DATABASE_URL;
    
    // Check environment variable is set
    expect(databaseUrl).toBeDefined();
    expect(databaseUrl).toContain("pooler.supabase.com");
    
    // Try to connect
    const sql = postgres(databaseUrl!, {
      ssl: 'require',
      connect_timeout: 30,
    });
    
    // Run a simple query
    const result = await sql`SELECT 1 as test`;
    expect(result).toBeDefined();
    expect(result[0].test).toBe(1);
    
    // Check if users table exists
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'users'
    `;
    
    console.log("Tables found:", tables);
    
    // Close connection
    await sql.end();
  }, 30000); // 30 second timeout
});
