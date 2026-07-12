/**
 * Prospect Audit Router
 * Exported separately so server/_core/index.ts can import it for the CombinedRouter type.
 */

import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
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
        avgJobValue: z.number().int().positive().optional(),
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
        avgJobValue: input.avgJobValue ?? null,
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

  /**
   * Look up a completed prospect audit by website domain.
   * Used during campaign onboarding to detect if a baseline already exists.
   * Normalizes the input website the same way as the audit engine so
   * https://www.titancleaningco.com and titancleaningco.com both match.
   */
  findByDomain: protectedProcedure
    .input(z.object({ website: z.string() }))
    .query(async ({ input }) => {
      const { normalizeDomain } = await import('./prospectAuditEngine');
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { eq, and, isNull } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return null;

      const domain = normalizeDomain(input.website);
      if (!domain) return null;

      // Find the most recent completed audit for this domain that hasn't been
      // promoted to a campaign yet
      const [audit] = await db
        .select({
          id: prospectAudits.id,
          businessName: prospectAudits.businessName,
          location: prospectAudits.location,
          overallScore: prospectAudits.overallScore,
          chatgptScore: prospectAudits.chatgptScore,
          geminiScore: prospectAudits.geminiScore,
          aiOverviewScore: prospectAudits.aiOverviewScore,
          queriesMentioned: prospectAudits.queriesMentioned,
          completedAt: prospectAudits.completedAt,
          queries: prospectAudits.queries,
          snapshotResults: prospectAudits.snapshotResults,
          campaignId: prospectAudits.campaignId,
          baselinePromotedAt: prospectAudits.baselinePromotedAt,
        })
        .from(prospectAudits)
        .where(
          and(
            eq(prospectAudits.normalizedDomain, domain),
            eq(prospectAudits.status, 'completed'),
            isNull(prospectAudits.campaignId) // not yet linked to a campaign
          )
        )
        .orderBy()
        .limit(1);

      return audit ?? null;
    }),

  /** List recent audits */
  listAudits: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
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

  /**
   * Generate (or return existing) share token for an audit.
   * The token is a 32-byte hex string stored on the audit record.
   * Returns the full shareable URL.
   */
  getShareLink: protectedProcedure
    .input(z.object({ auditId: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const crypto = await import('crypto');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const [audit] = await db.select({ id: prospectAudits.id, shareToken: prospectAudits.shareToken })
        .from(prospectAudits).where(eq(prospectAudits.id, input.auditId)).limit(1);
      if (!audit) throw new Error('Audit not found');

      let token = audit.shareToken;
      if (!token) {
        token = crypto.randomBytes(32).toString('hex');
        await db.update(prospectAudits).set({ shareToken: token }).where(eq(prospectAudits.id, input.auditId));
      }
      return { token, url: `/audit/${token}` };
    }),

  /**
   * Public endpoint — fetch audit by share token (no auth required).
   * Used by the public share page.
   */
  getByShareToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return null;
      const [audit] = await db.select().from(prospectAudits)
        .where(eq(prospectAudits.shareToken, input.token)).limit(1);
      return audit ?? null;
    }),

  /**
   * Get the current month's audit quota for the calling agency.
   * Returns { used, total, remaining, periodMonth }.
   */
  getQuota: protectedProcedure
    .query(async ({ ctx }) => {
      const { getDb } = await import('./db');
      const { agencyAuditQuota } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const { getAgencyByUserId } = await import('./dbAgencies');
      const db = await getDb();
      if (!db) return null;

      const agency = await getAgencyByUserId(ctx.user.id);
      if (!agency) return null;

      const now = new Date();
      const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const [row] = await db.select().from(agencyAuditQuota)
        .where(and(eq(agencyAuditQuota.agencyId, agency.id), eq(agencyAuditQuota.periodMonth, periodMonth)))
        .limit(1);

      const included = row?.includedQuota ?? 20;
      const overageAudits = (row?.overageBlocksPurchased ?? 0) * 5;
      const total = included + overageAudits;
      const used = row?.auditsUsed ?? 0;
      return { used, total, remaining: Math.max(0, total - used), periodMonth, agencyId: agency.id };
    }),

  /**
   * Create a Stripe Checkout Session for purchasing overage audit blocks.
   */
  createOverageCheckout: protectedProcedure
    .input(z.object({
      packageId: z.enum(['audit_5', 'audit_10', 'audit_25', 'audit_50']),
      successUrl: z.string().url(),
      cancelUrl: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { createAuditOverageCheckoutSession } = await import('./stripeAuditOverage');
      const agency = await getAgencyByUserId(ctx.user.id);
      if (!agency) throw new Error('Agency not found');

      const result = await createAuditOverageCheckoutSession({
        agencyId: agency.id,
        packageId: input.packageId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        stripeCustomerId: (agency as any).stripeCustomerId ?? null,
      });
      return result;
    }),

  /**
   * Fulfil an overage purchase after Stripe redirects back (success-page poll).
   * Verifies the session with Stripe before crediting.
   */
  fulfillOverage: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getAuditOverageSession, fulfillAuditOveragePurchase } = await import('./stripeAuditOverage');
      const agency = await getAgencyByUserId(ctx.user.id);
      if (!agency) throw new Error('Agency not found');

      const session = await getAuditOverageSession(input.sessionId);
      if (!session.paid) throw new Error('Payment not completed');
      if (session.agencyId !== agency.id) throw new Error('Session does not belong to this agency');

      const now = new Date();
      const periodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      await fulfillAuditOveragePurchase(agency.id, session.auditsGranted, periodMonth);
      return { auditsGranted: session.auditsGranted };
    }),
});
