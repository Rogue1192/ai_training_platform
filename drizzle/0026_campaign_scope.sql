-- Migration 0026: Add campaignScope to campaigns table
-- Controls whether location is appended to queries and how prompts/schema are framed.
-- 'local' (default) = service-area business, location appended to every query
-- 'national' = agency/franchise/SaaS, queries run without location suffix
-- 'ecommerce' = online store, no location at all, product-discovery framing

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "campaignScope" varchar(20) NOT NULL DEFAULT 'local';
