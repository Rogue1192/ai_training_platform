import { integer, pgEnum, pgTable, serial, text, timestamp, varchar, json, boolean, real } from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */

// Enums
export const roleEnum = pgEnum("role", ["user", "admin"]);
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
export const clientTypeEnum = pgEnum("client_type", ["ai_only", "ai_plus_seo", "ai_plus_seo_plus_build"]);
export const campaignStatusEnum = pgEnum("campaign_status", [
  "pending",           // Just created from webhook
  "keyword_research",  // Running keyword research
  "credibility_research", // Researching credibility data
  "content_generation", // Generating content pages
  "publishing",        // Auto-publishing to WordPress
  "indexing",          // Submitted for indexing, waiting
  "baseline_check",    // Running initial visibility report
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

// Businesses table (enhanced with credibility fields)
export const businesses = pgTable("businesses", {
  id: serial("id").primaryKey(),
  // Nullable — businesses belong to the company, not an individual employee.
  // onDelete: set null so deleting an employee account does NOT destroy client data.
  userId: integer("userId")
    .references(() => users.id, { onDelete: "set null" }),
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
  competitors: json("competitors"), // string[]
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
  // WordPress credentials (encrypted) for auto-publishing
  siteAdminUrl: text("siteAdminUrl"),
  siteUsername: text("siteUsername"),
  sitePasswordEncrypted: text("sitePasswordEncrypted"),
  // Client type determines the publishing workflow
  clientType: clientTypeEnum("clientType"),
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

// Service Keys table — global keys for external services (DataForSEO, SinByte, Resend)
// These are stored encrypted in the database so they can be managed via the Settings UI
// instead of requiring manual Railway env var configuration.
export const serviceKeyServiceEnum = pgEnum("service_key_service", ["dataforseo", "sinbyte", "resend", "whitelabel"]);
export const serviceKeys = pgTable("serviceKeys", {
  id: serial("id").primaryKey(),
  service: serviceKeyServiceEnum("service").notNull().unique(),
  // For services with login+password (DataForSEO), store as JSON: {login, password}
  // For services with a single API key (SinByte, Resend), store as the key string
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
  maxQueries: integer("maxQueries").notNull(), // Max search queries allowed
  maxLocations: integer("maxLocations").notNull(), // Max locations allowed
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
  clientType: clientTypeEnum("clientType").notNull(),
  // Pipeline tracking — which phase has been completed
  keywordResearchCompletedAt: timestamp("keywordResearchCompletedAt"),
  credibilityResearchCompletedAt: timestamp("credibilityResearchCompletedAt"),
  contentGenerationCompletedAt: timestamp("contentGenerationCompletedAt"),
  publishingCompletedAt: timestamp("publishingCompletedAt"),
  indexingSubmittedAt: timestamp("indexingSubmittedAt"),
  indexingVerifiedAt: timestamp("indexingVerifiedAt"),
  baselineCheckCompletedAt: timestamp("baselineCheckCompletedAt"),
  trainingStartedAt: timestamp("trainingStartedAt"),
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
  maxQueries: integer("maxQueries").default(5).notNull(),   // Trial: 5, paid: per package
  maxLocations: integer("maxLocations").default(3).notNull(), // Trial: 3, paid: per package
  // Stripe
  stripePaymentLinkSentAt: timestamp("stripePaymentLinkSentAt"),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
  // Metadata
  sourceWebhookId: integer("sourceWebhookId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type InsertCampaign = typeof campaigns.$inferInsert;

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
  trainingStatus: varchar("trainingStatus", { length: 20 }).default("pending").notNull(), // 'pending' | 'training' | 'achieved' | 'monitoring' | 'recovering'
  trainingSessions: integer("trainingSessions").default(0).notNull(), // Count of sessions run for this combo
  // Before/after scan video URLs (uploaded to Supabase Storage)
  beforeVideoChatgpt: text("beforeVideoChatgpt"),    // "Before" recording on ChatGPT
  beforeVideoGoogleAi: text("beforeVideoGoogleAi"),  // "Before" recording on Google AI
  afterVideoChatgpt: text("afterVideoChatgpt"),      // "After" recording on ChatGPT (set on first win)
  afterVideoGoogleAi: text("afterVideoGoogleAi"),    // "After" recording on Google AI (set on first win)
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
