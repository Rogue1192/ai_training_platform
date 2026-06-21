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
    logout: publicProcedure.mutation(() => {
      // Auth is JWT-based via Supabase Bearer tokens — no server-side session cookie to clear.
      // The client calls supabase.auth.signOut() directly after this returns.
      return {
        success: true,
      } as const;
    }),
  }),

  // Business management
  business: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getAllBusinesses } = await import("./db");
      return getAllBusinesses();
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
          contactEmail: z.string().optional(),
          contactName: z.string().optional(),
          certifications: z.string().optional(),
          awards: z.string().optional(),
          yearsInBusiness: z.number().optional(),
          bbbRating: z.string().optional(),
          licenses: z.string().optional(),
          warranties: z.string().optional(),
          differentiators: z.string().optional(),
          specialties: z.string().optional(),
          clientType: z.enum(["ai_only", "ai_plus_seo", "ai_plus_seo_plus_build"]).optional(),
          siteAdminUrl: z.string().optional(),
          siteUsername: z.string().optional(),
          sitePassword: z.string().optional(),
          useWebhookForContent: z.boolean().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createBusiness } = await import("./db");
        const { encrypt } = await import("./encryption");
        
        const { sitePassword, ...restInput } = input;
        const businessData: any = { ...restInput, userId: ctx.user.id };
        
        if (sitePassword) {
          businessData.sitePasswordEncrypted = encrypt(sitePassword);
        }
        
        // userId stored for audit trail only — nullable, not used for access control
        const business = await createBusiness(businessData);
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
          contactEmail: z.string().optional(),
          contactName: z.string().optional(),
          certifications: z.string().optional(),
          awards: z.string().optional(),
          yearsInBusiness: z.number().optional(),
          bbbRating: z.string().optional(),
          licenses: z.string().optional(),
          warranties: z.string().optional(),
          differentiators: z.string().optional(),
          specialties: z.string().optional(),
          clientType: z.enum(["ai_only", "ai_plus_seo", "ai_plus_seo_plus_build"]).optional(),
          siteAdminUrl: z.string().optional(),
          siteUsername: z.string().optional(),
          sitePassword: z.string().optional(),
          useWebhookForContent: z.boolean().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { updateBusiness } = await import("./db");
        const { encrypt } = await import("./encryption");
        
        const { id, sitePassword, ...updates } = input;
        const updateData: any = { ...updates };
        
        if (sitePassword) {
          updateData.sitePasswordEncrypted = encrypt(sitePassword);
        }
        
        await updateBusiness(id, updateData);
        return { success: true };
      }),
    delete: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      const { deleteBusiness } = await import("./db");
      await deleteBusiness(input.id);
      return { success: true };
    }),
    bulkDelete: protectedProcedure
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        const { bulkDeleteBusinesses } = await import("./db");
        await bulkDeleteBusinesses(input.ids);
        return { success: true, deleted: input.ids.length };
      }),
    bulkArchive: protectedProcedure
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        const { bulkArchiveBusinesses } = await import("./db");
        await bulkArchiveBusinesses(input.ids);
        return { success: true, archived: input.ids.length };
      }),
    // Super-admin direct onboarding: create business + kick off full pipeline immediately
    onboardClient: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        businessType: z.string().optional(),
        location: z.string().optional(),
        description: z.string().optional(),
        website: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        notes: z.string().optional(),
        contactEmail: z.string().optional(),
        contactName: z.string().optional(),
        certifications: z.string().optional(),
        awards: z.string().optional(),
        yearsInBusiness: z.number().optional(),
        bbbRating: z.string().optional(),
        licenses: z.string().optional(),
        warranties: z.string().optional(),
        differentiators: z.string().optional(),
        specialties: z.string().optional(),
        clientType: z.enum(["ai_only", "ai_plus_seo", "ai_plus_seo_plus_build"]).optional(),
        internalSource: z.enum(["rogue", "ranklocal"]).optional(),
        packageTier: z.enum(["starter", "growth", "pro"]),
      }))
      .mutation(async ({ ctx, input }) => {
        const { createBusiness } = await import("./db");
        const { packageTier, ...businessFields } = input;
        // Create the business record
        const business = await createBusiness({
          ...businessFields,
          userId: ctx.user.id,
        });
        // Kick off the full pipeline asynchronously
        setImmediate(async () => {
          try {
            const { getDb: _getDb } = await import('./db');
            const db = await _getDb();
            if (!db) return;
            const {
              getPackageTierBySlug, seedDefaultPackageTiers,
              createCampaign, createClientDashboard, getCampaignsByBusinessId
            } = await import('./dbCampaigns');
            const { runFullPipeline } = await import('./pipelineOrchestrator');
            const ownerId = ctx.user.id;
            // Avoid duplicate campaigns
            const existingCampaigns = await getCampaignsByBusinessId(business.id);
            const activeCampaign = existingCampaigns.find(
              (c: any) => c.status !== 'monitoring' && c.status !== 'error' && c.status !== 'paused'
            );
            if (activeCampaign) return;
            // Resolve package tier
            await seedDefaultPackageTiers();
            const tier = await getPackageTierBySlug(packageTier);
            if (!tier) { console.error(`[onboardClient] Package tier '${packageTier}' not found`); return; }
            const { getBusinessById } = await import('./db');
            const biz = await getBusinessById(business.id);
            if (!biz) return;
            // Create campaign
            const campaign = await createCampaign({
              userId: ownerId,
              businessId: business.id,
              packageTierId: tier.id,
              campaignName: `${biz.name} - AI Visibility`,
              status: 'pending',
              clientType: input.clientType || 'ai_only',
              trainingAggressiveness: 'aggressive',
              rankCheckFrequency: 'weekly',
              errorCount: 0,
              trialStatus: 'trial',
              maxQueries: tier.maxQueries,
              maxLocations: tier.maxLocations,
              selectedPackage: packageTier,
            });
            // Initialize trial
            const { initializeTrial } = await import('./trialManager');
            await initializeTrial(campaign.id, packageTier);
            // Create client dashboard
            const crypto = await import('crypto');
            const accessToken = crypto.randomBytes(32).toString('hex');
            await createClientDashboard({
              businessId: business.id,
              campaignId: campaign.id,
              accessToken,
              isActive: true,
              dashboardTitle: `${biz.name} - AI Visibility Report`,
              accessCount: 0,
            });
            // Run the full pipeline
            await runFullPipeline(campaign.id, ownerId);
            console.log(`[onboardClient] Pipeline started for business ${business.id}, campaign ${campaign.id}`);
          } catch (err) {
            console.error('[onboardClient] Pipeline kickoff failed:', err);
          }
        });
        return { success: true, businessId: business.id };
      }),
  }),

  // API key management
  apiKey: router({
    list: protectedProcedure.query(async () => {
      const { getAllApiKeys } = await import("./db");
      const keys = await getAllApiKeys();
      // Don't send encrypted keys to frontend
      return keys.map((k) => ({ ...k, encryptedKey: "********" }));
    }),
    create: protectedProcedure
      .input(
        z.object({
          provider: z.enum(["openai", "anthropic", "google", "minimax"]),
          apiKey: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        const { createApiKey, getApiKeyByProvider } = await import("./db");
        const { encrypt } = await import("./encryption");
        const { verifyApiKey } = await import("./aiProviders");

        // Verify the API key works
        const verification = await verifyApiKey(input.provider, input.apiKey);
        if (!verification.valid) {
          throw new Error(verification.error || "Invalid API key or unable to connect to provider");
        }

        // Check if a global key already exists for this provider
        const existing = await getApiKeyByProvider(input.provider);
        if (existing) {
          throw new Error("API key for this provider already exists. Please update or delete it first.");
        }

        const encryptedKey = encrypt(input.apiKey);
        const apiKey = await createApiKey({
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
          provider: z.enum(["openai", "anthropic", "google", "minimax"]),
          apiKey: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        const { createApiKey, getApiKeyByProvider, updateApiKey } = await import("./db");
        const { encrypt } = await import("./encryption");
        const { verifyApiKey } = await import("./aiProviders");

        // Verify the API key works
        const verification = await verifyApiKey(input.provider, input.apiKey);
        if (!verification.valid) {
          throw new Error(verification.error || "Invalid API key or unable to connect to provider");
        }

        const encryptedKey = encrypt(input.apiKey);
        const existing = await getApiKeyByProvider(input.provider);
        
        if (existing) {
          // Update existing global key
          await updateApiKey(existing.id, {
            encryptedKey,
            status: "connected",
            lastVerified: new Date(),
          });
          return { success: true, id: existing.id };
        } else {
          // Create new global key
          const apiKey = await createApiKey({
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
          provider: z.enum(["openai", "anthropic", "google", "minimax"]),
          apiKey: z.string().min(1),
        })
      )
      .mutation(async ({ input }) => {
        const { getApiKeyByProvider, updateApiKey } = await import("./db");
        const { encrypt } = await import("./encryption");
        const { verifyApiKey } = await import("./aiProviders");

        // Verify the API key works
        const verification = await verifyApiKey(input.provider, input.apiKey);
        if (!verification.valid) {
          throw new Error(verification.error || "Invalid API key or unable to connect to provider");
        }

        const existing = await getApiKeyByProvider(input.provider);
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
    delete: protectedProcedure.input(z.object({ provider: z.enum(["openai", "anthropic", "google", "minimax"]) })).mutation(async ({ input }) => {
      const { getApiKeyByProvider, deleteApiKey } = await import("./db");
      const existing = await getApiKeyByProvider(input.provider);
      if (existing) {
        await deleteApiKey(existing.id);
      }
      return { success: true };
    }),
    test: protectedProcedure
      .input(z.object({ provider: z.enum(["openai", "anthropic", "google", "minimax"]) }))
      .mutation(async ({ input }) => {
        const { getApiKeyByProvider, updateApiKey } = await import("./db");
        const { decrypt } = await import("./encryption");
        const { testApiKey } = await import("./aiProviders");

        const existing = await getApiKeyByProvider(input.provider);
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

  // Service Keys (DataForSEO, Monkey Indexer, Resend) — managed via Settings UI
  serviceKey: router({
    list: protectedProcedure.query(async () => {
      const { getAllServiceKeys } = await import("./db");
      const { decrypt } = await import("./encryption");
      const keys = await getAllServiceKeys();
      return keys.map(k => {
        // Safely extract non-sensitive metadata from encrypted value
        let metadata: Record<string, string> = {};
        if (k.encryptedValue) {
          try {
            const raw = decrypt(k.encryptedValue);
            // dataforseo stores JSON {login, password} — expose only login (email)
            if (k.service === "dataforseo") {
              const parsed = JSON.parse(raw) as { login?: string; password?: string };
              if (parsed.login) metadata.login = parsed.login;
            }
            // whitelabel stores JSON — expose all fields (none are secret)
            if (k.service === "whitelabel") {
              const parsed = JSON.parse(raw) as Record<string, string>;
              metadata = parsed;
            }
            // stripe stores JSON {liveKey, testKey} — expose masked versions only
            if (k.service === "stripe") {
              const parsed = JSON.parse(raw) as { liveKey?: string; testKey?: string };
              if (parsed.liveKey) metadata.liveKey = parsed.liveKey.substring(0, 12) + "...";
              if (parsed.testKey) metadata.testKey = parsed.testKey.substring(0, 12) + "...";
            }
          } catch { /* ignore decrypt/parse errors */ }
        }
        return {
          id: k.id,
          service: k.service,
          status: k.status,
          lastVerified: k.lastVerified,
          createdAt: k.createdAt,
          updatedAt: k.updatedAt,
          hasKey: !!k.encryptedValue,
          metadata,
        };
      });
    }),
    save: protectedProcedure
      .input(z.object({
        service: z.enum(["dataforseo", "monkeyindexer", "resend", "whitelabel", "stripe"]),
        // For dataforseo: pass as JSON string {login, password}
        // For monkeyindexer/resend: pass as the API key string
        value: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const { upsertServiceKey } = await import("./db");
        const { encrypt } = await import("./encryption");
        const encryptedValue = encrypt(input.value);
        await upsertServiceKey(input.service, encryptedValue);
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ service: z.enum(["dataforseo", "monkeyindexer", "resend", "whitelabel", "stripe"]) }))
      .mutation(async ({ input }) => {
        const { deleteServiceKey } = await import("./db");
        await deleteServiceKey(input.service);
        return { success: true };
      }),
    test: protectedProcedure
      .input(z.object({ service: z.enum(["dataforseo", "monkeyindexer", "resend", "whitelabel", "stripe"]) }))
      .mutation(async ({ input }) => {
        const { getServiceKey, upsertServiceKey } = await import("./db");
        const { decrypt } = await import("./encryption");
        const record = await getServiceKey(input.service);
        if (!record) throw new Error("No key found for this service. Please save one first.");
        const value = decrypt(record.encryptedValue);
        
        try {
          if (input.service === "dataforseo") {
            const creds = JSON.parse(value) as { login: string; password: string };
            const auth = "Basic " + Buffer.from(`${creds.login}:${creds.password}`).toString("base64");
            const axios = (await import("axios")).default;
            const resp = await axios.get("https://api.dataforseo.com/v3/appendix/user_data", {
              headers: { Authorization: auth },
              timeout: 10000,
            });
            const valid = resp.data?.status_code === 20000;
            return { success: valid, message: valid ? "DataForSEO credentials verified" : "Invalid credentials" };
          } else if (input.service === "monkeyindexer") {
            const axios = (await import("axios")).default;
            const resp = await axios.get("https://monkeyindexer.com/api/v1/me", {
              headers: { Authorization: `Bearer ${value}` },
              timeout: 10000,
              validateStatus: () => true,
            });
            const valid = resp.status === 200 && resp.data?.success === true;
            const credits = resp.data?.data?.credits?.available;
            const msg = valid
              ? `Monkey Indexer key verified — ${credits ?? "?"} credits available`
              : `Monkey Indexer returned status ${resp.status}`;
            return { success: valid, message: msg };
          } else if (input.service === "resend") {
            const { Resend } = await import("resend");
            const resend = new Resend(value);
            const { error } = await resend.domains.list();
            const valid = !error;
            return { success: valid, message: valid ? "Resend API key verified" : (error?.message || "Invalid Resend key") };
          } else if (input.service === "whitelabel") {
            // White-label settings are always valid if they exist
            const parsed = JSON.parse(value) as { companyName?: string };
            return { success: true, message: `White-label settings verified (company: ${parsed.companyName || "set"})` };
          } else if (input.service === "stripe") {
            const parsed = JSON.parse(value) as { liveKey?: string; testKey?: string };
            const keyToTest = parsed.liveKey || parsed.testKey;
            if (!keyToTest) return { success: false, message: "No Stripe key found" };
            const axios = (await import("axios")).default;
            const resp = await axios.get("https://api.stripe.com/v1/account", {
              headers: { Authorization: `Bearer ${keyToTest}` },
              timeout: 10000,
              validateStatus: () => true,
            });
            const valid = resp.status === 200;
            const mode = keyToTest.startsWith("sk_live") ? "live" : "test";
            return {
              success: valid,
              message: valid
                ? `Stripe ${mode} key verified — account: ${resp.data?.email || resp.data?.id || "connected"}`
                : `Stripe returned HTTP ${resp.status}: ${resp.data?.error?.message || "Invalid key"}`,
            };
          }
          return { success: false, message: "Unknown service" };
        } catch (err: any) {
          return { success: false, message: err.message || "Connection test failed" };
        }
      }),
  }),

  // Training session management
  training: router({
    list: protectedProcedure.query(async () => {
      const { getAllTrainingSessions } = await import("./db");
      return getAllTrainingSessions();
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
          influencerAiProvider: z.enum(["openai", "anthropic", "google", "minimax"]),
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
        // userId stored for audit trail only — nullable, not used for access control
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
            session.targetAiProvider as "openai" | "anthropic" | "google",
            session.influencerAiProvider as "openai" | "anthropic" | "google" | "minimax"
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
          influencerAiProvider: z.enum(["openai", "anthropic", "google", "minimax"]).optional(),
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
        // All employees share access — no ownership check needed
        
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
        
        // All employees share access — no ownership check needed
        
        if (originalSession.status !== "completed" && originalSession.status !== "error") {
          throw new Error("Can only restart completed or error sessions");
        }
        
        // userId not carried over from original session — restarted sessions are team-owned
        const newSession = await createTrainingSession({
          userId: ctx.user.id, // audit trail only
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
        
        // Find all error sessions (team-wide)
        const errorSessions = await db
          .select()
          .from(trainingSessions)
          .where(
            eq(trainingSessions.status, "error")
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
                session.targetAiProvider as "openai" | "anthropic" | "google",
                session.influencerAiProvider as "openai" | "anthropic" | "google" | "minimax"
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
            eq(trainingSessions.status, "error")
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
      const { getAllTodayMetrics } = await import("./db");
      return getAllTodayMetrics();
    }),
  }),

  // Scheduled jobs
  schedule: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const { getAllScheduledJobs } = await import("./db");
      return getAllScheduledJobs();
    }),
    create: protectedProcedure
      .input(
        z.object({
          trainingSessionId: z.number(),
          jobName: z.string().min(1),
scheduleType: z.enum(["hourly", "daily", "weekly", "monthly", "custom"]),
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
        if (!session) {
          throw new Error("Training session not found");
        }
        
        const nextRun = calculateNextRun(input.scheduleType, {
          timeOfDay: input.timeOfDay,
          dayOfWeek: input.dayOfWeek,
          dayOfMonth: input.dayOfMonth,
          timezone: input.timezone,
          cronExpression: input.cronExpression,
        });
        
        // userId stored for audit trail only — nullable, not used for access control
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
          scheduleType: z.enum(["hourly", "daily", "weekly", "monthly", "custom"]).optional(),
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
        
        // Verify the job exists
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { scheduledJobs } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const jobs = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).limit(1);
        const job = jobs[0];
        if (!job) {
          throw new Error("Scheduled job not found");
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
      // Verify the job exists before deleting
      const { getDb, deleteScheduledJob } = await import("./db");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { scheduledJobs } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const jobs = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, input.id)).limit(1);
      if (!jobs[0]) {
        throw new Error("Scheduled job not found");
      }
      await deleteScheduledJob(input.id);
      return { success: true };
    }),
    runNow: protectedProcedure.input(z.object({ id: z.number() })).mutation(async ({ ctx, input }) => {
      // Verify the job exists before running
      const { getDb } = await import("./db");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const { scheduledJobs } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const jobs = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, input.id)).limit(1);
      if (!jobs[0]) {
        throw new Error("Scheduled job not found");
      }
      const { runJobNow } = await import("./scheduler");
      return runJobNow(input.id);
    }),
    // Run history
    getRunHistory: protectedProcedure
      .input(z.object({ jobId: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        if (input.jobId) {
          // Verify the job exists before returning its history
          const { getDb, getScheduledJobRunsByJobId } = await import("./db");
          const db = await getDb();
          if (!db) throw new Error("Database not available");
          const { scheduledJobs } = await import("../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const jobs = await db.select().from(scheduledJobs).where(eq(scheduledJobs.id, input.jobId)).limit(1);
          if (!jobs[0]) {
            throw new Error("Scheduled job not found");
          }
          return getScheduledJobRunsByJobId(input.jobId);
        } else {
          const { getAllScheduledJobRuns } = await import("./db");
          return getAllScheduledJobRuns();
        }
      }),
  }),

  // AI provider utilities
  aiProvider: router({
    getModels: protectedProcedure.input(z.object({ provider: z.enum(["openai", "anthropic", "google", "minimax"]) })).query(async ({ input }) => {
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
    list: protectedProcedure.query(async () => {
      const { getAllCampaignsWithBusinessInfo } = await import("./dbCampaigns");
      return getAllCampaignsWithBusinessInfo();
    }),
    stats: protectedProcedure.query(async () => {
      const { getAllCampaignStats } = await import("./dbCampaigns");
      return getAllCampaignStats();
    }),
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getCampaignById, getQueryLocationsByCampaignId } = await import("./dbCampaigns");
        const { getBusinessById } = await import("./db");
        const campaign = await getCampaignById(input.id);
        if (!campaign) {
          throw new Error("Campaign not found");
        }
        const business = await getBusinessById(campaign.businessId);
        const queryLocations = await getQueryLocationsByCampaignId(input.id);
        return { ...campaign, business, businessName: business?.name, queryLocations };
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
        if (!campaign) {
          throw new Error("Campaign not found");
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
        if (!campaign) {
          throw new Error("Campaign not found");
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
        if (!campaign) {
          throw new Error("Campaign not found");
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
        if (!campaign) {
          throw new Error("Campaign not found");
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
        if (!campaign) {
          throw new Error("Campaign not found");
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
        if (!campaign) {
          throw new Error("Campaign not found");
        }
        return getRankSnapshotsByCampaign(input.campaignId, input.limit);
      }),
    // ============= CREDIBILITY RESEARCH (Sprint 4) =============
    runCredibilityResearch: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getCampaignById } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) {
          throw new Error("Campaign not found");
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
        if (!campaign) {
          throw new Error("Campaign not found");
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
        if (!campaign) {
          throw new Error("Campaign not found");
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
        if (!campaign) {
          throw new Error("Campaign not found");
        }
        const { getContentPagesForCampaign } = await import("./contentGenerationEngine");
        return getContentPagesForCampaign(input.campaignId);
      }),
    setContentPageUrl: protectedProcedure
      .input(z.object({
        pageId: z.number(),
        publishedUrl: z.string().url("Must be a valid URL"),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Admin access required");
        }
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { contentPages } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        // Save the manually-entered URL and mark the page as published
        const [updatedPage] = await db
          .update(contentPages)
          .set({
            publishedUrl: input.publishedUrl,
            status: "published",
            publishedAt: new Date(),
            publishError: null,
            updatedAt: new Date(),
          })
          .where(eq(contentPages.id, input.pageId))
          .returning();
        if (!updatedPage) throw new Error("Content page not found");
        // Check if ALL pages for this campaign now have a publishedUrl
        const allPages = await db
          .select({ id: contentPages.id, publishedUrl: contentPages.publishedUrl })
          .from(contentPages)
          .where(eq(contentPages.campaignId, updatedPage.campaignId!));
        const allHaveUrls = allPages.length > 0 && allPages.every((p: { id: number; publishedUrl: string | null }) => !!p.publishedUrl);
        if (allHaveUrls && updatedPage.campaignId) {
          // All pages now have URLs — auto-kick off indexing step
          setImmediate(async () => {
            try {
              const { runPipelineStep } = await import("./pipelineOrchestrator");
              await runPipelineStep(updatedPage.campaignId!, "indexing", ctx.user.id);
              console.log(`[setContentPageUrl] Auto-triggered indexing for campaign ${updatedPage.campaignId} after all URLs entered manually`);
            } catch (err: any) {
              console.error(`[setContentPageUrl] Auto-indexing failed for campaign ${updatedPage.campaignId}:`, err.message);
            }
          });
        }
        return { success: true, allUrlsEntered: allHaveUrls };
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
    lock: protectedProcedure
      .input(z.object({ industry: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const { getIndustryKeywordCache, upsertIndustryKeywordCache } = await import("./dbCampaigns");
        const cache = await getIndustryKeywordCache(input.industry);
        if (!cache) throw new Error(`Cache not found for industry: ${input.industry}`);
        // If no golden template keywords yet, use top keywords from the full list
        const goldenKeywords = cache.goldenTemplateKeywords || 
          (cache.keywords as any[]).sort((a: any, b: any) => (b.aiSearchVolume || 0) - (a.aiSearchVolume || 0)).slice(0, 20);
        await upsertIndustryKeywordCache(input.industry, {
          isLocked: true,
          goldenTemplateKeywords: goldenKeywords,
        });
        return { success: true, message: `Golden template locked for ${input.industry}` };
      }),
    unlock: protectedProcedure
      .input(z.object({ industry: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const { upsertIndustryKeywordCache } = await import("./dbCampaigns");
        await upsertIndustryKeywordCache(input.industry, {
          isLocked: false,
        });
        return { success: true, message: `Golden template unlocked for ${input.industry}` };
      }),
    updateKeywords: protectedProcedure
      .input(z.object({
        industry: z.string().min(1),
        keywords: z.array(z.object({
          keyword: z.string(),
          aiSearchVolume: z.number().optional(),
          searchVolume: z.number().optional(),
          searchIntent: z.string().optional(),
          category: z.string().optional(),
          frequency: z.number().optional(),
        })),
        updateGolden: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const { upsertIndustryKeywordCache } = await import("./dbCampaigns");
        const updateData: any = { keywords: input.keywords };
        if (input.updateGolden) {
          updateData.goldenTemplateKeywords = input.keywords;
        }
        await upsertIndustryKeywordCache(input.industry, updateData);
        return { success: true, message: `Keywords updated for ${input.industry}` };
      }),
    updateLockThreshold: protectedProcedure
      .input(z.object({
        industry: z.string().min(1),
        lockThreshold: z.number().min(1).max(20),
      }))
      .mutation(async ({ input }) => {
        const { upsertIndustryKeywordCache } = await import("./dbCampaigns");
        await upsertIndustryKeywordCache(input.industry, {
          lockThreshold: input.lockThreshold,
        });
        return { success: true, message: `Lock threshold updated to ${input.lockThreshold}` };
      }),
    delete: protectedProcedure
      .input(z.object({ industry: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const { getDb } = await import("./db");
        const { industryKeywordCache } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        await db.delete(industryKeywordCache).where(eq(industryKeywordCache.industry, input.industry.toLowerCase().trim()));
        return { success: true, message: `Cache deleted for ${input.industry}` };
      }),
    refresh: protectedProcedure
      .input(z.object({ industry: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const { upsertIndustryKeywordCache } = await import("./dbCampaigns");
        // Reset the cache — unlock it and clear golden template so next research run rebuilds it
        await upsertIndustryKeywordCache(input.industry, {
          isLocked: false,
          goldenTemplateKeywords: null as any,
          clientCount: 0,
          lastRefreshedAt: new Date(),
        });
        return { success: true, message: `Cache reset for ${input.industry}. Next keyword research run will rebuild it.` };
      }),
  }),

  // Prompt template management
  promptTemplate: router({
    // List all templates for the current user, optionally filtered by type
    list: protectedProcedure
      .input(z.object({ templateType: z.enum(["clean", "suggestive", "follow_up", "category_based", "content_generation", "credibility_research", "injection_system", "injection_citation"]).optional() }).optional())
      .query(async ({ ctx, input }) => {
        const { getAllPromptTemplates, hasAnyPromptTemplates, seedDefaultPromptTemplates } = await import("./db");
        
        // Seed defaults if no templates exist at all
        const hasTemplates = await hasAnyPromptTemplates();
        if (!hasTemplates) {
          await seedDefaultPromptTemplates();
        }
        
        return getAllPromptTemplates(input?.templateType as any);
      }),

    // Get a single template by ID
    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getPromptTemplateById } = await import("./db");
        const template = await getPromptTemplateById(input.id);
        
        // All employees share access — no ownership check needed
        
        return template;
      }),

    create: protectedProcedure
      .input(
        z.object({
          templateType: z.enum(["clean", "suggestive", "follow_up", "category_based", "content_generation", "credibility_research", "injection_system", "injection_citation"]),
          templateName: z.string().min(1).max(255),
          templateContent: z.string().min(1),
          isActive: z.boolean().default(true),
          sortOrder: z.number().default(0),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createPromptTemplate } = await import("./db");
        const template = await createPromptTemplate(input);
        return { success: true, templateId: template.id };
      }),

    // Update an existing template
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        templateType: z.enum(["clean", "suggestive", "follow_up", "category_based", "content_generation", "credibility_research", "injection_system", "injection_citation"]).optional(),
        templateName: z.string().min(1).max(255).optional(),
        templateContent: z.string().min(1).optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getPromptTemplateById, updatePromptTemplate } = await import("./db");
        
        const existing = await getPromptTemplateById(input.id);
        if (!existing) {
          throw new Error("Template not found");
        }
        
        const { id, ...updateData } = input;
        return updatePromptTemplate(id, updateData);
      }),

    // Delete a template
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getPromptTemplateById, deletePromptTemplate } = await import("./db");
        
        const existing = await getPromptTemplateById(input.id);
        if (!existing) {
          throw new Error("Template not found");
        }
        
        return deletePromptTemplate(input.id);
      }),

    // Reset all templates to defaults
    resetToDefaults: protectedProcedure.mutation(async ({ ctx }) => {
      const { deleteAllPromptTemplates, seedDefaultPromptTemplates } = await import("./db");
      
      // Delete all existing templates
      await deleteAllPromptTemplates();
      
      // Seed defaults
      return seedDefaultPromptTemplates();
    }),
  }),

  // ============= AI ANSWER FORGE — WordPress Publisher (Sprint 6) =============
  wpPublisher: router({
    testConnection: protectedProcedure
      .input(z.object({ businessId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const { businesses } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { decrypt } = await import("./encryption");
        const { testSiteConnection } = await import("./contentPublisher");
        
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const biz = (await db.select().from(businesses).where(eq(businesses.id, input.businessId)).limit(1))[0];
        if (!biz) throw new Error("Business not found");
        if (!biz.siteAdminUrl || !biz.siteUsername || !biz.sitePasswordEncrypted) {
          throw new Error("Site credentials not configured for this business");
        }
        return testSiteConnection({
          siteUrl: biz.siteAdminUrl.replace(/\/wp-admin.*$/, ""),
          adminUrl: biz.siteAdminUrl,
          username: biz.siteUsername,
          password: decrypt(biz.sitePasswordEncrypted),
        });
      }),
    storeCredentials: protectedProcedure
      .input(z.object({
        businessId: z.number(),
        siteAdminUrl: z.string().url(),
        siteUsername: z.string().min(1),
        wpAppPassword: z.string().min(1),
      }))
      .mutation(async ({ ctx, input }) => {
        const { storeSiteCredentials } = await import("./contentPublisher");
        await storeSiteCredentials(input.businessId, input.siteAdminUrl, input.siteUsername, input.wpAppPassword);
        return { success: true };
      }),
    publishCampaign: protectedProcedure
      .input(z.object({ campaignId: z.number(), businessId: z.number(), dryRun: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        const { publishCampaignContent } = await import("./contentPublisher");
        return publishCampaignContent(input);
      }),
    publishLlmTxt: protectedProcedure
      .input(z.object({ campaignId: z.number(), businessId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { publishLlmTxt } = await import("./contentPublisher");
        return publishLlmTxt(input);
      }),
    getPublishedUrls: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getPublishedUrls } = await import("./contentPublisher");
        return getPublishedUrls(input.campaignId);
      }),
  }),

  // ============= AI ANSWER FORGE — Monkey Indexer (replaces SinByte) =============
  indexing: router({
    submitCampaign: protectedProcedure
      .input(z.object({ campaignId: z.number(), businessName: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const { submitCampaignForIndexing } = await import("./monkeyIndexer");
        return submitCampaignForIndexing(input);
      }),
    verifyCampaign: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { verifyCampaignIndexing } = await import("./monkeyIndexer");
        return verifyCampaignIndexing(input.campaignId);
      }),
    getHistory: protectedProcedure
      .query(async ({ ctx }) => {
        const { getIndexingHistory } = await import("./monkeyIndexer");
        return getIndexingHistory();
      }),
    getSubmissionStatuses: protectedProcedure
      .input(z.object({ trackingIds: z.array(z.string()) }))
      .query(async ({ ctx, input }) => {
        const { getSubmissionStatuses } = await import("./monkeyIndexer");
        return getSubmissionStatuses(input.trackingIds);
      }),
    getAccountInfo: protectedProcedure
      .query(async ({ ctx }) => {
        const { getAccountInfo } = await import("./monkeyIndexer");
        return getAccountInfo();
      }),
  }),

  // ============= AI ANSWER FORGE — Pipeline Orchestrator =============
  pipeline: router({
    getStatus: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
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
      .mutation(async ({ ctx, input }) => {
        const { runScheduledRankCheck } = await import("./rankTrackingEngine");
        return runScheduledRankCheck(input.campaignId);
      }),
    getReport: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { generateCampaignRankReport } = await import("./rankTrackingEngine");
        return generateCampaignRankReport(input.campaignId);
      }),
    getTrends: protectedProcedure
      .input(z.object({ campaignId: z.number(), days: z.number().optional() }))
      .query(async ({ ctx, input }) => {
        const { getVisibilityTrends } = await import("./rankTrackingEngine");
        return getVisibilityTrends(input.campaignId, { days: input.days });
      }),
    getMentionHistory: protectedProcedure
      .input(z.object({
        queryLocationId: z.number(),
        days: z.number().min(1).max(365).default(90),
      }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { rankSnapshots } = await import("../drizzle/schema");
        const { eq, gte, desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        const since = new Date();
        since.setDate(since.getDate() - input.days);
        return db
          .select({
            id: rankSnapshots.id,
            checkedAt: rankSnapshots.checkedAt,
            checkType: rankSnapshots.checkType,
            chatgptMentioned: rankSnapshots.chatgptMentioned,
            chatgptPosition: rankSnapshots.chatgptPosition,
            geminiMentioned: rankSnapshots.geminiMentioned,
            geminiPosition: rankSnapshots.geminiPosition,
            aiOverviewMentioned: rankSnapshots.aiOverviewMentioned,
            aiOverviewPosition: rankSnapshots.aiOverviewPosition,
          })
          .from(rankSnapshots)
          .where(eq(rankSnapshots.queryLocationId, input.queryLocationId))
          .orderBy(desc(rankSnapshots.checkedAt))
          .limit(200);
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
      .mutation(async ({ ctx, input }) => {
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
    // List all dashboards (all employees see everything)
    list: protectedProcedure.query(async ({ ctx }) => {
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
        .innerJoin(businesses, eq(clientDashboards.businessId, businesses.id))
        .orderBy(desc(clientDashboards.createdAt));
    }),
    // Admin: toggle dashboard active status
    toggleActive: protectedProcedure
      .input(z.object({ id: z.number(), isActive: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
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

  // ─── Sprint 11: Training Context Enrichment ────────────────────────────────
  trainingContext: router({
    // Get enrichment status for a business
    getEnrichmentStatus: protectedProcedure
      .input(z.object({ businessId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { buildTrainingContext, summarizeTrainingContext } = await import("./trainingContextEnricher");
        const context = await buildTrainingContext(input.businessId);
        return summarizeTrainingContext(context);
      }),
    // Get full training context for a business
    getFullContext: protectedProcedure
      .input(z.object({ businessId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { buildTrainingContext } = await import("./trainingContextEnricher");
        return buildTrainingContext(input.businessId);
      }),
    // Get enriched system message preview
    getEnrichedSystemMessage: protectedProcedure
      .input(z.object({ businessId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { buildTrainingContext, buildEnrichedSystemMessage } = await import("./trainingContextEnricher");
        const context = await buildTrainingContext(input.businessId);
        if (!context) return { message: null, hasContext: false };
        return { message: await buildEnrichedSystemMessage(context), hasContext: true };
      }),
    // Get source citation block preview
    getSourceCitationBlock: protectedProcedure
      .input(z.object({ businessId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { buildTrainingContext, buildSourceCitationBlock } = await import("./trainingContextEnricher");
        const context = await buildTrainingContext(input.businessId);
        if (!context) return { block: null, hasContext: false };
        return { block: await buildSourceCitationBlock(context), hasContext: true };
      }),
  }),

  // ─── Sprint 12: Smart Scheduling ───────────────────────────────────────────
  smartScheduler: router({
    // Get schedule config for a mode
    getConfig: protectedProcedure
      .input(z.object({ mode: z.enum(["aggressive", "moderate", "maintenance"]) }))
      .query(async ({ input }) => {
        const { getScheduleConfig } = await import("./smartScheduler");
        return getScheduleConfig(input.mode);
      }),
    // Get all schedule configs
    getAllConfigs: protectedProcedure.query(async () => {
      const { getAllScheduleConfigs } = await import("./smartScheduler");
      return getAllScheduleConfigs();
    }),
    // Get campaign schedule status
    getCampaignStatus: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { getCampaignScheduleStatus } = await import("./smartScheduler");
        return getCampaignScheduleStatus(input.campaignId);
      }),
    // Get all campaign schedule statuses
    getAllStatuses: protectedProcedure.query(async () => {
      const { getAllCampaignScheduleStatuses } = await import("./smartScheduler");
      return getAllCampaignScheduleStatuses();
    }),
    // Get mode recommendation for a campaign
    getRecommendation: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { recommendMode } = await import("./smartScheduler");
        return recommendMode(input.campaignId);
      }),
    // Apply mode change to a campaign
    applyModeChange: protectedProcedure
      .input(z.object({
        campaignId: z.number(),
        mode: z.enum(["aggressive", "moderate", "maintenance"]),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { applyCampaignModeChange } = await import("./smartScheduler");
        return applyCampaignModeChange(
          input.campaignId,
          input.mode,
          input.reason || `Manual mode change to ${input.mode}`
        );
      }),
    // Run auto-recovery check on all campaigns
    checkAutoRecovery: protectedProcedure.mutation(async () => {
      const { checkAutoRecovery } = await import("./smartScheduler");
      return checkAutoRecovery();
    }),
    // Evaluate all campaigns and apply recommended mode changes
    evaluateAll: protectedProcedure.mutation(async () => {
      const { evaluateAndApplyModeChanges } = await import("./smartScheduler");
      return evaluateAndApplyModeChanges();
    }),
  }),

  // ─── Sprint 13: Win Notifications ──────────────────────────────────────────
  wins: router({
    // Detect wins for a specific campaign
    detectWins: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { detectWins } = await import("./winNotifications");
        return detectWins(input.campaignId);
      }),
    // Generate full win report for a campaign
    getReport: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { generateWinReport } = await import("./winNotifications");
        return generateWinReport(input.campaignId);
      }),
    // Check all campaigns for wins and send notifications
    checkAll: protectedProcedure.mutation(async () => {
      // Note: This checks ALL campaigns - admin-level operation
      // User is already authenticated via protectedProcedure
      const { checkAllCampaignsForWins } = await import("./winNotifications");
      return checkAllCampaignsForWins();
    }),
    // Format wins for client dashboard display
    formatForClient: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ ctx, input }) => {
        const { detectWins, formatWinsForClient } = await import("./winNotifications");
        const wins = await detectWins(input.campaignId);
        return formatWinsForClient(wins);
      }),
   }),

  // ─── Email Router ──────────────────────────────────────────────────────────
  email: router({
    // Send a test email to verify integration
    sendTest: protectedProcedure
      .input(z.object({ toEmail: z.string().email() }))
      .mutation(async ({ input }) => {
        const { sendTestEmail } = await import("./emailService");
        return sendTestEmail(input.toEmail);
      }),

    // Send win notification email for a campaign
    sendWinNotification: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { detectWins } = await import("./winNotifications");
        const { sendCampaignWinEmails } = await import("./emailService");
        const { generateCampaignRankReport } = await import("./rankTrackingEngine");
        
        const wins = await detectWins(input.campaignId);
        if (wins.length === 0) return { success: false, error: "No wins to report" };
        
        const report = await generateCampaignRankReport(input.campaignId);
        const formattedWins = wins.map(w => ({
          platform: w.platform === "ai_overview" ? "AI Overview" :
                   w.platform === "chatgpt" ? "ChatGPT" :
                   w.platform === "gemini" ? "Gemini" : w.platform,
          query: w.query,
          location: w.location,
          message: w.description,
          significance: w.significance,
        }));
        
        return sendCampaignWinEmails(
          input.campaignId,
          formattedWins,
          report.currentScore.overall,
          report.previousScore?.overall ?? null
        );
      }),

    // Send visibility report email for a campaign
    sendVisibilityReport: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { generateCampaignRankReport } = await import("./rankTrackingEngine");
        const { sendCampaignVisibilityReport } = await import("./emailService");
        
        const report = await generateCampaignRankReport(input.campaignId);
        
        const topWins = report.queryDetails
          .filter(q => q.chatgptMentioned || q.geminiMentioned || q.aiOverviewMentioned)
          .slice(0, 5)
          .map(q => ({
            query: q.searchQuery,
            platform: q.chatgptMentioned ? "ChatGPT" : q.geminiMentioned ? "Gemini" : "AI Overview",
            position: q.chatgptPosition || q.geminiPosition || q.aiOverviewPosition,
          }));
        
        return sendCampaignVisibilityReport(input.campaignId, {
          currentScore: report.currentScore.overall,
          baselineScore: report.baselineScore?.overall ?? null,
          previousScore: report.previousScore?.overall ?? null,
          chatgptScore: report.currentScore.chatgpt,
          geminiScore: report.currentScore.gemini,
          aiOverviewScore: report.currentScore.aiOverview,
          mentionedQueries: report.currentScore.mentionedQueries,
          totalQueries: report.currentScore.totalQueries,
          topWins,
        });
      }),

    // Send welcome email for a campaign
    sendWelcome: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        const { campaigns, businesses } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { sendWelcomeEmail } = await import("./emailService");
        
        const [campaign] = await db!.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).limit(1);
        if (!campaign) return { success: false, error: "Campaign not found" };
        
        const [business] = await db!.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
        if (!business?.contactEmail) return { success: false, error: "No contact email" };
        
        // Get dashboard URL if exists
        const { clientDashboards } = await import("../drizzle/schema");
        const [dashboard] = await db!.select().from(clientDashboards).where(eq(clientDashboards.campaignId, input.campaignId)).limit(1);
        const baseUrl = process.env.APP_BASE_URL ?? "";
        const dashboardUrl = dashboard?.isActive && baseUrl ? `${baseUrl}/report/${dashboard.accessToken}` : undefined;
        
        return sendWelcomeEmail({
          businessName: business.name,
          contactName: business.contactName || business.name,
          contactEmail: business.contactEmail,
          packageName: campaign.campaignName || "AI Visibility",
          dashboardUrl,
        });
      }),

    // Send milestone email for a campaign
    sendMilestone: protectedProcedure
      .input(z.object({
        campaignId: z.number(),
        milestone: z.string(),
        milestoneDescription: z.string(),
        nextStep: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const db = await getDb();
        const { campaigns, businesses, clientDashboards } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { sendMilestoneEmail } = await import("./emailService");
        
        const [campaign] = await db!.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).limit(1);
        if (!campaign) return { success: false, error: "Campaign not found" };
        
        const [business] = await db!.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
        if (!business?.contactEmail) return { success: false, error: "No contact email" };
        
        const [dashboard] = await db!.select().from(clientDashboards).where(eq(clientDashboards.campaignId, input.campaignId)).limit(1);
        const baseUrl = process.env.APP_BASE_URL ?? "";
        const dashboardUrl = dashboard?.isActive && baseUrl ? `${baseUrl}/report/${dashboard.accessToken}` : undefined;
        
        return sendMilestoneEmail({
          businessName: business.name,
          contactName: business.contactName || business.name,
          contactEmail: business.contactEmail,
          milestone: input.milestone,
          milestoneDescription: input.milestoneDescription,
          nextStep: input.nextStep,
          dashboardUrl,
        });
      }),

    // Preview email templates (returns HTML without sending)
    previewWinEmail: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const { previewWinEmail } = await import("./emailService");
        return {
          html: await previewWinEmail({
            businessName: "Sample Business",
            contactName: "John",
            contactEmail: "test@example.com",
            totalWins: 3,
            wins: [
              { platform: "ChatGPT", query: "best hvac repair near me", location: "Dallas, TX", message: "Sample Business is now the #1 recommendation on ChatGPT!", significance: "breakthrough" },
              { platform: "Gemini", query: "ac installation dallas", location: "Dallas, TX", message: "Sample Business is now mentioned by Gemini!", significance: "major" },
              { platform: "AI Overview", query: "emergency hvac service", location: "Dallas, TX", message: "Improved from #5 to #2 on AI Overview", significance: "moderate" },
            ],
            currentScore: 72,
            previousScore: 35,
          }),
        };
      }),

    previewVisibilityReport: protectedProcedure
      .query(async () => {
        const { previewVisibilityReportEmail } = await import("./emailService");
        return {
          html: await previewVisibilityReportEmail({
            businessName: "Sample Business",
            contactName: "John",
            contactEmail: "test@example.com",
            currentScore: 65,
            baselineScore: 8,
            previousScore: 52,
            chatgptScore: 72,
            geminiScore: 58,
            aiOverviewScore: 61,
            mentionedQueries: 18,
            totalQueries: 25,
            topWins: [
              { query: "best hvac repair near me", platform: "ChatGPT", position: 1 },
              { query: "ac installation dallas", platform: "Gemini", position: 2 },
            ],
            reportPeriod: "March 2026",
          }),
        };
      }),
   }),
});
// ============= LLM Insights — Query Volume Dashboard =============
export const llmInsightsRouter = router({
  /**
   * Get all query × location combos across all campaigns, sorted by AI search volume.
   * This is the global LLM query volume dashboard.
   */
  topQueries: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).default(100),
      campaignId: z.number().optional(), // Filter to a single campaign
    }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const { campaignQueryLocations, campaigns, businesses } = await import("../drizzle/schema");
      const { desc, eq, isNotNull } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];

      const query = db
        .select({
          id: campaignQueryLocations.id,
          campaignId: campaignQueryLocations.campaignId,
          searchQuery: campaignQueryLocations.searchQuery,
          location: campaignQueryLocations.location,
          aiSearchVolume: campaignQueryLocations.aiSearchVolume,
          monthlyTrend: campaignQueryLocations.monthlyTrend,
          currentRankChatGPT: campaignQueryLocations.currentRankChatGPT,
          currentRankGemini: campaignQueryLocations.currentRankGemini,
          currentRankAIOverview: campaignQueryLocations.currentRankAIOverview,
          trainingStatus: campaignQueryLocations.trainingStatus,
          trainingSessions: campaignQueryLocations.trainingSessions,
          firstMentionedAt: campaignQueryLocations.firstMentionedAt,
          lastRankCheckAt: campaignQueryLocations.lastRankCheckAt,
          businessName: businesses.name,
          campaignName: campaigns.campaignName,
          businessType: businesses.businessType,
        })
        .from(campaignQueryLocations)
        .leftJoin(campaigns, eq(campaignQueryLocations.campaignId, campaigns.id))
        .leftJoin(businesses, eq(campaigns.businessId, businesses.id))
        .where(
          input.campaignId
            ? eq(campaignQueryLocations.campaignId, input.campaignId)
            : isNotNull(campaignQueryLocations.aiSearchVolume)
        )
        .orderBy(desc(campaignQueryLocations.aiSearchVolume))
        .limit(input.limit);

      return query;
    }),

  /**
   * Get aggregate LLM mention stats across all campaigns.
   * Shows total queries tracked, mention rates per platform, etc.
   */
  aggregateStats: protectedProcedure.query(async () => {
    const { getDb } = await import("./db");
    const { campaignQueryLocations, campaigns, businesses } = await import("../drizzle/schema");
    const { sql, eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return null;

    const [stats] = await db
      .select({
        totalQueries: sql<number>`count(*)`,
        totalWithVolume: sql<number>`count(${campaignQueryLocations.aiSearchVolume})`,
        avgAiVolume: sql<number>`avg(${campaignQueryLocations.aiSearchVolume})`,
        totalAiVolume: sql<number>`sum(${campaignQueryLocations.aiSearchVolume})`,
        mentionedChatGPT: sql<number>`sum(case when ${campaignQueryLocations.currentRankChatGPT} = 'mentioned' then 1 else 0 end)`,
        mentionedGemini: sql<number>`sum(case when ${campaignQueryLocations.currentRankGemini} = 'mentioned' then 1 else 0 end)`,
        mentionedAIOverview: sql<number>`sum(case when ${campaignQueryLocations.currentRankAIOverview} = 'mentioned' then 1 else 0 end)`,
        achievedCount: sql<number>`sum(case when ${campaignQueryLocations.trainingStatus} = 'achieved' then 1 else 0 end)`,
      })
      .from(campaignQueryLocations);

    return {
      totalQueries: Number(stats?.totalQueries ?? 0),
      totalWithVolume: Number(stats?.totalWithVolume ?? 0),
      avgAiVolume: Math.round(Number(stats?.avgAiVolume ?? 0)),
      totalAiVolume: Number(stats?.totalAiVolume ?? 0),
      mentionedChatGPT: Number(stats?.mentionedChatGPT ?? 0),
      mentionedGemini: Number(stats?.mentionedGemini ?? 0),
      mentionedAIOverview: Number(stats?.mentionedAIOverview ?? 0),
      achievedCount: Number(stats?.achievedCount ?? 0),
    };
  }),
});

