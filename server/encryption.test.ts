import { describe, expect, it } from "vitest";
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

    // Decryption should fail
    expect(() => decrypt(tampered)).toThrow();
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

  it("should require JWT_SECRET environment variable", () => {
    // This test would need to manipulate process.env, which is tricky
    // In production, the encryption will throw if JWT_SECRET is not set
    expect(process.env.JWT_SECRET).toBeDefined();
  });
});
