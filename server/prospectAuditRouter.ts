/**
 * Prospect Audit Router
 * Exported separately so server/_core/index.ts can import it for the CombinedRouter type.
 */

import { protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";

export const prospectAuditRouter = router({
  /** Step 1: Generate 15 queries from business info */
  generateQueries: protectedProcedure
    .input(
      z.object({
        businessName: z.string().min(1),
        location: z.string().min(1),
        industry: z.string().optional(),
        seedKeywords: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { generateProspectQueries } = await import('./prospectAuditEngine');
      const queries = await generateProspectQueries(input);
      return { queries };
    }),

  /** Step 2: Create audit record and return ID */
  createAudit: protectedProcedure
    .input(
      z.object({
        businessName: z.string().min(1),
        website: z.string().optional(),
        location: z.string().min(1),
        industry: z.string().optional(),
        seedKeywords: z.string().optional(),
        queries: z.array(z.object({ searchQuery: z.string(), location: z.string() })),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { getAgencyByUserId } = await import('./dbAgencies');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      let agencyId: number | null = null;
      try {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (agency) agencyId = agency.id;
      } catch {}

      const [audit] = await db.insert(prospectAudits).values({
        agencyId,
        businessName: input.businessName,
        website: input.website ?? null,
        location: input.location,
        industry: input.industry ?? null,
        seedKeywords: input.seedKeywords ?? null,
        queries: input.queries as any,
        status: 'pending',
      }).returning({ id: prospectAudits.id });

      return { auditId: audit.id };
    }),

  /** Step 3: Run the audit */
  runAudit: protectedProcedure
    .input(z.object({ auditId: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const { runProspectAudit } = await import('./prospectAuditEngine');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const [audit] = await db.select().from(prospectAudits).where(eq(prospectAudits.id, input.auditId)).limit(1);
      if (!audit) throw new Error('Audit not found');

      const queries = (audit.queries as any[]) || [];
      const { snapshots, scores } = await runProspectAudit(
        audit.id,
        audit.businessName,
        audit.website,
        null,
        audit.agencyId,
        queries
      );

      return { snapshots, scores };
    }),

  /** Fetch a completed audit by ID */
  getAudit: protectedProcedure
    .input(z.object({ auditId: z.number() }))
    .query(async ({ input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const [audit] = await db.select().from(prospectAudits).where(eq(prospectAudits.id, input.auditId)).limit(1);
      if (!audit) throw new Error('Audit not found');
      return audit;
    }),

  /** List recent audits */
  listAudits: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { desc, eq } = await import('drizzle-orm');
      const { getAgencyByUserId } = await import('./dbAgencies');
      const db = await getDb();
      if (!db) return [];

      let agencyId: number | null = null;
      try {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (agency) agencyId = agency.id;
      } catch {}

      const rows = agencyId
        ? await db.select().from(prospectAudits).where(eq(prospectAudits.agencyId, agencyId)).orderBy(desc(prospectAudits.createdAt)).limit(input.limit)
        : await db.select().from(prospectAudits).orderBy(desc(prospectAudits.createdAt)).limit(input.limit);

      return rows;
    }),
});
