-- Migration 0020: Agency API keys and intake token
-- Adds per-agency OpenAI/Gemini keys (encrypted) and a reusable intake token
-- for the white-label client onboarding flow.
ALTER TABLE "agencies"
  ADD COLUMN IF NOT EXISTS "intakeToken"     VARCHAR(64)  UNIQUE,
  ADD COLUMN IF NOT EXISTS "agencyOpenAiKey" TEXT,
  ADD COLUMN IF NOT EXISTS "agencyGeminiKey" TEXT;
