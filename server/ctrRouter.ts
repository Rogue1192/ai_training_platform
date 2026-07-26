/**
 * CTR Module Router
 * Completely isolated from AI Answer Forge routers.
 * All tables: ctr_campaigns, ctr_keywords, ctr_sessions, ctr_drive_journeys, ctr_ramp_snapshots, ctr_gsc_connections
 */
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { sql } from "drizzle-orm";

// ─── router ─────────────────────────────────────────────────────────────────

export const ctrRouter = router({

  // ── Campaigns ──────────────────────────────────────────────────────────────

  listCampaigns: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db.execute(sql`
      SELECT
        c.*,
        COUNT(DISTINCT k.id)::int  AS "keywordCount",
        COUNT(DISTINCT s.id)::int  AS "sessionCount"
      FROM ctr_campaigns c
      LEFT JOIN ctr_keywords k ON k."campaignId" = c.id AND k."isActive" = true
      LEFT JOIN ctr_sessions s ON s."campaignId" = c.id
      WHERE c."userId" = ${ctx.user.id}
      GROUP BY c.id
      ORDER BY c."createdAt" DESC
    `);
    return rows as any[];
  }),

  getCampaign: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const rows = await db.execute(sql`
        SELECT c.*
        FROM ctr_campaigns c
        WHERE c.id = ${input.id} AND c."userId" = ${ctx.user.id}
        LIMIT 1
      `);
      if (!rows[0]) throw new Error("Campaign not found");
      const campaign = rows[0] as any;

      const keywords = await db.execute(sql`
        SELECT * FROM ctr_keywords
        WHERE "campaignId" = ${input.id}
        ORDER BY "createdAt" ASC
      `);
      return { ...campaign, keywords: Array.from(keywords) };
    }),

  createCampaign: protectedProcedure
    .input(z.object({
      businessName: z.string().min(1),
      mapsUrl: z.string().optional(),
      phone: z.string().optional(),
      targetCity: z.string().min(1),
      targetCountry: z.string().default("US"),
      gscSiteUrl: z.string().optional(),
      weeklyRampPct: z.number().min(3).max(7).default(5),
      rampMode: z.enum(["auto", "manual"]).default("auto"),
      keywords: z.array(z.object({
        keyword: z.string(),
        keywordType: z.enum(["primary", "brand", "local"]).default("primary"),
        weightPct: z.number().default(33.33),
      })).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");

      const campResult = await db.execute(sql`
        INSERT INTO ctr_campaigns (
          "userId", "businessName", "mapsUrl", "phone",
          "targetCity", "targetCountry", "gscSiteUrl",
          "weeklyRampPct", "rampMode", "useRealBrowser",
          "createdAt", "updatedAt"
        ) VALUES (
          ${ctx.user.id}, ${input.businessName}, ${input.mapsUrl ?? null}, ${input.phone ?? null},
          ${input.targetCity}, ${input.targetCountry}, ${input.gscSiteUrl ?? null},
          ${input.weeklyRampPct}, ${input.rampMode}, true,
          NOW(), NOW()
        )
        RETURNING id
      `);
      const campaignId = (campResult[0] as any).id;

      for (const kw of input.keywords) {
        await db.execute(sql`
          INSERT INTO ctr_keywords (
            "campaignId", "keyword", "keywordType", "weightPct",
            "isActive", "createdAt", "updatedAt"
          ) VALUES (
            ${campaignId}, ${kw.keyword}, ${kw.keywordType}, ${kw.weightPct},
            true, NOW(), NOW()
          )
        `);
      }

      return { id: campaignId };
    }),

  updateCampaignStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["active", "paused", "completed"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.execute(sql`
        UPDATE ctr_campaigns
        SET status = ${input.status}, "updatedAt" = NOW()
        WHERE id = ${input.id} AND "userId" = ${ctx.user.id}
      `);
      return { ok: true };
    }),

  updateCampaign: protectedProcedure
    .input(z.object({
      id: z.number(),
      weeklyRampPct: z.number().min(3).max(7).optional(),
      rampMode: z.enum(["auto", "manual"]).optional(),
      gscSiteUrl: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const { id, ...fields } = input;
      if (fields.weeklyRampPct !== undefined) {
        await db.execute(sql`UPDATE ctr_campaigns SET "weeklyRampPct" = ${fields.weeklyRampPct}, "updatedAt" = NOW() WHERE id = ${id} AND "userId" = ${ctx.user.id}`);
      }
      if (fields.rampMode !== undefined) {
        await db.execute(sql`UPDATE ctr_campaigns SET "rampMode" = ${fields.rampMode}, "updatedAt" = NOW() WHERE id = ${id} AND "userId" = ${ctx.user.id}`);
      }
      if (fields.gscSiteUrl !== undefined) {
        await db.execute(sql`UPDATE ctr_campaigns SET "gscSiteUrl" = ${fields.gscSiteUrl}, "updatedAt" = NOW() WHERE id = ${id} AND "userId" = ${ctx.user.id}`);
      }
      if (fields.notes !== undefined) {
        await db.execute(sql`UPDATE ctr_campaigns SET "notes" = ${fields.notes}, "updatedAt" = NOW() WHERE id = ${id} AND "userId" = ${ctx.user.id}`);
      }
      return { ok: true };
    }),

  // ── Keywords ───────────────────────────────────────────────────────────────

  updateKeywordWeight: protectedProcedure
    .input(z.object({
      id: z.number(),
      weightPct: z.number().min(0).max(100),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.execute(sql`
        UPDATE ctr_keywords SET "weightPct" = ${input.weightPct}, "updatedAt" = NOW()
        WHERE id = ${input.id}
      `);
      return { ok: true };
    }),

  addKeyword: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      keyword: z.string().min(1),
      keywordType: z.enum(["primary", "brand", "local"]).default("primary"),
      weightPct: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.execute(sql`
        INSERT INTO ctr_keywords ("campaignId", "keyword", "keywordType", "weightPct", "isActive", "createdAt", "updatedAt")
        VALUES (${input.campaignId}, ${input.keyword}, ${input.keywordType}, ${input.weightPct}, true, NOW(), NOW())
      `);
      return { ok: true };
    }),

  removeKeyword: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      await db.execute(sql`DELETE FROM ctr_keywords WHERE id = ${input.id}`);
      return { ok: true };
    }),

  // ── Sessions ───────────────────────────────────────────────────────────────

  listSessions: protectedProcedure
    .input(z.object({
      campaignId: z.number().optional(),
      limit: z.number().default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      if (input.campaignId) {
        const rows = await db.execute(sql`
          SELECT s.* FROM ctr_sessions s
          JOIN ctr_campaigns c ON c.id = s."campaignId"
          WHERE s."campaignId" = ${input.campaignId} AND c."userId" = ${ctx.user.id}
          ORDER BY s."createdAt" DESC
          LIMIT ${input.limit}
        `);
        return rows as any[];
      }
      const rows = await db.execute(sql`
        SELECT s.* FROM ctr_sessions s
        JOIN ctr_campaigns c ON c.id = s."campaignId"
        WHERE c."userId" = ${ctx.user.id}
        ORDER BY s."createdAt" DESC
        LIMIT ${input.limit}
      `);
      return rows as any[];
    }),

  // ── Drive Journeys ─────────────────────────────────────────────────────────

  listDriveJourneys: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const rows = await db.execute(sql`
        SELECT j.* FROM ctr_drive_journeys j
        JOIN ctr_campaigns c ON c.id = j."campaignId"
        WHERE j."campaignId" = ${input.campaignId} AND c."userId" = ${ctx.user.id}
        ORDER BY j."createdAt" DESC
        LIMIT 50
      `);
      return rows as any[];
    }),

  createDriveJourney: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      journeyType: z.enum(["driving", "transit", "walking", "cycling"]).default("driving"),
      customerPersona: z.string().optional(),
      originAddress: z.string().min(1),
      destinationAddress: z.string().min(1),
      createCalendarEvent: z.boolean().default(true),
      calendarEventTitle: z.string().optional(),
      scheduledFor: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const camp = await db.execute(sql`
        SELECT id FROM ctr_campaigns WHERE id = ${input.campaignId} AND "userId" = ${ctx.user.id} LIMIT 1
      `);
      if (!camp[0]) throw new Error("Campaign not found");

      const scheduledAt = input.scheduledFor ? new Date(input.scheduledFor).toISOString() : null;
      await db.execute(sql`
        INSERT INTO ctr_drive_journeys (
          "campaignId", "journeyType", "customerPersona",
          "originAddress", "destinationAddress",
          "createCalendarEvent", "calendarEventTitle",
          "status", "browserType",
          "scheduledFor", "createdAt", "updatedAt"
        ) VALUES (
          ${input.campaignId}, ${input.journeyType}, ${input.customerPersona ?? null},
          ${input.originAddress}, ${input.destinationAddress},
          ${input.createCalendarEvent}, ${input.calendarEventTitle ?? null},
          'pending', 'real',
          ${scheduledAt},
          NOW(), NOW()
        )
      `);
      return { ok: true };
    }),

  // ── Ramp Snapshots ─────────────────────────────────────────────────────────

  listRampSnapshots: protectedProcedure
    .input(z.object({ campaignId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      if (input.campaignId) {
        const rows = await db.execute(sql`
          SELECT r.* FROM ctr_ramp_snapshots r
          JOIN ctr_campaigns c ON c.id = r."campaignId"
          WHERE r."campaignId" = ${input.campaignId} AND c."userId" = ${ctx.user.id}
          ORDER BY r."weekStartDate" DESC
          LIMIT 20
        `);
        return rows as any[];
      }
      const rows = await db.execute(sql`
        SELECT r.* FROM ctr_ramp_snapshots r
        JOIN ctr_campaigns c ON c.id = r."campaignId"
        WHERE c."userId" = ${ctx.user.id}
        ORDER BY r."weekStartDate" DESC
        LIMIT 50
      `);
      return rows as any[];
    }),

});
