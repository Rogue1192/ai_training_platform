-- bonusQueryResults table
CREATE TABLE IF NOT EXISTS "bonusQueryResults" (
  "id" serial PRIMARY KEY,
  "campaignId" integer NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "businessId" integer NOT NULL REFERENCES "businesses"("id") ON DELETE CASCADE,
  "sourceQueryLocationId" integer REFERENCES "campaignQueryLocations"("id") ON DELETE SET NULL,
  "sourceSearchQuery" text NOT NULL,
  "bonusSearchQuery" text NOT NULL,
  "location" varchar(255) NOT NULL,
  "chatgptMentioned" boolean NOT NULL DEFAULT false,
  "chatgptSnippet" text,
  "geminiMentioned" boolean NOT NULL DEFAULT false,
  "geminiSnippet" text,
  "isBonusWin" boolean NOT NULL DEFAULT false,
  "promotedToTracked" boolean NOT NULL DEFAULT false,
  "promotedQueryLocationId" integer REFERENCES "campaignQueryLocations"("id") ON DELETE SET NULL,
  "scanRunAt" timestamp NOT NULL DEFAULT now(),
  "createdAt" timestamp NOT NULL DEFAULT now()
);

-- queryDropoffEvents table
CREATE TABLE IF NOT EXISTS "queryDropoffEvents" (
  "id" serial PRIMARY KEY,
  "campaignId" integer NOT NULL REFERENCES "campaigns"("id") ON DELETE CASCADE,
  "queryLocationId" integer NOT NULL REFERENCES "campaignQueryLocations"("id") ON DELETE CASCADE,
  "platform" varchar(20) NOT NULL,
  "searchQuery" text NOT NULL,
  "location" varchar(255) NOT NULL,
  "detectedAt" timestamp NOT NULL DEFAULT now(),
  "reoptimizationInitiated" boolean NOT NULL DEFAULT false,
  "reoptimizationInitiatedAt" timestamp,
  "recoveredAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
