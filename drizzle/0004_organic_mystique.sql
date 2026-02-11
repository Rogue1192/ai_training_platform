CREATE TABLE "scheduledJobRuns" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheduledJobId" integer NOT NULL,
	"trainingSessionId" integer,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"errorMessage" text,
	"baselineMentioned" boolean,
	"evaluationMentioned" boolean,
	"influenceScore" integer,
	"iterationsCompleted" integer,
	"triggeredBy" varchar(20) DEFAULT 'scheduler' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduledJobs" ADD COLUMN "timeOfDay" varchar(5) DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduledJobs" ADD COLUMN "dayOfWeek" integer;--> statement-breakpoint
ALTER TABLE "scheduledJobs" ADD COLUMN "dayOfMonth" integer;--> statement-breakpoint
ALTER TABLE "scheduledJobs" ADD COLUMN "timezone" varchar(100) DEFAULT 'America/Los_Angeles' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduledJobRuns" ADD CONSTRAINT "scheduledJobRuns_scheduledJobId_scheduledJobs_id_fk" FOREIGN KEY ("scheduledJobId") REFERENCES "public"."scheduledJobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduledJobRuns" ADD CONSTRAINT "scheduledJobRuns_trainingSessionId_trainingSessions_id_fk" FOREIGN KEY ("trainingSessionId") REFERENCES "public"."trainingSessions"("id") ON DELETE set null ON UPDATE no action;