-- Migration: Make userId nullable in campaigns and platformMetrics tables
-- Reason: This is an internal team tool — campaigns and metrics belong to the company,
-- not individual employees. Deleting an employee account must NOT destroy client campaigns
-- or historical metrics data.

-- campaigns.userId: drop notNull constraint and change cascade to set null
ALTER TABLE "campaigns" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "campaigns" DROP CONSTRAINT IF EXISTS "campaigns_userId_users_id_fk";
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_userId_users_id_fk"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL;

-- platformMetrics.userId: drop notNull constraint and change cascade to set null
ALTER TABLE "platformMetrics" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "platformMetrics" DROP CONSTRAINT IF EXISTS "platformMetrics_userId_users_id_fk";
ALTER TABLE "platformMetrics" ADD CONSTRAINT "platformMetrics_userId_users_id_fk"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL;
