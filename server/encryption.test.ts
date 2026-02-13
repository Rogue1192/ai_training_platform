import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt, clearSensitiveData } from "./encryption";

describe("Encryption System", () => {
  it("should encrypt and decrypt data correctly", () => {
    const originalText = "sk-test-api-key-12345";
    const encrypted = encrypt(originalText);
    const decrypted = decrypt(encrypted);

    expect(decrypted).toBe(originalText);
  });

  it("should produce different encrypted values for the same input (unique salts)", () => {
    const originalText = "sk-test-api-key-12345";
    const encrypted1 = encrypt(originalText);
    const encrypted2 = encrypt(originalText);

    // Encrypted values should be different due to unique salts
    expect(encrypted1).not.toBe(encrypted2);

    // But both should decrypt to the same original value
    expect(decrypt(encrypted1)).toBe(originalText);
    expect(decrypt(encrypted2)).toBe(originalText);
  });

  it("should include salt, iv, encrypted data, and tag in correct format", () => {
    const originalText = "test-data";
    const encrypted = encrypt(originalText);

    // Format should be: salt:iv:encrypted:tag
    const parts = encrypted.split(":");
    expect(parts.length).toBe(4);

    // Each part should be hex-encoded
    parts.forEach((part) => {
      expect(part).toMatch(/^[0-9a-f]+$/);
    });
  });

  it("should throw error for invalid encrypted data format", () => {
    expect(() => decrypt("invalid-format")).toThrow("Invalid encrypted data format");
    expect(() => decrypt("only:two:parts")).toThrow("Invalid encrypted data format");
  });

  it("should handle empty strings", () => {
    const encrypted = encrypt("");
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe("");
  });

  it("should handle long strings", () => {
    const longText = "a".repeat(10000);
    const encrypted = encrypt(longText);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(longText);
  });

  it("should handle special characters and unicode", () => {
    const specialText = "Hello 世界! 🔐 @#$%^&*()";
    const encrypted = encrypt(specialText);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(specialText);
  });

  it("should fail to decrypt with tampered data", () => {
    const originalText = "secret-data";
    const encrypted = encrypt(originalText);

    // Tamper with the encrypted data
    const parts = encrypted.split(":");
    parts[2] = parts[2]!.substring(0, parts[2]!.length - 2) + "ff"; // Change last byte
    const tampered = parts.join(":");

    // Decryption should fail with a helpful error message
    expect(() => decrypt(tampered)).toThrow("Unable to decrypt data");
  });

  it("should clear sensitive data from memory", () => {
    let sensitiveString = "secret-api-key";
    clearSensitiveData(sensitiveString);
    // Note: In JavaScript, we can't truly verify memory clearing,
    // but we can verify the function doesn't throw
    expect(true).toBe(true);

    const sensitiveBuffer = Buffer.from("secret-data");
    clearSensitiveData(sensitiveBuffer);
    // Buffer should be zeroed out
    expect(sensitiveBuffer.every((byte) => byte === 0)).toBe(true);
  });

  it("should use different salts for each encryption operation", () => {
    const text = "same-text";
    const encrypted1 = encrypt(text);
    const encrypted2 = encrypt(text);
    const encrypted3 = encrypt(text);

    // Extract salts
    const salt1 = encrypted1.split(":")[0];
    const salt2 = encrypted2.split(":")[0];
    const salt3 = encrypted3.split(":")[0];

    // All salts should be different
    expect(salt1).not.toBe(salt2);
    expect(salt2).not.toBe(salt3);
    expect(salt1).not.toBe(salt3);
  });

  it("should use ENCRYPTION_KEY when available", () => {
    // ENCRYPTION_KEY should be set in the test environment
    expect(process.env.ENCRYPTION_KEY).toBeDefined();
    expect(process.env.ENCRYPTION_KEY!.length).toBeGreaterThan(0);

    // Encrypt/decrypt should work with ENCRYPTION_KEY
    const text = "test-with-encryption-key";
    const encrypted = encrypt(text);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(text);
  });

  describe("ENCRYPTION_KEY stability", () => {
    it("should decrypt data encrypted with the same ENCRYPTION_KEY after simulated redeployment", () => {
      // Encrypt with current ENCRYPTION_KEY
      const text = "api-key-that-must-survive-deploy";
      const encrypted = encrypt(text);

      // Simulate JWT_SECRET changing (as happens on redeployment)
      const originalJwtSecret = process.env.JWT_SECRET;
      process.env.JWT_SECRET = "completely-different-jwt-secret-after-deploy";

      // Decryption should still work because ENCRYPTION_KEY hasn't changed
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(text);

      // Restore
      process.env.JWT_SECRET = originalJwtSecret;
    });

    it("should still encrypt/decrypt after JWT_SECRET rotation", () => {
      const originalJwtSecret = process.env.JWT_SECRET;
      
      // Encrypt with current state
      const text = "survives-jwt-rotation";
      const encrypted = encrypt(text);

      // Rotate JWT_SECRET
      process.env.JWT_SECRET = "rotated-jwt-secret-v2";
      
      // Should still work — ENCRYPTION_KEY is the primary key
      expect(decrypt(encrypted)).toBe(text);

      // New encryptions should also work
      const encrypted2 = encrypt("new-data-after-rotation");
      expect(decrypt(encrypted2)).toBe("new-data-after-rotation");

      // Restore
      process.env.JWT_SECRET = originalJwtSecret;
    });
  });

  describe("Fallback to JWT_SECRET", () => {
    it("should fall back to JWT_SECRET when ENCRYPTION_KEY is not set", () => {
      const originalEncKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;

      // Should still work using JWT_SECRET
      const text = "fallback-test";
      const encrypted = encrypt(text);
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(text);

      // Restore
      process.env.ENCRYPTION_KEY = originalEncKey;
    });

    it("should decrypt JWT_SECRET-encrypted data when ENCRYPTION_KEY is set but different", () => {
      // Step 1: Encrypt with JWT_SECRET only (simulating old behavior)
      const originalEncKey = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      
      const text = "encrypted-with-old-jwt-secret";
      const encrypted = encrypt(text);

      // Step 2: Now set ENCRYPTION_KEY (simulating migration)
      process.env.ENCRYPTION_KEY = originalEncKey;

      // Should decrypt via JWT_SECRET fallback
      const decrypted = decrypt(encrypted);
      expect(decrypted).toBe(text);
    });
  });
});
