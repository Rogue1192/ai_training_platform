import { describe, it, expect } from "vitest";
import Redis from "ioredis";

describe("Redis Connection", () => {
  it("should connect to Redis successfully", async () => {
    console.log(`Connecting to Redis at ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
    
    const redis = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 1,
      connectTimeout: 15000,
      commandTimeout: 10000,
    });

    try {
      // Test basic operations
      const pingResult = await redis.ping();
      expect(pingResult).toBe("PONG");
      
      // Test set/get
      const testKey = `aaf-test-${Date.now()}`;
      await redis.set(testKey, "test-value", "EX", 60);
      const value = await redis.get(testKey);
      expect(value).toBe("test-value");
      
      // Cleanup
      await redis.del(testKey);
      
      console.log("Redis connection successful!");
      console.log(`Connected to: ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
    } finally {
      await redis.quit();
    }
  }, 20000); // 20 second timeout for the test
});
