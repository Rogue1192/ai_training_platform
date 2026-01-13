-- Add new fields to trainingConversations table
ALTER TABLE "trainingConversations" ADD COLUMN "conversationType" varchar(20) DEFAULT 'training' NOT NULL;
ALTER TABLE "trainingConversations" ADD COLUMN "promptType" varchar(20) DEFAULT 'suggestive' NOT NULL;
ALTER TABLE "trainingConversations" ADD COLUMN "businessMentionedUnprompted" boolean;
ALTER TABLE "trainingConversations" ADD COLUMN "mentionConfidence" integer;

-- Add new fields to trainingSessions table
ALTER TABLE "trainingSessions" ADD COLUMN "trainingPhase" varchar(20) DEFAULT 'pending' NOT NULL;
ALTER TABLE "trainingSessions" ADD COLUMN "baselineMentioned" boolean;
ALTER TABLE "trainingSessions" ADD COLUMN "evaluationMentioned" boolean;
ALTER TABLE "trainingSessions" ADD COLUMN "influenceScore" integer;
ALTER TABLE "trainingSessions" ADD COLUMN "trainingIterationsCompleted" integer DEFAULT 0 NOT NULL;
ALTER TABLE "trainingSessions" ADD COLUMN "isLegacy" boolean DEFAULT false NOT NULL;

-- Mark existing sessions as legacy
UPDATE "trainingSessions" SET "isLegacy" = true WHERE "trainingPhase" = 'pending';
