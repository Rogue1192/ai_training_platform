import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000; // PBKDF2 iterations for key derivation

/**
 * Get encryption key from environment
 * Uses PBKDF2 with unique salt per encryption operation
 */
function deriveKey(salt: Buffer): Buffer {
  const secret = process.env.JWT_SECRET;
  
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required for encryption");
  }
  
  // Use PBKDF2 instead of scrypt for better compatibility and security
  return crypto.pbkdf2Sync(secret, salt, ITERATIONS, KEY_LENGTH, "sha256");
}

/**
 * Encrypt a string value with unique salt per operation
 * Format: salt:iv:encrypted:tag (all hex encoded)
 */
export function encrypt(text: string): string {
  // Generate unique salt for this encryption operation
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  // Combine salt + iv + encrypted + tag
  return [
    salt.toString("hex"),
    iv.toString("hex"),
    encrypted,
    tag.toString("hex")
  ].join(":");
}

/**
 * Decrypt an encrypted string
 * Expects format: salt:iv:encrypted:tag
 */
export function decrypt(encryptedData: string): string {
  const parts = encryptedData.split(":");

  if (parts.length !== 4) {
    throw new Error("Invalid encrypted data format. Expected: salt:iv:encrypted:tag");
  }

  const salt = Buffer.from(parts[0]!, "hex");
  const iv = Buffer.from(parts[1]!, "hex");
  const encrypted = parts[2]!;
  const tag = Buffer.from(parts[3]!, "hex");

  // Derive key using the stored salt
  const key = deriveKey(salt);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Securely clear sensitive data from memory
 * Note: JavaScript doesn't guarantee memory clearing, but this is best practice
 */
export function clearSensitiveData(data: string | Buffer): void {
  if (typeof data === "string") {
    // Overwrite string in memory (limited effectiveness in JS)
    data = "";
  } else if (Buffer.isBuffer(data)) {
    // Overwrite buffer with zeros
    data.fill(0);
  }
}
