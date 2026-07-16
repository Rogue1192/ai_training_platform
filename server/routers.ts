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
          credibilityUrls: z.string().optional(), // JSON string: [{label,url}]
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { createBusiness } = await import("./db");
        const businessData: any = { ...input, userId: ctx.user.id };
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
          credibilityUrls: z.string().optional(), // JSON string: [{label,url}]
          // Agency assignment
          agencyId: z.number().nullable().optional(),
          billingType: z.enum(["white_label", "direct", "legacy", "external"]).optional(),
          // Bundled billing flag
          noCharge: z.boolean().optional(),
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
    bulkUnarchive: protectedProcedure
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        const { bulkUnarchiveBusinesses } = await import("./db");
        await bulkUnarchiveBusinesses(input.ids);
        return { success: true, unarchived: input.ids.length };
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
        credibilityUrls: z.string().optional(), // JSON string: [{label,url}]
        internalSource: z.enum(["rogue", "ranklocal"]).optional(),
        packageTier: z.enum(["starter", "growth", "pro"]),
        noCharge: z.boolean().default(false),
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
            // Resolve query-slot budget from tier (new model)
            const resolvedMaxQuerySlots = tier.maxQuerySlots || (tier.maxQueries * tier.maxLocations);
            // Derive billingType: business.billingType first, then agency-linked → white_label, otherwise → legacy
            const onboardBillingType: "white_label" | "direct" | "legacy" | "external" =
              (biz as any).billingType
                ? (biz as any).billingType as "white_label" | "direct" | "legacy" | "external"
                : (biz as any).agencyId ? "white_label" : "legacy";
            // Create campaign
            const campaign = await createCampaign({
              userId: ownerId,
              businessId: business.id,
              packageTierId: tier.id,
              campaignName: `${biz.name} - AI Visibility`,
              status: 'pending',
              trainingAggressiveness: 'aggressive',
              rankCheckFrequency: 'weekly',
              errorCount: 0,
              trialStatus: 'trial',
              maxQueries: tier.maxQueries,
              maxLocations: tier.maxLocations,
              maxQuerySlots: resolvedMaxQuerySlots,
              selectedPackage: packageTier,
              billingType: onboardBillingType,
              noCharge: input.noCharge ?? false,
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
        const { encryptVerified } = await import("./encryption");
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

        const encryptedKey = encryptVerified(input.apiKey);
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
        const { encryptVerified } = await import("./encryption");
        const { verifyApiKey } = await import("./aiProviders");

        // Verify the API key works
        const verification = await verifyApiKey(input.provider, input.apiKey);
        if (!verification.valid) {
          throw new Error(verification.error || "Invalid API key or unable to connect to provider");
        }

        const encryptedKey = encryptVerified(input.apiKey);
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
        const { encryptVerified } = await import("./encryption");
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

        const encryptedKey = encryptVerified(input.apiKey);
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
            // Surface the actual reason from Monkey Indexer (was hidden before).
            // 401 = bad/missing key; 403 = key recognized but account/action forbidden.
            const detail =
              resp.data && typeof resp.data === "object"
                ? (resp.data.message || resp.data.error || JSON.stringify(resp.data).slice(0, 300))
                : String(resp.data ?? "").slice(0, 300);
            const msg = valid
              ? `Monkey Indexer key verified — ${credits ?? "?"} credits available`
              : `Monkey Indexer returned HTTP ${resp.status}: ${detail}`;
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

  // ─── Model Configuration ──────────────────────────────────────────────────
  modelConfig: router({
    get: protectedProcedure.query(async () => {
      const { getModelConfig } = await import("./modelConfigService");
      return getModelConfig();
    }),
    save: protectedProcedure
      .input(z.object({
        trainerModel: z.string().optional(),
        trainerProvider: z.string().optional(),
        contentModel: z.string().optional(),
        contentProvider: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { saveModelConfig } = await import("./modelConfigService");
        const updated = await saveModelConfig(input);
        return { success: true, config: updated };
      }),
    getDeprecatedCampaigns: protectedProcedure.query(async () => {
      const { getDb } = await import("./db");
      const { campaigns } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];
      const paused = await db.select().from(campaigns).where(eq(campaigns.status, "paused"));
      return paused.filter((r: any) => r.lastError?.includes("MODEL_DEPRECATED"));
    }),
    resumeDeprecatedCampaigns: protectedProcedure.mutation(async () => {
      const { getDb } = await import("./db");
      const { campaigns } = await import("../drizzle/schema");
      const { eq, inArray } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { resumed: 0 };
      const paused = await db.select().from(campaigns).where(eq(campaigns.status, "paused"));
      const deprecated = paused.filter((r: any) => r.lastError?.includes("MODEL_DEPRECATED"));
      if (deprecated.length === 0) return { resumed: 0 };
      const ids = deprecated.map((c: any) => c.id);
      await db.update(campaigns)
        .set({ status: "training", lastError: null, errorCount: 0 } as any)
        .where(inArray(campaigns.id, ids));
      return { resumed: ids.length };
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
            // Only legacy (V1) sessions use the influencer; V2 never calls it.
            session.isLegacy ? (session.influencerAiProvider as "openai" | "anthropic" | "google" | "minimax") : undefined
          );

          if (!validation.valid) {
            const cap = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
            const issues: string[] = [];
            if (validation.missingProviders.length > 0) {
              issues.push(`Missing API key(s) for: ${validation.missingProviders.map(cap).join(", ")}.`);
            }
            if (validation.corruptedProviders.length > 0) {
              issues.push(`Unreadable/outdated API key(s) for: ${validation.corruptedProviders.map(cap).join(", ")} — re-enter in Settings to re-encrypt.`);
            }
            throw new Error(`Cannot start training. ${issues.join(" ")} Please fix the API key(s) in Settings before starting.`);
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
    bulkDelete: protectedProcedure
      .input(z.object({ ids: z.array(z.number()).min(1) }))
      .mutation(async ({ input }) => {
        const { bulkDeleteTrainingSessions } = await import("./db");
        await bulkDeleteTrainingSessions(input.ids);
        return { success: true, deleted: input.ids.length };
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
              
              // Validate API keys (influencer only matters for legacy V1 sessions)
              const validation = await validateApiKeysForTraining(
                session.targetAiProvider as "openai" | "anthropic" | "google",
                session.isLegacy ? (session.influencerAiProvider as "openai" | "anthropic" | "google" | "minimax") : undefined
              );
              
              if (!validation.valid) {
                const cap = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
                const issues: string[] = [];
                if (validation.missingProviders.length > 0) {
                  issues.push(`missing: ${validation.missingProviders.map(cap).join(", ")}`);
                }
                if (validation.corruptedProviders.length > 0) {
                  issues.push(`unreadable, re-enter in Settings: ${validation.corruptedProviders.map(cap).join(", ")}`);
                }
                results.push({ sessionId: session.id, name: session.trainingName, success: false, error: `API key issue — ${issues.join("; ")}` });
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
    createManual: protectedProcedure
      .input(z.object({
        // NEW: pass an existing businessId to skip business creation
        businessId: z.number().int().positive().optional(),
        // Legacy fields kept for backward-compat (webhook, etc.) — ignored when businessId is set
        businessName: z.string().min(1, "Business name is required").optional(),
        websiteUrl: z.string().url("Valid website URL is required").optional(),
        industry: z.string().optional(),
        contactEmail: z.string().email("Valid contact email is required").optional(),
        contactName: z.string().optional(),
        contactPhone: z.string().optional(),
        locations: z.array(z.string().min(1)).optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        packageTierSlug: z.string().optional(),
        packageTierId: z.number().optional(),
        searchQueries: z.array(z.string()).optional(),
        locationQueryMap: z.array(z.object({
          location: z.string().min(1),
          queries: z.array(z.string().min(1)),
        })).optional(),
        billingType: z.enum(["white_label", "direct", "legacy"]).optional(),
        yearsFounded: z.number().optional(),
        certifications: z.array(z.string()).optional(),
        awards: z.array(z.string()).optional(),
        bbbRating: z.string().optional(),
        googleReviewCount: z.number().optional(),
        googleRating: z.number().optional(),
        selectedPackage: z.string().optional(),
        agencyId: z.number().int().positive().optional(),
        agencyPackageTier: z.enum(['starter', 'growth', 'pro']).optional(),
        source: z.enum(["rogue", "ranklocal"]).optional(),
        specialties: z.string().optional(),
        campaignScope: z.enum(["local", "national", "ecommerce"]).default("local"),
        noCharge: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import("./db");
        const { businesses } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { serializeLocations } = await import("@shared/location");
        const {
          createCampaign,
          getPackageTierBySlug,
          getPackageTierById,
          createCampaignQueryLocations,
          createClientDashboard,
          seedDefaultPackageTiers,
          getCampaignsByBusinessId
        } = await import("./dbCampaigns");
        const crypto = await import("crypto");

        const db = await getDb();
        if (!db) throw new Error("Database not available");

        // Ensure default package tiers exist
        await seedDefaultPackageTiers();

        // Resolve package tier
        let packageTier;
        if (input.packageTierId) {
          packageTier = await getPackageTierById(input.packageTierId);
        } else if (input.packageTierSlug) {
          packageTier = await getPackageTierBySlug(input.packageTierSlug);
        }
        if (!packageTier) {
          packageTier = await getPackageTierBySlug("starter");
        }
        if (!packageTier) {
          throw new Error("Package tier not found");
        }

        const sanitizeLoc = (s: string) => s.replace(/;/g, ",").replace(/\s+/g, " ").trim().slice(0, 140);

        // ── NEW PATH: businessId supplied — use existing business record ──────────
        let businessId: number;
        let finalLocations: string[];
        let industry: string;
        let resolvedBusinessName: string;
        let resolvedNoCharge: boolean;

        if (input.businessId) {
          const { getBusinessById } = await import("./db");
          const biz = await getBusinessById(input.businessId);
          if (!biz) throw new Error(`Business ${input.businessId} not found`);

          businessId = biz.id;
          resolvedBusinessName = biz.name;
          industry = biz.businessType?.trim() || "general";
          resolvedNoCharge = (biz as any).noCharge ?? input.noCharge ?? false;

          // Parse locations from the business record; fall back to any locations passed in
          const { parseLocations } = await import("@shared/location");
          const bizLocs = parseLocations(biz.location || "");
          const passedLocs = (input.locations ?? []).map((l) => sanitizeLoc(l)).filter(Boolean);
          finalLocations = passedLocs.length > 0 ? passedLocs : bizLocs;

          if (finalLocations.length === 0) {
            throw new Error("The selected business has no locations. Please add at least one location in the Businesses tab first.");
          }
        } else {
          // ── LEGACY PATH: all fields supplied manually ─────────────────────────
          if (!input.businessName) throw new Error("businessName is required when businessId is not provided");
          if (!input.websiteUrl) throw new Error("websiteUrl is required when businessId is not provided");

          finalLocations = (input.locations ?? []).map((l) => sanitizeLoc(l)).filter(Boolean);
          if (finalLocations.length === 0 && input.city?.trim() && input.state?.trim()) {
            const city = sanitizeLoc(input.city).slice(0, 100);
            const state = sanitizeLoc(input.state).slice(0, 40);
            if (city && state) finalLocations.push(`${city}, ${state}`);
          }
          if (finalLocations.length === 0) {
            throw new Error("At least one location is required");
          }

          industry = input.industry?.trim() || "general";
          resolvedBusinessName = input.businessName;
          resolvedNoCharge = input.noCharge ?? false;

          // Check if business already exists by website URL
          const existingBusinesses = await db
            .select()
            .from(businesses)
            .where(eq(businesses.website, input.websiteUrl))
            .limit(1);

          if (existingBusinesses.length > 0) {
            businessId = existingBusinesses[0].id;
            const updateFields: Record<string, any> = {
              businessType: industry,
              contactEmail: input.contactEmail,
              updatedAt: new Date(),
              location: serializeLocations(finalLocations),
            };
            if (input.contactName) updateFields.contactName = input.contactName;
            if (input.contactPhone) updateFields.phone = input.contactPhone;
            if (input.yearsFounded) updateFields.yearsInBusiness = input.yearsFounded;
            if (input.certifications) updateFields.certifications = input.certifications.join(", ");
            if (input.awards) updateFields.awards = input.awards.join(", ");
            if (input.bbbRating) updateFields.bbbRating = input.bbbRating;
            if (input.source) updateFields.internalSource = input.source;
            if (input.specialties) updateFields.specialties = input.specialties;

            await db.update(businesses).set(updateFields).where(eq(businesses.id, businessId));
          } else {
            const newBusiness = await db
              .insert(businesses)
              .values({
                userId: ctx.user.id,
                name: input.businessName,
                website: input.websiteUrl,
                businessType: industry,
                contactEmail: input.contactEmail,
                contactName: input.contactName || null,
                phone: input.contactPhone || null,
                location: serializeLocations(finalLocations),
                description: null,
                yearsInBusiness: input.yearsFounded || null,
                certifications: input.certifications?.join(", ") || null,
                awards: input.awards?.join(", ") || null,
                bbbRating: input.bbbRating || null,
                internalSource: input.source || null,
                specialties: input.specialties || null,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .returning();
            businessId = newBusiness[0].id;
          }
        }

        // ── Derive billingType from business context ─────────────────────────────
        // Priority: explicit input > business.billingType > business.agencyId > legacy
        // If the business record already has a billingType set (e.g. "legacy" for a
        // pre-existing client), that value flows down to the campaign automatically.
        let resolvedBillingType: "white_label" | "direct" | "legacy" | "external";
        if (input.billingType) {
          resolvedBillingType = input.billingType as "white_label" | "direct" | "legacy" | "external";
        } else {
          // Look up the business record to read its billingType and agencyId
          const { getBusinessById: _getBizForBilling } = await import("./db");
          const bizForBilling = await _getBizForBilling(businessId);
          if (bizForBilling?.billingType) {
            // Business-level billingType takes precedence — this is the source of truth
            resolvedBillingType = bizForBilling.billingType as "white_label" | "direct" | "legacy" | "external";
          } else if (bizForBilling?.agencyId) {
            resolvedBillingType = "white_label";
          } else {
            // No agency, no explicit billing type → legacy (not on any billing plan)
            resolvedBillingType = "legacy";
          }
        }

        // Check for existing active campaign
        const existingCampaigns = await getCampaignsByBusinessId(businessId);
        const activeCampaign = existingCampaigns.find(
          (c) => c.status !== "monitoring" && c.status !== "error" && c.status !== "paused"
        );

        if (activeCampaign) {
          const { getClientDashboardsByCampaignId } = await import("./dbCampaigns");
          const dashboards = await getClientDashboardsByCampaignId(activeCampaign.id);
          const existingToken = dashboards.find((d) => d.isActive)?.accessToken || "";
          return {
            success: true,
            campaignId: activeCampaign.id,
            businessId,
            dashboardToken: existingToken,
            message: `Active campaign already exists: "${activeCampaign.campaignName}". No duplicate created.`,
            existing: true,
          };
        }

        const resolvedMaxQuerySlots = packageTier.maxQuerySlots || (packageTier.maxQueries * packageTier.maxLocations);

        const campaign = await createCampaign({
          userId: ctx.user.id,
          businessId,
          packageTierId: packageTier.id,
          campaignName: `${resolvedBusinessName} - AI Visibility`,
          status: "pending",
          trainingAggressiveness: "aggressive",
          rankCheckFrequency: "weekly",
          errorCount: 0,
          trialStatus: "trial",
          maxQueries: packageTier.maxQueries,
          maxLocations: packageTier.maxLocations,
          maxQuerySlots: resolvedMaxQuerySlots,
          selectedPackage: input.selectedPackage || null,
          billingType: resolvedBillingType,
          campaignScope: input.campaignScope ?? "local",
          noCharge: resolvedNoCharge,
        });

        const { initializeTrial } = await import("./trialManager");
        await initializeTrial(campaign.id, input.selectedPackage);

        const entries = [];
        let slotsUsed = 0;

        if (input.locationQueryMap && input.locationQueryMap.length > 0) {
          for (const lqEntry of input.locationQueryMap) {
            for (const q of lqEntry.queries) {
              if (slotsUsed >= resolvedMaxQuerySlots) break;
              entries.push({ campaignId: campaign.id, searchQuery: q, location: lqEntry.location, trainingStatus: "pending", trainingSessions: 0 });
              slotsUsed++;
            }
            if (slotsUsed >= resolvedMaxQuerySlots) break;
          }
        } else if (input.searchQueries && input.searchQueries.length > 0 && finalLocations.length > 0) {
          for (const query of input.searchQueries) {
            for (const location of finalLocations) {
              if (slotsUsed >= resolvedMaxQuerySlots) break;
              entries.push({ campaignId: campaign.id, searchQuery: query, location, trainingStatus: "pending", trainingSessions: 0 });
              slotsUsed++;
            }
            if (slotsUsed >= resolvedMaxQuerySlots) break;
          }
        }

        if (entries.length > 0) {
          await createCampaignQueryLocations(entries);
          
          // Also populate the trainingQueries table so the V3 training engine
          // uses these exact audit-generated queries as the initial prompts
          const { getDb } = await import("./db");
          const db = await getDb();
          if (db) {
            const { trainingQueries } = await import("../drizzle/schema");
            // Deduplicate queries (since entries might have the same query across multiple locations)
            const uniqueQueries = Array.from(new Set(entries.map(e => e.searchQuery)));
            
            for (let i = 0; i < uniqueQueries.length; i++) {
              await db.insert(trainingQueries).values({
                campaignId: campaign.id,
                businessId: businessId,
                phraseText: uniqueQueries[i],
                phraseVariations: [uniqueQueries[i]], // Use the exact query as its own variation
                sortOrder: i + 1,
                isActive: true,
                lockedAt: new Date(), // Lock immediately so they are ready for training
              });
            }
          }
        }

        const accessToken = crypto.randomBytes(32).toString("hex");
        await createClientDashboard({
          businessId,
          campaignId: campaign.id,
          accessToken,
          isActive: true,
          dashboardTitle: `${resolvedBusinessName} - AI Visibility Report`,
          accessCount: 0,
        });

        // Auto-start pipeline
        setImmediate(async () => {
          try {
            const { runFullPipeline } = await import("./pipelineOrchestrator");
            await runFullPipeline(campaign.id, ctx.user.id);
          } catch (err) {
            console.error(`[ManualCreate] Pipeline auto-run failed for campaign ${campaign.id}:`, err);
          }
        });

        return {
          success: true,
          campaignId: campaign.id,
          businessId,
          dashboardToken: accessToken,
          message: `Campaign "${campaign.campaignName}" created successfully.`,
        };
      }),

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
        const { getDb } = await import('./db');
        const { contentPages } = await import('../drizzle/schema');
        const { eq, and, isNull, sql, notInArray } = await import('drizzle-orm');
        const campaign = await getCampaignById(input.id);
        if (!campaign) {
          throw new Error("Campaign not found");
        }
        const business = await getBusinessById(campaign.businessId);
        const queryLocations = await getQueryLocationsByCampaignId(input.id);
        // Compute isBlocked + missingUrlCount (same logic as campaign.list)
        let missingUrlCount = 0;
        const db = await getDb();
        if (db) {
          const NO_URL_TYPES = ['llm_txt','schema_package','schema_audit','schema_delivery'];
          const rows = await db
            .select({ count: sql<number>`count(*)` })
            .from(contentPages)
            .where(
              and(
                eq(contentPages.campaignId, input.id),
                notInArray(contentPages.pageType, NO_URL_TYPES),
                isNull(contentPages.publishedUrl)
              )
            );
          missingUrlCount = Number(rows[0]?.count ?? 0);
        }
        const isBlocked =
          missingUrlCount > 0 ||
          campaign.llmTxtVerified === false ||
          campaign.schemaVerified === false;
        return { ...campaign, business, businessName: business?.name, queryLocations, isBlocked, missingUrlCount };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          campaignName: z.string().min(1).optional(),
          trainingAggressiveness: z.enum(["aggressive", "moderate", "maintenance"]).optional(),
          rankCheckFrequency: z.enum(["daily", "weekly", "biweekly"]).optional(),
          status: z.enum([
            "pending", "keyword_research", "query_review", "credibility_research", "content_generation",
            "publishing", "indexing", "indexing_verification", "baseline_check", "training", "monitoring", "paused", "error"
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
        return updateCampaign(id, updates as any);
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
        const { getCampaignById, createCampaignQueryLocations, getQueryLocationsByCampaignId } = await import("./dbCampaigns");
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) {
          throw new Error("Campaign not found");
        }
        // Enforce maxQuerySlots cap
        const maxSlots = campaign.maxQuerySlots || 15;
        const existing = await getQueryLocationsByCampaignId(input.campaignId);
        const available = maxSlots - existing.length;
        if (available <= 0) {
          throw new Error(`Query slot limit reached (${maxSlots} slots for this package). Remove an existing query before adding a new one.`);
        }
        // Trim entries to fit within remaining budget
        const allowed = input.entries.slice(0, available);
        if (allowed.length < input.entries.length) {
          // Still insert what fits — caller sees the count mismatch via the return value
          console.warn(`[addQueryLocations] Trimmed ${input.entries.length - allowed.length} entries to stay within maxQuerySlots=${maxSlots}`);
        }
        return createCampaignQueryLocations(
          allowed.map((e) => ({ ...e, campaignId: input.campaignId }))
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
    // Regenerate queries for an existing campaign:
    // merges new locations into business.location, replaces seed keywords (specialties),
    // clears the old query-location matrix, and re-runs keyword research.
    rerunKeywordResearch: protectedProcedure
      .input(z.object({
        campaignId: z.number(),
        // New locations to ADD (merged with existing; duplicates are dropped)
        additionalLocations: z.array(z.string().min(1)).optional(),
        // Clean list of seed keywords — REPLACES business.specialties entirely
        seedKeywords: z.array(z.string().min(1)).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getCampaignById, updateCampaign, deleteQueryLocationsByCampaignId } = await import('./dbCampaigns');
        const { getBusinessById, updateBusiness } = await import('./db');
        const { parseLocations, serializeLocations } = await import('../shared/location');
        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) throw new Error('Campaign not found');
        const business = await getBusinessById(campaign.businessId);
        if (!business) throw new Error('Business not found');
        // 1. Merge locations
        if (input.additionalLocations && input.additionalLocations.length > 0) {
          const existing = parseLocations(business.location);
          const incoming = input.additionalLocations.map((l) => l.trim()).filter(Boolean);
          const merged = Array.from(
            new Map([...existing, ...incoming].map((l) => [l.toLowerCase(), l])).values()
          );
          await updateBusiness(business.id, { location: serializeLocations(merged) });
        }
        // 2. Replace seed keywords (specialties) with the clean list from the modal
        if (input.seedKeywords && input.seedKeywords.length > 0) {
          const clean = input.seedKeywords.map((k) => k.trim()).filter(Boolean).join(', ');
          await updateBusiness(business.id, { specialties: clean });
        }
        // 3. Clear existing query-location matrix
        const deleted = await deleteQueryLocationsByCampaignId(input.campaignId);
        console.log(`[rerunKeywordResearch] Deleted ${deleted} query-location rows for campaign ${input.campaignId}`);
        // 4. Reset keyword research timestamps so the pipeline treats this as fresh
        await updateCampaign(input.campaignId, {
          keywordResearchCompletedAt: null,
          baselineCheckCompletedAt: null,
        });
        // 5. Re-run keyword research
        const { runCampaignKeywordResearch } = await import('./keywordResearchPipeline');
        const result = await runCampaignKeywordResearch(input.campaignId);
        return {
          ...result,
          deletedQueryCount: deleted,
        };
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
        // Parse pre-supplied credibility URLs from the business record (BBB, certs, etc.)
        let parsedCredibilityUrls: Array<{ label: string; url: string }> | undefined;
        try {
          const raw = (business as any).credibilityUrls;
          if (raw) parsedCredibilityUrls = JSON.parse(raw);
        } catch { /* ignore parse errors */ }
        return runCredibilityResearch({
          userId: ctx.user.id,
          businessId: campaign.businessId,
          campaignId: input.campaignId,
          businessName: business.name,
          websiteUrl: business.website || "",
          industry: business.businessType || "",
          location: business.location || "",
          credibilityUrls: parsedCredibilityUrls,
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
          campaignScope: (campaign as any).campaignScope ?? "local",
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
        const pages = await getContentPagesForCampaign(input.campaignId);
        return {
          pages,
          llmTxtVerified: (campaign as any).llmTxtVerified ?? false,
          schemaVerified: (campaign as any).schemaVerified ?? false,
        };
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
          // All pages now have URLs. Mark publishing complete first — the manual-copy
          // publishing branch intentionally pauses without setting publishingCompletedAt,
          // so without this the Publish step shows "in progress" forever for manual-copy
          // clients even after every live URL has been entered.
          const { campaigns: campaignsTable } = await import("../drizzle/schema");
          await db.update(campaignsTable)
            .set({ publishingCompletedAt: new Date(), updatedAt: new Date() })
            .where(eq(campaignsTable.id, updatedPage.campaignId));
          // Auto-kick off indexing step
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

    /**
     * Regenerate the llm.txt for an existing campaign using the rich generator.
     * This is used for campaigns that were created before the rich llm.txt generator
     * was introduced, or when business profile data has been updated.
     */
    regenerateLlmTxt: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new Error("Admin access required");
        const { getDb, getBusinessById } = await import("./db");
        const { getCampaignById, getCredibilityDataByBusinessId } = await import("./dbCampaigns");
        const { buildRichLlmTxt, getContentPagesForCampaign } = await import("./contentGenerationEngine");
        const { contentPages: cpTable } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) throw new Error("Campaign not found");

        const business = await getBusinessById(campaign.businessId);
        if (!business) throw new Error("Business not found");

        // Load credibility data to pass to the rich generator
        const credData = await getCredibilityDataByBusinessId(business.id);
        if (!credData) throw new Error("Credibility data not found — run credibility research first");

        // Reconstruct a CredibilityResearchResult-compatible shape from stored data.
        // The credibilityData table stores the full research output in researchResults (JSON).
        const researchResults = (credData.researchResults as any) ?? {};
        const credibilityResult = {
          businessName: business.name,
          industry: business.businessType ?? "",
          overallScore: credData.credibilityScore ?? 0,
          facts: (researchResults.facts ?? []) as any[],
          suggestedPages: (researchResults.suggestedPages ?? []) as any[],
          llmTxtContent: "",
          schemaMarkupRecommendations: (researchResults.schemaMarkupRecommendations ?? []) as any[],
          researchSummary: researchResults.researchSummary ?? "",
          researchedAt: credData.researchCompletedAt?.toISOString() ?? new Date().toISOString(),
        };

        // Get the already-generated content pages (for Important Pages section)
        const allPages = await getContentPagesForCampaign(input.campaignId);
        const generatedPages = allPages
          .filter((p: any) => !["llm_txt", "schema_package", "schema_audit", "schema_delivery"].includes(p.pageType))
          .map((p: any) => ({
            pageType: p.pageType,
            pageTitle: p.pageTitle,
            pageSlug: p.pageSlug,
            pageContent: p.pageContent ?? "",
            metaDescription: p.metaDescription ?? "",
            schemaMarkup: p.schemaMarkup ?? "",
            interlinkTargets: p.interlinkTargets ?? [],
            deliveryType: (p.deliveryType ?? "new_page") as "new_page" | "inject_existing",
          }));

        const richContent = await buildRichLlmTxt({
          businessId: business.id,
          campaignId: input.campaignId,
          businessName: business.name,
          websiteUrl: business.website ?? "",
          industry: business.businessType ?? "",
          location: business.location ?? "",
          credibilityResult,
          generatedPages,
          campaignScope: (campaign as any).campaignScope ?? "local",
        });

        // Upsert the llm.txt content page
        const [existing] = await db
          .select({ id: cpTable.id })
          .from(cpTable)
          .where(and(eq(cpTable.campaignId, input.campaignId), eq(cpTable.pageType, "llm_txt")))
          .limit(1);

        if (existing) {
          await db.update(cpTable)
            .set({ pageContent: richContent, updatedAt: new Date() })
            .where(eq(cpTable.id, existing.id));
        } else {
          await db.insert(cpTable).values({
            businessId: business.id,
            campaignId: input.campaignId,
            pageType: "llm_txt",
            pageTitle: "llm.txt",
            pageSlug: "llm.txt",
            pageContent: richContent,
            status: "generated",
            generationModel: "system",
          });
        }

        return { success: true, contentLength: richContent.length };
      }),
    getPageTypeConfigs: protectedProcedure
      .query(async () => {
        const { getPageTypeConfigs } = await import("./contentGenerationEngine");
        return getPageTypeConfigs();
      }),

    /**
     * Save updated gap field values into the schema_delivery content page
     * and regenerate the delivery plan with the new values.
     */
    updateSchemaGapFields: protectedProcedure
      .input(z.object({
        campaignId: z.number(),
        gapFields: z.array(z.object({
          field: z.string(),
          value: z.string(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Admin access required");
        }
        const { getDb } = await import("./db");
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const { contentPages: cpTable } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        // Load the existing delivery plan
        const [deliveryPage] = await db
          .select()
          .from(cpTable)
          .where(and(eq(cpTable.campaignId, input.campaignId), eq(cpTable.pageType, "schema_delivery")))
          .limit(1);
        if (!deliveryPage) throw new Error("Schema delivery plan not found. Run content generation first.");

        const plan = JSON.parse(deliveryPage.pageContent || "{}");

        // Apply the updated gap field values into the plan
        const updatedGapFields = (plan.gapFields || []).map((gf: any) => {
          const update = input.gapFields.find((u) => u.field === gf.field);
          return update ? { ...gf, currentValue: update.value } : gf;
        });
        const updatedPlan = { ...plan, gapFields: updatedGapFields };

        // Save the updated plan back to the DB
        await db
          .update(cpTable)
          .set({ pageContent: JSON.stringify(updatedPlan, null, 2), updatedAt: new Date() })
          .where(eq(cpTable.id, deliveryPage.id));

        return { success: true, updatedFields: input.gapFields.length };
      }),

    /**
     * Regenerate only the schema markup (audit + package + delivery plan)
     * for a campaign without touching existing content pages.
     * Safe to run on campaigns that already have published content.
     */
    regenerateSchema: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user.role !== "admin") throw new Error("Admin access required");

        const { getDb, getBusinessById } = await import("./db");
        const { getCampaignById } = await import("./dbCampaigns");
        const { buildSchemaPackageForBusiness, schemaPackageToString } = await import("./schemaMarkupEngine");
        const { auditSiteSchema } = await import("./siteSchemaAuditor");
        const { buildSchemaDeliveryPlan, serializeDeliveryPlan } = await import("./schemaDeliveryEngine");
        const { contentPages: cpTable } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");

        const db = await getDb();
        if (!db) throw new Error("Database not available");

        const campaign = await getCampaignById(input.campaignId);
        if (!campaign) throw new Error("Campaign not found");

        const business = await getBusinessById(campaign.businessId);
        if (!business) throw new Error("Business not found");

        const websiteUrl = business.website ?? "";
        const businessName = business.name;

        // ── Step 1: Audit existing schema on the client's site ────────────────
        let auditResult = null;
        if (websiteUrl) {
          try {
            auditResult = await auditSiteSchema(websiteUrl);
          } catch (e: any) {
            console.warn(`[regenerateSchema] Audit failed (non-fatal): ${e.message}`);
          }
        }

        // ── Step 2: Build the schema package from business + credibility data ─
        const schemaPkg = await buildSchemaPackageForBusiness(business.id, input.campaignId);
        if (!schemaPkg) throw new Error("Schema package could not be built — check business data");

        const schemaContent = schemaPackageToString(schemaPkg);

        // Upsert schema_package
        const [existingPkg] = await db.select({ id: cpTable.id })
          .from(cpTable)
          .where(and(eq(cpTable.campaignId, input.campaignId), eq(cpTable.pageType, "schema_package")))
          .limit(1);

        if (existingPkg) {
          await db.update(cpTable)
            .set({ pageContent: schemaContent, schemaMarkup: JSON.stringify(schemaPkg.siteWideSchema), updatedAt: new Date() })
            .where(eq(cpTable.id, existingPkg.id));
        } else {
          await db.insert(cpTable).values({
            businessId: business.id,
            campaignId: input.campaignId,
            pageType: "schema_package",
            pageTitle: "Schema Markup Package",
            pageSlug: "schema",
            pageContent: schemaContent,
            schemaMarkup: JSON.stringify(schemaPkg.siteWideSchema),
            status: "draft",
            deliveryType: "inject_existing",
            placementInstructions: `Paste the SITE-WIDE SCHEMA block into the <head> of every page on the client's site. Paste each per-page schema block into the corresponding page. Summary: ${schemaPkg.summary}`,
            generationModel: "system",
            generationPrompt: `Schema package for ${businessName}`,
          });
        }

        // ── Step 3: Build delivery plan (requires audit) ──────────────────────
        if (auditResult) {
          const deliveryPlan = buildSchemaDeliveryPlan(
            auditResult,
            schemaPkg,
            {
              name: businessName,
              phone: business.phone ?? null,
              address: business.address ?? null,
              website: websiteUrl,
              description: business.description ?? null,
            }
          );

          // Upsert schema_audit
          const [existingAudit] = await db.select({ id: cpTable.id })
            .from(cpTable)
            .where(and(eq(cpTable.campaignId, input.campaignId), eq(cpTable.pageType, "schema_audit")))
            .limit(1);
          const auditJson = JSON.stringify(auditResult, null, 2);
          if (existingAudit) {
            await db.update(cpTable).set({ pageContent: auditJson, updatedAt: new Date() }).where(eq(cpTable.id, existingAudit.id));
          } else {
            await db.insert(cpTable).values({
              businessId: business.id,
              campaignId: input.campaignId,
              pageType: "schema_audit",
              pageTitle: "Schema Site Audit",
              pageSlug: "schema-audit",
              pageContent: auditJson,
              status: "draft",
              deliveryType: "inject_existing",
              placementInstructions: `Audit of existing schema on ${websiteUrl}. Delivery mode: ${auditResult.deliveryMode}.`,
              generationModel: "system",
            });
          }

          // Upsert schema_delivery
          const [existingDelivery] = await db.select({ id: cpTable.id })
            .from(cpTable)
            .where(and(eq(cpTable.campaignId, input.campaignId), eq(cpTable.pageType, "schema_delivery")))
            .limit(1);
          const deliveryJson = serializeDeliveryPlan(deliveryPlan);
          if (existingDelivery) {
            await db.update(cpTable).set({ pageContent: deliveryJson, updatedAt: new Date() }).where(eq(cpTable.id, existingDelivery.id));
          } else {
            await db.insert(cpTable).values({
              businessId: business.id,
              campaignId: input.campaignId,
              pageType: "schema_delivery",
              pageTitle: "Schema Delivery Plan",
              pageSlug: "schema-delivery",
              pageContent: deliveryJson,
              status: "draft",
              deliveryType: "inject_existing",
              placementInstructions: deliveryPlan.auditSummary,
              generationModel: "system",
            });
          }

          return {
            success: true,
            mode: "full",
            deliveryMode: auditResult.deliveryMode,
            blockCount: deliveryPlan.actionCount,
            gapFieldCount: deliveryPlan.gapFields.length,
          };
        }

        // No audit result — schema_package only
        return { success: true, mode: "package_only", deliveryMode: "full_replace", blockCount: 0, gapFieldCount: 0 };
      }),

    // Update the HTML content of a content page (allows editing links/text even after page is published)
    updateContentPageContent: protectedProcedure
      .input(z.object({
        pageId: z.number(),
        pageContent: z.string().min(1, 'Content cannot be empty'),
      }))
      .mutation(async ({ ctx, input }) => {
        const { getDb } = await import('./db');
        const { contentPages: cpTable, campaigns: campaignsTable, businesses: bizTable } = await import('../drizzle/schema');
        const { eq, and } = await import('drizzle-orm');
        const db = await getDb();
        if (!db) throw new Error('Database not available');
        // Find the page and verify it belongs to the current user's agency
        const [page] = await db
          .select({ id: cpTable.id, campaignId: cpTable.campaignId })
          .from(cpTable)
          .where(eq(cpTable.id, input.pageId))
          .limit(1);
        if (!page || !page.campaignId) throw new Error('Content page not found');
        // Admins can edit any page; agency users can only edit their own
        if (ctx.user.role !== 'admin') {
          const { getAgencyByUserId } = await import('./dbAgencies');
          const agency = await getAgencyByUserId(ctx.user.id);
          if (!agency) throw new Error('Agency not found');
          const [campaign] = await db
            .select({ id: campaignsTable.id })
            .from(campaignsTable)
            .innerJoin(bizTable, eq(bizTable.id, campaignsTable.businessId))
            .where(and(eq(campaignsTable.id, page.campaignId), eq(bizTable.agencyId, agency.id)))
            .limit(1);
          if (!campaign) throw new Error('Not authorized to update this page');
        }
        await db
          .update(cpTable)
          .set({ pageContent: input.pageContent, updatedAt: new Date() })
          .where(eq(cpTable.id, input.pageId));
        return { success: true };
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

    // Bonus query discovery results for a campaign
    getBonusResults: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { bonusQueryResults } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(bonusQueryResults)
          .where(eq(bonusQueryResults.campaignId, input.campaignId))
          .orderBy(desc(bonusQueryResults.scanRunAt))
          .limit(500);
      }),

    // Bonus query discovery results via client dashboard token (public)
    getBonusResultsByToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { bonusQueryResults, clientDashboards } = await import("../drizzle/schema");
        const { eq, desc, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        const [dashboard] = await db
          .select({ campaignId: clientDashboards.campaignId })
          .from(clientDashboards)
          .where(and(eq(clientDashboards.accessToken, input.token), eq(clientDashboards.isActive, true)))
          .limit(1);
        if (!dashboard?.campaignId) return [];
        return db
          .select()
          .from(bonusQueryResults)
          .where(eq(bonusQueryResults.campaignId, dashboard.campaignId))
          .orderBy(desc(bonusQueryResults.scanRunAt))
          .limit(500);
      }),

    // Drop-off events for a campaign (admin)
    getDropoffEvents: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { queryDropoffEvents } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        return db
          .select()
          .from(queryDropoffEvents)
          .where(eq(queryDropoffEvents.campaignId, input.campaignId))
          .orderBy(desc(queryDropoffEvents.detectedAt))
          .limit(200);
      }),

    // Drop-off events via client dashboard token (public)
    getDropoffEventsByToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const { getDb } = await import("./db");
        const { queryDropoffEvents, clientDashboards, campaignQueryLocations } = await import("../drizzle/schema");
        const { eq, desc, and } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) return [];
        const [dashboard] = await db
          .select({ campaignId: clientDashboards.campaignId })
          .from(clientDashboards)
          .where(and(eq(clientDashboards.accessToken, input.token), eq(clientDashboards.isActive, true)))
          .limit(1);
        if (!dashboard?.campaignId) return [];
        // Only return drop-offs for the original paid queries (isTargetLocation=true).
        // Bonus-win queries that later dropped are NOT re-optimized and should NOT
        // appear on the client dashboard as a visibility drop alert.
        return db
          .select({ 
            id: queryDropoffEvents.id,
            campaignId: queryDropoffEvents.campaignId,
            queryLocationId: queryDropoffEvents.queryLocationId,
            platform: queryDropoffEvents.platform,
            searchQuery: queryDropoffEvents.searchQuery,
            location: queryDropoffEvents.location,
            detectedAt: queryDropoffEvents.detectedAt,
            reoptimizationInitiated: queryDropoffEvents.reoptimizationInitiated,
            reoptimizationInitiatedAt: queryDropoffEvents.reoptimizationInitiatedAt,
            recoveredAt: queryDropoffEvents.recoveredAt,
            createdAt: queryDropoffEvents.createdAt,
          })
          .from(queryDropoffEvents)
          .innerJoin(
            campaignQueryLocations,
            and(
              eq(queryDropoffEvents.queryLocationId, campaignQueryLocations.id),
              eq(campaignQueryLocations.isTargetLocation, true)
            )
          )
          .where(eq(queryDropoffEvents.campaignId, dashboard.campaignId))
          .orderBy(desc(queryDropoffEvents.detectedAt))
          .limit(200);
      }),

    // Trigger a bonus scan manually (admin)
    runBonusScan: protectedProcedure
      .input(z.object({ campaignId: z.number() }))
      .mutation(async ({ input }) => {
        const { runBonusQueryScan } = await import("./bonusQueryScanner");
        return runBonusQueryScan(input.campaignId);
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
              { query: "best hvac repair near me", platform: "ChatGPT" },
              { query: "ac installation dallas", platform: "Gemini" },
            ],
            reportPeriod: "March 2026",
          }),
        };
      }),
   }),

  // ── Content Publishing Gate ──────────────────────────────────────────────────
  // Verify that llm.txt, schema, and all content page URLs are live on the client site.
  // Called automatically when the agency/admin checks the verification checkbox.
  verifyCampaignContent: protectedProcedure
    .input(z.object({ campaignId: z.number(), scanType: z.enum(['llm', 'schema', 'both']).default('both') }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { campaigns, businesses } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const [campaign] = await db
        .select({ id: campaigns.id, businessId: campaigns.businessId, llmTxtVerified: campaigns.llmTxtVerified, schemaVerified: campaigns.schemaVerified })
        .from(campaigns)
        .where(eq(campaigns.id, input.campaignId))
        .limit(1);
      if (!campaign) throw new Error('Campaign not found');

      const [business] = await db
        .select({ id: businesses.id, website: businesses.website, agencyId: businesses.agencyId })
        .from(businesses)
        .where(eq(businesses.id, campaign.businessId))
        .limit(1);
      if (!business) throw new Error('Business not found');

      if (ctx.user.role !== 'admin') {
        const { getAgencyByUserId } = await import('./dbAgencies');
        const agency = await getAgencyByUserId(ctx.user.id);
        if (!agency || agency.id !== business.agencyId) throw new Error('Forbidden');
      }

      const { verifyCampaignContent } = await import('./contentVerifier');
      const result = await verifyCampaignContent({
        campaignId: input.campaignId,
        websiteUrl: business.website || '',
        scanType: input.scanType,
      });

      // Persist only the fields that were scanned — don't overwrite the other
      const updateFields: Record<string, any> = { updatedAt: new Date() };
      if (input.scanType === 'llm' || input.scanType === 'both') {
        updateFields.llmTxtVerified = result.llmTxt.detected;
      }
      if (input.scanType === 'schema' || input.scanType === 'both') {
        updateFields.schemaVerified = result.schema.detected;
      }
      await db
        .update(campaigns)
        .set(updateFields)
        .where(eq(campaigns.id, input.campaignId));

      return result;
    }),

  // Super admin only: pause all campaigns that are in training/monitoring but have
  // unpublished content pages (no URL entered). Run once after deploy.
  pauseCampaignsWithUnpublishedContent: protectedProcedure
    .mutation(async ({ ctx }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden — super admin only');
      const { getDb } = await import('./db');
      const { campaigns, contentPages } = await import('../drizzle/schema');
      const { eq, inArray } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      const NO_URL_REQUIRED = ['llm_txt', 'schema_package', 'schema_audit', 'schema_delivery'];

      const activeCampaigns = await db
        .select({ id: campaigns.id, status: campaigns.status })
        .from(campaigns)
        .where(
          inArray(campaigns.status as any, ['training', 'monitoring', 'indexing', 'indexing_verification'])
        );

      const toPause: number[] = [];

      for (const c of activeCampaigns) {
        const pages = await db
          .select({ id: contentPages.id, pageType: contentPages.pageType, publishedUrl: contentPages.publishedUrl })
          .from(contentPages)
          .where(eq(contentPages.campaignId, c.id));

        const hasMissing = pages.some(
          (p: any) => !NO_URL_REQUIRED.includes(p.pageType ?? '') && !p.publishedUrl
        );

        if (hasMissing) toPause.push(c.id);
      }

      if (toPause.length > 0) {
        await db
          .update(campaigns)
          .set({ status: 'publishing', updatedAt: new Date() } as any)
          .where(inArray(campaigns.id, toPause));
      }

      return { paused: toPause.length, campaignIds: toPause };
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
      billingType: z.string().optional(), // Filter by billing type
      agencyId: z.number().optional(), // Filter by agency
    }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const { campaignQueryLocations, campaigns, businesses, agencies } = await import("../drizzle/schema");
      const { eq, sql, and } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];

      const conditions = [];
      if (input.campaignId) conditions.push(eq(campaignQueryLocations.campaignId, input.campaignId));
      if (input.billingType === 'no_charge') {
        const { isNotNull } = await import("drizzle-orm");
        // noCharge is a runtime-added column; use sql cast
        conditions.push(sql`${campaigns.noCharge} = true`);
      } else if (input.billingType) {
        conditions.push(eq(campaigns.billingType, input.billingType as any));
      }
      if (input.agencyId) conditions.push(eq(businesses.agencyId, input.agencyId));

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
          isTargetLocation: campaignQueryLocations.isTargetLocation,
          businessName: businesses.name,
          campaignName: campaigns.campaignName,
          businessType: businesses.businessType,
          billingType: campaigns.billingType,
          noCharge: campaigns.noCharge,
          agencyId: businesses.agencyId,
          agencyName: agencies.name,
        })
        .from(campaignQueryLocations)
        .leftJoin(campaigns, eq(campaignQueryLocations.campaignId, campaigns.id))
        .leftJoin(businesses, eq(campaigns.businessId, businesses.id))
        .leftJoin(agencies, eq(businesses.agencyId, agencies.id))
        // Show ALL tracked queries. Previously this hid any query whose
        // aiSearchVolume was null, which made a campaign read "N queries tracked"
        // in the summary but show an empty table (queries created without AI-volume
        // data, e.g. via the intake webhook). Order by volume with nulls last so
        // volume-ranked queries stay on top and no-volume ones still appear.
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(sql`${campaignQueryLocations.aiSearchVolume} desc nulls last`)
        .limit(input.limit);

      return query;
    }),

  /**
   * Delete a tracked query (campaignQueryLocation). Its rank snapshots cascade
   * away via the FK. Used by the "remove query" control on LLM Insights.
   */
  deleteQueryLocation: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const { campaignQueryLocations } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(campaignQueryLocations).where(eq(campaignQueryLocations.id, input.id));
      return { success: true };
    }),

  /**
   * Update a single query-location row (rename the searchQuery).
   * Used by the Query Review UI to let admins edit generated queries.
   */
  updateQueryLocation: protectedProcedure
    .input(z.object({
      id: z.number(),
      searchQuery: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const { updateQueryLocation } = await import('./dbCampaigns');
      return updateQueryLocation(input.id, { searchQuery: input.searchQuery });
    }),

  /**
   * Approve the query review step for a campaign — sets status back to
   * keyword_research_complete so the pipeline can continue from credibility_research.
   * Optionally runs the next pipeline step immediately.
   */
  approveQueryReview: protectedProcedure
    .input(z.object({
      campaignId: z.number(),
      runNext: z.boolean().optional().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const { updateCampaign, getCampaignById } = await import('./dbCampaigns');
      const campaign = await getCampaignById(input.campaignId);
      if (!campaign) throw new Error('Campaign not found');
      if (campaign.status !== 'query_review') throw new Error('Campaign is not in query_review status');
      // Mark query review as approved by advancing status
      await updateCampaign(input.campaignId, { status: 'credibility_research' });
      if (input.runNext) {
        // Run the full pipeline from credibility_research onward
        const { runFullPipeline } = await import('./pipelineOrchestrator');
        runFullPipeline(input.campaignId, ctx.user.id).catch((err: any) => {
          console.error('[approveQueryReview] Pipeline error:', err.message);
        });
      }
      return { success: true };
    }),

  /**
   * Fetch AI search volume from DataForSEO for a campaign's tracked queries and
   * write it onto each query-location. Used by the "Refresh AI volume" button —
   * fills the AI Vol column for queries that were added without volume data.
   */
  refreshAiVolume: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const { campaignQueryLocations } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { getAIKeywordSearchVolume, getGoogleAdsSearchVolume } = await import("./dataforseoService");
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const qls = await db
        .select()
        .from(campaignQueryLocations)
        .where(eq(campaignQueryLocations.campaignId, input.campaignId));
      if (qls.length === 0) return { updated: 0, checked: 0 };

      // Build final query+location strings (same as what the LLM checks use)
      const finalStrings = qls.map((q) =>
        q.location ? `${q.searchQuery} ${q.location}` : q.searchQuery
      );

      // Pass 1: AI volume on final query+location strings
      const aiVolumeMap = new Map<string, number>();
      try {
        const volumes = await getAIKeywordSearchVolume(finalStrings);
        for (const v of volumes) {
          if (v.aiSearchVolume > 0) aiVolumeMap.set(v.keyword.toLowerCase(), v.aiSearchVolume);
        }
      } catch (err: any) {
        console.warn("[refreshAiVolume] AI volume fetch failed:", err.message);
      }

      // Pass 2: Google Ads × 25% fallback for zero-AI-volume queries
      const needsFallback = finalStrings.filter((s) => !aiVolumeMap.has(s.toLowerCase()));
      const fallbackMap = new Map<string, number>();
      if (needsFallback.length > 0) {
        try {
          const googleMap = await getGoogleAdsSearchVolume(needsFallback);
          for (const [k, v] of googleMap.entries()) {
            if (v > 0) fallbackMap.set(k, Math.round(v * 0.25));
          }
        } catch (err: any) {
          console.warn("[refreshAiVolume] Google Ads fallback failed:", err.message);
        }
      }

      let updated = 0;
      for (let i = 0; i < qls.length; i++) {
        const q = qls[i];
        const key = finalStrings[i].toLowerCase();
        const aiVol = aiVolumeMap.get(key) ?? 0;
        const fallbackVol = fallbackMap.get(key) ?? 0;
        const finalVolume = aiVol > 0 ? aiVol : (fallbackVol > 0 ? fallbackVol : Math.round(100 * 0.25));
        await db
          .update(campaignQueryLocations)
          .set({ aiSearchVolume: finalVolume, updatedAt: new Date() })
          .where(eq(campaignQueryLocations.id, q.id));
        updated++;
      }
      return { updated, checked: finalStrings.length };
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
        // 'monitoring' = achieved + in weekly maintenance; 'achieved' = just hit the target.
        // Both count as "achieved" for the dashboard counter.
        achievedCount: sql<number>`sum(case when ${campaignQueryLocations.trainingStatus} in ('achieved', 'monitoring') then 1 else 0 end)`,
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

  /**
   * Trigger a manual LLM rank check for a specific campaign.
   * Runs the same logic as the scheduled check but on demand.
   * Returns the number of snapshots created and any new wins detected.
   */
  manualScan: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new Error("Admin access required");
      const { runScheduledRankCheck } = await import("./rankTrackingEngine");
      const result = await runScheduledRankCheck(input.campaignId);
      return {
        success: result.success,
        snapshotsCreated: result.snapshotsCreated,
        winsDetected: result.winsDetected.length,
        error: result.error,
      };
    }),

  /**
   * Get the scan history (rank snapshots) for a single query-location.
   * Used by the history drawer in LLM Insights.
   */
  queryHistory: protectedProcedure
    .input(z.object({ queryLocationId: z.number(), limit: z.number().min(1).max(100).default(30) }))
    .query(async ({ input }) => {
      const { getDb } = await import("./db");
      const { rankSnapshots } = await import("../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];
      return db
        .select({
          id: rankSnapshots.id,
          checkedAt: rankSnapshots.checkedAt,
          checkType: rankSnapshots.checkType,
          chatgptMentioned: rankSnapshots.chatgptMentioned,
          geminiMentioned: rankSnapshots.geminiMentioned,
          aiOverviewMentioned: rankSnapshots.aiOverviewMentioned,
          chatgptPosition: rankSnapshots.chatgptPosition,
          geminiPosition: rankSnapshots.geminiPosition,
          aiOverviewPosition: rankSnapshots.aiOverviewPosition,
        })
        .from(rankSnapshots)
        .where(eq(rankSnapshots.queryLocationId, input.queryLocationId))
        .orderBy(desc(rankSnapshots.checkedAt))
        .limit(input.limit);
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
    const { getAgencyByUserId, getAgencyById } = await import('./dbAgencies');
    // If a super-admin is impersonating an agency, return that agency's record
    if (ctx.impersonatedAgencyId && ctx.user?.role === 'admin') {
      return getAgencyById(ctx.impersonatedAgencyId);
    }
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
      // Lead capture widget settings
      webhookUrl: z.string().optional().nullable(),
      calendarEmbedCode: z.string().optional().nullable(),
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
      // Agency user can update their own branding + API keys + lead widget settings
      const myAgency = await getAgencyByUserId(ctx.user.id);
      if (!myAgency || myAgency.id !== id) throw new Error('Forbidden');
      const { brandName, brandLogoUrl, brandFromName, agencyOpenAiKey, agencyGeminiKey, webhookUrl, calendarEmbedCode } = processedUpdates;
      return updateAgency(id, { brandName, brandLogoUrl, brandFromName, agencyOpenAiKey, agencyGeminiKey, webhookUrl, calendarEmbedCode });
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
    const { getAgencyByUserId, getAgencyById } = await import('./dbAgencies');
    const { businesses, campaigns } = await import('../drizzle/schema');
    const { eq, sql, and } = await import('drizzle-orm');
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) return [];
    // Impersonation: super-admin viewing as an agency
    let agencyId: number | null = null;
    if (ctx.impersonatedAgencyId && ctx.user?.role === 'admin') {
      agencyId = ctx.impersonatedAgencyId;
    } else {
      const agency = await getAgencyByUserId(ctx.user.id);
      if (!agency) return [];
      agencyId = agency.id;
    }
    // Fetch all clients for this agency
    const clientRows = await db.select().from(businesses).where(eq(businesses.agencyId, agencyId));
    if (clientRows.length === 0) return [];
    // For each client, check campaigns: count, status, and whether any are blocked
    const businessIds = clientRows.map((b) => b.id);
    const campaignRows = await db
      .select({
        id: campaigns.id,
        businessId: campaigns.businessId,
        status: campaigns.status,
        llmTxtVerified: campaigns.llmTxtVerified,
        schemaVerified: campaigns.schemaVerified,
      })
      .from(campaigns)
      .where(sql`${campaigns.businessId} = ANY(ARRAY[${sql.raw(businessIds.join(','))}]::int[])`);

    // Fetch missing URL counts for all campaigns in one aggregated query
    const { contentPages: cpAgency } = await import('../drizzle/schema');
    const campaignIds = campaignRows.map((c: any) => c.id).filter(Boolean);
    const missingUrlMap = new Map<number, number>();
    if (campaignIds.length > 0) {
      const missingRows = await db
        .select({
          campaignId: cpAgency.campaignId,
          missingCount: sql<number>`count(*)`,
        })
        .from(cpAgency)
        .where(
          and(
            sql`${cpAgency.campaignId} = ANY(ARRAY[${sql.raw(campaignIds.join(','))}]::int[])`,
            sql`${cpAgency.pageType} NOT IN ('llm_txt','schema_package','schema_audit','schema_delivery')`,
            sql`${cpAgency.publishedUrl} IS NULL`
          )
        )
        .groupBy(cpAgency.campaignId);
      for (const row of missingRows) {
        if (row.campaignId != null) missingUrlMap.set(row.campaignId, Number(row.missingCount));
      }
    }

    // Build per-business maps
    const campaignCountMap = new Map<number, number>();
    const campaignStatusMap = new Map<number, string>();
    const campaignBlockedMap = new Map<number, boolean>();
    for (const row of campaignRows) {
      if (!row.businessId) continue;
      campaignCountMap.set(row.businessId, (campaignCountMap.get(row.businessId) ?? 0) + 1);
      // Track most recent status (last write wins — rows are ordered by insert)
      campaignStatusMap.set(row.businessId, row.status ?? 'unknown');
      // Blocked if: any content pages missing a live URL OR llm.txt/schema not yet verified via scan
      const missingUrlCount = missingUrlMap.get(row.id) ?? 0;
      const isBlocked =
        missingUrlCount > 0 ||
        row.llmTxtVerified === false ||
        row.schemaVerified === false;
      if (isBlocked) campaignBlockedMap.set(row.businessId, true);
    }
    return clientRows.map((b) => ({
      ...b,
      hasCampaign: (campaignCountMap.get(b.id) ?? 0) > 0,
      campaignStatus: campaignStatusMap.get(b.id) ?? null,
      campaignBlocked: campaignBlockedMap.get(b.id) ?? false,
    }));
  }),

  // Agency: get all client dashboard links for this agency's clients
  myClientDashboards: protectedProcedure.query(async ({ ctx }) => {
    const { getAgencyByUserId, getAgencyById } = await import('./dbAgencies');
    const { businesses, clientDashboards } = await import('../drizzle/schema');
    const { eq, inArray, desc } = await import('drizzle-orm');
    const { getDb } = await import('./db');
    const db = await getDb();
    if (!db) return [];
    // Resolve agency (supports impersonation)
    let agencyId: number | null = null;
    if (ctx.impersonatedAgencyId && ctx.user?.role === 'admin') {
      agencyId = ctx.impersonatedAgencyId;
    } else {
      const agency = await getAgencyByUserId(ctx.user.id);
      if (!agency) return [];
      agencyId = agency.id;
    }
    // Get all business IDs for this agency
    const clientRows = await db.select({ id: businesses.id, name: businesses.name, website: businesses.website })
      .from(businesses).where(eq(businesses.agencyId, agencyId));
    if (clientRows.length === 0) return [];
    const businessIds = clientRows.map((b) => b.id);
    // Get all active dashboards for those businesses
    const dashRows = await db.select({
      id: clientDashboards.id,
      businessId: clientDashboards.businessId,
      accessToken: clientDashboards.accessToken,
      dashboardTitle: clientDashboards.dashboardTitle,
      isActive: clientDashboards.isActive,
      accessCount: clientDashboards.accessCount,
      lastAccessedAt: clientDashboards.lastAccessedAt,
      createdAt: clientDashboards.createdAt,
    }).from(clientDashboards)
      .where(inArray(clientDashboards.businessId, businessIds))
      .orderBy(desc(clientDashboards.createdAt));
    // Attach business name
    const bizMap = new Map(clientRows.map((b) => [b.id, b]));
    return dashRows.map((d) => ({
      ...d,
      businessName: bizMap.get(d.businessId!)?.name ?? null,
      businessWebsite: bizMap.get(d.businessId!)?.website ?? null,
    }));
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
      specialties: z.string().optional(),
      credibilityUrls: z.string().optional(), // JSON string: [{label,url}]
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
      // ── Contact info ── (required so reports can be delivered)
      contactName: z.string().min(1, "Contact name is required"),
      contactEmail: z.string().email("A valid contact email is required"),
      // ── Credibility data ──
      yearsInBusiness: z.number().int().positive().optional(),
      certifications: z.string().optional(),
      licenses: z.string().optional(),
      awards: z.string().optional(),
      warranties: z.string().optional(),
      bbbRating: z.string().optional(),
      differentiators: z.string().optional(),
      specialties: z.string().optional(),
      credibilityUrls: z.string().optional(), // JSON string: [{label,url}]
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
          // Resolve query-slot budget from tier (new model)
          const resolvedMaxQuerySlots = packageTier.maxQuerySlots || (packageTier.maxQueries * packageTier.maxLocations);
          // Create campaign
          const campaign = await createCampaign({
            userId: ownerId,
            businessId: input.businessId,
            packageTierId: packageTier.id,
            campaignName: `${business.name} - AI Visibility`,
            status: 'pending',
            trainingAggressiveness: 'aggressive',
            rankCheckFrequency: 'weekly',
            errorCount: 0,
            trialStatus: 'trial',
            maxQueries: packageTier.maxQueries,
            maxLocations: packageTier.maxLocations,
            maxQuerySlots: resolvedMaxQuerySlots,
            billingType: 'white_label',
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
      if (ctx.impersonatedAgencyId && ctx.user?.role === 'admin') {
        agencyId = ctx.impersonatedAgencyId;
      } else if (ctx.user.role !== 'admin') {
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
          isTargetLocation: campaignQueryLocations.isTargetLocation,
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
    if (ctx.impersonatedAgencyId && ctx.user?.role === 'admin') {
      agencyId = ctx.impersonatedAgencyId;
    } else if (ctx.user.role !== 'admin') {
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

  // Agency user: send a report link to a client via email
  sendReportEmail: protectedProcedure
    .input(z.object({
      dashboardId: z.number(),
      toEmail: z.string().email(),
      clientName: z.string().optional(),
      businessName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getDb } = await import('./db');
      const { clientDashboards, campaigns, businesses } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      // Fetch the dashboard/link record
      const [dash] = await db.select().from(clientDashboards).where(eq(clientDashboards.id, input.dashboardId)).limit(1);
      if (!dash || !dash.isActive) throw new Error('Report link not found or inactive');
      // Authorization check for non-admins
      let agencyRecord: any = null;
      if (ctx.user.role !== 'admin') {
        agencyRecord = await getAgencyByUserId(ctx.user.id);
        if (!agencyRecord) throw new Error('Forbidden');
        const [camp] = dash.campaignId
          ? await db.select().from(campaigns).where(eq(campaigns.id, dash.campaignId)).limit(1)
          : [undefined];
        const [biz] = camp
          ? await db.select().from(businesses).where(eq(businesses.id, camp.businessId)).limit(1)
          : [undefined];
        if (!biz || biz.agencyId !== agencyRecord.id) throw new Error('Forbidden');
      } else {
        // Admin: get agency from campaign if available
        if (dash.campaignId) {
          const [camp] = await db.select().from(campaigns).where(eq(campaigns.id, dash.campaignId)).limit(1);
          if (camp) {
            const [biz] = await db.select().from(businesses).where(eq(businesses.id, camp.businessId)).limit(1);
            if (biz?.agencyId) {
              const { getAgencyById } = await import('./dbAgencies');
              agencyRecord = await getAgencyById(biz.agencyId);
            }
          }
        }
      }
      const appUrl = process.env.APP_URL || 'https://app.aianswerforge.com';
      const reportUrl = `${appUrl}/report/${dash.accessToken}`;
      const agencyName = agencyRecord?.brandName || agencyRecord?.name || 'AI Answer Forge';
      const agencyLogoUrl = agencyRecord?.brandLogoUrl || null;
      const fromEmail = process.env.INTAKE_FROM_EMAIL || 'noreply@aianswerforge.com';
      const { Resend } = await import('resend');
      const { getServiceKey } = await import('./db');
      const { decrypt } = await import('./encryption');
      const resendRecord = await getServiceKey('resend').catch(() => null);
      const resendApiKey = resendRecord?.encryptedValue ? decrypt(resendRecord.encryptedValue) : process.env.RESEND_API_KEY;
      if (!resendApiKey) throw new Error('Resend API key not configured. Please add it in Settings → Service Keys.');
      const resend = new Resend(resendApiKey);
      const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
        <tr>
          <td style="background:#1d1d1f;padding:24px 32px;">
            ${agencyLogoUrl ? `<img src="${agencyLogoUrl}" alt="${agencyName}" style="height:36px;margin-bottom:8px;" />` : ''}
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">${agencyName}</p>
            <p style="margin:4px 0 0;color:#a1a1aa;font-size:13px;">AI Visibility Report</p>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 8px;font-size:20px;color:#111827;">Your AI Visibility Report is Ready</h2>
            ${input.clientName ? `<p style="margin:0 0 4px;color:#374151;font-size:14px;">Hi ${input.clientName},</p>` : ''}
            <p style="margin:0 0 24px;color:#6b7280;font-size:14px;line-height:1.6;">
              Your latest AI visibility report for <strong>${input.businessName || 'your business'}</strong> is now available. Click the button below to view your full report.
            </p>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td style="background:#2563eb;border-radius:6px;">
                  <a href="${reportUrl}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">View My Report →</a>
                </td>
              </tr>
            </table>
            <p style="margin:0;color:#9ca3af;font-size:12px;">Or copy this link: <a href="${reportUrl}" style="color:#2563eb;">${reportUrl}</a></p>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
            <p style="margin:0;color:#9ca3af;font-size:12px;">Powered by ${agencyName}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();
      await resend.emails.send({
        from: `${agencyName} <${fromEmail}>`,
        to: input.toEmail,
        subject: `Your AI Visibility Report — ${input.businessName || 'Your Business'}`,
        html,
      });
      return { success: true };
    }),

  // Upload a logo image for an agency — accepts base64 data URL, stores in Supabase Storage
  uploadLogo: protectedProcedure
    .input(z.object({
      agencyId: z.number().optional(), // optional — if omitted, uses the caller's own agency
      dataUrl: z.string().min(1),       // base64 data URL: "data:image/png;base64,..."
      fileName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId, updateAgency } = await import('./dbAgencies');

      // Parse the base64 data URL first (cheap validation before any DB work)
      const match = input.dataUrl.match(/^data:([a-zA-Z0-9/+]+);base64,(.+)$/);
      if (!match) throw new Error('Invalid data URL format');
      const [, mimeType, base64Data] = match;
      const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp', 'image/svg+xml'];
      if (!allowedTypes.includes(mimeType!)) throw new Error(`Unsupported image type: ${mimeType}`);
      const buffer = Buffer.from(base64Data!, 'base64');
      if (buffer.length > 5 * 1024 * 1024) throw new Error('Image too large — maximum 5MB');

      // Determine which agency this upload is for.
      // agencyId is provided when editing an existing agency (admin flow).
      // When creating a new agency the agencyId is not yet known — we upload the
      // file to a temporary path and return the URL; the caller stores it in form
      // state and it gets persisted when the agency is created/saved.
      let agencyId: number | null = null;
      if (input.agencyId !== undefined) {
        if (ctx.user.role !== 'admin') throw new Error('Forbidden — only super admin can upload for other agencies');
        agencyId = input.agencyId;
      } else {
        // Try to find the caller's own agency (agency-owner self-service path)
        const myAgency = await getAgencyByUserId(ctx.user.id);
        if (myAgency) agencyId = myAgency.id;
        // If still null the caller is an admin creating a brand-new agency —
        // we'll upload to a temp path and skip the DB persist step below.
        if (!agencyId && ctx.user.role !== 'admin') throw new Error('Agency not found');
      }

      const ext = mimeType!.split('/')[1]!.replace('svg+xml', 'svg');
      const fileName = input.fileName?.replace(/[^a-zA-Z0-9._-]/g, '_') || `logo.${ext}`;
      // Use agencyId in the path when known, otherwise use a temp folder keyed by userId.
      const pathSegment = agencyId ? `agency-logos/${agencyId}` : `agency-logos/tmp-user-${ctx.user.id}`;
      const storageKey = `${pathSegment}/${Date.now()}-${fileName}`;

      const { storagePut } = await import('./storage');
      const { url } = await storagePut(storageKey, buffer, mimeType!);

      // Immediately persist the logo URL on the agency record so it survives
      // even if the admin closes the form without clicking Save.
      if (agencyId) {
        await updateAgency(agencyId, { brandLogoUrl: url });
      }

      return { url };
    }),

  // Agency: create a Stripe Customer Portal session so the agency can manage their billing
  billingPortal: protectedProcedure
    .input(z.object({ returnUrl: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const agency = await getAgencyByUserId(ctx.user.id);
      if (!agency) throw new Error('Agency not found');
      if (!agency.stripeCustomerId) {
        throw new Error('No Stripe customer on file. Please contact support to set up billing.');
      }
      const { createBillingPortalSession } = await import('./stripeAgency');
      const returnUrl = input.returnUrl ?? 'https://app.roguebusinessmarketing.com/agency/settings';
      const { url } = await createBillingPortalSession({
        stripeCustomerId: agency.stripeCustomerId,
        returnUrl,
      });
      return { url };
    }),

  // Agency: get content pages for a client campaign (for self-publishing workflow)
  getClientContentPages: protectedProcedure
    .input(z.object({ campaignId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getDb } = await import('./db');
      const { contentPages, campaigns, businesses } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      // Resolve the agency — either impersonated or the caller's own
      const impersonatedAgencyId = (ctx as any).impersonatedAgencyId as number | undefined;
      let agencyId: number;
      if (impersonatedAgencyId) {
        if (ctx.user.role !== 'admin') throw new Error('Forbidden');
        agencyId = impersonatedAgencyId;
      } else {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (!agency) throw new Error('Agency not found');
        agencyId = agency.id;
      }
      // Verify the campaign belongs to a business owned by this agency
      const [campaign] = await db
        .select({ id: campaigns.id, businessId: campaigns.businessId, status: campaigns.status, llmTxtVerified: campaigns.llmTxtVerified, schemaVerified: campaigns.schemaVerified })
        .from(campaigns)
        .innerJoin(businesses, eq(businesses.id, campaigns.businessId))
        .where(and(eq(campaigns.id, input.campaignId), eq(businesses.agencyId, agencyId)))
        .limit(1);
      if (!campaign) throw new Error('Campaign not found or not accessible');
      // schema_audit is raw JSON for internal use only — hide it from agencies.
      // llm_txt, schema_package, schema_delivery are all actionable and surfaced.
      const HIDDEN_TYPES = new Set(['schema_audit']);
      const pages = await db
        .select()
        .from(contentPages)
        .where(eq(contentPages.campaignId, input.campaignId));
      const visiblePages = pages.filter(p => !HIDDEN_TYPES.has(p.pageType));
      // Enrich llm_txt and schema pages with canonical placement instructions if missing
      const enriched = visiblePages.map(p => {
        if (p.pageType === 'llm_txt' && !p.placementInstructions) {
          return {
            ...p,
            placementInstructions: 'Upload this file to the root of the client\'s domain at /llm.txt (e.g., https://clientsite.com/llm.txt). Upload via FTP/cPanel to the public_html folder, or use your hosting file manager.',
          };
        }
        if (p.pageType === 'schema_delivery' && !p.placementInstructions) {
          return {
            ...p,
            placementInstructions: 'Follow the delivery plan below. For each block marked "inject", paste the JSON-LD into the <head> of the corresponding page.',
          };
        }
        return p;
      });
      return {
        campaignStatus: campaign.status,
        llmTxtVerified: campaign.llmTxtVerified ?? false,
        schemaVerified: campaign.schemaVerified ?? false,
        pages: enriched,
      };
    }),

  // Agency: save a published URL for a content page (triggers indexing when all pages have URLs)
  setClientContentPageUrl: protectedProcedure
    .input(z.object({
      pageId: z.number(),
      publishedUrl: z.string().url('Must be a valid URL'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getDb } = await import('./db');
      const { contentPages, campaigns, businesses } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      // Resolve agency
      const impersonatedAgencyId = (ctx as any).impersonatedAgencyId as number | undefined;
      let agencyId: number;
      if (impersonatedAgencyId) {
        if (ctx.user.role !== 'admin') throw new Error('Forbidden');
        agencyId = impersonatedAgencyId;
      } else {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (!agency) throw new Error('Agency not found');
        agencyId = agency.id;
      }
      // Verify the page belongs to a campaign under this agency
      const [page] = await db
        .select({ id: contentPages.id, campaignId: contentPages.campaignId })
        .from(contentPages)
        .where(eq(contentPages.id, input.pageId))
        .limit(1);
      if (!page || !page.campaignId) throw new Error('Content page not found');
      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .innerJoin(businesses, eq(businesses.id, campaigns.businessId))
        .where(and(eq(campaigns.id, page.campaignId), eq(businesses.agencyId, agencyId)))
        .limit(1);
      if (!campaign) throw new Error('Not authorized to update this page');
      // Save the URL and mark page as published
      await db
        .update(contentPages)
        .set({
          publishedUrl: input.publishedUrl,
          status: 'published',
          publishedAt: new Date(),
          publishError: null,
          updatedAt: new Date(),
        })
        .where(eq(contentPages.id, input.pageId));
      // Check if ALL visible pages for this campaign now have a URL.
      // schema_audit is internal only; all other types (including llm_txt, schema_package,
      // schema_delivery) require a URL from the agency before indexing can proceed.
      const HIDDEN_TYPES_URL = new Set(['schema_audit']);
      const allPages = await db
        .select({ id: contentPages.id, publishedUrl: contentPages.publishedUrl, pageType: contentPages.pageType })
        .from(contentPages)
        .where(eq(contentPages.campaignId, page.campaignId));
      const visiblePages = allPages.filter(p => !HIDDEN_TYPES_URL.has(p.pageType));
      const allHaveUrls = visiblePages.length > 0 && visiblePages.every(p => !!p.publishedUrl);
      if (allHaveUrls) {
        // Mark publishing complete and auto-kick indexing
        const { campaigns: campaignsTable } = await import('../drizzle/schema');
        await db.update(campaignsTable)
          .set({ publishingCompletedAt: new Date(), updatedAt: new Date() })
          .where(eq(campaignsTable.id, page.campaignId));
        setImmediate(async () => {
          try {
            const { runPipelineStep } = await import('./pipelineOrchestrator');
            await runPipelineStep(page.campaignId!, 'indexing', ctx.user.id);
            console.log(`[agency.setClientContentPageUrl] Auto-triggered indexing for campaign ${page.campaignId}`);
          } catch (err: any) {
            console.error(`[agency.setClientContentPageUrl] Auto-indexing failed:`, err.message);
          }
        });
      }
      return { success: true, allUrlsEntered: allHaveUrls };
    }),

  // Update the HTML content of a content page (allows editing links/text even after page is published)
  updateContentPageContent: protectedProcedure
    .input(z.object({
      pageId: z.number(),
      pageContent: z.string().min(1, 'Content cannot be empty'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getAgencyByUserId } = await import('./dbAgencies');
      const { getDb } = await import('./db');
      const { contentPages, campaigns, businesses } = await import('../drizzle/schema');
      const { eq, and } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      // Resolve agency (support admin impersonation)
      const impersonatedAgencyId = (ctx as any).impersonatedAgencyId as number | undefined;
      let agencyId: number;
      if (impersonatedAgencyId) {
        if (ctx.user.role !== 'admin') throw new Error('Forbidden');
        agencyId = impersonatedAgencyId;
      } else {
        const agency = await getAgencyByUserId(ctx.user.id);
        if (!agency) throw new Error('Agency not found');
        agencyId = agency.id;
      }
      // Verify the page belongs to a campaign under this agency
      const [page] = await db
        .select({ id: contentPages.id, campaignId: contentPages.campaignId })
        .from(contentPages)
        .where(eq(contentPages.id, input.pageId))
        .limit(1);
      if (!page || !page.campaignId) throw new Error('Content page not found');
      const [campaign] = await db
        .select({ id: campaigns.id })
        .from(campaigns)
        .innerJoin(businesses, eq(businesses.id, campaigns.businessId))
        .where(and(eq(campaigns.id, page.campaignId), eq(businesses.agencyId, agencyId)))
        .limit(1);
      if (!campaign) throw new Error('Not authorized to update this page');
      // Save the updated content
      await db
        .update(contentPages)
        .set({
          pageContent: input.pageContent,
          updatedAt: new Date(),
        })
        .where(eq(contentPages.id, input.pageId));
      return { success: true };
    }),

  // Super admin: start impersonating an agency (returns the agency user id for context switching)
  startImpersonation: protectedProcedure
    .input(z.object({ agencyId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') throw new Error('Forbidden — super admin only');
      const { getAgencyById } = await import('./dbAgencies');
      const { getDb } = await import('./db');
      const { users } = await import('../drizzle/schema');
      const { eq } = await import('drizzle-orm');
      const agency = await getAgencyById(input.agencyId);
      if (!agency) throw new Error('Agency not found');
      if (!agency.userId) throw new Error('Agency has no linked user account');
      const db = await getDb();
      if (!db) throw new Error('Database not available');
      const [agencyUser] = await db.select().from(users).where(eq(users.id, agency.userId)).limit(1);
      if (!agencyUser) throw new Error('Agency user account not found');
      return {
        agencyId: agency.id,
        agencyName: agency.brandName || agency.name,
        agencyUserId: agencyUser.id,
        agencyUserEmail: agencyUser.email,
      };
    }),
});

// ─── Prospect Audit Router ───────────────────────────────────────────────────
const prospectAuditRouter = router({
  /** Step 1: Generate 15 queries from business info */
  generateQueries: protectedProcedure
    .input(
      z.object({
        businessName: z.string().min(1),
        location: z.string().min(1),
        industry: z.string().optional(),
        seedKeywords: z.string().optional(),
        campaignScope: z.enum(["local", "national", "ecommerce"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { generateProspectQueries } = await import('./prospectAuditEngine');
      const queries = await generateProspectQueries({ ...input, campaignScope: input.campaignScope ?? "local" });
      return { queries };
    }),

  /** Step 2: Create audit record and return ID so frontend can poll */
  createAudit: protectedProcedure
    .input(
      z.object({
        businessName: z.string().min(1),
        website: z.string().optional(),
        location: z.string().min(1),
        industry: z.string().optional(),
        seedKeywords: z.string().optional(),
        campaignScope: z.enum(["local", "national", "ecommerce"]).optional(),
        queries: z.array(z.object({ searchQuery: z.string(), location: z.string() })),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import('./db');
      const { prospectAudits } = await import('../drizzle/schema');
      const { getAgencyByUserId } = await import('./dbAgencies');
      const db = await getDb();
      if (!db) throw new Error('Database not available');

      // Resolve agency ID from logged-in user (null for super admin)
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
        campaignScope: input.campaignScope ?? 'local',
        queries: input.queries as any,
        status: 'pending',
      }).returning({ id: prospectAudits.id });

      return { auditId: audit.id };
    }),

  /** Step 3: Run the audit (called after createAudit) */
  runAudit: protectedProcedure
    .input(
      z.object({
        auditId: z.number(),
      })
    )
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
        queries,
        undefined,
        audit.seedKeywords ?? undefined,
        ((audit as any).campaignScope ?? 'local') as "local" | "national" | "ecommerce"
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

  /** List recent audits (for the menu page) */
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

// Merge llmInsights and costTracking into appRouter
import { costTrackingRouter } from "./costTrackingRouter";
import { trainingQueryRouter } from "./trainingQueryRouter";
export const appRouterWithInsights = router({
  ...appRouter._def.procedures,
  llmInsights: llmInsightsRouter,
  costTracking: costTrackingRouter,
  prospectAudit: prospectAuditRouter,
  trainingQuery: trainingQueryRouter,
});
export type AppRouter = typeof appRouter;
// Re-export the extended router for use in server setup
export { appRouterWithInsights as extendedAppRouter };
