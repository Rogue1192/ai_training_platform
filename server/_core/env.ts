export const ENV = {
  // Database
  databaseUrl: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "",

  // Auth
  cookieSecret: process.env.JWT_SECRET ?? "",

  // Owner info
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",

  // App — BUG-025 fix: use only APP_BASE_URL (server-side env var); VITE_ prefix is for client-side only
  appBaseUrl: process.env.APP_BASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",

  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
};
