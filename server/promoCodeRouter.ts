import { z } from "zod";
import { router, adminProcedure, publicProcedure } from "./_core/trpc";
import { getDb } from "./db";
import { promoCodes } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";

// ============= Promo Code Router =============

export const promoCodeRouter = router({

  // List all promo codes (admin only)
  list: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    return db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt));
  }),

  // Create a new promo code (admin only)
  create: adminProcedure
    .input(z.object({
      code: z.string().min(3).max(50).optional(), // auto-generated if omitted
      description: z.string().optional(),
      discountType: z.enum(["free_trial", "percent_off", "fixed_off"]).default("free_trial"),
      discountValue: z.number().int().min(0).default(0),
      packageTierSlug: z.string().optional(), // lock to specific package, or null for any
      maxUses: z.number().int().min(1).default(1),
      expiresAt: z.string().optional(), // ISO date string, or omit for no expiry
      noCharge: z.boolean().default(true),
      trialDays: z.number().int().min(1).default(30),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Auto-generate a code if not provided
      const code = input.code
        ? input.code.toUpperCase().trim()
        : crypto.randomBytes(4).toString("hex").toUpperCase();

      const [created] = await db.insert(promoCodes).values({
        code,
        description: input.description || null,
        discountType: input.discountType,
        discountValue: input.discountValue,
        packageTierSlug: input.packageTierSlug || null,
        maxUses: input.maxUses,
        usedCount: 0,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        noCharge: input.noCharge,
        trialDays: input.trialDays,
        createdBy: ctx.user?.id || null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      return created;
    }),

  // Update a promo code (admin only)
  update: adminProcedure
    .input(z.object({
      id: z.number().int(),
      description: z.string().optional(),
      maxUses: z.number().int().min(1).optional(),
      expiresAt: z.string().nullable().optional(),
      noCharge: z.boolean().optional(),
      trialDays: z.number().int().min(1).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (input.description !== undefined) updates.description = input.description;
      if (input.maxUses !== undefined) updates.maxUses = input.maxUses;
      if (input.expiresAt !== undefined) updates.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (input.noCharge !== undefined) updates.noCharge = input.noCharge;
      if (input.trialDays !== undefined) updates.trialDays = input.trialDays;

      await db.update(promoCodes).set(updates).where(eq(promoCodes.id, input.id));
      const [updated] = await db.select().from(promoCodes).where(eq(promoCodes.id, input.id)).limit(1);
      return updated;
    }),

  // Delete a promo code (admin only)
  delete: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(promoCodes).where(eq(promoCodes.id, input.id));
      return { success: true };
    }),

  // Validate a promo code (public — used during onboarding/webhook)
  validate: publicProcedure
    .input(z.object({ code: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [promo] = await db
        .select()
        .from(promoCodes)
        .where(eq(promoCodes.code, input.code.toUpperCase().trim()))
        .limit(1);

      if (!promo) return { valid: false, reason: "Code not found" };
      if (promo.expiresAt && new Date() > promo.expiresAt) return { valid: false, reason: "Code has expired" };
      if (promo.maxUses !== null && promo.usedCount >= promo.maxUses) return { valid: false, reason: "Code has reached its maximum uses" };

      return {
        valid: true,
        promo: {
          id: promo.id,
          code: promo.code,
          description: promo.description,
          discountType: promo.discountType,
          discountValue: promo.discountValue,
          packageTierSlug: promo.packageTierSlug,
          noCharge: promo.noCharge,
          trialDays: promo.trialDays,
        },
      };
    }),
});
