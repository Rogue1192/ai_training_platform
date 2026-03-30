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
    // Get session token for the client
    getSessionToken: publicProcedure.query(async ({ ctx }) => {
      return {
        user: ctx.user,
        hasSession: !!ctx.user,
      };
    }),
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
      console.log('[training.list] Called for user:', ctx.user.id);
      const { getTrainingSessionsByUserId } = await import("./db");
      const sessions = await getTrainingSessionsByUserId(ctx.user.id);
      console.log('[training.list] Found', sessions.length, 'sessions');
      return sessions;
    }),
    getById: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ input }) => {
      const { getTrainingSessionById } = await import("./db");
      return getTrainingSessionById(input.id);
    }),
    create: protectedProcedure
      .input(
        z.object({
          businessId: z.number(),
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
          isLegacy: false, // Explicitly set to use V2 phase-based training
          trainingPhase: "pending", // Initialize training phase
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
        const { resolveModel } = await import("./aiProviders");
        
        // Validate API keys before starting training
        if (input.status === "in_progress") {
          const session = await getTrainingSessionById(input.id);
          if (!session) {
            throw new Error("Training session not found");
          }
          
          // Auto-migrate deprecated model names in the database
          const resolvedTargetModel = resolveModel(session.targetAiModel);
          const resolvedInfluencerModel = resolveModel(session.influencerAiModel);
          const modelUpdates: Record<string, string> = {};
          if (resolvedTargetModel !== session.targetAiModel) {
            modelUpdates.targetAiModel = resolvedTargetModel;
            console.log(`[Training] Auto-migrating target model: ${session.targetAiModel} → ${resolvedTargetModel}`);
          }
          if (resolvedInfluencerModel !== session.influencerAiModel) {
            modelUpdates.influencerAiModel = resolvedInfluencerModel;
            console.log(`[Training] Auto-migrating influencer model: ${session.influencerAiModel} → ${resolvedInfluencerModel}`);
          }
          if (Object.keys(modelUpdates).length > 0) {
            await updateTrainingSession(input.id, modelUpdates);
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
        
        // Clear error message when starting or pausing (retrying from error state)
        if (input.status === "in_progress" || input.status === "paused") {
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
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          businessId: z.number().optional(),
          trainingName: z.string().min(1).optional(),
          topic: z.string().min(1).optional(),
          targetAiProvider: z.enum(["openai", "anthropic", "google"]).optional(),
          targetAiModel: z.string().min(1).optional(),
          influencerAiProvider: z.enum(["openai", "anthropic", "google"]).optional(),
          influencerAiModel: z.string().min(1).optional(),
          trainingPrompts: z.array(z.string()).min(1).optional(),
          trainingContext: z.string().optional(),
          trainingGoal: z.string().min(1).optional(),
          iterations: z.number().min(1).optional(),
          retryInterval: z.number().min(5).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { updateTrainingSession, getTrainingSessionById } = await import("./db");
        
        // Verify session exists and belongs to user
        const session = await getTrainingSessionById(input.id);
        if (!session) {
          throw new Error("Training session not found");
        }
        if (session.userId !== ctx.user.id) {
          throw new Error("Access denied: You don't own this training session");
        }
        
        // Only allow editing paused or error sessions
        if (session.status !== "paused" && session.status !== "error") {
          throw new Error("Can only edit paused or error sessions. Please pause the session first.");
        }
        
        const { id, ...updates } = input;
        await updateTrainingSession(id, updates);
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
    restartConversation: protectedProcedure
      .input(
        z.object({
          sessionId: z.number(),
          newIterations: z.number().min(1).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { getTrainingSessionById, createTrainingSession } = await import("./db");
        
        const originalSession = await getTrainingSessionById(input.sessionId);
        if (!originalSession) {
          throw new Error("Training session not found");
        }
        
        if (originalSession.userId !== ctx.user.id) {
          throw new Error("Access denied");
        }
        
        if (originalSession.status !== "completed" && originalSession.status !== "error") {
          throw new Error("Can only restart completed or error sessions");
        }
        
        const newSession = await createTrainingSession({
          userId: ctx.user.id,
          businessId: originalSession.businessId,
          trainingName: originalSession.trainingName + " (Restarted)",
          topic: originalSession.topic,
          targetAiProvider: originalSession.targetAiProvider,
          targetAiModel: originalSession.targetAiModel,
          influencerAiProvider: originalSession.influencerAiProvider,
          influencerAiModel: originalSession.influencerAiModel,
          trainingPrompts: originalSession.trainingPrompts,
          trainingContext: originalSession.trainingContext,
          trainingGoal: originalSession.trainingGoal,
          iterations: input.newIterations || originalSession.iterations,
          retryInterval: originalSession.retryInterval,
          currentProgress: 0,
          status: "paused",
        });
        
        return { success: true, newSessionId: newSession.id };
      }),
    resetStuckSessions: protectedProcedure
      .mutation(async ({ ctx }) => {
        const { getDb } = await import("./db");
        const { trainingSessions } = await import("../drizzle/schema");
        const { eq, and, lt } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("Database not initialized");
        
        // Define "stuck" as in_progress for more than 1 hour without update
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        // Find all stuck sessions for this user
        const stuckSessions = await db
          .select()
          .from(trainingSessions)
          .where(
            and(
              eq(trainingSessions.userId, ctx.user.id),
              eq(trainingSessions.status, "in_progress"),
              lt(trainingSessions.updatedAt, oneHourAgo)
            )
          );
        
        if (stuckSessions.length === 0) {
          return { success: true, count: 0, message: "No stuck sessions found" };
        }
        
        // Reset each stuck session to error status with descriptive message
        const resetPromises = stuckSessions.map(async (session: typeof stuckSessions[0]) => {
          const stuckDuration = Date.now() - new Date(session.updatedAt!).getTime();
          const hours = Math.floor(stuckDuration / (1000 * 60 * 60));
          const minutes = Math.floor((stuckDuration % (1000 * 60 * 60)) / (1000 * 60));
          
          const errorMessage = `Session timed out - no progress for ${hours}h ${minutes}m. Last phase: ${session.trainingPhase || 'unknown'}. Progress: ${session.currentProgress}/${session.iterations} iterations.`;
          
          await db
            .update(trainingSessions)
            .set({
              status: "error",
              errorMessage: errorMessage,
              updatedAt: new Date(),
            })
            .where(eq(trainingSessions.id, session.id));
        });
        
        await Promise.all(resetPromises);
        
        return { 
          success: true, 
          count: stuckSessions.length, 
          message: `Reset ${stuckSessions.length} stuck session(s) to error status` 
        };
      }),
    restartAllError: protectedProcedure
      .mutation(async ({ ctx }) => {
        const { getDb, getTrainingSessionById, updateTrainingSession, validateApiKeysForTraining } = await import("./db");
        const { trainingSessions } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const { startTrainingSession } = await import("./trainingEngine");
        const { resolveModel } = await import("./aiProviders");
        const db = await getDb();
        if (!db) throw new Error("Database not initialized");
        
        // Find all error sessions for this user
        const errorSessions = await db
          .select()
          .from(trainingSessions)
          .where(
            and(
              eq(trainingSessions.userId, ctx.user.id),
              eq(trainingSessions.status, "error")
            )
          );
        
        if (errorSessions.length === 0) {
          return { success: true, started: 0, failed: 0, total: 0, message: "No error sessions found", results: [] };
        }
        
        const results: Array<{ sessionId: number; name: string; success: boolean; error?: string }> = [];
        
        // Process in batches of 5 to avoid overwhelming the queue
        const BATCH_SIZE = 5;
        for (let i = 0; i < errorSessions.length; i += BATCH_SIZE) {
          const batch = errorSessions.slice(i, i + BATCH_SIZE);
          const batchPromises = batch.map(async (session) => {
            try {
              // Auto-migrate deprecated model names
              const resolvedTargetModel = resolveModel(session.targetAiModel);
              const resolvedInfluencerModel = resolveModel(session.influencerAiModel);
              const modelUpdates: Record<string, string> = {};
              if (resolvedTargetModel !== session.targetAiModel) {
                modelUpdates.targetAiModel = resolvedTargetModel;
              }
              if (resolvedInfluencerModel !== session.influencerAiModel) {
                modelUpdates.influencerAiModel = resolvedInfluencerModel;
              }
              if (Object.keys(modelUpdates).length > 0) {
                await updateTrainingSession(session.id, modelUpdates);
              }
              
              // Validate API keys
              const validation = await validateApiKeysForTraining(
                ctx.user.id,
                session.targetAiProvider as "openai" | "anthropic" | "google",
                session.influencerAiProvider as "openai" | "anthropic" | "google"
              );
              
              if (!validation.valid) {
                const providerNames = validation.missingProviders.map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(", ");
                results.push({ sessionId: session.id, name: session.trainingName, success: false, error: `Missing API key(s): ${providerNames}` });
                return;
              }
              
              // Clear error and set to in_progress
              await updateTrainingSession(session.id, { status: "in_progress", errorMessage: null });
              
              // Start training in background
              startTrainingSession(session.id, ctx.user.id);
              
              results.push({ sessionId: session.id, name: session.trainingName, success: true });
            } catch (err: any) {
              results.push({ sessionId: session.id, name: session.trainingName, success: false, error: err.message });
            }
          });
          
          await Promise.all(batchPromises);
          
          // Small delay between batches to avoid overwhelming Redis
          if (i + BATCH_SIZE < errorSessions.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
        const started = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        
        return {
          success: true,
          started,
          failed,
          total: errorSessions.length,
          message: `Started ${started} session(s)${failed > 0 ? `, ${failed} failed` : ''}`,
          results,
        };
      }),
    getErrorSessionsCount: protectedProcedure
      .query(async ({ ctx }) => {
        const { getDb } = await import("./db");
        const { trainingSessions } = await import("../drizzle/schema");
        const { eq, and, count } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("Database not initialized");
        
        const result = await db
          .select({ count: count() })
          .from(trainingSessions)
          .where(
            and(
              eq(trainingSessions.userId, ctx.user.id),
              eq(trainingSessions.status, "error")
            )
          );
        
        return { count: result[0]?.count || 0 };
      }),
    getStuckSessionsCount: protectedProcedure
      .query(async ({ ctx }) => {
        const { getDb } = await import("./db");
        const { trainingSessions } = await import("../drizzle/schema");
        const { eq, and, lt, count } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("Database not initialized");
        
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        const result = await db
          .select({ count: count() })
          .from(trainingSessions)
          .where(
            and(
              eq(trainingSessions.userId, ctx.user.id),
              eq(trainingSessions.status, "in_progress"),
              lt(trainingSessions.updatedAt, oneHourAgo)
            )
          );
        
        return { count: result[0]?.count || 0 };
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
          trainingSessionId: z.number(),
          jobName: z.string().min(1),
scheduleType: z.enum(["hourly", "daily", "weekly", "monthly"]),
           timeOfDay: z.string().regex(/^\d{2}:\d{2}$/), // "HH:mm"
           dayOfWeek: z.number().min(0).max(6).optional(), // 0=Sun, 6=Sat
          dayOfMonth: z.number().min(1).max(31).optional(),
          timezone: z.string().default("America/Los_Angeles"),
          cronExpression: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createScheduledJob, getTrainingSessionById } = await import("./db");
        const { calculateNextRun } = await import("./scheduler");
        
        const session = await getTrainingSessionById(input.trainingSessionId);
        if (!session || session.userId !== ctx.user.id) {
          throw new Error("Training session not found or access denied");
        }
        
        const nextRun = calculateNextRun(input.scheduleType, {
          timeOfDay: input.timeOfDay,
          dayOfWeek: input.dayOfWeek,
          dayOfMonth: input.dayOfMonth,
          timezone: input.timezone,
          cronExpression: input.cronExpression,
        });
        
        return createScheduledJob({
          ...input,
          businessId: session.businessId ?? undefined,
          userId: ctx.user.id,
          isActive: true,
          runCount: 0,
          nextRun,
        });
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          jobName: z.string().min(1).optional(),
          trainingSessionId: z.number().optional(),
          isActive: z.boolean().optional(),
          scheduleType: z.enum(["hourly", "daily", "weekly", "monthly"]).optional(),
          timeOfDay: z.string().regex(/^\d{2}:\d{2}$/).optional(),
          dayOfWeek: z.number().min(0).max(6).optional().nullable(),
          dayOfMonth: z.number().min(1).max(31).optional().nullable(),
          timezone: z.string().optional(),
          cronExpression: z.string().optional().nullable(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { updateScheduledJob } = await import("./db");
        const { calculateNextRun } = await import("./scheduler");
        const { id, ...updates } = input;
        
        // Verify ownership
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { scheduledJobs } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const jobs = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).limit(1);
        const job = jobs[0];
        if (!job || job.userId !== ctx.user.id) {
          throw new Error("Scheduled job not found or access denied");
        }
        
        // If schedule changed, recalculate next run
        if (updates.scheduleType || updates.timeOfDay || updates.dayOfWeek !== undefined || updates.dayOfMonth !== undefined) {
          const scheduleType = (updates.scheduleType || job.scheduleType) as "hourly" | "daily" | "weekly" | "monthly" | "custom";
          const nextRun = calculateNextRun(scheduleType, {
            timeOfDay: updates.timeOfDay || job.timeOfDay,
            dayOfWeek: updates.dayOfWeek !== undefined ? updates.dayOfWeek : job.dayOfWeek,
            dayOfMonth: updates.dayOfMonth !== undefined ? updates.dayOfMonth : job.dayOfMonth,
            timezone: updates.timezone || job.timezone,
            cronExpression: updates.cronExpression !== undefined ? (updates.cronExpression ?? undefined) : (job.cronExpression ?? undefined),
          });
          (updates as any).nextRun = nextRun;
        }
        
        await updateScheduledJob(id, updates as any);
        return { success: true };
      }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      // Verify ownership before deleting
      const { getDb, deleteScheduledJob } = await import("./db");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { scheduledJobs } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const jobs = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, input.id)).limit(1);
      if (!jobs[0] || jobs[0].userId !== ctx.user.id) {
        throw new Error("Scheduled job not found or access denied");
      }
      await deleteScheduledJob(input.id);
      return { success: true };
    }),
    runNow: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      // Verify ownership before running
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { scheduledJobs } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const jobs = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, input.id)).limit(1);
      if (!jobs[0] || jobs[0].userId !== ctx.user.id) {
        throw new Error("Scheduled job not found or access denied");
      }
      const { runJobNow } = await import("./scheduler");
      return runJobNow(input.id);
    }),
    // Run history
    getRunHistory: protectedProcedure
      .input(z.object({ jobId: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        if (input.jobId) {
          // Verify the job belongs to the current user before returning its history
          const { getDb, getScheduledJobRunsByJobId } = await import("./db");
          const db = await getDb();
          if (!db) throw new Error("Database not available");
          const { scheduledJobs } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const jobs = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, input.jobId)).limit(1);
          if (!jobs[0] || jobs[0].userId !== ctx.user.id) {
            throw new Error("Scheduled job not found or access denied");
          }
          return getScheduledJobRunsByJobId(input.jobId);
        } else {
          const { getScheduledJobRunsByUserId } = await import("./db");
          return getScheduledJobRunsByUserId(ctx.user.id);
        }
      }),
  }),

  // AI provider utilities
  aiProvider: router({
    getModels: protectedProcedure.input(z.object({ provider: z.enum(["openai", "anthropic", "google"]) })).query(async ({ input }) => {
      const { getAvailableModels } = await import("./aiProviders");
      return getAvailableModels(input.provider);
    }),
  }),

  // ============= AI ANSWER FORGE — Package Tiers =============
  packageTier: router({
    list: protectedProcedure.query(async () => {
      const { getPackageTiers, seedDefaultPackageTiers } = await import("./dbCampaigns");
      const tiers = await getPackageTiers();
      if (tiers.length === 0) {
        return seedDefaultPackageTiers();
      }
      return tiers;
    }),
    create: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1).max(100),
          maxQueries: z.number().min(1).max(50),
          maxLocations: z.number().min(1).max(50),
          monthlyPrice: z.number().min(0).default(0),
          description: z.string().optional(),
          isActive: z.boolean().default(true),
          sortOrder: z.number().default(0),
        })
      )
      .mutation(async ({ input }) => {
        const { createPackageTier } = await import("./dbCampaigns");
        return createPackageTier(input);
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).max(100).optional(),
          maxQueries: z.number().min(1).max(50).optional(),
          maxLocations: z.number().min(1).max(50).optional(),
          monthlyPrice: z.number().min(0).optional(),
          description: z.string().optional(),
          isActive: z.boolean().optional(),
          sortOrder: z.number().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { updatePackageTier } = await import("./dbCampaigns");
        const { id, ...updates } = input;
        const result = await updatePackageTier(id, updates);
        if (!result) throw new Error("Package tier not found");
        return result;
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { deletePackageTier } = await import("./dbCampaigns");
        const success = await deletePackageTier(input.id);
        if (!success) throw new Error("Package tier not found");
        return { success: true };
      }),
  }),

  // ============= AI ANSWER FORGE — Campaigns =============
  campaign: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getCampaignsWithBusinessInfo } = await import("./dbCampaigns");
      return getCampaignsWithBusinessInfo(ctx.user.id);
    }),
    stats: protectedProcedure.query(async ({ ctx }) => {
      const { getCampaignStats } = await import("./dbCampaigns");
      return getCampaignStats(ctx.user.id);
    }),
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getCampaignById, getQueryLocationsByCampaignId } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.id);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        const queryLocations = await getQueryLocationsByCampaignId(input.id);
        return { ...campaign, queryLocations };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          campaignName: z.string().min(1).optional(),
          trainingAggressiveness: z.enum(["aggressive", "moderate", "maintenance"]).optional(),
          rankCheckFrequency: z.enum(["daily", "weekly", "biweekly"]).optional(),
          status: z.enum([
            "pending", "keyword_research", "credibility_research", "content_generation",
            "publishing", "indexing", "baseline_check", "training", "monitoring", "paused", "error"
          ]).optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { getCampaignById, updateCampaign } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.id);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        const { id, ...updates } = input;
        return updateCampaign(id, updates);
      }),
    // Query-location management for a campaign
    getQueryLocations: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getCampaignById, getQueryLocationsByCampaignId } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        return getQueryLocationsByCampaignId(input.campaignId);
      }),
    addQueryLocations: protectedProcedure
      .input(
        z.object({
          campaignId: z.number(),
          entries: z.array(
            z.object({
              searchQuery: z.string().min(1),
              location: z.string().min(1),
              aiSearchVolume: z.number().optional(),
            })
          ),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { getCampaignById, createCampaignQueryLocations } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        return createCampaignQueryLocations(
          input.entries.map((e) => ({ ...e, campaignId: input.campaignId }))
        );
      }),
    // Trigger keyword research for a campaign
    runKeywordResearch: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getCampaignById } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        const { runCampaignKeywordResearch } = await import("./keywordResearchPipeline");
        return runCampaignKeywordResearch(input.campaignId);
      }),
    // Trigger baseline rank check for a campaign
    runBaselineCheck: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getCampaignById } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        const { runCampaignBaselineCheck } = await import("./keywordResearchPipeline");
        return runCampaignBaselineCheck(input.campaignId);
      }),
    // Get rank snapshots for a campaign
    getRankSnapshots: protectedProcedure
      .input(z.object({ campaignId: z.number(), limit: z.number().min(1).max(500).default(100) }))
      .query(async ({ ctx, input }) => {
        const { getCampaignById, getRankSnapshotsByCampaign } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        return getRankSnapshotsByCampaign(input.campaignId, input.limit);
      }),
    // ============= CREDIBILITY RESEARCH (Sprint 4) =============
    runCredibilityResearch: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getCampaignById } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        // Get the business info
        const { getBusinessById } = await import("./db");
        const business = await getBusinessById(campaign.businessId);
        if (!business) throw new Error("Business not found for this campaign");
        
        const { runCredibilityResearch } = await import("./credibilityResearchEngine");
        return runCredibilityResearch({
          userId: ctx.user.id,
          businessId: campaign.businessId,
          campaignId: input.campaignId,
          businessName: business.name,
          websiteUrl: business.website || "",
          industry: business.businessType || "",
          location: business.location || "",
        });
      }),
    getCredibilityData: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getCampaignById } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        const { getCredibilityDataForCampaign } = await import("./credibilityResearchEngine");
        return getCredibilityDataForCampaign(input.campaignId);
      }),
    // ============= CONTENT GENERATION (Sprint 5) =============
    runContentGeneration: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getCampaignById } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        // Get the business info
        const { getBusinessById } = await import("./db");
        const business = await getBusinessById(campaign.businessId);
        if (!business) throw new Error("Business not found for this campaign");
        
        // Get credibility data (required before content generation)
        const { getCredibilityDataForCampaign } = await import("./credibilityResearchEngine");
        const credData = await getCredibilityDataForCampaign(input.campaignId);
        if (!credData) {
          throw new Error("Credibility research must be completed before content generation. Run credibility research first.");
        }
        
        const { generateAllContentPages } = await import("./contentGenerationEngine");
        return generateAllContentPages({
          userId: ctx.user.id,
          businessId: campaign.businessId,
          campaignId: input.campaignId,
          businessName: business.name,
          websiteUrl: business.website || "",
          industry: business.businessType || "",
          location: business.location || "",
          credibilityResult: credData.researchResults as any,
        });
      }),
    getContentPages: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getCampaignById } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign || campaign.userId !== ctx.user.id) {
          throw new Error("Campaign not found or access denied");
        }
        const { getContentPagesForCampaign } = await import("./contentGenerationEngine");
        return getContentPagesForCampaign(input.campaignId);
      }),
    regenerateContentPage: protectedProcedure
      .input(z.object({ pageId: z.number(), customPrompt: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        const { regenerateContentPage } = await import("./contentGenerationEngine");
        return regenerateContentPage({
          userId: ctx.user.id,
          pageId: input.pageId,
          customPrompt: input.customPrompt,
        });
      }),
    getContentGenerationPrompt: protectedProcedure
      .query(async () => {
        const { getContentGenerationPrompt } = await import("./contentGenerationEngine");
        return { prompt: getContentGenerationPrompt() };
      }),
    getPageTypeConfigs: protectedProcedure
      .query(async () => {
        const { getPageTypeConfigs } = await import("./contentGenerationEngine");
        return getPageTypeConfigs();
      }),
  }),

  // ============= AI ANSWER FORGE — Webhook Logs =============
  webhookLog: router({
    list: protectedProcedure
      .input(z.object({ limit: z.number().min(1).max(200).default(50) }).optional())
      .query(async ({ input }) => {
        const { getWebhookLogs } = await import("./dbCampaigns");
        return getWebhookLogs(input?.limit ?? 50);
      }),
  }),

  // ============= AI ANSWER FORGE — Industry Keyword Cache =============
  industryCache: router({
    list: protectedProcedure.query(async () => {
      const { getAllIndustryKeywordCaches } = await import("./dbCampaigns");
      return getAllIndustryKeywordCaches();
    }),
    get: protectedProcedure
      .input(z.object({ industry: z.string().min(1) }))
      .query(async ({ input }) => {
        const { getIndustryKeywordCache } = await import("./dbCampaigns");
        return getIndustryKeywordCache(input.industry);
      }),
  }),

  // Prompt template management
  promptTemplate: router({
    // List all templates for the current user, optionally filtered by type
    list: protectedProcedure
      .input(z.object({ templateType: z.enum(["clean", "suggestive", "follow_up", "category_based"]).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const { getPromptTemplates, seedDefaultPromptTemplates, hasPromptTemplates } = await import("./db");
        
        // Seed defaults if user has no templates
        const hasTemplates = await hasPromptTemplates(ctx.user.id);
        if (!hasTemplates) {
          await seedDefaultPromptTemplates(ctx.user.id);
        }
        
        return getPromptTemplates(ctx.user.id, input?.templateType as any);
      }),

    // Get a single template by ID
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getPromptTemplateById } = await import("./db");
        const template = await getPromptTemplateById(input.id);
        
        // Verify ownership
        if (template && template.userId !== ctx.user.id) {
          throw new Error("Not authorized to view this template");
        }
        
        return template;
      }),

    // Create a new template
    create: protectedProcedure
      .input(z.object({
        templateType: z.enum(["clean", "suggestive", "follow_up", "category_based"]),
        templateName: z.string().min(1).max(255),
        templateContent: z.string().min(1),
        isActive: z.boolean().default(true),
        sortOrder: z.number().default(0),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createPromptTemplate } = await import("./db");
        return createPromptTemplate({
          ...input,
          userId: ctx.user.id,
        });
      }),

    // Update an existing template
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        templateName: z.string().min(1).max(255).optional(),
        templateContent: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getPromptTemplateById, updatePromptTemplate } = await import("./db");
        
        // Verify ownership
        const existing = await getPromptTemplateById(input.id);
        if (!existing || existing.userId !== ctx.user.id) {
          throw new Error("Not authorized to update this template");
        }
        
        const { id, ...updateData } = input;
        return updatePromptTemplate(id, updateData);
      }),

    // Delete a template
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getPromptTemplateById, deletePromptTemplate } = await import("./db");
        
        // Verify ownership
        const existing = await getPromptTemplateById(input.id);
        if (!existing || existing.userId !== ctx.user.id) {
          throw new Error("Not authorized to delete this template");
        }
        
        return deletePromptTemplate(input.id);
      }),

    // Reset all templates to defaults
    resetToDefaults: protectedProcedure.mutation(async ({ ctx }) => {
      const { deleteAllPromptTemplates, seedDefaultPromptTemplates } = await import("./db");
      
      // Delete all existing templates
      await deleteAllPromptTemplates(ctx.user.id);
      
      // Seed defaults
      return seedDefaultPromptTemplates(ctx.user.id);
    }),
  }),

  // ============= AI ANSWER FORGE — WordPress Publisher (Sprint 6) =============
  wpPublisher: router({
    testConnection: protectedProcedure
      .input(z.object({ businessId: z.number() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { businesses } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { decrypt } = await import("./encryption");
        const { testWPConnection } = await import("./wordpressPublisher");
        
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const biz = (await db.select().from(businesses).where(eq(businesses.id, input.businessId)).limit(1))[0];
        if (!biz) throw new Error("Business not found");
        if (!biz.wpAdminUrl || !biz.wpUsername || !biz.wpPasswordEncrypted) {
          throw new Error("WordPress credentials not configured for this business");
        }
        return testWPConnection({
          siteUrl: biz.wpAdminUrl,
          username: biz.wpUsername,
          appPassword: decrypt(biz.wpPasswordEncrypted),
        });
      }),
    storeCredentials: protectedProcedure
      .input(z.object({
        businessId: z.number(),
        wpAdminUrl: z.string().url(),
        wpUsername: z.string().min(1),
        wpAppPassword: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const { storeWPCredentials } = await import("./wordpressPublisher");
        await storeWPCredentials(input.businessId, input.wpAdminUrl, input.wpUsername, input.wpAppPassword);
        return { success: true };
      }),
    publishCampaign: protectedProcedure
      .input(z.object({ campaignId: z.number(), businessId: z.number(), dryRun: z.boolean().optional() }))
      .mutation(async ({ input }) => {
        const { publishCampaignContent } = await import("./wordpressPublisher");
        return publishCampaignContent(input);
      }),
    publishLlmTxt: protectedProcedure
      .input(z.object({ campaignId: z.number(), businessId: z.number() }))
      .mutation(async ({ input }) => {
        const { publishLlmTxt } = await import("./wordpressPublisher");
        return publishLlmTxt(input);
      }),
    getPublishedUrls: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const { getPublishedUrls } = await import("./wordpressPublisher");
        return getPublishedUrls(input.campaignId);
      }),
  }),

  // ============= AI ANSWER FORGE — SinByte Indexing (Sprint 7) =============
  indexing: router({
    submitCampaign: protectedProcedure
      .input(z.object({ campaignId: z.number(), businessName: z.string() }))
      .mutation(async ({ input }) => {
        const { submitCampaignForIndexing } = await import("./sinbyteIndexing");
        return submitCampaignForIndexing(input);
      }),
    verifyCampaign: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ input }) => {
        const { verifyCampaignIndexing } = await import("./sinbyteIndexing");
        return verifyCampaignIndexing(input.campaignId);
      }),
    getHistory: protectedProcedure
      .query(async () => {
        const { getIndexingHistory } = await import("./sinbyteIndexing");
        return getIndexingHistory();
      }),
    getTaskStatus: protectedProcedure
      .input(z.object({ taskId: z.union([z.string(), z.number()]) }))
      .query(async ({ input }) => {
        const { getTaskStatus } = await import("./sinbyteIndexing");
        return getTaskStatus(input.taskId);
      }),
  }),

  // ============= AI ANSWER FORGE — Pipeline Orchestrator =============
  pipeline: router({
    getStatus: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const { getPipelineStatus } = await import("./pipelineOrchestrator");
        return getPipelineStatus(input.campaignId);
      }),
    getStepLabels: protectedProcedure
      .query(async () => {
        const { getPipelineStepLabels } = await import("./pipelineOrchestrator");
        return getPipelineStepLabels();
      }),
    runStep: protectedProcedure
      .input(z.object({
        campaignId: z.number(),
        step: z.enum(["keyword_research", "credibility_research", "content_generation", "publishing", "indexing", "indexing_verification", "baseline_check", "training"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { runPipelineStep } = await import("./pipelineOrchestrator");
        return runPipelineStep(input.campaignId, input.step, ctx.user.id);
      }),
    runFull: protectedProcedure
      .input(z.object({
        campaignId: z.number(),
        stopAfterStep: z.enum(["keyword_research", "credibility_research", "content_generation", "publishing", "indexing", "indexing_verification", "baseline_check", "training"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { runFullPipeline } = await import("./pipelineOrchestrator");
        return runFullPipeline(input.campaignId, ctx.user.id, {
          stopAfterStep: input.stopAfterStep,
        });
      }),
  }),

  // ============= AI ANSWER FORGE — Rank Tracking (Sprint 8) =============
  rankTracking: router({
    runCheck: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ input }) => {
        const { runScheduledRankCheck } = await import("./rankTrackingEngine");
        return runScheduledRankCheck(input.campaignId);
      }),
    getReport: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const { generateCampaignRankReport } = await import("./rankTrackingEngine");
        return generateCampaignRankReport(input.campaignId);
      }),
    getTrends: protectedProcedure
      .input(z.object({ campaignId: z.number(), days: z.number().optional() }))
      .query(async ({ input }) => {
        const { getVisibilityTrends } = await import("./rankTrackingEngine");
        return getVisibilityTrends(input.campaignId, { days: input.days });
      }),
  }),

  // ============= AI ANSWER FORGE — Client Dashboard (Sprint 10) =============
  clientDashboard: router({
    // Public endpoint — no auth required, uses access token
    getByToken: publicProcedure
      .input(z.object({ token: z.string().min(1) }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { clientDashboards, businesses, campaigns } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        const { generateCampaignRankReport } = await import("./rankTrackingEngine");

        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const dashboard = (await db.select().from(clientDashboards)
          .where(and(
            eq(clientDashboards.accessToken, input.token),
            eq(clientDashboards.isActive, true)
          )).limit(1))[0];

        if (!dashboard) return null;

        // Update access tracking
        await db.update(clientDashboards)
          .set({
            lastAccessedAt: new Date(),
            accessCount: (dashboard.accessCount || 0) + 1,
          })
          .where(eq(clientDashboards.id, dashboard.id));

        // Get business info
        const business = (await db.select().from(businesses)
          .where(eq(businesses.id, dashboard.businessId)).limit(1))[0];

        if (!dashboard.campaignId) return { dashboard, business, report: null };

        // Generate the rank report
        try {
          const report = await generateCampaignRankReport(dashboard.campaignId);
          return { dashboard, business, report };
        } catch {
          return { dashboard, business, report: null };
        }
      }),
    // Admin: create a client dashboard
    create: protectedProcedure
      .input(z.object({
        businessId: z.number(),
        campaignId: z.number().optional(),
        dashboardTitle: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { clientDashboards } = await import("../drizzle/schema");
        const crypto = await import("crypto");

        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const accessToken = crypto.randomBytes(32).toString("hex");

        const result = await db.insert(clientDashboards).values({
          businessId: input.businessId,
          campaignId: input.campaignId || null,
          accessToken,
          dashboardTitle: input.dashboardTitle || null,
          isActive: true,
        }).returning();

        return result[0];
      }),
    // Admin: list all dashboards
    list: protectedProcedure.query(async () => {
      const { getDb } = await import("./db");
      const { clientDashboards, businesses } = await import("../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");

      const db = await getDb();
      if (!db) return [];

      return db.select({
        id: clientDashboards.id,
        businessId: clientDashboards.businessId,
        campaignId: clientDashboards.campaignId,
        accessToken: clientDashboards.accessToken,
        dashboardTitle: clientDashboards.dashboardTitle,
        isActive: clientDashboards.isActive,
        lastAccessedAt: clientDashboards.lastAccessedAt,
        accessCount: clientDashboards.accessCount,
        createdAt: clientDashboards.createdAt,
        businessName: businesses.name,
      })
        .from(clientDashboards)
        .leftJoin(businesses, eq(clientDashboards.businessId, businesses.id))
        .orderBy(desc(clientDashboards.createdAt));
    }),
    // Admin: toggle dashboard active status
    toggleActive: protectedProcedure
      .input(z.object({ id: z.number(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { clientDashboards } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");

        const db = await getDb();
        if (!db) throw new Error("Database not available");

        await db.update(clientDashboards)
          .set({ isActive: input.isActive })
          .where(eq(clientDashboards.id, input.id));

        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
