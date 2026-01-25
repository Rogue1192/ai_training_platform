ALTER TABLE "promptTemplates" ALTER COLUMN "templateType" SET DATA TYPE varchar(50);--> statement-breakpoint
DROP TYPE "public"."prompt_template_type";