import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000; // PBKDF2 iterations for key derivation

/**
 * Get the encryption secret from environment.
 * 
 * Uses ENCRYPTION_KEY (dedicated, stable, user-managed) as the primary key.
 * Falls back to JWT_SECRET only for backward-compatible decryption attempts.
 * 
 * IMPORTANT: ENCRYPTION_KEY must be the SAME value in all environments
 * (Manus dev, Manus published, Railway) to ensure encrypted data is portable.
 */
function getEncryptionSecret(): string {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey) {
    return encryptionKey;
  }

  // Fallback to JWT_SECRET for backward compatibility during migration
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret) {
    console.warn(
      "[Encryption] WARNING: Using JWT_SECRET as encryption key. " +
      "Set ENCRYPTION_KEY environment variable for stable encryption across deployments."
    );
    return jwtSecret;
  }

  throw new Error(
    "ENCRYPTION_KEY environment variable is required for encryption. " +
    "Set a stable 64-character hex string that is the same across all environments."
  );
}

/**
 * Derive an AES-256 key from the master secret using PBKDF2 with a unique salt
 */
function deriveKey(salt: Buffer): Buffer {
  const secret = getEncryptionSecret();
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
    tag.toString("hex"),
  ].join(":");
}

/**
 * Decrypt an encrypted string.
 * 
 * Tries ENCRYPTION_KEY first. If that fails and JWT_SECRET is different,
 * tries JWT_SECRET as a fallback (for keys encrypted before the migration).
 * 
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

  // Try primary key (ENCRYPTION_KEY or current fallback)
  const primarySecret = getEncryptionSecret();
  try {
    const key = crypto.pbkdf2Sync(primarySecret, salt, ITERATIONS, KEY_LENGTH, "sha256");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    // Primary key failed — try JWT_SECRET as fallback if it's different
    const jwtSecret = process.env.JWT_SECRET;
    if (jwtSecret && jwtSecret !== primarySecret) {
      try {
        const fallbackKey = crypto.pbkdf2Sync(jwtSecret, salt, ITERATIONS, KEY_LENGTH, "sha256");
        const decipher = crypto.createDecipheriv(ALGORITHM, fallbackKey, iv);
        decipher.setAuthTag(tag);
        let decrypted = decipher.update(encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");
        console.warn(
          "[Encryption] Decrypted using JWT_SECRET fallback. " +
          "This key should be re-encrypted with ENCRYPTION_KEY."
        );
        return decrypted;
      } catch {
        // Both keys failed
      }
    }

    throw new Error(
      "Unable to decrypt data. The encryption key may have changed. " +
      "Please re-enter your API keys in Settings."
    );
  }
}

/**
 * Securely clear sensitive data from memory
 * Note: JavaScript doesn't guarantee memory clearing, but this is best practice
 */
export function clearSensitiveData(data: string | Buffer): void {
  if (typeof data === "string") {
    data = "";
  } else if (Buffer.isBuffer(data)) {
    data.fill(0);
  }
}
