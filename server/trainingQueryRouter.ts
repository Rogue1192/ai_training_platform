/**
 * trainingQueryRouter.ts
 *
 * tRPC endpoints for the V3 training query setup and dashboard.
 *
 * Endpoints:
 *   fetchCandidates   — run DataForSEO pipeline, return candidates (not saved yet)
 *   saveQueries       — save selected phrases (replaces existing unlocked ones)
 *   generateVariations — generate 3 GPT-4o variations per phrase (not locked)
 *   lockQueries       — lock phrases + variations, create 4-day sprint schedule
 *   getQueries        — get all training queries for a campaign
 *   updatePhrase      — update a single phrase text (only if not locked)
 *   deletePhrase      — delete a single phrase (only if not locked)
 *   getDashboard      — get full training dashboard data (day runs, phrase status)
 *   getSprintStatus   — get sprint progress for a campaign
 */

import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import {
  trainingQueries,
  trainingPhraseStatus,
  trainingDayRuns,
  campaigns,
  businesses,
} from "../drizzle/schema";
import { eq, and, desc, asc } from "drizzle-orm";

export const trainingQueryRouter = router({
  /**
   * Fetch keyword candidates from DataForSEO for a campaign.
   * Returns the top N phrases based on the campaign's package tier.
   * Does NOT save anything — just returns candidates for review.
   */
  fetchCandidates: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { runKeywordResearchPipeline } = await import("./dataforseoService");

      // Get campaign + business
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaign) throw new Error("Campaign not found");

      const [business] = await db
        .select()
        .from(businesses)
        .where(eq(businesses.id, campaign.businessId))
        .limit(1);
      if (!business) throw new Error("Business not found");

      // Determine max phrases from package tier
      const maxPhrases = getMaxPhrasesForTier(campaign.packageTierId?.toString() ?? null);

      // Run DataForSEO pipeline
      const result = await runKeywordResearchPipeline(
        business.website || business.name,
        {
          maxKeywords: maxPhrases,
          businessType: business.businessType ?? null,
          specialties: business.specialties ?? null,
          primaryLocation: business.location ?? null,
        }
      );

      return {
        candidates: result.topKeywords.map((kw, i) => ({
          phraseText: kw.keyword,
          aiSearchVolume: kw.aiSearchVolume,
          sortOrder: i + 1,
        })),
        maxPhrases,
      };
    }),

  /**
   * Save selected phrases for a campaign.
   * Replaces all existing unlocked phrases.
   * Locked phrases are preserved.
   */
  saveQueries: protectedProcedure
    .input(
      z.object({
        campaignId: z.number(),
        phrases: z.array(
          z.object({
            phraseText: z.string().min(3),
            aiSearchVolume: z.number().optional(),
            sortOrder: z.number(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaign) throw new Error("Campaign not found");

      // Delete existing unlocked phrases
      const existing = await db
        .select()
        .from(trainingQueries)
        .where(eq(trainingQueries.campaignId, input.campaignId));

      const unlockedIds = existing.filter((q) => !q.lockedAt).map((q) => q.id);
      for (const id of unlockedIds) {
        await db.delete(trainingQueries).where(eq(trainingQueries.id, id));
      }

      // Insert new phrases
      for (const phrase of input.phrases) {
        await db.insert(trainingQueries).values({
          campaignId: input.campaignId,
          businessId: campaign.businessId,
          phraseText: phrase.phraseText,
          aiSearchVolume: phrase.aiSearchVolume ?? 0,
          sortOrder: phrase.sortOrder,
          isActive: true,
        });
      }

      return { saved: input.phrases.length };
    }),

  /**
   * Generate 3 natural-language variations for each phrase.
   * Saves variations to the database but does NOT lock.
   */
  generateVariations: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { generateQueryVariations } = await import("./trainingWorkerV3");

      const queries = await db
        .select()
        .from(trainingQueries)
        .where(
          and(
            eq(trainingQueries.campaignId, input.campaignId),
            eq(trainingQueries.isActive, true)
          )
        )
        .orderBy(asc(trainingQueries.sortOrder));

      let generated = 0;
      for (const query of queries) {
        if (query.lockedAt) continue; // Don't regenerate locked phrases

        const variations = await generateQueryVariations(query.phraseText, 3);
        await db
          .update(trainingQueries)
          .set({ phraseVariations: variations, updatedAt: new Date() })
          .where(eq(trainingQueries.id, query.id));
        generated++;
      }

      return { generated };
    }),

  /**
   * Lock all phrases + variations and create the 4-day sprint schedule.
   * After locking, phrases cannot be edited or deleted.
   */
  lockQueries: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { createSprintSchedule } = await import("./trainingWorkerV3");

      // Verify all phrases have variations
      const queries = await db
        .select()
        .from(trainingQueries)
        .where(
          and(
            eq(trainingQueries.campaignId, input.campaignId),
            eq(trainingQueries.isActive, true)
          )
        );

      const missingVariations = queries.filter(
        (q) => !q.lockedAt && (!q.phraseVariations || (q.phraseVariations as string[]).length === 0)
      );

      if (missingVariations.length > 0) {
        throw new Error(
          `${missingVariations.length} phrase(s) are missing variations. Generate variations first.`
        );
      }

      // Check if sprint already exists
      const existingRuns = await db
        .select()
        .from(trainingDayRuns)
        .where(eq(trainingDayRuns.campaignId, input.campaignId))
        .limit(1);

      if (existingRuns.length > 0) {
        throw new Error("Sprint schedule already exists for this campaign.");
      }

      // Lock all unlocked phrases
      const now = new Date();
      for (const query of queries) {
        if (!query.lockedAt) {
          await db
            .update(trainingQueries)
            .set({ lockedAt: now, updatedAt: now })
            .where(eq(trainingQueries.id, query.id));
        }
      }

      // Create 4-day sprint schedule
      await createSprintSchedule(input.campaignId);

      return { locked: queries.length, sprintCreated: true };
    }),

  /**
   * Get all training queries for a campaign with their phrase status.
   */
  getQueries: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];

      const queries = await db
        .select()
        .from(trainingQueries)
        .where(eq(trainingQueries.campaignId, input.campaignId))
        .orderBy(asc(trainingQueries.sortOrder));

      // Get phrase status for each query
      const statuses = await db
        .select()
        .from(trainingPhraseStatus)
        .where(eq(trainingPhraseStatus.campaignId, input.campaignId));

      const statusByQueryId = new Map<number, typeof statuses>();
      for (const s of statuses) {
        if (!statusByQueryId.has(s.queryId)) {
          statusByQueryId.set(s.queryId, []);
        }
        statusByQueryId.get(s.queryId)!.push(s);
      }

      return queries.map((q) => ({
        ...q,
        phraseStatuses: statusByQueryId.get(q.id) ?? [],
      }));
    }),

  /**
   * Update a single phrase text (only if not locked).
   */
  updatePhrase: protectedProcedure
    .input(
      z.object({
        queryId: z.number(),
        phraseText: z.string().min(3),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [query] = await db
        .select()
        .from(trainingQueries)
        .where(eq(trainingQueries.id, input.queryId))
        .limit(1);

      if (!query) throw new Error("Query not found");
      if (query.lockedAt) throw new Error("Cannot edit a locked phrase");

      await db
        .update(trainingQueries)
        .set({
          phraseText: input.phraseText,
          phraseVariations: [], // Clear variations when phrase changes
          updatedAt: new Date(),
        })
        .where(eq(trainingQueries.id, input.queryId));

      return { updated: true };
    }),

  /**
   * Delete a single phrase (only if not locked).
   */
  deletePhrase: protectedProcedure
    .input(z.object({ queryId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [query] = await db
        .select()
        .from(trainingQueries)
        .where(eq(trainingQueries.id, input.queryId))
        .limit(1);

      if (!query) throw new Error("Query not found");
      if (query.lockedAt) throw new Error("Cannot delete a locked phrase");

      await db.delete(trainingQueries).where(eq(trainingQueries.id, input.queryId));
      return { deleted: true };
    }),

  /**
   * Get full training dashboard data for a campaign.
   * Returns day runs, phrase statuses, and overall progress.
   */
  getDashboard: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      // Get day runs
      const dayRuns = await db
        .select()
        .from(trainingDayRuns)
        .where(eq(trainingDayRuns.campaignId, input.campaignId))
        .orderBy(asc(trainingDayRuns.runDay));

      // Get all queries with status
      const queries = await db
        .select()
        .from(trainingQueries)
        .where(eq(trainingQueries.campaignId, input.campaignId))
        .orderBy(asc(trainingQueries.sortOrder));

      const statuses = await db
        .select()
        .from(trainingPhraseStatus)
        .where(eq(trainingPhraseStatus.campaignId, input.campaignId));

      // Compute summary stats
      const totalPhrases = queries.length;
      const graduatedOpenAI = statuses.filter(
        (s) => s.targetAiProvider === "openai" && s.isGraduated
      ).length;
      const graduatedGoogle = statuses.filter(
        (s) => s.targetAiProvider === "google" && s.isGraduated
      ).length;

      const sprintRuns = dayRuns.filter((r) => r.runType === "sprint");
      const maintenanceRuns = dayRuns.filter((r) => r.runType === "maintenance");
      const sprintComplete = sprintRuns.length >= 4 && sprintRuns.every((r) => r.status === "completed");
      const currentMode = sprintComplete ? "maintenance" : "sprint";

      const currentRun = dayRuns.find((r) => r.status === "running") ?? null;
      const nextPendingRun = dayRuns.find((r) => r.status === "pending") ?? null;

      return {
        dayRuns,
        queries: queries.map((q) => ({
          ...q,
          phraseStatuses: statuses.filter((s) => s.queryId === q.id),
        })),
        summary: {
          totalPhrases,
          graduatedOpenAI,
          graduatedGoogle,
          currentMode,
          sprintComplete,
          currentRun,
          nextPendingRun,
          sprintDaysCompleted: sprintRuns.filter((r) => r.status === "completed").length,
          maintenanceRunsCompleted: maintenanceRuns.filter((r) => r.status === "completed").length,
        },
      };
    }),

  /**
   * Get sprint progress for a campaign (lightweight, for polling).
   */
  getSprintStatus: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;

      const dayRuns = await db
        .select()
        .from(trainingDayRuns)
        .where(eq(trainingDayRuns.campaignId, input.campaignId))
        .orderBy(asc(trainingDayRuns.runDay));

      const currentRun = dayRuns.find((r) => r.status === "running");
      if (!currentRun) return { status: "idle", dayRuns };

      return {
        status: "running",
        currentRun,
        dayRuns,
        progress:
          currentRun.sessionsTotal > 0
            ? Math.round((currentRun.sessionsCompleted / currentRun.sessionsTotal) * 100)
            : 0,
      };
    }),

  /**
   * Trigger a test training day for a campaign, bypassing all gate checks
   * (llmTxtVerified, schemaVerified, publishedUrl).
   *
   * This is an admin-only mutation for testing the training engine before
   * a campaign has completed the full content pipeline.
   *
   * It creates a new dayRun record (type: "sprint", status: "pending") and
   * immediately runs it in the background.
   */
  triggerTestTrainingDay: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      // Admin-only guard
      if ((ctx.user as any).role !== 'admin') {
        throw new Error('Admin access required');
      }

      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const { runTrainingDay } = await import('./trainingWorkerV3');

      // Verify campaign exists
      const [campaign] = await db
        .select()
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaign) throw new Error('Campaign not found');

      // Verify there are active queries with variations
      const queries = await db
        .select()
        .from(trainingQueries)
        .where(
          and(
            eq(trainingQueries.campaignId, input.campaignId),
            eq(trainingQueries.isActive, true)
          )
        );

      if (queries.length === 0) {
        throw new Error(
          'No active training queries found. Save and lock queries first.'
        );
      }

      // Determine next run day number
      const existingRuns = await db
        .select()
        .from(trainingDayRuns)
        .where(eq(trainingDayRuns.campaignId, input.campaignId))
        .orderBy(desc(trainingDayRuns.runDay))
        .limit(1);

      const nextRunDay =
        existingRuns.length > 0 ? existingRuns[0].runDay + 1 : 1;
      const today = new Date().toISOString().split('T')[0];

      // Create a new day run record
      const [newRun] = await db
        .insert(trainingDayRuns)
        .values({
          campaignId: input.campaignId,
          runType: 'sprint',
          runDay: nextRunDay,
          scheduledDate: today,
          status: 'pending',
          webSearchStatus: 'pending',
        })
        .returning();

      const dayRunId = (newRun as any)?.id ?? (newRun as any)?.[0]?.id;

      // Fire and forget — run in background so the HTTP response returns immediately
      runTrainingDay(input.campaignId, dayRunId).catch((err: any) => {
        console.error(
          `[TrainingTest] Background training day failed for campaign ${
            input.campaignId
          }, dayRun ${dayRunId}:`,
          err.message
        );
      });

      return { success: true, dayRunId, runDay: nextRunDay };
    }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMaxPhrasesForTier(packageTier: string | null): number {
  switch (packageTier?.toLowerCase()) {
    case "pro":
      return 25;
    case "growth":
      return 20;
    case "starter":
    default:
      return 15;
  }
}
