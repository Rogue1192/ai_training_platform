/**
 * v7AccountRouter.ts
 * 
 * tRPC router for managing the V7 browser training account pool.
 * Provides CRUD operations for ChatGPT/Gemini accounts and residential proxies.
 */

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, publicProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { v7Accounts, v7Proxies, v7SessionLogs } from "../drizzle/schema";
import { encrypt, decrypt } from "./encryption";

export const v7AccountRouter = router({
  // ── Accounts ────────────────────────────────────────────────────────────────
  
  listAccounts: publicProcedure.query(async () => {
    const db = await getDb();
    const accounts = await db.select({
      id: v7Accounts.id,
      provider: v7Accounts.provider,
      email: v7Accounts.email,
      status: v7Accounts.status,
      proxyId: v7Accounts.proxyId,
      lastUsedAt: v7Accounts.lastUsedAt,
      totalSessionsRun: v7Accounts.totalSessionsRun,
      consecutiveErrors: v7Accounts.consecutiveErrors,
      createdAt: v7Accounts.createdAt,
      notes: v7Accounts.notes,
    })
    .from(v7Accounts)
    .orderBy(desc(v7Accounts.createdAt));
    
    return accounts;
  }),
  
  addAccount: publicProcedure
    .input(z.object({
      provider: z.enum(["chatgpt", "gemini"]),
      email: z.string().email(),
      password: z.string().min(8),
      proxyId: z.number().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const encryptedPassword = encrypt(input.password);
      
      const [account] = await db.insert(v7Accounts).values({
        provider: input.provider,
        email: input.email,
        encryptedPassword,
        proxyId: input.proxyId,
        status: "warming", // New accounts start in warming state
        notes: input.notes,
      }).returning({ id: v7Accounts.id });
      
      return { success: true, id: account?.id };
    }),
  
  updateAccountStatus: publicProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["active", "warming", "cooldown", "flagged", "disabled"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db.update(v7Accounts)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(v7Accounts.id, input.id));
      return { success: true };
    }),
  
  deleteAccount: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db.delete(v7Accounts).where(eq(v7Accounts.id, input.id));
      return { success: true };
    }),
  
  // ── Proxies ─────────────────────────────────────────────────────────────────
  
  listProxies: publicProcedure.query(async () => {
    const db = await getDb();
    const proxies = await db.select({
      id: v7Proxies.id,
      city: v7Proxies.city,
      state: v7Proxies.state,
      country: v7Proxies.country,
      status: v7Proxies.status,
      lastTestedAt: v7Proxies.lastTestedAt,
      createdAt: v7Proxies.createdAt,
    })
    .from(v7Proxies)
    .orderBy(desc(v7Proxies.createdAt));
    
    return proxies;
  }),
  
  addProxy: publicProcedure
    .input(z.object({
      connectionString: z.string(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().default("US"),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const encryptedConnectionString = encrypt(input.connectionString);
      
      const [proxy] = await db.insert(v7Proxies).values({
        encryptedConnectionString,
        city: input.city,
        state: input.state,
        country: input.country,
      }).returning({ id: v7Proxies.id });
      
      return { success: true, id: proxy?.id };
    }),
  
  deleteProxy: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db.delete(v7Proxies).where(eq(v7Proxies.id, input.id));
      return { success: true };
    }),
  
  // ── Session Logs ─────────────────────────────────────────────────────────────

  listSessionLogs: publicProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) => {
      const db = await getDb();
      const logs = await db.select({
        id: v7SessionLogs.id,
        provider: v7SessionLogs.targetProvider,
        query: v7SessionLogs.phraseText,
        success: v7SessionLogs.sessionWin,
        createdAt: v7SessionLogs.createdAt,
      })
        .from(v7SessionLogs)
        .orderBy(desc(v7SessionLogs.createdAt))
        .limit(input.limit);
      return logs;
    }),

  getSessionLogs: publicProcedure
    .input(z.object({
      campaignId: z.number(),
      limit: z.number().default(50),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      const logs = await db.select()
        .from(v7SessionLogs)
        .where(eq(v7SessionLogs.campaignId, input.campaignId))
        .orderBy(desc(v7SessionLogs.createdAt))
        .limit(input.limit);
      return logs;
    }),
  
  // ── Pool Summary ─────────────────────────────────────────────────────────────
  
  getPoolSummary: publicProcedure.query(async () => {
    const db = await getDb();
    const accounts = await db.select().from(v7Accounts);
    const proxies = await db.select().from(v7Proxies);
    
    const summary = {
      chatgpt: {
        total: accounts.filter(a => a.provider === "chatgpt").length,
        active: accounts.filter(a => a.provider === "chatgpt" && a.status === "active").length,
        warming: accounts.filter(a => a.provider === "chatgpt" && a.status === "warming").length,
        flagged: accounts.filter(a => a.provider === "chatgpt" && a.status === "flagged").length,
      },
      gemini: {
        total: accounts.filter(a => a.provider === "gemini").length,
        active: accounts.filter(a => a.provider === "gemini" && a.status === "active").length,
        warming: accounts.filter(a => a.provider === "gemini" && a.status === "warming").length,
        flagged: accounts.filter(a => a.provider === "gemini" && a.status === "flagged").length,
      },
      proxies: {
        total: proxies.length,
        active: proxies.filter(p => p.status === "active").length,
        flagged: proxies.filter(p => p.status === "flagged").length,
      }
    };
    
    return summary;
  }),
});
