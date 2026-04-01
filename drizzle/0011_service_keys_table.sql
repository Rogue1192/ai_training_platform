-- Migration: Add serviceKeys table for DataForSEO, SinByte, and Resend API credentials
-- These are stored encrypted in the database so they can be managed via the Settings UI
-- instead of requiring manual Railway env var configuration.

-- Create the service enum
CREATE TYPE "service_key_service" AS ENUM ('dataforseo', 'sinbyte', 'resend');

-- Create the serviceKeys table
CREATE TABLE IF NOT EXISTS "serviceKeys" (
  "id" serial PRIMARY KEY,
  "service" "service_key_service" NOT NULL UNIQUE,
  "encryptedValue" text NOT NULL,
  "status" "api_key_status" DEFAULT 'connected' NOT NULL,
  "lastVerified" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
