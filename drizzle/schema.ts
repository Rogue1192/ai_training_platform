import { integer, pgEnum, pgTable, serial, text, timestamp, varchar, json, boolean, real, decimal, date } from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */

// Enums
export const roleEnum = pgEnum("role", ["user", "admin", "agency"]);
export const aiProviderEnum = pgEnum("ai_provider", ["openai", "anthropic", "google", "minimax"]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["connected", "disconnected"]);
export const trainingStatusEnum = pgEnum("training_status", ["paused", "in_progress", "completed", "error"]);
// Note: trainingPhase, conversationType, and promptType use varchar instead of enum for TiDB compatibility
// Valid values: trainingPhase: 'pending' | 'baseline' | 'training' | 'evaluation' | 'completed'
// Valid values: conversationType: 'baseline' | 'training' | 'evaluation'
// Valid values: promptType: 'clean' | 'suggestive' | 'follow_up'
export const scheduleTypeEnum = pgEnum("schedule_type", ["hourly", "daily", "weekly", "monthly", "custom"]);
// Note: promptTemplateType uses varchar instead of enum for TiDB compatibility
// Valid values: 'clean' | 'suggestive' | 'follow_up' | 'category_based'

// New enums for AI Answer Forge
export const campaignStatusEnum = pgEnum("campaign_status", [
  "pending",           // Just created from webhook
  "keyword_research",  // Running keyword research
  "query_review",      // Keyword research done — awaiting admin query approval
  "credibility_research", // Researching credibility data
  "content_generation", // Generating content pages
  "publishing",        // Auto-publishing to WordPress
  "indexing",          // Submitted for indexing, waiting
  "baseline_check",    // Running initial visibility report
  "fan_out_audit",     // ChatGPT entity-verification audit — ops fills in credibility URLs before content generation
  "training",          // Active training sessions running
  "monitoring",        // Achieved rankings, in maintenance mode
  "paused",           // Manually paused
  "error",            // Pipeline error, needs attention
]);
export const contentPageStatusEnum = pgEnum("content_page_status", ["draft", "generated", "published", "failed"]);

