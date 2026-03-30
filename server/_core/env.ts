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

  // OpenAI (for LLM, image generation, voice transcription)
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",

  // Google Maps
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? "",
};
