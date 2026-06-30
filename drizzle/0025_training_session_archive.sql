-- Add isArchived flag to trainingSessions so that archiving a business
-- cascades to its training sessions (they are then hidden from the Training view).
-- Safe/additive: existing rows default to false (not archived).
ALTER TABLE "trainingSessions"
  ADD COLUMN IF NOT EXISTS "isArchived" boolean DEFAULT false NOT NULL;