// Users table
export const users = pgTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: serial("id").primaryKey(),
  /** Supabase Auth identifier (user.id) returned from authentication. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Agencies table — reseller/white-label agency accounts
export const agencies = pgTable("agencies", {
  id: serial("id").primaryKey(),
  // The user account that owns/manages this agency
  userId: integer("userId").references(() => users.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  contactEmail: varchar("contactEmail", { length: 320 }).notNull(),
  contactName: varchar("contactName", { length: 255 }),
  phone: varchar("phone", { length: 50 }),
  packageTier: varchar("packageTier", { length: 50 }).default("starter").notNull(),
  // Branding fields for white-label emails
  brandName: varchar("brandName", { length: 255 }),
  brandLogoUrl: varchar("brandLogoUrl", { length: 500 }),
  brandFromName: varchar("brandFromName", { length: 255 }),
  // Stripe billing
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripePaymentMethodId: varchar("stripePaymentMethodId", { length: 255 }),
  hasPaymentMethod: boolean("hasPaymentMethod").default(false).notNull(),
  // Client intake form — permanent reusable token for the branded intake URL
  // URL: /intake/{intakeToken} — shared with clients to self-onboard
  intakeToken: varchar("intakeToken", { length: 64 }).unique(),
  // Agency-provided API keys for training queries (agency absorbs OpenAI + Gemini costs)
  // Stored encrypted; pipeline falls back to platform keys if not set
  agencyOpenAiKey: text("agencyOpenAiKey"),
  agencyGeminiKey: text("agencyGeminiKey"),
  // Lead capture widget settings
  // Calendar embed code shown in the CTA lightbox on audit report pages
  calendarEmbedCode: text("calendarEmbedCode"),
  // Custom label for the CTA booking button (defaults to "Schedule a Free Strategy Call")
  ctaButtonText: varchar("ctaButtonText", { length: 255 }),
  // CRM webhook URL — fired when a prospect submits their lead info on an audit
  webhookUrl: varchar("webhookUrl", { length: 1000 }),
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Agency = typeof agencies.$inferSelect;
export type InsertAgency = typeof agencies.$inferInsert;

// Businesses table (enhanced with credibility fields)
export const businesses = pgTable("businesses", {
  id: serial("id").primaryKey(),
  // Nullable — businesses belong to the company, not an individual employee.
  // onDelete: set null so deleting an employee account does NOT destroy client data.
  userId: integer("userId")
    .references(() => users.id, { onDelete: "set null" }),
  // Agency that owns this client (null = direct/internal client)
  agencyId: integer("agencyId")
    .references(() => agencies.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  businessType: varchar("businessType", { length: 100 }),
  location: varchar("location", { length: 255 }),
  description: text("description"),
  website: varchar("website", { length: 500 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  notes: text("notes"),
  // New credibility fields for AI Answer Forge
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactName: varchar("contactName", { length: 255 }),
  certifications: text("certifications"),
  awards: text("awards"),
  yearsInBusiness: integer("yearsInBusiness"),
  bbbRating: varchar("bbbRating", { length: 10 }),
  licenses: text("licenses"),
  warranties: text("warranties"),
  differentiators: text("differentiators"),
  // Social profiles — discovered during credibility research, included in schema.org sameAs
  facebookUrl: varchar("facebookUrl", { length: 500 }),
  instagramUrl: varchar("instagramUrl", { length: 500 }),
  linkedinUrl: varchar("linkedinUrl", { length: 500 }),
  twitterUrl: varchar("twitterUrl", { length: 500 }),
  youtubeUrl: varchar("youtubeUrl", { length: 500 }),
  tiktokUrl: varchar("tiktokUrl", { length: 500 }),
  yelpUrl: varchar("yelpUrl", { length: 500 }),
  googleMapsUrl: varchar("googleMapsUrl", { length: 500 }),
  bbbUrl: varchar("bbbUrl", { length: 500 }),
  angiesUrl: varchar("angiesUrl", { length: 500 }),
  thumbtackUrl: varchar("thumbtackUrl", { length: 500 }),
  houzzUrl: varchar("houzzUrl", { length: 500 }),
  // Agency billing — Stripe subscription for this client (billed to the agency)
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  agencyPackageTier: varchar("agencyPackageTier", { length: 50 }),
  // Agency notification preference — if false, win emails are sent to the business only,
  // not to the agency. Defaults to true (agency receives all win emails by default).
  agencyWinEmailsEnabled: boolean("agencyWinEmailsEnabled").default(true).notNull(),
  // Archive flag — soft-delete for test/inactive clients
  isArchived: boolean("isArchived").default(false).notNull(),
  // Billing type — how this business is billed. Flows down to all campaigns created for this business.
  // white_label = agency reseller client, direct = direct platform subscriber,
  // legacy = pre-existing client (no billing), external = billed outside platform
  billingType: varchar("billingType", { length: 20 }).default("direct"),
  // Bundled billing flag — when true, campaigns created for this business should default to no-charge
  noCharge: boolean("noCharge").default(false).notNull(),
  // Internal source tag — "rogue", "ranklocal", or null (white-label/unknown)
  internalSource: varchar("internalSource", { length: 50 }),
  // Specialties & unique expertise — free-text field seeded into MiniMax training prompts
  // e.g. "Specializes in red clay stain removal unique to North Alabama geography"
  specialties: text("specialties"),
  // Credibility source URLs — JSON array of { label: string, url: string } objects.
  // Provided by the client or admin so the credibility research AI reads these pages
  // first (BBB profile, certification registry, license lookup, review profiles, etc.)
  // instead of searching the internet and potentially missing them.
  // Example: [{"label":"BBB Profile","url":"https://bbb.org/..."},{"label":"NATE Cert","url":"https://natex.org/..."}]
  credibilityUrls: text("credibilityUrls"),
  // Source tracking
  sourceWebhookId: integer("sourceWebhookId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Business = typeof businesses.$inferSelect;
export type InsertBusiness = typeof businesses.$inferInsert;

// API Keys table — global keys shared across all employees and businesses
export const apiKeys = pgTable("apiKeys", {
  id: serial("id").primaryKey(),
  provider: aiProviderEnum("provider").notNull().unique(),
  encryptedKey: text("encryptedKey").notNull(),
  status: apiKeyStatusEnum("status").default("connected").notNull(),
  lastVerified: timestamp("lastVerified"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// Service Keys table — global keys for external services (DataForSEO, Monkey Indexer, Resend)
// These are stored encrypted in the database so they can be managed via the Settings UI
// instead of requiring manual Railway env var configuration.
// Note: "sinbyte" is kept in the enum for backward compatibility (existing DB rows);
// new installs use "monkeyindexer" instead.
export const serviceKeyServiceEnum = pgEnum("service_key_service", ["dataforseo", "sinbyte", "monkeyindexer", "resend", "whitelabel", "stripe", "model_config"]);
export const serviceKeys = pgTable("serviceKeys", {
  id: serial("id").primaryKey(),
  service: serviceKeyServiceEnum("service").notNull().unique(),
  // For services with login+password (DataForSEO), store as JSON: {login, password}
  // For services with a single API key (Monkey Indexer, Resend), store as the key string
  encryptedValue: text("encryptedValue").notNull(),
  status: apiKeyStatusEnum("status").default("connected").notNull(),
  lastVerified: timestamp("lastVerified"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ServiceKey = typeof serviceKeys.$inferSelect;
export type InsertServiceKey = typeof serviceKeys.$inferInsert;

// Training Sessions table
export const trainingSessions = pgTable("trainingSessions", {
  id: serial("id").primaryKey(),
  // Nullable — sessions belong to the business/campaign, not an individual employee.
  // onDelete: set null so deleting an employee account does NOT destroy training history.
  userId: integer("userId")
    .references(() => users.id, { onDelete: "set null" }),
  businessId: integer("businessId").references(() => businesses.id, { onDelete: "set null" }),
  trainingName: varchar("trainingName", { length: 255 }).notNull(),
  topic: text("topic").notNull(),
  targetAiProvider: aiProviderEnum("targetAiProvider").notNull(),
  targetAiModel: varchar("targetAiModel", { length: 100 }).notNull(),
  influencerAiProvider: aiProviderEnum("influencerAiProvider").notNull(),
  influencerAiModel: varchar("influencerAiModel", { length: 100 }).notNull(),
  trainingPrompts: json("trainingPrompts").notNull(),
  trainingContext: text("trainingContext"),
  trainingGoal: text("trainingGoal").notNull(),
  iterations: integer("iterations").default(50).notNull(),
  retryInterval: integer("retryInterval").default(10).notNull(),
  currentProgress: integer("currentProgress").default(0).notNull(),
  status: trainingStatusEnum("status").default("paused").notNull(),
  errorMessage: text("errorMessage"),
  // New fields for phase-based training
  trainingPhase: varchar("trainingPhase", { length: 20 }).default("pending").notNull(),
  baselineMentioned: boolean("baselineMentioned"),
  evaluationMentioned: boolean("evaluationMentioned"),
  influenceScore: integer("influenceScore"),
  trainingIterationsCompleted: integer("trainingIterationsCompleted").default(0).notNull(),
  // Legacy flag for sessions created before phase-based training
  isLegacy: boolean("isLegacy").default(false).notNull(),
  // Archive flag — set when the parent business is archived, so archived clients'
  // training sessions are hidden from the Training view too.
  isArchived: boolean("isArchived").default(false).notNull(),
  // Link to campaign (for auto-created sessions)
  campaignId: integer("campaignId"),
  campaignQueryLocationId: integer("campaignQueryLocationId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type TrainingSession = typeof trainingSessions.$inferSelect;
export type InsertTrainingSession = typeof trainingSessions.$inferInsert;

// Training Conversations table
export const trainingConversations = pgTable("trainingConversations", {
  id: serial("id").primaryKey(),
  trainingSessionId: integer("trainingSessionId")
    .notNull()
    .references(() => trainingSessions.id, { onDelete: "cascade" }),
  iterationNumber: integer("iterationNumber").notNull(),
  conversationHistory: json("conversationHistory").notNull(),
  promptUsed: text("promptUsed").notNull(),
  goalAchieved: boolean("goalAchieved").default(false).notNull(),
  responseTime: integer("responseTime"),
  // New fields for phase-based training
  conversationType: varchar("conversationType", { length: 20 }).default("training").notNull(),
  promptType: varchar("promptType", { length: 20 }).default("suggestive").notNull(),
  businessMentionedUnprompted: boolean("businessMentionedUnprompted"),
  mentionConfidence: integer("mentionConfidence"), // 0-100 confidence score
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TrainingConversation = typeof trainingConversations.$inferSelect;
export type InsertTrainingConversation = typeof trainingConversations.$inferInsert;

// Scheduled Jobs table
export const scheduledJobs = pgTable("scheduledJobs", {
  id: serial("id").primaryKey(),
  // Nullable — scheduled jobs belong to the team, not an individual employee.
  // onDelete: set null so deleting an employee account does NOT delete scheduled jobs.
  userId: integer("userId")
    .references(() => users.id, { onDelete: "set null" }),
  trainingSessionId: integer("trainingSessionId").references(() => trainingSessions.id, {
    onDelete: "cascade",
  }),
  businessId: integer("businessId").references(() => businesses.id, { onDelete: "cascade" }),
  jobName: varchar("jobName", { length: 255 }).notNull(),
  scheduleType: scheduleTypeEnum("scheduleType").notNull(),
  cronExpression: varchar("cronExpression", { length: 100 }),
  // Exact scheduling fields
  timeOfDay: varchar("timeOfDay", { length: 5 }).notNull().default("09:00"), // HH:mm format
  dayOfWeek: integer("dayOfWeek"), // 0=Sunday, 1=Monday, ..., 6=Saturday (for weekly)
  dayOfMonth: integer("dayOfMonth"), // 1-31 (for monthly)
  timezone: varchar("timezone", { length: 100 }).default("America/Los_Angeles").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  lastRun: timestamp("lastRun"),
  nextRun: timestamp("nextRun"),
  runCount: integer("runCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type InsertScheduledJob = typeof scheduledJobs.$inferInsert;

// Scheduled Job Runs - History of every execution
export const scheduledJobRuns = pgTable("scheduledJobRuns", {
  id: serial("id").primaryKey(),
  scheduledJobId: integer("scheduledJobId")
    .notNull()
    .references(() => scheduledJobs.id, { onDelete: "cascade" }),
  trainingSessionId: integer("trainingSessionId").references(() => trainingSessions.id, {
    onDelete: "set null",
  }),
  status: varchar("status", { length: 20 }).notNull().default("running"), // 'running' | 'completed' | 'failed' | 'skipped'
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  errorMessage: text("errorMessage"),
  // Snapshot of training results at completion
  baselineMentioned: boolean("baselineMentioned"),
  evaluationMentioned: boolean("evaluationMentioned"),
  influenceScore: integer("influenceScore"),
  iterationsCompleted: integer("iterationsCompleted"),
  triggeredBy: varchar("triggeredBy", { length: 20 }).default("scheduler").notNull(), // 'scheduler' | 'manual'
});

export type ScheduledJobRun = typeof scheduledJobRuns.$inferSelect;
export type InsertScheduledJobRun = typeof scheduledJobRuns.$inferInsert;

// Platform Metrics table
export const platformMetrics = pgTable("platformMetrics", {
  id: serial("id").primaryKey(),
  // Nullable — metrics belong to the team, not an individual employee.
  // onDelete: set null so deleting an employee does NOT destroy historical metrics.
  userId: integer("userId")
    .references(() => users.id, { onDelete: "set null" }),
  date: timestamp("date").notNull(),
  activeTrainings: integer("activeTrainings").default(0).notNull(),
  completedGoals: integer("completedGoals").default(0).notNull(),
  apiCallsToday: integer("apiCallsToday").default(0).notNull(),
  avgResponseTime: integer("avgResponseTime").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PlatformMetric = typeof platformMetrics.$inferSelect;
export type InsertPlatformMetric = typeof platformMetrics.$inferInsert;

// Prompt Templates table - Global prompt configuration (shared across all team members)
export const promptTemplates = pgTable("promptTemplates", {
  id: serial("id").primaryKey(),
  // userId removed — prompt templates are global team resources, not per-employee.
  templateType: varchar("templateType", { length: 50 }).notNull(), // 'clean' | 'suggestive' | 'follow_up' | 'category_based'
  templateName: varchar("templateName", { length: 255 }).notNull(),
  templateContent: text("templateContent").notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: integer("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type InsertPromptTemplate = typeof promptTemplates.$inferInsert;


// ============================================================================
// AI ANSWER FORGE — NEW TABLES
// ============================================================================

// Package Tiers — defines the service packages (5 queries/3 locations, etc.)
export const packageTiers = pgTable("packageTiers", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(), // e.g., "Starter", "Growth", "Pro", "Enterprise"
  slug: varchar("slug", { length: 50 }).notNull().unique(), // e.g., "starter", "growth", "pro", "enterprise"
  maxQueries: integer("maxQueries").notNull(), // Max search queries allowed (legacy)
  maxLocations: integer("maxLocations").notNull(), // Max locations allowed (legacy)
  maxQuerySlots: integer("maxQuerySlots").notNull().default(15), // Total query-location pairs budget (new model: Starter=15, Growth=30, Pro=50)
  description: text("description"),
  monthlyPrice: integer("monthlyPrice"), // Price in cents (for reference, not billing)
  isActive: boolean("isActive").default(true).notNull(),
  sortOrder: integer("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PackageTier = typeof packageTiers.$inferSelect;
export type InsertPackageTier = typeof packageTiers.$inferInsert;

// Campaigns — the core automation unit, one per client onboarding
export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  // Nullable — campaigns belong to the business/company, not an individual employee.
  // onDelete: set null so deleting an employee does NOT destroy client campaigns.
  userId: integer("userId")
    .references(() => users.id, { onDelete: "set null" }),
  businessId: integer("businessId")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  packageTierId: integer("packageTierId")
    .references(() => packageTiers.id, { onDelete: "set null" }),
  // Campaign identification
  campaignName: varchar("campaignName", { length: 255 }).notNull(),
  status: campaignStatusEnum("status").default("pending").notNull(),
  // Pipeline tracking — which phase has been completed
  keywordResearchCompletedAt: timestamp("keywordResearchCompletedAt"),
  credibilityResearchCompletedAt: timestamp("credibilityResearchCompletedAt"),
  contentGenerationCompletedAt: timestamp("contentGenerationCompletedAt"),
  publishingCompletedAt: timestamp("publishingCompletedAt"),
  indexingSubmittedAt: timestamp("indexingSubmittedAt"),
  indexingVerifiedAt: timestamp("indexingVerifiedAt"),
  baselineCheckCompletedAt: timestamp("baselineCheckCompletedAt"),
  fanOutAuditCompletedAt: timestamp("fanOutAuditCompletedAt"),
  // Fan-out gap list — JSON array of FanOutGapItem objects surfaced by the ChatGPT entity-verification audit.
  // Each item represents a claim ChatGPT tried to verify independently but couldn\'t find.
  // Ops team fills in verificationUrl per item; content generation bakes those URLs into copy.
  fanOutGapList: json("fanOutGapList"),
  trainingStartedAt: timestamp("trainingStartedAt"),
  sprintCompletedAt: timestamp("sprintCompletedAt"), // Set when all 4 sprint days complete — anchors 7-day rank tracking and 14-day bonus query scan
  // Configuration
  trainingAggressiveness: varchar("trainingAggressiveness", { length: 20 }).default("aggressive").notNull(), // 'aggressive' | 'moderate' | 'maintenance'
  rankCheckFrequency: varchar("rankCheckFrequency", { length: 20 }).default("weekly").notNull(), // 'daily' | 'weekly' | 'biweekly'
  // Error tracking
  lastError: text("lastError"),
  errorCount: integer("errorCount").default(0).notNull(),
  // 14-day risk-free trial
  // trialStatus: 'trial' | 'converted' | 'expired' | 'paid'
  trialStatus: varchar("trialStatus", { length: 20 }).default("trial").notNull(),
  trialStartedAt: timestamp("trialStartedAt"),
  trialExpiresAt: timestamp("trialExpiresAt"),
  trialConvertedAt: timestamp("trialConvertedAt"),
  // Package tier selected during onboarding (from GHL webhook)
  // e.g., 'starter_5loc' | 'growth_5loc' | 'pro_5loc' | 'starter_10loc' | 'growth_10loc' | 'pro_10loc'
  selectedPackage: varchar("selectedPackage", { length: 50 }),
  maxQueries: integer("maxQueries").default(5).notNull(),   // Trial: 5, paid: per package (legacy)
  maxLocations: integer("maxLocations").default(3).notNull(), // Trial: 3, paid: per package (legacy)
  maxQuerySlots: integer("maxQuerySlots").default(15).notNull(), // Total query-location pairs budget (new model)
  // Stripe
  stripePaymentLinkSentAt: timestamp("stripePaymentLinkSentAt"),
  stripePaymentLinkUrl: varchar("stripePaymentLinkUrl", { length: 512 }),
  stripePaymentLinkId: varchar("stripePaymentLinkId", { length: 255 }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  // Billing type — determines revenue rate for P&L calculation
  // 'white_label' = agency wholesale ($99/$149/$179), 'direct' = retail ($199/$299/$349), 'legacy' = costs only
  billingType: varchar("billingType", { length: 20 }).default("white_label").notNull(),
  // Campaign scope — controls whether location is appended to queries and how prompts are framed
  // 'local'      = service-area business (plumber, cleaner, roofer) — location appended to every query (default, ~90% of use cases)
  // 'national'   = agency, franchise, SaaS, nationwide service — queries run without location suffix, national prompt framing
  // 'ecommerce'  = online store, no physical presence — no location at all, product-discovery prompt framing, Organization schema
  campaignScope: varchar("campaignScope", { length: 20 }).default("local").notNull(),
  // No-charge flag — when true, this campaign is bundled into a larger package and should not be billed individually
  // Suppresses: Stripe subscription creation, cost tracking entries, and billing-related alerts
  noCharge: boolean("noCharge").default(false).notNull(),
  // Resume tracking — set when an admin requests a pipeline resume/retry.
  // The pipeline reads this to know it should re-queue from the next incomplete stage.
  // Cleared automatically once the pipeline picks it up and starts running.
  resumeRequestedAt: timestamp("resumeRequestedAt"),
  // Training engine version — 'v3' (default) | 'v4' (goal-assessment + double-endorsement graduation)
  trainingVersion: varchar("trainingVersion", { length: 10 }).default("v3").notNull(),
  // Training hold — when true the scheduler will NOT fire the sprint even if llm.txt/schema are verified.
  // Defaults to true (held) for all new campaigns so admins can assign the training version before launch.
  // Set to false manually via the campaign admin panel when ready to start training.
  trainingHeld: boolean("trainingHeld").default(true).notNull(),
  // Site verification — set to true when the scan confirms llm.txt / schema are live.
  // Checkbox in the publishing panel auto-triggers the scan; campaign stays blocked until both pass.
  llmTxtVerified: boolean("llmTxtVerified").default(false).notNull(),
  schemaVerified: boolean("schemaVerified").default(false).notNull(),
  // Primary keywords — 3 core service keywords that drive query generation (e.g. "AC repair", "AC replacement", "heating repair")
  // Required before keyword research can run. These replace buildServiceSeeds as the seed source.
  primaryKeywords: text("primary_keywords").array().default([]),
  // Promo code applied at campaign creation
  promoCodeId: integer("promoCodeId"),
  promoCodeUsed: varchar("promoCodeUsed", { length: 50 }),
  // Metadata
  sourceWebhookId: integer("sourceWebhookId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

// Promo Codes — one-time or limited-use codes for free trials, discounts, or noCharge campaigns
export const promoCodes = pgTable("promoCodes", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  description: text("description"),
  // 'free_trial' = noCharge for trialDays, 'percent_off' = % discount, 'fixed_off' = fixed $ off
  discountType: varchar("discountType", { length: 20 }).default("free_trial").notNull(),
  discountValue: integer("discountValue").default(0), // percent or cents depending on discountType
  packageTierSlug: varchar("packageTierSlug", { length: 50 }), // if set, locks code to a specific package
  maxUses: integer("maxUses").default(1), // null = unlimited
  usedCount: integer("usedCount").default(0).notNull(),
  expiresAt: timestamp("expiresAt"), // null = never expires
  noCharge: boolean("noCharge").default(true).notNull(), // if true, campaign gets noCharge=true
  trialDays: integer("trialDays").default(30), // days of free access for free_trial type
  createdBy: integer("createdBy"), // userId of admin who created it
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PromoCode = typeof promoCodes.$inferSelect;
export type InsertPromoCode = typeof promoCodes.$inferInsert;

// Campaign Query-Location Matrix — each row is one query+location combo in a campaign
export const campaignQueryLocations = pgTable("campaignQueryLocations", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaignId")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  searchQuery: text("searchQuery").notNull(), // e.g., "best HVAC company"
  location: varchar("location", { length: 255 }).notNull(), // e.g., "Dallas, TX"
  // AI search volume data from DataForSEO
  aiSearchVolume: integer("aiSearchVolume"),
  monthlyTrend: json("monthlyTrend"), // 12-month trend array
  // Rank tracking
  currentRankChatGPT: varchar("currentRankChatGPT", { length: 50 }), // 'mentioned' | 'not_mentioned' | 'top_3' etc.
  currentRankGemini: varchar("currentRankGemini", { length: 50 }),
  currentRankAIOverview: varchar("currentRankAIOverview", { length: 50 }),
  lastRankCheckAt: timestamp("lastRankCheckAt"),
  firstMentionedAt: timestamp("firstMentionedAt"), // When the client first appeared for this combo
  // Training status for this specific combo
  // trainingStatus: 'pending' | 'before_capture' | 'training' | 'achieved' | 'monitoring' | 'recovering'
  trainingStatus: varchar("trainingStatus", { length: 20 }).default("pending").notNull(),
  trainingSessions: integer("trainingSessions").default(0).notNull(), // Count of full 50-iteration runs completed
  // Cycle orchestration — drives the 4-run initial cycle and weekly monitoring
  trainingRunCount: integer("trainingRunCount").default(0).notNull(),       // Full runs fired so far (max 4 in initial phase)
  lastRunCompletedAt: timestamp("lastRunCompletedAt"),                       // When the last 50-iteration run finished
  nextPollAt: timestamp("nextPollAt"),                                        // When to next run the LLM poll (24h after run, or weekly in monitoring)
  monitoringStartedAt: timestamp("monitoringStartedAt"),                     // When combo entered weekly monitoring state
  lastMonitoringPollAt: timestamp("lastMonitoringPollAt"),                   // Last weekly monitoring poll timestamp
  // Before/after scan video + screenshot URLs (uploaded to Supabase Storage)
  /**
   * true  = this location was explicitly set as a target in the client’s package (default)
   * false = bonus win — the business appeared in a location NOT in their target list
   */
  isTargetLocation: boolean("isTargetLocation").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type CampaignQueryLocation = typeof campaignQueryLocations.$inferSelect;
