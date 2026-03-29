CREATE TYPE "public"."campaign_status" AS ENUM('pending', 'keyword_research', 'credibility_research', 'content_generation', 'publishing', 'indexing', 'baseline_check', 'training', 'monitoring', 'paused', 'error');--> statement-breakpoint
CREATE TYPE "public"."client_type" AS ENUM('ai_only', 'ai_plus_seo', 'ai_plus_seo_plus_build');--> statement-breakpoint
CREATE TYPE "public"."content_page_status" AS ENUM('draft', 'generated', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "campaignQueryLocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaignId" integer NOT NULL,
	"searchQuery" text NOT NULL,
	"location" varchar(255) NOT NULL,
	"aiSearchVolume" integer,
	"monthlyTrend" json,
	"currentRankChatGPT" varchar(50),
	"currentRankGemini" varchar(50),
	"currentRankAIOverview" varchar(50),
	"lastRankCheckAt" timestamp,
	"firstMentionedAt" timestamp,
	"trainingStatus" varchar(20) DEFAULT 'pending' NOT NULL,
	"trainingSessions" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"businessId" integer NOT NULL,
	"packageTierId" integer,
	"campaignName" varchar(255) NOT NULL,
	"status" "campaign_status" DEFAULT 'pending' NOT NULL,
	"clientType" "client_type" NOT NULL,
	"keywordResearchCompletedAt" timestamp,
	"credibilityResearchCompletedAt" timestamp,
	"contentGenerationCompletedAt" timestamp,
	"publishingCompletedAt" timestamp,
	"indexingSubmittedAt" timestamp,
	"indexingVerifiedAt" timestamp,
	"baselineCheckCompletedAt" timestamp,
	"trainingStartedAt" timestamp,
	"trainingAggressiveness" varchar(20) DEFAULT 'aggressive' NOT NULL,
	"rankCheckFrequency" varchar(20) DEFAULT 'weekly' NOT NULL,
	"lastError" text,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"sourceWebhookId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clientDashboards" (
	"id" serial PRIMARY KEY NOT NULL,
	"businessId" integer NOT NULL,
	"campaignId" integer,
	"accessToken" varchar(64) NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"dashboardTitle" varchar(255),
	"lastAccessedAt" timestamp,
	"accessCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clientDashboards_accessToken_unique" UNIQUE("accessToken")
);
--> statement-breakpoint
CREATE TABLE "contentPages" (
	"id" serial PRIMARY KEY NOT NULL,
	"businessId" integer NOT NULL,
	"campaignId" integer,
	"pageType" varchar(50) NOT NULL,
	"pageTitle" varchar(255) NOT NULL,
	"pageSlug" varchar(255),
	"pageContent" text NOT NULL,
	"metaDescription" text,
	"schemaMarkup" text,
	"interlinkTargets" json,
	"status" "content_page_status" DEFAULT 'draft' NOT NULL,
	"publishedUrl" text,
	"publishedAt" timestamp,
	"publishError" text,
	"generationModel" varchar(100),
	"generationPrompt" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credibilityData" (
	"id" serial PRIMARY KEY NOT NULL,
	"businessId" integer NOT NULL,
	"campaignId" integer,
	"researchResults" json NOT NULL,
	"verifiedFacts" json,
	"credibilityScore" integer,
	"researchModel" varchar(100),
	"researchCompletedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industryKeywordCache" (
	"id" serial PRIMARY KEY NOT NULL,
	"industry" varchar(100) NOT NULL,
	"keywords" json NOT NULL,
	"goldenTemplateKeywords" json,
	"clientCount" integer DEFAULT 1 NOT NULL,
	"isLocked" boolean DEFAULT false NOT NULL,
	"lockThreshold" integer DEFAULT 3 NOT NULL,
	"lastRefreshedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llmTxtFiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"businessId" integer NOT NULL,
	"campaignId" integer,
	"content" text NOT NULL,
	"publishedToSite" boolean DEFAULT false NOT NULL,
	"publishedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificationLogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"businessId" integer,
	"campaignId" integer,
	"notificationType" varchar(50) NOT NULL,
	"recipientEmail" varchar(320) NOT NULL,
	"subject" varchar(500) NOT NULL,
	"body" text,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"resendMessageId" varchar(100),
	"errorMessage" text,
	"sentAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "packageTiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(50) NOT NULL,
	"maxQueries" integer NOT NULL,
	"maxLocations" integer NOT NULL,
	"description" text,
	"monthlyPrice" integer,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "packageTiers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "rankSnapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaignId" integer NOT NULL,
	"queryLocationId" integer NOT NULL,
	"chatgptMentioned" boolean,
	"chatgptPosition" integer,
	"chatgptResponseSnippet" text,
	"geminiMentioned" boolean,
	"geminiPosition" integer,
	"geminiResponseSnippet" text,
	"aiOverviewMentioned" boolean,
	"aiOverviewPosition" integer,
	"aiOverviewResponseSnippet" text,
	"sourcesCited" json,
	"checkType" varchar(20) DEFAULT 'scheduled' NOT NULL,
	"checkedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schemaMarkupRecommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"businessId" integer NOT NULL,
	"campaignId" integer,
	"existingSchemaTypes" json,
	"recommendedSchemaTypes" json,
	"generatedSchema" text,
	"publishedToSite" boolean DEFAULT false NOT NULL,
	"publishedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhookLogs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" varchar(50) DEFAULT 'ghl' NOT NULL,
	"payload" json NOT NULL,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"errorMessage" text,
	"businessId" integer,
	"campaignId" integer,
	"ipAddress" varchar(45),
	"processedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "contactEmail" varchar(320);--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "contactName" varchar(255);--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "certifications" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "awards" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "yearsInBusiness" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "bbbRating" varchar(10);--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "licenses" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "warranties" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "differentiators" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "competitors" json;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "wpAdminUrl" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "wpUsername" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "wpPasswordEncrypted" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "clientType" "client_type";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "sourceWebhookId" integer;--> statement-breakpoint
ALTER TABLE "trainingSessions" ADD COLUMN "campaignId" integer;--> statement-breakpoint
ALTER TABLE "trainingSessions" ADD COLUMN "campaignQueryLocationId" integer;--> statement-breakpoint
ALTER TABLE "campaignQueryLocations" ADD CONSTRAINT "campaignQueryLocations_campaignId_campaigns_id_fk" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_businessId_businesses_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_packageTierId_packageTiers_id_fk" FOREIGN KEY ("packageTierId") REFERENCES "public"."packageTiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientDashboards" ADD CONSTRAINT "clientDashboards_businessId_businesses_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clientDashboards" ADD CONSTRAINT "clientDashboards_campaignId_campaigns_id_fk" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contentPages" ADD CONSTRAINT "contentPages_businessId_businesses_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contentPages" ADD CONSTRAINT "contentPages_campaignId_campaigns_id_fk" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credibilityData" ADD CONSTRAINT "credibilityData_businessId_businesses_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credibilityData" ADD CONSTRAINT "credibilityData_campaignId_campaigns_id_fk" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llmTxtFiles" ADD CONSTRAINT "llmTxtFiles_businessId_businesses_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llmTxtFiles" ADD CONSTRAINT "llmTxtFiles_campaignId_campaigns_id_fk" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificationLogs" ADD CONSTRAINT "notificationLogs_businessId_businesses_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificationLogs" ADD CONSTRAINT "notificationLogs_campaignId_campaigns_id_fk" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankSnapshots" ADD CONSTRAINT "rankSnapshots_campaignId_campaigns_id_fk" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankSnapshots" ADD CONSTRAINT "rankSnapshots_queryLocationId_campaignQueryLocations_id_fk" FOREIGN KEY ("queryLocationId") REFERENCES "public"."campaignQueryLocations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemaMarkupRecommendations" ADD CONSTRAINT "schemaMarkupRecommendations_businessId_businesses_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schemaMarkupRecommendations" ADD CONSTRAINT "schemaMarkupRecommendations_campaignId_campaigns_id_fk" FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;