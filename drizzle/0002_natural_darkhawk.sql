CREATE TYPE "public"."prompt_template_type" AS ENUM('clean', 'suggestive', 'follow_up', 'category_based');--> statement-breakpoint
CREATE TABLE "promptTemplates" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"templateType" "prompt_template_type" NOT NULL,
	"templateName" varchar(255) NOT NULL,
	"templateContent" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "promptTemplates" ADD CONSTRAINT "promptTemplates_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;