export type InsertCampaignQueryLocation = typeof campaignQueryLocations.$inferInsert;

// Credibility Data — structured credibility research results per business
export const credibilityData = pgTable("credibilityData", {
  id: serial("id").primaryKey(),
  businessId: integer("businessId")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  campaignId: integer("campaignId")
    .references(() => campaigns.id, { onDelete: "cascade" }),
  // Structured credibility facts
  researchResults: json("researchResults").notNull(), // Full structured research output
  verifiedFacts: json("verifiedFacts"), // Array of verified, expandable facts
  credibilityScore: integer("credibilityScore"), // 0-100 overall credibility assessment
  // Research metadata
  researchModel: varchar("researchModel", { length: 100 }), // Which LLM did the research
  researchCompletedAt: timestamp("researchCompletedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type CredibilityData = typeof credibilityData.$inferSelect;
export type InsertCredibilityData = typeof credibilityData.$inferInsert;

// Content Pages — generated content pages for client websites
export const contentPages = pgTable("contentPages", {
  id: serial("id").primaryKey(),
  businessId: integer("businessId")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  campaignId: integer("campaignId")
    .references(() => campaigns.id, { onDelete: "cascade" }),
  // Page details
  pageType: varchar("pageType", { length: 50 }).notNull(), // 'certifications' | 'warranties' | 'awards' | 'team' | 'service_area' | 'faq' | 'pricing'
  pageTitle: varchar("pageTitle", { length: 255 }).notNull(),
  pageSlug: varchar("pageSlug", { length: 255 }),
  pageContent: text("pageContent").notNull(), // Full HTML/markdown content
  metaDescription: text("metaDescription"),
  schemaMarkup: text("schemaMarkup"), // JSON-LD schema for this page
  interlinkTargets: json("interlinkTargets"), // Array of page IDs to interlink to
  // Publishing status
  status: contentPageStatusEnum("status").default("draft").notNull(),
  publishedUrl: text("publishedUrl"), // Live URL after publishing
  publishedAt: timestamp("publishedAt"),
  publishError: text("publishError"),
  // Delivery metadata — how this content should be placed on the client's site
  deliveryType: varchar("deliveryType", { length: 30 }).default("new_page").notNull(), // 'new_page' | 'inject_existing'
  placementInstructions: text("placementInstructions"), // Plain-English note for the team
  // Generation metadata
  generationModel: varchar("generationModel", { length: 100 }),
  generationPrompt: text("generationPrompt"), // The prompt used to generate this page
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ContentPage = typeof contentPages.$inferSelect;
export type InsertContentPage = typeof contentPages.$inferInsert;

// Industry Keyword Cache — stores keyword research results by industry for reuse
export const industryKeywordCache = pgTable("industryKeywordCache", {
  id: serial("id").primaryKey(),
  industry: varchar("industry", { length: 100 }).notNull(), // e.g., "HVAC", "Plumbing", "Roofing"
  // Keyword data
  keywords: json("keywords").notNull(), // Array of { query, aiSearchVolume, intent, category }
  goldenTemplateKeywords: json("goldenTemplateKeywords"), // Locked-in top keywords after threshold
  // Cache metadata
  clientCount: integer("clientCount").default(1).notNull(), // How many clients contributed to this cache
  isLocked: boolean("isLocked").default(false).notNull(), // True when golden template is established
  lockThreshold: integer("lockThreshold").default(3).notNull(), // Clients needed before locking
  lastRefreshedAt: timestamp("lastRefreshedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type IndustryKeywordCache = typeof industryKeywordCache.$inferSelect;
export type InsertIndustryKeywordCache = typeof industryKeywordCache.$inferInsert;

// Rank Snapshots — historical rank tracking data per query+location combo
export const rankSnapshots = pgTable("rankSnapshots", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaignId")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  queryLocationId: integer("queryLocationId")
    .notNull()
    .references(() => campaignQueryLocations.id, { onDelete: "cascade" }),
  // Rank data per platform
  chatgptMentioned: boolean("chatgptMentioned"),
  chatgptPosition: integer("chatgptPosition"), // Position in the response (1st mentioned, 2nd, etc.)
  chatgptResponseSnippet: text("chatgptResponseSnippet"),
  geminiMentioned: boolean("geminiMentioned"),
  geminiPosition: integer("geminiPosition"),
  geminiResponseSnippet: text("geminiResponseSnippet"),
  aiOverviewMentioned: boolean("aiOverviewMentioned"),
  aiOverviewPosition: integer("aiOverviewPosition"),
  aiOverviewResponseSnippet: text("aiOverviewResponseSnippet"),
  // Sources cited
  sourcesCited: json("sourcesCited"), // Array of URLs cited in the AI response
  // Metadata
  checkType: varchar("checkType", { length: 20 }).default("scheduled").notNull(), // 'baseline' | 'scheduled' | 'recovery_check'
  // Whether this snapshot is for a tracked (isTargetLocation=true) query-location.
  // Bonus query snapshots have isTracked=false and MUST NEVER be included in any score calculation.
  isTracked: boolean("isTracked").default(true).notNull(),
  checkedAt: timestamp("checkedAt").defaultNow().notNull(),
});

export type RankSnapshot = typeof rankSnapshots.$inferSelect;
export type InsertRankSnapshot = typeof rankSnapshots.$inferInsert;

// Client Dashboards — private access tokens for iframe-embeddable dashboards
export const clientDashboards = pgTable("clientDashboards", {
  id: serial("id").primaryKey(),
  businessId: integer("businessId")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  campaignId: integer("campaignId")
    .references(() => campaigns.id, { onDelete: "cascade" }),
  // Access control
  accessToken: varchar("accessToken", { length: 64 }).notNull().unique(), // Non-guessable URL token
  isActive: boolean("isActive").default(true).notNull(),
  // Customization
  dashboardTitle: varchar("dashboardTitle", { length: 255 }),
  // Usage tracking
  lastAccessedAt: timestamp("lastAccessedAt"),
  accessCount: integer("accessCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ClientDashboard = typeof clientDashboards.$inferSelect;
export type InsertClientDashboard = typeof clientDashboards.$inferInsert;

// Webhook Logs — tracks all incoming webhooks for monitoring
export const webhookLogs = pgTable("webhookLogs", {
  id: serial("id").primaryKey(),
  // Webhook data
  source: varchar("source", { length: 50 }).notNull().default("ghl"), // 'ghl' | 'siteforge_ultra' | 'manual'
  payload: json("payload").notNull(), // Raw webhook payload
  // Processing status
  status: varchar("status", { length: 20 }).notNull().default("received"), // 'received' | 'processing' | 'completed' | 'failed'
  errorMessage: text("errorMessage"),
  // Links to created records
  businessId: integer("businessId"),
  campaignId: integer("campaignId"),
  // Metadata
  ipAddress: varchar("ipAddress", { length: 45 }),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type WebhookLog = typeof webhookLogs.$inferSelect;
export type InsertWebhookLog = typeof webhookLogs.$inferInsert;

// Notification Log — tracks all emails sent to clients
export const notificationLogs = pgTable("notificationLogs", {
  id: serial("id").primaryKey(),
  businessId: integer("businessId")
    .references(() => businesses.id, { onDelete: "set null" }),
  campaignId: integer("campaignId")
    .references(() => campaigns.id, { onDelete: "set null" }),
  // Notification details
  notificationType: varchar("notificationType", { length: 50 }).notNull(), // 'initial_report' | 'win_notification' | 'publish_fallback' | 'status_update'
  recipientEmail: varchar("recipientEmail", { length: 320 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  body: text("body"),
  // Delivery status
  status: varchar("status", { length: 20 }).notNull().default("pending"), // 'pending' | 'sent' | 'failed'
  resendMessageId: varchar("resendMessageId", { length: 100 }),
  errorMessage: text("errorMessage"),
  sentAt: timestamp("sentAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type NotificationLog = typeof notificationLogs.$inferSelect;
export type InsertNotificationLog = typeof notificationLogs.$inferInsert;

// LLM.txt Files — generated llm.txt content per business
export const llmTxtFiles = pgTable("llmTxtFiles", {
  id: serial("id").primaryKey(),
  businessId: integer("businessId")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  campaignId: integer("campaignId")
    .references(() => campaigns.id, { onDelete: "cascade" }),
  content: text("content").notNull(), // The full llm.txt file content
  publishedToSite: boolean("publishedToSite").default(false).notNull(),
  publishedAt: timestamp("publishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type LlmTxtFile = typeof llmTxtFiles.$inferSelect;
export type InsertLlmTxtFile = typeof llmTxtFiles.$inferInsert;

// Schema Markup Recommendations — generated schema markup per business
export const schemaMarkupRecommendations = pgTable("schemaMarkupRecommendations", {
  id: serial("id").primaryKey(),
  businessId: integer("businessId")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  campaignId: integer("campaignId")
    .references(() => campaigns.id, { onDelete: "cascade" }),
  // Schema analysis
  existingSchemaTypes: json("existingSchemaTypes"), // What schema the site already has
  recommendedSchemaTypes: json("recommendedSchemaTypes"), // What should be added
  generatedSchema: text("generatedSchema"), // Full JSON-LD code to add
  // Publishing status
  publishedToSite: boolean("publishedToSite").default(false).notNull(),
  publishedAt: timestamp("publishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type SchemaMarkupRecommendation = typeof schemaMarkupRecommendations.$inferSelect;
export type InsertSchemaMarkupRecommendation = typeof schemaMarkupRecommendations.$inferInsert;

// ─── Cost Logs ─────────────────────────────────────────────────────────────────
// Tracks every LLM and DataForSEO API call cost per campaign.
// Used by the super-admin Cost Tracking page to compute per-client P&L.
export const costLogs = pgTable("costLogs", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaignId")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  businessId: integer("businessId")
    .references(() => businesses.id, { onDelete: "set null" }),
  // Category of operation: 'training' | 'rank_check' | 'content_generation' |
  //   'credibility_research' | 'keyword_research' | 'dfs_llm_mentions' |
  //   'dfs_keyword_volume' | 'dfs_site_keywords'
  operationType: varchar("operationType", { length: 50 }).notNull(),
  // AI provider: 'openai' | 'anthropic' | 'google' | 'minimax' | 'dataforseo'
  provider: varchar("provider", { length: 30 }).notNull(),
  // Model name (null for DataForSEO calls)
  model: varchar("model", { length: 100 }),
  inputTokens: integer("inputTokens").default(0).notNull(),
  outputTokens: integer("outputTokens").default(0).notNull(),
  // Computed cost in USD (6 decimal places for sub-cent precision)
  costUsd: decimal("costUsd", { precision: 10, scale: 6 }).default("0").notNull(),
  // The billing cycle start date this cost belongs to (campaign createdAt day-of-month rolling)
  billingCycleStart: timestamp("billingCycleStart").notNull(),
  // Optional extra context (e.g. { queryCount: 5, endpoint: '/llm_mentions/search/live' })
  metadata: json("metadata"),
  // For V4/V5 training: the provider/model used as the trainer AI (separate from the trainee)
  trainerProvider: varchar("trainerProvider", { length: 30 }),
  trainerModel: varchar("trainerModel", { length: 100 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type CostLog = typeof costLogs.$inferSelect;
export type InsertCostLog = typeof costLogs.$inferInsert;


// ─── Bonus Query Results ────────────────────────────────────────────────────────
// Stores results of bi-weekly bonus query discovery scans.
// Each row is one semantically adjacent query that was checked but is NOT in the
// campaign's tracked campaignQueryLocations set.
// If the business appears → it becomes a bonus win and optionally gets promoted
// to a tracked query. If it doesn't appear → it's an opportunity gap.
export const bonusQueryResults = pgTable("bonusQueryResults", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaignId")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  businessId: integer("businessId")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  // The source tracked query this was derived from
  sourceQueryLocationId: integer("sourceQueryLocationId")
    .references(() => campaignQueryLocations.id, { onDelete: "set null" }),
  sourceSearchQuery: text("sourceSearchQuery").notNull(), // Original tracked query
  // The bonus/adjacent query that was actually checked
  bonusSearchQuery: text("bonusSearchQuery").notNull(),
  location: varchar("location", { length: 255 }).notNull(),
  // Visibility results per platform
  chatgptMentioned: boolean("chatgptMentioned").default(false).notNull(),
  chatgptSnippet: text("chatgptSnippet"),
  geminiMentioned: boolean("geminiMentioned").default(false).notNull(),
  geminiSnippet: text("geminiSnippet"),
  // Whether the business appeared on at least one platform
  isBonusWin: boolean("isBonusWin").default(false).notNull(),
  // Whether this bonus query has been promoted to a tracked query
  promotedToTracked: boolean("promotedToTracked").default(false).notNull(),
  promotedQueryLocationId: integer("promotedQueryLocationId")
    .references(() => campaignQueryLocations.id, { onDelete: "set null" }),
  // Scan metadata
  scanRunAt: timestamp("scanRunAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type BonusQueryResult = typeof bonusQueryResults.$inferSelect;
export type InsertBonusQueryResult = typeof bonusQueryResults.$inferInsert;

// ─── Query Drop-off Events ──────────────────────────────────────────────────────
// Records when a tracked query loses visibility on a platform, so the client
// dashboard can show "lost" alerts and the system can trigger re-optimization.
export const queryDropoffEvents = pgTable("queryDropoffEvents", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaignId")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  queryLocationId: integer("queryLocationId")
    .notNull()
    .references(() => campaignQueryLocations.id, { onDelete: "cascade" }),
  platform: varchar("platform", { length: 20 }).notNull(), // 'chatgpt' | 'gemini' | 'aiOverview'
  searchQuery: text("searchQuery").notNull(),
  location: varchar("location", { length: 255 }).notNull(),
  // When it was lost
  detectedAt: timestamp("detectedAt").defaultNow().notNull(),
  // Re-optimization status
  reoptimizationInitiated: boolean("reoptimizationInitiated").default(false).notNull(),
  reoptimizationInitiatedAt: timestamp("reoptimizationInitiatedAt"),
  // When visibility was recovered (null = still lost)
  recoveredAt: timestamp("recoveredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type QueryDropoffEvent = typeof queryDropoffEvents.$inferSelect;
export type InsertQueryDropoffEvent = typeof queryDropoffEvents.$inferInsert;

// ─── Prospect Visibility Audits ──────────────────────────────────────────────
// Stores AI visibility audits run for prospects (sales tool).
// Each audit runs 15 queries across ChatGPT, Gemini, and AI Overview.
// Results are cached and can be promoted to a campaign baseline if the
// prospect signs up, avoiding a redundant re-run.

export const prospectAuditStatusEnum = pgEnum("prospect_audit_status", [
  "pending",    // Form submitted, audit queued
  "running",    // Audit in progress
  "completed",  // Audit done, PDF delivered
  "failed",     // Audit failed
]);

export const prospectAudits = pgTable("prospectAudits", {
  id: serial("id").primaryKey(),
  // Which agency ran this audit (null = super admin / direct)
  agencyId: integer("agencyId").references(() => agencies.id, { onDelete: "set null" }),
  // Business info
  businessName: varchar("businessName", { length: 255 }).notNull(),
  website: varchar("website", { length: 500 }),
  location: varchar("location", { length: 255 }).notNull(),
  industry: varchar("industry", { length: 100 }),
  seedKeywords: text("seedKeywords"), // comma-separated seed keywords provided by user
  // Campaign scope — controls query generation and volume lookup strategy
  // 'local' = service-area business (default), 'national' = nationwide, 'ecommerce' = online store
  campaignScope: varchar("campaignScope", { length: 20 }).default("local").notNull(),
  // Normalized domain for prospect-to-client matching (e.g. "titancleaningco.com")
  normalizedDomain: varchar("normalizedDomain", { length: 253 }),
  // Public share token — allows viewing the audit report without login
  shareToken: varchar("shareToken", { length: 64 }),
  // Contact info (lead capture)
  contactFirstName: varchar("contactFirstName", { length: 100 }),
  contactLastName: varchar("contactLastName", { length: 100 }),
  contactEmail: varchar("contactEmail", { length: 320 }),
  contactPhone: varchar("contactPhone", { length: 50 }),
  // The 15 queries that were generated and checked
  queries: json("queries"), // Array of { searchQuery, location }
  // Snapshot results — same shape as rankSnapshots but stored inline as JSON
  snapshotResults: json("snapshotResults"), // Array of per-query results
  // Computed scores
  overallScore: integer("overallScore"),
  chatgptScore: integer("chatgptScore"),
  geminiScore: integer("geminiScore"),
  aiOverviewScore: integer("aiOverviewScore"),
  queriesMentioned: integer("queriesMentioned"),
  // AI search volume summary (computed during audit, persisted for public report)
  avgJobValue: integer("avgJobValue"),
  totalAISearches: integer("totalAISearches"),
  visibleSearches: integer("visibleSearches"),
  lostOpportunities: integer("lostOpportunities"),
  volumeUsedFallback: boolean("volumeUsedFallback").default(false),
  // Delivery
  pdfUrl: varchar("pdfUrl", { length: 1000 }), // URL to generated PDF
  emailSentAt: timestamp("emailSentAt"),
  // GHL webhook
  ghlWebhookSentAt: timestamp("ghlWebhookSentAt"),
  ghlWebhookStatus: varchar("ghlWebhookStatus", { length: 20 }), // 'sent' | 'failed' | null
  // Booking link shown after results (configurable per agency)
  bookingLink: varchar("bookingLink", { length: 500 }),
  // If this prospect signed up, link to their campaign so baseline can be reused
  campaignId: integer("campaignId").references(() => campaigns.id, { onDelete: "set null" }),
  baselinePromotedAt: timestamp("baselinePromotedAt"), // When results were copied to campaign baseline
  // Source: 'internal' = run by agency in the app; 'widget' = submitted via embedded lead-gen widget
  source: varchar("source", { length: 20 }).default("internal").notNull(),
  // Lead capture: true once the prospect has submitted their contact info via the
  // blurred-results lightbox. The share URL shows the full report without overlay
  // once this is true — prevents duplicate lead capture on revisit.
  leadCaptured: boolean("leadCaptured").default(false).notNull(),
  // Status
  status: prospectAuditStatusEnum("status").default("pending").notNull(),
  errorMessage: text("errorMessage"),
  startedAt: timestamp("startedAt"),
  completedAt: timestamp("completedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ProspectAudit = typeof prospectAudits.$inferSelect;
export type InsertProspectAudit = typeof prospectAudits.$inferInsert;

// ─── Agency Audit Quota ───────────────────────────────────────────────────────
// Tracks monthly prospect audit usage per agency.
// Resets on the 1st of each month. Overage can be purchased in blocks.

export const agencyAuditQuota = pgTable("agencyAuditQuota", {
  id: serial("id").primaryKey(),
  agencyId: integer("agencyId").notNull().references(() => agencies.id, { onDelete: "cascade" }),
  // Billing period — YYYY-MM kept for legacy; periodStart (YYYY-MM-DD) is the canonical key
  periodMonth: varchar("periodMonth", { length: 7 }).notNull(), // e.g. "2026-07" (legacy)
  periodStart: date("periodStart"), // e.g. "2026-07-13" — anniversary-based period start
  // Included quota (default 20 for white-label)
  includedQuota: integer("includedQuota").default(20).notNull(),
  // Extra audits purchased as overage blocks (5 per block)
  overageBlocksPurchased: integer("overageBlocksPurchased").default(0).notNull(),
  // How many audits have been used this period
  auditsUsed: integer("auditsUsed").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type AgencyAuditQuota = typeof agencyAuditQuota.$inferSelect;
export type InsertAgencyAuditQuota = typeof agencyAuditQuota.$inferInsert;

// ─── Training Queries ─────────────────────────────────────────────────────────
// Stores the base keyword phrases and their generated variations per campaign.
// Created once via DataForSEO + admin review, locked in permanently after approval.
export const trainingQueries = pgTable("trainingQueries", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaignId")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  businessId: integer("businessId")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  // The base keyword phrase (e.g. "best HVAC company in Dallas TX")
  phraseText: text("phraseText").notNull(),
  // JSON array of 3 natural-language variations generated by GPT-4o
  phraseVariations: json("phraseVariations").$type<string[]>().default([]),
  // 1-based sort order (1–15 Starter, 1–20 Growth, 1–25 Pro)
  sortOrder: integer("sortOrder").notNull(),
  // Monthly AI search volume from DataForSEO (informational)
  aiSearchVolume: integer("aiSearchVolume"),
  isActive: boolean("isActive").default(true).notNull(),
  // Set when admin approves — variations cannot be regenerated after this
  lockedAt: timestamp("lockedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type TrainingQuery = typeof trainingQueries.$inferSelect;
export type InsertTrainingQuery = typeof trainingQueries.$inferInsert;

// ─── Training Phrase Status ───────────────────────────────────────────────────
// Tracks graduation status per phrase per target AI per campaign.
export const trainingPhraseStatus = pgTable("trainingPhraseStatus", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaignId")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  queryId: integer("queryId")
    .notNull()
    .references(() => trainingQueries.id, { onDelete: "cascade" }),
  // 'openai' | 'google'
  targetAiProvider: varchar("targetAiProvider", { length: 20 }).notNull(),
  // Number of consecutive session wins (clean probe hits) — resets if web search doesn't confirm
  consecutiveWins: integer("consecutiveWins").default(0).notNull(),
  // True when consecutiveWins >= 2 AND confirmed by end-of-day web search
  isGraduated: boolean("isGraduated").default(false).notNull(),
  lastTrainedAt: timestamp("lastTrainedAt"),
  lastWebSearchAt: timestamp("lastWebSearchAt"),
  // 'found' | 'not_found' | null
  lastWebSearchResult: varchar("lastWebSearchResult", { length: 20 }),
  // Snippet from last web search response (for display)
  lastWebSearchSnippet: text("lastWebSearchSnippet"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type TrainingPhraseStatus = typeof trainingPhraseStatus.$inferSelect;
export type InsertTrainingPhraseStatus = typeof trainingPhraseStatus.$inferInsert;

// ─── Training Day Runs ────────────────────────────────────────────────────────
// Tracks each daily training run (sprint days and weekly maintenance days).
export const trainingDayRuns = pgTable("trainingDayRuns", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaignId")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  // 'sprint' | 'maintenance'
  runType: varchar("runType", { length: 20 }).notNull(),
  // Sprint day 1–4; for maintenance: sequential week number post-sprint
  runDay: integer("runDay").notNull(),
  scheduledDate: date("scheduledDate").notNull(),
  // 'pending' | 'running' | 'complete' | 'failed'
  status: varchar("status", { length: 20 }).default("pending").notNull(),
  // 'pending' | 'running' | 'complete' | 'failed'
  webSearchStatus: varchar("webSearchStatus", { length: 20 }).default("pending").notNull(),
  sessionsTotal: integer("sessionsTotal").default(0).notNull(),
  sessionsCompleted: integer("sessionsCompleted").default(0).notNull(),
  phrasesGraduated: integer("phrasesGraduated").default(0).notNull(),
  phrasesInRotation: integer("phrasesInRotation").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});
export type TrainingDayRun = typeof trainingDayRuns.$inferSelect;
export type InsertTrainingDayRun = typeof trainingDayRuns.$inferInsert;

// ─── Training Session Logs (V3) ───────────────────────────────────────────────
// Stores the full trainer/trainee dialogue for every session run by trainingWorkerV3.
// One row per (dayRun × query × variation × targetProvider) combination.
export const trainingSessionLogs = pgTable("trainingSessionLogs", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaignId").notNull(),
  dayRunId: integer("dayRunId").notNull(),
  queryId: integer("queryId").notNull(),
  // The base phrase (e.g. "best HVAC company in Dallas TX")
  phraseText: text("phraseText").notNull(),
  // The specific variation used in this session
  variationText: text("variationText").notNull(),
  variationIndex: integer("variationIndex").notNull().default(0),
  // 'openai' | 'google' | 'google_ai_overview'
  targetProvider: varchar("targetProvider", { length: 30 }).notNull(),
  // Whether the clean probe at the end of the session mentioned the business
  sessionWin: boolean("sessionWin").notNull().default(false),
  cleanProbeMentioned: boolean("cleanProbeMentioned").notNull().default(false),
  // The exact clean probe query sent and the AI's response
  cleanProbeQuery: text("cleanProbeQuery"),
  cleanProbeResponse: text("cleanProbeResponse"),
  // Total trainer↔target turns completed
  totalTurns: integer("totalTurns").notNull().default(0),
  // Full conversation: array of { role: 'user'|'assistant'|'trainer', content: string, turn: number }
  conversationHistory: json("conversationHistory").$type<Array<{
    role: "user" | "assistant" | "trainer";
    content: string;
    turn: number;
    isTrainerMessage?: boolean;
  }>>().notNull().default([]),
  // Token counts for cost attribution
  trainerInputTokens: integer("trainerInputTokens").notNull().default(0),
  trainerOutputTokens: integer("trainerOutputTokens").notNull().default(0),
  targetInputTokens: integer("targetInputTokens").notNull().default(0),
  targetOutputTokens: integer("targetOutputTokens").notNull().default(0),
  // Set if the session threw an error
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type TrainingSessionLog = typeof trainingSessionLogs.$inferSelect;
export type InsertTrainingSessionLog = typeof trainingSessionLogs.$inferInsert;
