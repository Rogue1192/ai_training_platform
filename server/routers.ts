import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    // Debug endpoint to check Supabase configuration
    debug: publicProcedure.query(async ({ ctx }) => {
      const { isSupabaseConfigured } = await import("./_core/supabase");
      const authHeader = ctx.req.headers.authorization;
      
      let tokenInfo = null;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.substring(7);
        tokenInfo = {
          present: true,
          length: token.length,
          prefix: token.substring(0, 20) + "...",
        };
        
        // Try to verify the token if Supabase is configured
        if (isSupabaseConfigured) {
          try {
            const { supabase } = await import("./_core/supabase");
            const { data, error } = await supabase.auth.getUser(token);
            tokenInfo = {
              ...tokenInfo,
              verified: !error,
              userId: data?.user?.id || null,
              email: data?.user?.email || null,
              error: error?.message || null,
            };
          } catch (e: any) {
            tokenInfo = {
              ...tokenInfo,
              verified: false,
              error: e.message,
            };
          }
        }
      } else {
        tokenInfo = { present: false };
      }
      
      return {
        supabaseConfigured: isSupabaseConfigured,
        supabaseUrl: process.env.SUPABASE_URL ? "set" : "missing",
        supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "missing",
        databaseUrl: process.env.DATABASE_URL ? "set" : "missing",
        token: tokenInfo,
        user: ctx.user,
      };
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Business management
  business: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getBusinessesByUserId } = await import("./db");
      return getBusinessesByUserId(ctx.user.id);
    }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          businessType: z.string().optional(),
          location: z.string().optional(),
          description: z.string().optional(),
          website: z.string().optional(),
          phone: z.string().optional(),
          address: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createBusiness } = await import("./db");
        const business = await createBusiness({ ...input, userId: ctx.user.id });
        return { success: true, businessId: business.id };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).optional(),
          businessType: z.string().optional(),
          location: z.string().optional(),
          description: z.string().optional(),
          website: z.string().optional(),
          phone: z.string().optional(),
          address: z.string().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { updateBusiness } = await import("./db");
        const { id, ...updates } = input;
        await updateBusiness(id, updates);
        return { success: true };
      }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const { deleteBusiness } = await import("./db");
      await deleteBusiness(input.id);
      return { success: true };
    }),
  }),

  // API key management
  apiKey: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getApiKeysByUserId } = await import("./db");
      const keys = await getApiKeysByUserId(ctx.user.id);
      // Don't send encrypted keys to frontend
      return keys.map((k) => ({ ...k, encryptedKey: "********" }));
    }),
    create: protectedProcedure
      .input(
        z.object({
          provider: z.enum(["openai", "anthropic", "google"]),
          apiKey: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createApiKey, getApiKeyByUserAndProvider } = await import("./db");
        const { encrypt } = await import("./encryption");
        const { verifyApiKey } = await import("./aiProviders");

        // Verify the API key works
        const verification = await verifyApiKey(input.provider, input.apiKey);
        if (!verification.valid) {
          throw new Error(verification.error || "Invalid API key or unable to connect to provider");
        }

        // Check if key already exists
        const existing = await getApiKeyByUserAndProvider(ctx.user.id, input.provider);
        if (existing) {
          throw new Error("API key for this provider already exists. Please update or delete it first.");
        }

        const encryptedKey = encrypt(input.apiKey);
        const apiKey = await createApiKey({
          userId: ctx.user.id,
          provider: input.provider,
          encryptedKey,
          status: "connected",
          lastVerified: new Date(),
        });
        return { success: true, id: apiKey.id };
      }),
    save: protectedProcedure
      .input(
        z.object({
          provider: z.enum(["openai", "anthropic", "google"]),
          apiKey: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createApiKey, getApiKeyByUserAndProvider, updateApiKey } = await import("./db");
        const { encrypt } = await import("./encryption");
        const { verifyApiKey } = await import("./aiProviders");

        // Verify the API key works
        const verification = await verifyApiKey(input.provider, input.apiKey);
        if (!verification.valid) {
          throw new Error(verification.error || "Invalid API key or unable to connect to provider");
        }

        const encryptedKey = encrypt(input.apiKey);
        const existing = await getApiKeyByUserAndProvider(ctx.user.id, input.provider);
        
        if (existing) {
          // Update existing
          await updateApiKey(existing.id, {
            encryptedKey,
            status: "connected",
            lastVerified: new Date(),
          });
          return { success: true, id: existing.id };
        } else {
          // Create new
          const apiKey = await createApiKey({
            userId: ctx.user.id,
            provider: input.provider,
            encryptedKey,
            status: "connected",
            lastVerified: new Date(),
          });
          return { success: true, id: apiKey.id };
        }
      }),
    update: protectedProcedure
      .input(
        z.object({
          provider: z.enum(["openai", "anthropic", "google"]),
          apiKey: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { getApiKeyByUserAndProvider, updateApiKey } = await import("./db");
        const { encrypt } = await import("./encryption");
        const { verifyApiKey } = await import("./aiProviders");

        // Verify the API key works
        const verification = await verifyApiKey(input.provider, input.apiKey);
        if (!verification.valid) {
          throw new Error(verification.error || "Invalid API key or unable to connect to provider");
        }

        const existing = await getApiKeyByUserAndProvider(ctx.user.id, input.provider);
        if (!existing) {
          throw new Error("API key not found");
        }

        const encryptedKey = encrypt(input.apiKey);
        await updateApiKey(existing.id, {
          encryptedKey,
          status: "connected",
          lastVerified: new Date(),
        });
        return { success: true };
      }),
    delete: protectedProcedure.input(z.object({ provider: z.enum(["openai", "anthropic", "google"]) })).mutation(async ({ ctx, input }) => {
      const { getApiKeyByUserAndProvider, deleteApiKey } = await import("./db");
      const existing = await getApiKeyByUserAndProvider(ctx.user.id, input.provider);
      if (existing) {
        await deleteApiKey(existing.id);
      }
      return { success: true };
    }),
    test: protectedProcedure
      .input(z.object({ provider: z.enum(["openai", "anthropic", "google"]) }))
      .mutation(async ({ ctx, input }) => {
        const { getApiKeyByUserAndProvider, updateApiKey } = await import("./db");
        const { decrypt } = await import("./encryption");
        const { testApiKey } = await import("./aiProviders");

        const existing = await getApiKeyByUserAndProvider(ctx.user.id, input.provider);
        if (!existing) {
          throw new Error("No API key found for this provider. Please add one first.");
        }

        // Decrypt the stored key
        const apiKey = decrypt(existing.encryptedKey);
        
        // Test the API key with a real API call
        const result = await testApiKey(input.provider, apiKey);
        
        // Update last verified timestamp if successful
        if (result.success) {
          await updateApiKey(existing.id, {
            status: "connected",
            lastVerified: new Date(),
          });
        } else {
          await updateApiKey(existing.id, {
            status: "disconnected",
          });
        }
        
        return result;
      }),
  }),

  // Training session management
  training: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getTrainingSessionsByUserId } = await import("./db");
      return getTrainingSessionsByUserId(ctx.user.id);
    }),
    getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const { getTrainingSessionById } = await import("./db");
      return getTrainingSessionById(input.id);
    }),
    create: protectedProcedure
      .input(
        z.object({
          businessId: z.number().optional(),
          trainingName: z.string().min(1),
          topic: z.string().min(1),
          targetAiProvider: z.enum(["openai", "anthropic", "google"]),
          targetAiModel: z.string().min(1),
          influencerAiProvider: z.enum(["openai", "anthropic", "google"]),
          influencerAiModel: z.string().min(1),
          trainingPrompts: z.array(z.string()).min(1),
          trainingContext: z.string().optional(),
          trainingGoal: z.string().min(1),
          iterations: z.number().min(1).default(50),
          retryInterval: z.number().min(5).default(10),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createTrainingSession } = await import("./db");
        const session = await createTrainingSession({
          ...input,
          userId: ctx.user.id,
          currentProgress: 0,
          status: "paused",
        });
        return { success: true, sessionId: session.id };
      }),
    updateStatus: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          status: z.enum(["paused", "in_progress", "completed", "error"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { updateTrainingSession, getTrainingSessionById, validateApiKeysForTraining } = await import("./db");
        const { startTrainingSession } = await import("./trainingEngine");
        
        // Validate API keys before starting training
        if (input.status === "in_progress") {
          const session = await getTrainingSessionById(input.id);
          if (!session) {
            throw new Error("Training session not found");
          }
          
          const validation = await validateApiKeysForTraining(
            ctx.user.id,
            session.targetAiProvider as "openai" | "anthropic" | "google",
            session.influencerAiProvider as "openai" | "anthropic" | "google"
          );
          
          if (!validation.valid) {
            const providerNames = validation.missingProviders.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(", ");
            throw new Error(`Missing API key(s) for: ${providerNames}. Please add the required API key(s) in Settings before starting training.`);
          }
        }
        
        // Clear error message when retrying from error state
        if (input.status === "paused") {
          await updateTrainingSession(input.id, { status: input.status, errorMessage: null });
        } else {
          await updateTrainingSession(input.id, { status: input.status });
        }
        
        // Start training in background if status is in_progress
        if (input.status === "in_progress") {
          startTrainingSession(input.id, ctx.user.id);
        }
        
        return { success: true };
      }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const { deleteTrainingSession } = await import("./db");
      await deleteTrainingSession(input.id);
      return { success: true };
    }),
    getConversations: protectedProcedure.input(z.object({ sessionId: z.number() })).query(async ({ input }) => {
      const { getConversationsBySessionId } = await import("./db");
      return getConversationsBySessionId(input.sessionId);
    }),
  }),

  // Dashboard metrics
  dashboard: router({
    metrics: protectedProcedure.query(async ({ ctx }) => {
      const { getTodayMetrics } = await import("./db");
      return getTodayMetrics(ctx.user.id);
    }),
  }),

  // Scheduled jobs
  schedule: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getScheduledJobsByUserId } = await import("./db");
      return getScheduledJobsByUserId(ctx.user.id);
    }),
    create: protectedProcedure
      .input(
        z.object({
          trainingSessionId: z.number().optional(),
          businessId: z.number().optional(),
          jobName: z.string().min(1),
          scheduleType: z.enum(["daily", "weekly", "monthly", "custom"]),
          cronExpression: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createScheduledJob } = await import("./db");
        return createScheduledJob({
          ...input,
          userId: ctx.user.id,
          isActive: true,
          runCount: 0,
        });
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          isActive: z.boolean().optional(),
          scheduleType: z.enum(["daily", "weekly", "monthly", "custom"]).optional(),
          cronExpression: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { updateScheduledJob } = await import("./db");
        const { id, ...updates } = input;
        await updateScheduledJob(id, updates);
        return { success: true };
      }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const { deleteScheduledJob } = await import("./db");
      await deleteScheduledJob(input.id);
      return { success: true };
    }),
  }),

  // AI provider utilities
  aiProvider: router({
    getModels: protectedProcedure.input(z.object({ provider: z.enum(["openai", "anthropic", "google"]) })).query(async ({ input }) => {
      const { getAvailableModels } = await import("./aiProviders");
      return getAvailableModels(input.provider);
    }),
  }),
});

export type AppRouter = typeof appRouter;
