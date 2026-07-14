/**
 * Prospect Audit Router
 * Exported separately so server/_core/index.ts can import it for the CombinedRouter type.
 *
 * Quota billing periods are anniversary-based:
 *   - Period starts on the same day-of-month as the agency's createdAt date
 *   - e.g. agency created on the 13th → periods run 13th → 12th of next month
 * Super admins (role === 'admin') are never quota-gated.
 */

import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";

// ─── Billing period helpers ───────────────────────────────────────────────────

/**
 * Given an agency's createdAt date and "now", compute the start of the
 * current anniversary billing period (as a YYYY-MM-DD string).
 *
 * Example: createdAt = 2026-06-13, now = 2026-07-20
 *   → current period start = 2026-07-13
 *
 * Example: createdAt = 2026-06-13, now = 2026-07-10
 *   → current period start = 2026-06-13
 */
function getAnniversaryPeriodStart(createdAt: Date, now: Date): string {
  const anchorDay = createdAt.getUTCDate(); // e.g. 13
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-indexed
  const day = now.getUTCDate();

  // Try the anchor day in the current month
  let periodStart = new Date(Date.UTC(year, month, anchorDay));

  // If that date is in the future, roll back one month
  if (periodStart > now) {
    periodStart = new Date(Date.UTC(year, month - 1, anchorDay));
  }

  return periodStart.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Legacy YYYY-MM string for the periodMonth column (kept for backward compat) */
function getPeriodMonth(periodStart: string): string {
  return periodStart.slice(0, 7); // "2026-07-13" → "2026-07"
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const prospectAuditRouter = router({
  /** Step 1: Generate queries from business info (one set per location) */
  generateQueries: protectedProcedure
    .input(
      z.object({
        businessName: z.string().min(1),
        location: z.string().min(1),
        locations: z.array(z.string().min(1)).optional(),
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
        locations: z.array(z.string().min(1)).optional(),
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
      const { serializeLocations } = await import('../shared/location');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      let agencyId: number | null = null;
      try {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (agency) agencyId = agency.id;
      } catch {}

      // Serialize all locations into the single location column ("City, ST; City2, ST")
      const allLocations = [
        input.location,
        ...(input.locations ?? []).filter((l) => l.trim() && l.trim() !== input.location.trim()),
      ].filter(Boolean);
      const storedLocation = serializeLocations(allLocations) || input.location;

      const [audit] = await db.insert(prospectAudits).values({
        agencyId,
        businessName: input.businessName,
        website: input.website ?? null,
        location: storedLocation,
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
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits, agencyAuditQuota, agencies } = await import('../drizzle/schema');
      const { eq, and, sql } = await import('drizzle-orm');
      const { runProspectAudit } = await import('./prospectAuditEngine');
      const { getAgencyByUserId } = await import('./dbAgencies');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const [audit] = await db.select().from(prospectAudits).where(eq(prospectAudits.id, input.auditId)).limit(1);
      if (!audit) throw new Error('Audit not found');

      // Super admins are never quota-gated
      const isAdmin = (ctx.user as any).role === 'admin';

      // ── Quota check (agency users only) ────────────────────────────────────
      const agency = isAdmin ? null : await getAgencyByUserId(ctx.user.id);
      if (agency) {
        const now = new Date();
        const periodStart = getAnniversaryPeriodStart(agency.createdAt, now);
        const [qRow] = await db.select().from(agencyAuditQuota)
          .where(and(eq(agencyAuditQuota.agencyId, agency.id), eq(agencyAuditQuota.periodStart, periodStart)))
          .limit(1);
        const included = qRow?.includedQuota ?? 20;
        const overageAudits = (qRow?.overageBlocksPurchased ?? 0) * 5;
        const total = included + overageAudits;
        const used = qRow?.auditsUsed ?? 0;
        if (used >= total) {
          throw new Error(`Audit quota exceeded (${used}/${total} used this period). Purchase more audits to continue.`);
        }
      }

      const queries = (audit.queries as any[]) || [];
      const { snapshots, scores } = await runProspectAudit(
        audit.id,
        audit.businessName,
        audit.website,
        null,
        audit.agencyId,
        queries
      );

      // ── Increment quota usage (agency users only) ───────────────────────────
      if (agency) {
        const now = new Date();
        const periodStart = getAnniversaryPeriodStart(agency.createdAt, now);
        const periodMonth = getPeriodMonth(periodStart);
        await db.insert(agencyAuditQuota).values({
          agencyId: agency.id,
          periodMonth,
          periodStart,
          auditsUsed: 1,
          includedQuota: 20,
          overageBlocksPurchased: 0,
        }).onConflictDoUpdate({
          target: [agencyAuditQuota.agencyId, agencyAuditQuota.periodStart],
          set: { auditsUsed: sql`${agencyAuditQuota.auditsUsed} + 1`, updatedAt: new Date() },
        });
      }

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
   * Delete an audit record.
   * Agency users can only delete their own audits; admins can delete any.
   */
  deleteAudit: protectedProcedure
    .input(z.object({ auditId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const { getAgencyByUserId } = await import('./dbAgencies');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const isAdmin = (ctx.user as any).role === 'admin';
      const agency = isAdmin ? null : await getAgencyByUserId(ctx.user.id);

      if (agency) {
        // Agency user — verify ownership before deleting
        const [audit] = await db.select({ id: prospectAudits.id, agencyId: prospectAudits.agencyId })
          .from(prospectAudits).where(eq(prospectAudits.id, input.auditId)).limit(1);
        if (!audit) throw new Error('Audit not found');
        if (audit.agencyId !== agency.id) throw new Error('You do not have permission to delete this audit');
        await db.delete(prospectAudits).where(and(eq(prospectAudits.id, input.auditId), eq(prospectAudits.agencyId, agency.id)));
      } else {
        // Admin — can delete any audit
        await db.delete(prospectAudits).where(eq(prospectAudits.id, input.auditId));
      }

      return { deleted: true };
    }),

  /**
   * Look up a completed prospect audit by website domain.
   * Used during campaign onboarding to detect if a baseline already exists.
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
            isNull(prospectAudits.campaignId)
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
      const { getAgencyByUserId, getAgencyById } = await import('./dbAgencies');
      const db = await getDb();
      if (!db) return [];
      // Impersonation: super-admin viewing as an agency sees that agency's audits
      const impersonatedAgencyId = (ctx as any).impersonatedAgencyId as number | null;
      if (impersonatedAgencyId && (ctx.user as any).role === 'admin') {
        const rows = await db.select().from(prospectAudits).where(eq(prospectAudits.agencyId, impersonatedAgencyId)).orderBy(desc(prospectAudits.createdAt)).limit(input.limit);
        return rows;
      }
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
   * Get the current billing period's audit quota for the calling user.
   * - Agency users: anniversary-based period, 20 included + overage
   * - Super admins: unlimited (returns isAdmin: true)
   */
    getQuota: protectedProcedure
    .query(async ({ ctx }) => {
      const isAdmin = (ctx.user as any).role === 'admin';
      const impersonatedAgencyId = (ctx as any).impersonatedAgencyId as number | null;
      // When impersonating, show the agency's real quota instead of admin unlimited
      if (isAdmin && !impersonatedAgencyId) {
        return { used: 0, total: null, remaining: null, isAdmin: true, periodStart: null, periodEnd: null };
      }
      const { getDb } = await import('./db');
      const { agencyAuditQuota } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const { getAgencyByUserId, getAgencyById } = await import('./dbAgencies');
      const db = await getDb();
      if (!db) return null;
      // Resolve agency: impersonated agency or the caller's own
      const agency = impersonatedAgencyId
        ? await getAgencyById(impersonatedAgencyId)
        : await getAgencyByUserId(ctx.user.id);
      if (!agency) return null;

      const now = new Date();
      const periodStart = getAnniversaryPeriodStart(agency.createdAt, now);

      // Compute period end = one month after period start, minus one day
      const psDate = new Date(periodStart + 'T00:00:00Z');
      const peDate = new Date(Date.UTC(psDate.getUTCFullYear(), psDate.getUTCMonth() + 1, psDate.getUTCDate() - 1));
      const periodEnd = peDate.toISOString().slice(0, 10);

      const [row] = await db.select().from(agencyAuditQuota)
        .where(and(eq(agencyAuditQuota.agencyId, agency.id), eq(agencyAuditQuota.periodStart, periodStart)))
        .limit(1);

      const included = row?.includedQuota ?? 20;
      const overageAudits = (row?.overageBlocksPurchased ?? 0) * 5;
      const total = included + overageAudits;
      const used = row?.auditsUsed ?? 0;
      return {
        used,
        total,
        remaining: Math.max(0, total - used),
        isAdmin: false,
        periodStart,
        periodEnd,
        agencyId: agency.id,
      };
    }),

  /**
   * Public endpoint — submit lead contact info after viewing blurred results.
   * Saves name/phone/email to the audit record, flips leadCaptured=true,
   * fires the agency's CRM webhook, and returns the clean report URL.
   */
  submitLead: publicProcedure
    .input(z.object({
      token: z.string(),
      firstName: z.string().min(1),
      lastName: z.string().min(1),
      phone: z.string().min(7),
      email: z.string().email(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits, agencies } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const [audit] = await db.select().from(prospectAudits)
        .where(eq(prospectAudits.shareToken, input.token)).limit(1);
      if (!audit) throw new Error('Audit not found');

      // Save contact info and flip leadCaptured
      await db.update(prospectAudits).set({
        contactFirstName: input.firstName,
        contactLastName: input.lastName,
        contactPhone: input.phone,
        contactEmail: input.email,
        leadCaptured: true,
        updatedAt: new Date(),
      }).where(eq(prospectAudits.id, audit.id));

      // Fire agency CRM webhook (async, non-blocking)
      if (audit.agencyId) {
        try {
          const [agency] = await db.select({ webhookUrl: agencies.webhookUrl })
            .from(agencies).where(eq(agencies.id, audit.agencyId)).limit(1);
          if (agency?.webhookUrl) {
            const reportUrl = `${process.env.PUBLIC_URL ?? ''}/audit/${input.token}`;
            fetch(agency.webhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                firstName: input.firstName,
                lastName: input.lastName,
                phone: input.phone,
                email: input.email,
                businessName: audit.businessName,
                website: audit.website,
                location: audit.location,
                overallScore: audit.overallScore,
                reportUrl,
                auditId: audit.id,
                source: 'ai_visibility_audit',
              }),
            }).catch((err: Error) => console.error('[Audit] Webhook fire failed:', err.message));
          }
        } catch (err: any) {
          console.error('[Audit] Webhook lookup failed:', err.message);
        }
      }

      // Fire super-admin global webhook (async, non-blocking)
      try {
        const { getServiceKey } = await import('./db');
        const { decrypt } = await import('./encryption');
        const wlRecord = await getServiceKey('whitelabel');
        if (wlRecord) {
          const cfg = JSON.parse(decrypt(wlRecord.encryptedValue)) as Record<string, string>;
          if (cfg.globalAuditWebhookUrl) {
            const reportUrl = `${process.env.PUBLIC_URL ?? ''}/audit/${input.token}`;
            fetch(cfg.globalAuditWebhookUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                firstName: input.firstName,
                lastName: input.lastName,
                phone: input.phone,
                email: input.email,
                businessName: audit.businessName,
                website: audit.website,
                location: audit.location,
                overallScore: audit.overallScore,
                reportUrl,
                auditId: audit.id,
                agencyId: audit.agencyId,
                source: 'ai_visibility_audit',
              }),
            }).catch((err: Error) => console.error('[Audit] Global webhook fire failed:', err.message));
          }
        }
      } catch {}

      return { success: true, reportUrl: `/audit/${input.token}` };
    }),

  /**
   * Public endpoint — returns minimal metadata for the public report page:
   * leadCaptured flag, agency calendar embed code, and audit status.
   * Does NOT return full audit data (that stays in getByShareToken).
   */
  getPublicAuditMeta: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits, agencies } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return null;

      const [audit] = await db
        .select({
          id: prospectAudits.id,
          leadCaptured: prospectAudits.leadCaptured,
          status: prospectAudits.status,
          agencyId: prospectAudits.agencyId,
        })
        .from(prospectAudits)
        .where(eq(prospectAudits.shareToken, input.token))
        .limit(1);
      if (!audit) return null;

      let calendarEmbedCode: string | null = null;
      if (audit.agencyId) {
        const [agency] = await db
          .select({ calendarEmbedCode: agencies.calendarEmbedCode })
          .from(agencies)
          .where(eq(agencies.id, audit.agencyId))
          .limit(1);
        calendarEmbedCode = agency?.calendarEmbedCode ?? null;
      }

      // Fall back to super-admin global calendar embed
      if (!calendarEmbedCode) {
        try {
          const { getServiceKey } = await import('./db');
          const { decrypt } = await import('./encryption');
          const wlRecord = await getServiceKey('whitelabel');
          if (wlRecord) {
            const cfg = JSON.parse(decrypt(wlRecord.encryptedValue)) as Record<string, string>;
            calendarEmbedCode = cfg.globalCalendarEmbedCode ?? null;
          }
        } catch {}
      }

      return {
        leadCaptured: audit.leadCaptured,
        status: audit.status,
        calendarEmbedCode,
      };
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
      if (!agency) throw new Error('Agency not found. Only white-label agency accounts can purchase audit credits.');

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
   * Admin diagnostic: test DataForSEO credentials and return the exact error
   * if the connection fails, so we know whether it's a missing key, wrong
   * credentials, or a network/API error.
   */
  testDataForSEOConnection: protectedProcedure
    .query(async () => {
      try {
        const { getServiceKey } = await import('./db');
        const { decrypt } = await import('./encryption');
        const record = await getServiceKey('dataforseo');
        if (!record?.encryptedValue) {
          // Check env vars as fallback
          const login = process.env.DATAFORSEO_LOGIN;
          const password = process.env.DATAFORSEO_PASSWORD;
          if (!login || !password) {
            return { ok: false, source: 'none', error: 'DataForSEO credentials not configured. Add them in Settings → Service Keys or set DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD env vars.' };
          }
          return { ok: true, source: 'env', login: login.substring(0, 4) + '****' };
        }
        const creds = JSON.parse(decrypt(record.encryptedValue)) as { login?: string; password?: string };
        if (!creds.login || !creds.password) {
          return { ok: false, source: 'db', error: 'DataForSEO credentials stored in DB are incomplete (missing login or password).' };
        }
        // Test the actual API connection
        const axios = (await import('axios')).default;
        const auth = 'Basic ' + Buffer.from(`${creds.login}:${creds.password}`).toString('base64');
        const resp = await axios.get('https://api.dataforseo.com/v3/appendix/user_data', {
          headers: { Authorization: auth },
          timeout: 15_000,
        });
        if (resp.data?.status_code === 20000) {
          return { ok: true, source: 'db', login: creds.login.substring(0, 4) + '****', balance: resp.data?.tasks?.[0]?.result?.[0]?.money?.balance ?? null };
        }
        return { ok: false, source: 'db', error: `API returned status ${resp.data?.status_code}: ${resp.data?.status_message}` };
      } catch (err: any) {
        return { ok: false, source: 'unknown', error: err.message };
      }
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

      // Use the anniversary period start for the current date
      const now = new Date();
      const periodStart = getAnniversaryPeriodStart(agency.createdAt, now);
      const periodMonth = getPeriodMonth(periodStart);
      await fulfillAuditOveragePurchase(agency.id, session.auditsGranted, periodMonth, periodStart);
      return { auditsGranted: session.auditsGranted };
    }),

  // ─── Widget (public, no auth) ─────────────────────────────────────────────
  // Public counterparts of generateQueries / createAudit / runAudit used by
  // the embeddable /audit-widget page. No auth required; no quota gate.

  /**
   * Widget Step 1: Generate queries from business info.
   * Public — no auth required (widget runs on third-party landing pages).
   */
  widgetGenerateQueries: publicProcedure
    .input(
      z.object({
        businessName: z.string().min(1),
        location: z.string().min(1),
        locations: z.array(z.string().min(1)).optional(),
        industry: z.string().optional(),
        seedKeywords: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { generateProspectQueries } = await import('./prospectAuditEngine');
      const queries = await generateProspectQueries(input);
      return { queries };
    }),

  /**
   * Widget Step 2: Create audit record scoped to an agency.
   * Public — no auth required.
   */
  widgetCreateAudit: publicProcedure
    .input(
      z.object({
        agencyId: z.number().int().positive().optional(),
        businessName: z.string().min(1),
        website: z.string().optional(),
        location: z.string().min(1),
        locations: z.array(z.string().min(1)).optional(),
        industry: z.string().optional(),
        seedKeywords: z.string().optional(),
        avgJobValue: z.number().int().positive().optional(),
        queries: z.array(z.object({ searchQuery: z.string(), location: z.string() })),
      })
    )
    .mutation(async ({ input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { serializeLocations } = await import('../shared/location');
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      const allLocations = [
        input.location,
        ...(input.locations ?? []).filter((l) => l.trim() && l.trim() !== input.location.trim()),
      ].filter(Boolean);
      const storedLocation = serializeLocations(allLocations) || input.location;
      const [audit] = await db.insert(prospectAudits).values({
        agencyId: input.agencyId ?? null,
        businessName: input.businessName,
        website: input.website ?? null,
        location: storedLocation,
        industry: input.industry ?? null,
        seedKeywords: input.seedKeywords ?? null,
        avgJobValue: input.avgJobValue ?? null,
        queries: input.queries as any,
        status: 'pending',
      }).returning({ id: prospectAudits.id });
      return { auditId: audit.id };
    }),

  /**
   * Widget Step 3: Run the audit and return a share token.
   * Public — no auth required.
   * Quota-gated the same way as the internal runAudit: if the audit is scoped
   * to an agency (agencyId set on the audit record) the run counts against
   * that agency's monthly allowance and is blocked when the quota is exhausted.
   * Returns the share token so the widget can show results inline.
   */
  widgetRunAudit: publicProcedure
    .input(z.object({ auditId: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits, agencyAuditQuota, agencies } = await import('../drizzle/schema');
      const { eq, and, sql } = await import('drizzle-orm');
      const { runProspectAudit } = await import('./prospectAuditEngine');
      const crypto = await import('crypto');
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      const [audit] = await db.select().from(prospectAudits).where(eq(prospectAudits.id, input.auditId)).limit(1);
      if (!audit) throw new Error('Audit not found');
      // ── Quota check (agency-scoped audits only) ─────────────────────────────
      if (audit.agencyId) {
        const [agency] = await db
          .select({ id: agencies.id, createdAt: agencies.createdAt })
          .from(agencies)
          .where(eq(agencies.id, audit.agencyId))
          .limit(1);
        if (agency) {
          const now = new Date();
          const periodStart = getAnniversaryPeriodStart(agency.createdAt, now);
          const [qRow] = await db.select().from(agencyAuditQuota)
            .where(and(eq(agencyAuditQuota.agencyId, agency.id), eq(agencyAuditQuota.periodStart, periodStart)))
            .limit(1);
          const included = qRow?.includedQuota ?? 20;
          const overageAudits = (qRow?.overageBlocksPurchased ?? 0) * 5;
          const total = included + overageAudits;
          const used = qRow?.auditsUsed ?? 0;
          if (used >= total) {
            throw new Error(`Audit quota exceeded (${used}/${total} used this period). Purchase more audits to continue.`);
          }
        }
      }
      // Ensure share token exists before running so client can poll
      let token = audit.shareToken;
      if (!token) {
        token = crypto.randomBytes(32).toString('hex');
        await db.update(prospectAudits).set({ shareToken: token }).where(eq(prospectAudits.id, input.auditId));
      }
      const queries = (audit.queries as any[]) || [];
      const { snapshots, scores } = await runProspectAudit(
        audit.id,
        audit.businessName,
        audit.website,
        null,
        audit.agencyId,
        queries
      );
      // ── Increment quota usage (agency-scoped audits only) ──────────────────
      if (audit.agencyId) {
        const [agency] = await db
          .select({ id: agencies.id, createdAt: agencies.createdAt })
          .from(agencies)
          .where(eq(agencies.id, audit.agencyId))
          .limit(1);
        if (agency) {
          const now = new Date();
          const periodStart = getAnniversaryPeriodStart(agency.createdAt, now);
          const periodMonth = getPeriodMonth(periodStart);
          await db.insert(agencyAuditQuota).values({
            agencyId: agency.id,
            periodMonth,
            periodStart,
            auditsUsed: 1,
            includedQuota: 20,
            overageBlocksPurchased: 0,
          }).onConflictDoUpdate({
            target: [agencyAuditQuota.agencyId, agencyAuditQuota.periodStart],
            set: { auditsUsed: sql`${agencyAuditQuota.auditsUsed} + 1`, updatedAt: new Date() },
          });
        }
      }
      return { snapshots, scores, shareToken: token };
    }),

  /**
   * Widget: Get agency branding (calendar embed code) by agency ID.
   * Public — used by the widget to show the correct CTA after lead capture.
   */
  widgetGetAgencyMeta: publicProcedure
    .input(z.object({ agencyId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { getDb } = await import('./db');
      const { agencies } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return null;
      const [agency] = await db
        .select({
          id: agencies.id,
          name: agencies.name,
          brandName: agencies.brandName,
          calendarEmbedCode: agencies.calendarEmbedCode,
        })
        .from(agencies)
        .where(eq(agencies.id, input.agencyId))
        .limit(1);
      if (!agency) return null;
      return {
        agencyName: agency.brandName || agency.name,
        calendarEmbedCode: agency.calendarEmbedCode ?? null,
      };
    }),
});

