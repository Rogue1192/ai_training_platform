CREATE TYPE "public"."ai_provider" AS ENUM('openai', 'anthropic', 'google');--> statement-breakpoint
CREATE TYPE "public"."api_key_status" AS ENUM('connected', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."schedule_type" AS ENUM('daily', 'weekly', 'monthly', 'custom');--> statement-breakpoint
CREATE TYPE "public"."training_status" AS ENUM('paused', 'in_progress', 'completed', 'error');--> statement-breakpoint
CREATE TABLE "apiKeys" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"provider" "ai_provider" NOT NULL,
	"encryptedKey" text NOT NULL,
	"status" "api_key_status" DEFAULT 'connected' NOT NULL,
	"lastVerified" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"businessType" varchar(100),
	"location" varchar(255),
	"description" text,
	"website" varchar(500),
	"phone" varchar(50),
	"address" text,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platformMetrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"date" timestamp NOT NULL,
	"activeTrainings" integer DEFAULT 0 NOT NULL,
	"completedGoals" integer DEFAULT 0 NOT NULL,
	"apiCallsToday" integer DEFAULT 0 NOT NULL,
	"avgResponseTime" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduledJobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"trainingSessionId" integer,
	"businessId" integer,
	"jobName" varchar(255) NOT NULL,
	"scheduleType" "schedule_type" NOT NULL,
	"cronExpression" varchar(100),
	"isActive" boolean DEFAULT true NOT NULL,
	"lastRun" timestamp,
	"nextRun" timestamp,
	"runCount" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trainingConversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"trainingSessionId" integer NOT NULL,
	"iterationNumber" integer NOT NULL,
	"conversationHistory" json NOT NULL,
	"promptUsed" text NOT NULL,
	"goalAchieved" boolean DEFAULT false NOT NULL,
	"responseTime" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trainingSessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"businessId" integer,
	"trainingName" varchar(255) NOT NULL,
	"topic" text NOT NULL,
	"targetAiProvider" "ai_provider" NOT NULL,
	"targetAiModel" varchar(100) NOT NULL,
	"influencerAiProvider" "ai_provider" NOT NULL,
	"influencerAiModel" varchar(100) NOT NULL,
	"trainingPrompts" json NOT NULL,
	"trainingContext" text,
	"trainingGoal" text NOT NULL,
	"iterations" integer DEFAULT 50 NOT NULL,
	"retryInterval" integer DEFAULT 10 NOT NULL,
	"currentProgress" integer DEFAULT 0 NOT NULL,
	"status" "training_status" DEFAULT 'paused' NOT NULL,
	"errorMessage" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
ALTER TABLE "apiKeys" ADD CONSTRAINT "apiKeys_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platformMetrics" ADD CONSTRAINT "platformMetrics_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduledJobs" ADD CONSTRAINT "scheduledJobs_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduledJobs" ADD CONSTRAINT "scheduledJobs_trainingSessionId_trainingSessions_id_fk" FOREIGN KEY ("trainingSessionId") REFERENCES "public"."trainingSessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduledJobs" ADD CONSTRAINT "scheduledJobs_businessId_businesses_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainingConversations" ADD CONSTRAINT "trainingConversations_trainingSessionId_trainingSessions_id_fk" FOREIGN KEY ("trainingSessionId") REFERENCES "public"."trainingSessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainingSessions" ADD CONSTRAINT "trainingSessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainingSessions" ADD CONSTRAINT "trainingSessions_businessId_businesses_id_fk" FOREIGN KEY ("businessId") REFERENCES "public"."businesses"("id") ON DELETE set null ON UPDATE no action;