-- Rename WordPress-specific credential columns to generic CMS-agnostic names
-- These columns are used by Playwright for any website builder (WordPress, Webflow, Wix, Squarespace, etc.)
ALTER TABLE "businesses" RENAME COLUMN "wpAdminUrl" TO "siteAdminUrl";
ALTER TABLE "businesses" RENAME COLUMN "wpUsername" TO "siteUsername";
ALTER TABLE "businesses" RENAME COLUMN "wpPasswordEncrypted" TO "sitePasswordEncrypted";
