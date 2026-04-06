-- Agency Portal: Add agency role, agencies table, and link businesses to agencies
-- 1. Add 'agency' to the role enum
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'agency';

-- 2. Create agencies table
CREATE TABLE IF NOT EXISTS "agencies" (
  "id"                    SERIAL PRIMARY KEY,
  "userId"                INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "name"                  VARCHAR(255) NOT NULL,
  "contactEmail"          VARCHAR(320) NOT NULL,
  "contactName"           VARCHAR(255),
  "phone"                 VARCHAR(50),
  "packageTier"           VARCHAR(50) NOT NULL DEFAULT 'starter',
  -- Branding fields for white-label emails
  "brandName"             VARCHAR(255),
  "brandLogoUrl"          VARCHAR(500),
  "brandFromName"         VARCHAR(255),
  -- Stripe billing
  "stripeCustomerId"      VARCHAR(255),
  "stripePaymentMethodId" VARCHAR(255),
  "hasPaymentMethod"      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Status
  "isActive"              BOOLEAN NOT NULL DEFAULT TRUE,
  "notes"                 TEXT,
  "createdAt"             TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"             TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 3. Add agencyId to businesses table so we know which agency owns each client
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "agencyId" INTEGER REFERENCES "agencies"("id") ON DELETE SET NULL;
