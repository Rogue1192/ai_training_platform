export const ENV = {
  // Database
  databaseUrl: process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL || "",

  // Auth
  cookieSecret: process.env.JWT_SECRET ?? "",

  // Owner info
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",

  // App
  appBaseUrl: process.env.APP_BASE_URL || process.env.VITE_APP_BASE_URL || "",
  isProduction: process.env.NODE_ENV === "production",

  // Encryption
  encryptionKey: process.env.ENCRYPTION_KEY ?? "",

  // Legacy compatibility — these are no longer used but kept to prevent import errors
  // in unused _core template files (imageGeneration.ts, dataApi.ts, map.ts, voiceTranscription.ts, sdk.ts, oauth.ts)
  // The app uses Supabase Auth (supabaseAuth.ts) — NOT the legacy OAuth (sdk.ts/oauth.ts)
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  appId: process.env.VITE_APP_ID ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
};