// ─── Agency Router ───────────────────────────────────────────────────────────
export const agencyRouter = router({
  // Admin: list all agencies
  list: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== 'admin') throw new Error('Forbidden');
    const { getAllAgencies } = await import('./dbAgencies');
    return getAllAgencies();
  }),

  // Admin: get a single agency by id
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');
      const { getAgencyById } = await import('./dbAgencies');
      return getAgencyById(input.id);
    }),

  // Agency user: get their own agency record
  myAgency: protectedProcedure.query(async ({ ctx }) => {
    const { getAgencyByUserId } = await import('./dbAgencies');
    return getAgencyByUserId(ctx.user.id);
  }),

  // Admin: create a new agency (also creates a Stripe customer)
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      contactEmail: z.string().email(),
      contactName: z.string().optional(),
      phone: z.string().optional(),
      packageTier: z.string().optional(),
      brandName: z.string().optional(),
      brandLogoUrl: z.string().optional(),
      brandFromName: z.string().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');
      const { createAgency, updateAgency } = await import('./dbAgencies');
      // 1. Create the agency record
      const agency = await createAgency({
        ...input,
        packageTier: input.packageTier ?? 'starter',
      });
      // 2. Create Stripe customer (non-blocking — don't fail if Stripe not configured yet)
      try {
        const { createOrGetStripeCustomer } = await import('./stripeAgency');
        const stripeCustomerId = await createOrGetStripeCustomer({
          agencyId: agency.id,
          name: input.name,
          email: input.contactEmail,
        });
        return updateAgency(agency.id, { stripeCustomerId });
      } catch (stripeErr) {
        console.warn('[agency.create] Stripe customer creation skipped:', stripeErr);
        return agency;
      }
    }),

  // Admin: update an agency
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      contactEmail: z.string().email().optional(),
      contactName: z.string().optional(),
      phone: z.string().optional(),
      packageTier: z.string().optional(),
      brandName: z.string().optional(),
      brandLogoUrl: z.string().optional(),
      brandFromName: z.string().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
      // Agency-provided API keys for training queries (agency absorbs OpenAI + Gemini costs)
      agencyOpenAiKey: z.string().optional().nullable(),
      agencyGeminiKey: z.string().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId, updateAgency } = await import('./dbAgencies');
      const { encrypt } = await import('./encryption');
      const { id, ...updates } = input;
      // Encrypt API keys before storing
      const processedUpdates: any = { ...updates };
      if (updates.agencyOpenAiKey) processedUpdates.agencyOpenAiKey = encrypt(updates.agencyOpenAiKey);
      if (updates.agencyGeminiKey) processedUpdates.agencyGeminiKey = encrypt(updates.agencyGeminiKey);
      if (ctx.user.role === 'admin') {
        return updateAgency(id, processedUpdates);
      }
      // Agency user can update their own branding + API keys
      const myAgency = await getAgencyByUserId(ctx.user.id);
      if (!myAgency || myAgency.id !== id) throw new Error('Forbidden');
      const { brandName, brandLogoUrl, brandFromName, agencyOpenAiKey, agencyGeminiKey } = processedUpdates;
      return updateAgency(id, { brandName, brandLogoUrl, brandFromName, agencyOpenAiKey, agencyGeminiKey });
    }),

  // Admin: delete an agency
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');
      const { deleteAgency } = await import('./dbAgencies');
      await deleteAgency(input.id);
      return { success: true };
    }),

  // Agency user: get their own clients (businesses linked to their agency)
  myClients: protectedProcedure.query(async ({ ctx }) => {
    const { getAgencyByUserId } = await import('./dbAgencies');
    const { businesses } = await import('../drizzle/schema');
    const { eq } = await import('drizzle-orm');
    const agency = await getAgencyByUserId(ctx.user.id);
    if (!agency) return [];
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) return [];
    return db.select().from(businesses).where(eq(businesses.agencyId, agency.id));
  }),

  // Admin: get clients for a specific agency
  getClients: protectedProcedure
    .input(z.object({ agencyId: z.number() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');
      const { businesses } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) return [];
      return db.select().from(businesses).where(eq(businesses.agencyId, input.agencyId));
    }),

  // Agency user or admin: add a client to an agency and create a Stripe subscription
  addClient: protectedProcedure
    .input(z.object({
      agencyId: z.number(),
      packageTier: z.enum(['starter', 'growth', 'pro']),
      // ── Core business info ──
      name: z.string().min(1),
      businessType: z.string().optional(),
      website: z.string().optional(),
      location: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      description: z.string().optional(),
      notes: z.string().optional(),
      // ── Contact info ──
      contactName: z.string().optional(),
      contactEmail: z.string().optional(),
      // ── Credibility data (feeds the webhook payload) ──
      yearsInBusiness: z.number().int().positive().optional(),
      certifications: z.string().optional(),
      licenses: z.string().optional(),
      awards: z.string().optional(),
      warranties: z.string().optional(),
      bbbRating: z.string().optional(),
      differentiators: z.string().optional(),
      // ── Social profiles ──
      facebookUrl: z.string().optional(),
      instagramUrl: z.string().optional(),
      linkedinUrl: z.string().optional(),
      twitterUrl: z.string().optional(),
      youtubeUrl: z.string().optional(),
      tiktokUrl: z.string().optional(),
      yelpUrl: z.string().optional(),
      googleMapsUrl: z.string().optional(),
      bbbUrl: z.string().optional(),
      angiesUrl: z.string().optional(),
      thumbtackUrl: z.string().optional(),
      houzzUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyById, getAgencyByUserId } = await import('./dbAgencies');
      const { createBusiness, updateBusiness } = await import('./db');
      // Verify access
      let agency;
      if (ctx.user.role === 'admin') {
        agency = await getAgencyById(input.agencyId);
      } else {
        agency = await getAgencyByUserId(ctx.user.id);
        if (!agency || agency.id !== input.agencyId) throw new Error('Forbidden');
      }
      if (!agency) throw new Error('Agency not found');
      // Create the business record with all collected fields
      const { agencyId, packageTier, ...businessFields } = input;
      const newBusiness = await createBusiness({
        ...businessFields,
        agencyId,
        agencyPackageTier: packageTier,
        userId: ctx.user.id,
      });
      // Create Stripe subscription for this client (non-blocking)
      try {
        if (agency.stripeCustomerId) {
          const { createClientSubscription } = await import('./stripeAgency');
          const result = await createClientSubscription({
            stripeCustomerId: agency.stripeCustomerId,
            packageSlug: packageTier,
            agencyName: agency.brandName || agency.name,
            clientBusinessName: input.name,
            agencyId: agency.id,
            businessId: newBusiness.id,
          });
          if (result?.subscriptionId) {
            await updateBusiness(newBusiness.id, { stripeSubscriptionId: result.subscriptionId });
          }
        }
      } catch (stripeErr) {
        console.warn('[agency.addClient] Stripe subscription creation skipped:', stripeErr);
      }
      return { success: true, businessId: newBusiness.id };
    }),

  // Agency user or admin: remove a client from an agency (cancel subscription)
  removeClient: protectedProcedure
    .input(z.object({
      agencyId: z.number(),
      businessId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyById, getAgencyByUserId } = await import('./dbAgencies');
      const { updateBusiness, getBusinessById } = await import('./db');
      // Verify access
      let agency;
      if (ctx.user.role === 'admin') {
        agency = await getAgencyById(input.agencyId);
      } else {
        agency = await getAgencyByUserId(ctx.user.id);
        if (!agency || agency.id !== input.agencyId) throw new Error('Forbidden');
      }
      if (!agency) throw new Error('Agency not found');
      // Cancel Stripe subscription if one exists
      try {
        const biz = await getBusinessById(input.businessId);
        if (biz?.stripeSubscriptionId) {
          const { cancelClientSubscription } = await import('./stripeAgency');
          await cancelClientSubscription({ subscriptionId: biz.stripeSubscriptionId });
        }
      } catch (stripeErr) {
        console.warn('[agency.removeClient] Stripe cancellation skipped:', stripeErr);
      }
      // Unlink the business from the agency
      await updateBusiness(input.businessId, {
        agencyId: null,
        agencyPackageTier: null,
        stripeSubscriptionId: null,
      });
      return { success: true };
    }),

  // Agency user: get campaigns for a specific client business (must belong to their agency)
  clientCampaigns: protectedProcedure
    .input(z.object({ businessId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { businesses, campaigns } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const { getDb } = await import('./db');
      const db = await getDb();
      if (!db) return [];
      // Verify this business belongs to the agency
      const agency = await getAgencyByUserId(ctx.user.id);
      if (!agency && ctx.user.role !== 'admin') return [];
      if (agency) {
        const [biz] = await db.select({ agencyId: businesses.agencyId })
          .from(businesses)
          .where(eq(businesses.id, input.businessId))
          .limit(1);
        if (!biz || biz.agencyId !== agency.id) throw new Error('Forbidden');
      }
      return db.select().from(campaigns).where(eq(campaigns.businessId, input.businessId));
    }),

  // ── Intake token management ──────────────────────────────────────────────────────────────────

  // Agency user or admin: get (or generate) the agency's permanent intake token
  getIntakeToken: protectedProcedure.query(async ({ ctx }) => {
    const { getAgencyByUserId, updateAgency } = await import('./dbAgencies');
    const crypto = await import('crypto');
    let agency;
    if (ctx.user.role === 'admin') {
      // Admin calling on behalf — not typical, return null
      return { intakeToken: null, intakeUrl: null };
    }
    agency = await getAgencyByUserId(ctx.user.id);
    if (!agency) throw new Error('Agency not found');
    // Generate token if not yet set
    if (!agency.intakeToken) {
      const token = crypto.randomBytes(24).toString('hex');
      agency = await updateAgency(agency.id, { intakeToken: token });
    }
    return {
      intakeToken: agency.intakeToken,
      intakeUrl: `/intake/${agency.intakeToken}`,
    };
  }),

  // Admin: generate/reset intake token for a specific agency
  generateIntakeToken: protectedProcedure
    .input(z.object({ agencyId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden');
      const { getAgencyById, updateAgency } = await import('./dbAgencies');
      const crypto = await import('crypto');
      const agency = await getAgencyById(input.agencyId);
      if (!agency) throw new Error('Agency not found');
      const token = crypto.randomBytes(24).toString('hex');
      const updated = await updateAgency(agency.id, { intakeToken: token });
      return { intakeToken: updated.intakeToken, intakeUrl: `/intake/${updated.intakeToken}` };
    }),

  // PUBLIC: look up agency branding by intake token (no auth required)
  getIntakeBranding: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const { getAgencyByIntakeToken } = await import('./dbAgencies');
      const agency = await getAgencyByIntakeToken(input.token);
      if (!agency || !agency.isActive) throw new Error('Invalid or inactive intake link');
      return {
        agencyId: agency.id,
        brandName: agency.brandName || agency.name,
        brandLogoUrl: agency.brandLogoUrl || null,
        contactEmail: agency.contactEmail,
      };
    }),

  // PUBLIC: submit the client intake form (no auth required)
  submitIntakeForm: publicProcedure
    .input(z.object({
      token: z.string(),
      // ── Core business info ──
      name: z.string().min(1),
      businessType: z.string().optional(),
      website: z.string().optional(),
      location: z.string().optional(),
      address: z.string().optional(),
      phone: z.string().optional(),
      description: z.string().optional(),
      // ── Contact info ──
      contactName: z.string().optional(),
      contactEmail: z.string().optional(),
      // ── Credibility data ──
      yearsInBusiness: z.number().int().positive().optional(),
      certifications: z.string().optional(),
      licenses: z.string().optional(),
      awards: z.string().optional(),
      warranties: z.string().optional(),
      bbbRating: z.string().optional(),
      differentiators: z.string().optional(),
      // ── Social profiles ──
      facebookUrl: z.string().optional(),
      instagramUrl: z.string().optional(),
      linkedinUrl: z.string().optional(),
      twitterUrl: z.string().optional(),
      youtubeUrl: z.string().optional(),
      tiktokUrl: z.string().optional(),
      yelpUrl: z.string().optional(),
      googleMapsUrl: z.string().optional(),
      bbbUrl: z.string().optional(),
      angiesUrl: z.string().optional(),
      thumbtackUrl: z.string().optional(),
      houzzUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getAgencyByIntakeToken } = await import('./dbAgencies');
      const { createBusiness } = await import('./db');
      const { getDb } = await import('./db');
      const { users } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');

      // Validate the intake token
      const { token, ...businessFields } = input;
      const agency = await getAgencyByIntakeToken(token);
      if (!agency || !agency.isActive) throw new Error('Invalid or inactive intake link');

      // Assign to the platform admin user for audit trail
      const db = await getDb();
      if (!db) throw new Error('Database unavailable');
      const [adminUser] = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
      const ownerId = adminUser?.id ?? null;

      // Create the business record linked to this agency
      // agencyPackageTier is intentionally null — agency assigns it after reviewing the submission
      const newBusiness = await createBusiness({
        ...businessFields,
        agencyId: agency.id,
        agencyPackageTier: null,
        userId: ownerId,
      });

      // Send notification email to the agency (non-blocking)
      try {
        const { sendAgencyIntakeNotification } = await import('./agencyIntakeEmail');
        await sendAgencyIntakeNotification({
          agency,
          businessName: input.name,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          website: input.website,
          location: input.location,
          businessId: newBusiness.id,
        });
      } catch (emailErr) {
        console.warn('[intake] Notification email failed (non-blocking):', emailErr);
      }

      return { success: true, businessId: newBusiness.id };
    }),

  // Agency user or admin: assign a package tier to a pending intake client and start their campaign
  assignClientTier: protectedProcedure
    .input(z.object({
      agencyId: z.number(),
      businessId: z.number(),
      packageTier: z.enum(['starter', 'growth', 'pro']),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyById, getAgencyByUserId } = await import('./dbAgencies');
      const { updateBusiness } = await import('./db');
      // Verify access
      let agency;
      if (ctx.user.role === 'admin') {
        agency = await getAgencyById(input.agencyId);
      } else {
        agency = await getAgencyByUserId(ctx.user.id);
        if (!agency || agency.id !== input.agencyId) throw new Error('Forbidden');
      }
      if (!agency) throw new Error('Agency not found');
      // Set the tier and create Stripe subscription
      await updateBusiness(input.businessId, { agencyPackageTier: input.packageTier });
      try {
        if (agency.stripeCustomerId) {
          const { createClientSubscription } = await import('./stripeAgency');
          const { getBusinessById } = await import('./db');
          const business = await getBusinessById(input.businessId);
          const result = await createClientSubscription({
            stripeCustomerId: agency.stripeCustomerId,
            packageSlug: input.packageTier,
            agencyName: agency.brandName || agency.name,
            clientBusinessName: business?.name ?? 'Client',
            agencyId: agency.id,
            businessId: input.businessId,
          });
          if (result?.subscriptionId) {
            await updateBusiness(input.businessId, { stripeSubscriptionId: result.subscriptionId });
          }
        }
      } catch (stripeErr) {
        console.warn('[agency.assignClientTier] Stripe skipped:', stripeErr);
      }
      // --- CRITICAL: Trigger campaign creation and pipeline ---
      // After tier is assigned, create the campaign and kick off the full pipeline
      // (keyword research → credibility → content → publishing → indexing → training)
      setImmediate(async () => {
        try {
          const { getDb: _getDb, getBusinessById } = await import('./db');
          const db = await _getDb();
          if (!db) return;
          const { getPackageTierBySlug, seedDefaultPackageTiers } = await import('./dbCampaigns');
          const { createCampaign, createClientDashboard, getCampaignsByBusinessId } = await import('./dbCampaigns');
          const { runFullPipeline } = await import('./pipelineOrchestrator');
          const { users } = await import('../drizzle/schema');
          const { eq } = await import('drizzle-orm');
          // Get admin user as campaign owner
          const adminUsers = await db.select().from(users).where(eq(users.role, 'admin')).limit(1);
          if (!adminUsers[0]) { console.error('[assignClientTier] No admin user found for campaign creation'); return; }
          const ownerId = adminUsers[0].id;
          // Check if campaign already exists for this business
          const existingCampaigns = await getCampaignsByBusinessId(input.businessId);
          const activeCampaign = existingCampaigns.find(
            (c) => c.status !== 'monitoring' && c.status !== 'error' && c.status !== 'paused'
          );
          if (activeCampaign) {
            console.log(`[assignClientTier] Campaign already exists (ID: ${activeCampaign.id}) for business ${input.businessId}. Skipping.`);
            return;
          }
          // Resolve package tier
          await seedDefaultPackageTiers();
          const packageTier = await getPackageTierBySlug(input.packageTier);
          if (!packageTier) { console.error(`[assignClientTier] Package tier '${input.packageTier}' not found`); return; }
          const business = await getBusinessById(input.businessId);
          if (!business) { console.error(`[assignClientTier] Business ${input.businessId} not found`); return; }
          // Create campaign
          const campaign = await createCampaign({
            userId: ownerId,
            businessId: input.businessId,
            packageTierId: packageTier.id,
            campaignName: `${business.name} - AI Visibility`,
            status: 'pending',
            clientType: 'ai_only',
            trainingAggressiveness: 'aggressive',
            rankCheckFrequency: 'weekly',
            errorCount: 0,
            trialStatus: 'trial',
            maxQueries: packageTier.maxQueries,
            maxLocations: packageTier.maxLocations,
            selectedPackage: input.packageTier,
          });
          // Initialize trial
          const { initializeTrial } = await import('./trialManager');
          await initializeTrial(campaign.id, input.packageTier);
          // Create client dashboard
          const crypto = await import('crypto');
          const accessToken = crypto.randomBytes(32).toString('hex');
          await createClientDashboard({
            businessId: input.businessId,
            campaignId: campaign.id,
            accessToken,
            isActive: true,
            dashboardTitle: `${business.name} - AI Visibility Report`,
            accessCount: 0,
          });
          console.log(`[assignClientTier] Campaign ${campaign.id} created for agency client ${business.name}. Starting pipeline...`);
          // Kick off the full pipeline
          const result = await runFullPipeline(campaign.id, ownerId);
          console.log(`[assignClientTier] Pipeline started for campaign ${campaign.id}:`, result.reason);
        } catch (pipelineErr: any) {
          console.error(`[assignClientTier] Pipeline auto-start failed for business ${input.businessId}:`, pipelineErr.message);
        }
      });
      return { success: true };
    }),

  // Toggle whether the agency receives win emails for a specific client.
  // Defaults to true (agency gets all win emails). Set to false to silence them.
  setClientWinEmails: protectedProcedure
    .input(z.object({
      businessId: z.number(),
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getBusinessById, updateBusiness } = await import('./db');
      const business = await getBusinessById(input.businessId);
      if (!business) throw new Error('Client not found');
      if (ctx.user.role !== 'admin') {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (!agency || business.agencyId !== agency.id) throw new Error('Forbidden');
      }
      await updateBusiness(input.businessId, { agencyWinEmailsEnabled: input.enabled });
      return { success: true, enabled: input.enabled };
    }),

  // Agency user: get LLM query insights scoped to their own clients only
  llmInsightsQueries: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(500).default(200) }))
    .query(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getDb } = await import('./db');
      const { campaignQueryLocations, campaigns, businesses } = await import('../drizzle/schema');
      const { desc, eq, isNotNull } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return [];
      let agencyId: number | null = null;
      if (ctx.user.role !== 'admin') {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (!agency) return [];
        agencyId = agency.id;
      }
      const query = db
        .select({
          id: campaignQueryLocations.id,
          campaignId: campaignQueryLocations.campaignId,
          searchQuery: campaignQueryLocations.searchQuery,
          location: campaignQueryLocations.location,
          aiSearchVolume: campaignQueryLocations.aiSearchVolume,
          currentRankChatGPT: campaignQueryLocations.currentRankChatGPT,
          currentRankGemini: campaignQueryLocations.currentRankGemini,
          currentRankAIOverview: campaignQueryLocations.currentRankAIOverview,
          trainingStatus: campaignQueryLocations.trainingStatus,
          trainingSessions: campaignQueryLocations.trainingSessions,
          firstMentionedAt: campaignQueryLocations.firstMentionedAt,
          lastRankCheckAt: campaignQueryLocations.lastRankCheckAt,
          businessName: businesses.name,
          campaignName: campaigns.campaignName,
          businessType: businesses.businessType,
        })
        .from(campaignQueryLocations)
        .leftJoin(campaigns, eq(campaignQueryLocations.campaignId, campaigns.id))
        .leftJoin(businesses, eq(campaigns.businessId, businesses.id))
        .where(
          agencyId !== null
            ? eq(businesses.agencyId, agencyId)
            : isNotNull(campaignQueryLocations.aiSearchVolume)
        )
        .orderBy(desc(campaignQueryLocations.aiSearchVolume))
        .limit(input.limit);
      return query;
    }),

  // Agency user: get aggregate LLM stats scoped to their own clients only
  llmInsightsStats: protectedProcedure.query(async ({ ctx }) => {
    const { getAgencyByUserId } = await import('./dbAgencies');
    const { getDb } = await import('./db');
    const { campaignQueryLocations, campaigns, businesses } = await import('../drizzle/schema');
    const { sql, eq } = await import('drizzle-orm');
    const db = await getDb();
    if (!db) return null;
    let agencyId: number | null = null;
    if (ctx.user.role !== 'admin') {
      const agency = await getAgencyByUserId(ctx.user.id);
      if (!agency) return null;
      agencyId = agency.id;
    }
    const baseQuery = db
      .select({
        totalQueries: sql<number>`count(*)`,
        totalWithVolume: sql<number>`count(${campaignQueryLocations.aiSearchVolume})`,
        avgAiVolume: sql<number>`avg(${campaignQueryLocations.aiSearchVolume})`,
        totalAiVolume: sql<number>`sum(${campaignQueryLocations.aiSearchVolume})`,
        mentionedChatGPT: sql<number>`sum(case when ${campaignQueryLocations.currentRankChatGPT} = 'mentioned' then 1 else 0 end)`,
        mentionedGemini: sql<number>`sum(case when ${campaignQueryLocations.currentRankGemini} = 'mentioned' then 1 else 0 end)`,
        mentionedAIOverview: sql<number>`sum(case when ${campaignQueryLocations.currentRankAIOverview} = 'mentioned' then 1 else 0 end)`,
        achievedCount: sql<number>`sum(case when ${campaignQueryLocations.trainingStatus} = 'achieved' then 1 else 0 end)`,
      })
      .from(campaignQueryLocations)
      .leftJoin(campaigns, eq(campaignQueryLocations.campaignId, campaigns.id))
      .leftJoin(businesses, eq(campaigns.businessId, businesses.id));
    const [stats] = agencyId !== null
      ? await baseQuery.where(eq(businesses.agencyId, agencyId))
      : await baseQuery;
    return {
      totalQueries: Number(stats?.totalQueries ?? 0),
      totalWithVolume: Number(stats?.totalWithVolume ?? 0),
      avgAiVolume: Math.round(Number(stats?.avgAiVolume ?? 0)),
      totalAiVolume: Number(stats?.totalAiVolume ?? 0),
      mentionedChatGPT: Number(stats?.mentionedChatGPT ?? 0),
      mentionedGemini: Number(stats?.mentionedGemini ?? 0),
      mentionedAIOverview: Number(stats?.mentionedAIOverview ?? 0),
      achievedCount: Number(stats?.achievedCount ?? 0),
    };
  }),

  // Agency user: get existing client report links for a campaign
  getClientReportLinks: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getDb } = await import('./db');
      const { clientDashboards, campaigns, businesses } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) return [];
      if (ctx.user.role !== 'admin') {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (!agency) throw new Error('Forbidden');
        const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, input.campaignId)).limit(1);
        if (!campaign) throw new Error('Campaign not found');
        const [biz] = await db.select().from(businesses).where(eq(businesses.id, campaign.businessId)).limit(1);
        if (!biz || biz.agencyId !== agency.id) throw new Error('Forbidden');
      }
      return db.select().from(clientDashboards)
        .where(eq(clientDashboards.campaignId, input.campaignId))
        .orderBy(clientDashboards.createdAt);
    }),

  // Agency user: create a new client report link for a campaign
  createClientReportLink: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      businessId: z.number(),
      dashboardTitle: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getDb } = await import('./db');
      const { clientDashboards, businesses } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const crypto = await import('crypto');
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      if (ctx.user.role !== 'admin') {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (!agency) throw new Error('Forbidden');
        const [biz] = await db.select().from(businesses).where(eq(businesses.id, input.businessId)).limit(1);
        if (!biz || biz.agencyId !== agency.id) throw new Error('Forbidden');
      }
      const accessToken = crypto.randomBytes(32).toString('hex');
      const [created] = await db.insert(clientDashboards).values({
        businessId: input.businessId,
        campaignId: input.campaignId,
        accessToken,
        dashboardTitle: input.dashboardTitle || null,
        isActive: true,
      }).returning();
      return created;
    }),

  // Agency user: deactivate a client report link
  deactivateClientReportLink: protectedProcedure
    .input(z.object({ dashboardId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getDb } = await import('./db');
      const { clientDashboards, campaigns, businesses } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      if (ctx.user.role !== 'admin') {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (!agency) throw new Error('Forbidden');
        const [dash] = await db.select().from(clientDashboards).where(eq(clientDashboards.id, input.dashboardId)).limit(1);
        if (!dash) throw new Error('Not found');
        const [camp] = dash.campaignId
          ? await db.select().from(campaigns).where(eq(campaigns.id, dash.campaignId)).limit(1)
          : [undefined];
        const [biz] = camp
          ? await db.select().from(businesses).where(eq(businesses.id, camp.businessId)).limit(1)
          : [undefined];
        if (!biz || biz.agencyId !== agency.id) throw new Error('Forbidden');
      }
      await db.update(clientDashboards).set({ isActive: false }).where(eq(clientDashboards.id, input.dashboardId));
      return { success: true };
    }),
});

// Merge llmInsights into appRouter
export const appRouterWithInsights = router({
  ...appRouter._def.procedures,
  llmInsights: llmInsightsRouter,
});

export type AppRouter = typeof appRouter;
// Re-export the extended router for use in server setup
export { appRouterWithInsights as extendedAppRouter };
