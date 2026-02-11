import { integer, pgEnum, pgTable, serial, text, timestamp, varchar, json, boolean } from "drizzle-orm/pg-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */

// Enums
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const aiProviderEnum = pgEnum("ai_provider", ["openai", "anthropic", "google"]);
export const apiKeyStatusEnum = pgEnum("api_key_status", ["connected", "disconnected"]);
export const trainingStatusEnum = pgEnum("training_status", ["paused", "in_progress", "completed", "error"]);
// Note: trainingPhase, conversationType, and promptType use varchar instead of enum for TiDB compatibility
// Valid values: trainingPhase: 'pending' | 'baseline' | 'training' | 'evaluation' | 'completed'
// Valid values: conversationType: 'baseline' | 'training' | 'evaluation'
// Valid values: promptType: 'clean' | 'suggestive' | 'follow_up'
export const scheduleTypeEnum = pgEnum("schedule_type", ["hourly", "daily", "weekly", "monthly", "custom"]);
// Note: promptTemplateType uses varchar instead of enum for TiDB compatibility
// Valid values: 'clean' | 'suggestive' | 'follow_up' | 'category_based'

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

// Businesses table
export const businesses = pgTable("businesses", {
  id: serial("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  businessType: varchar("businessType", { length: 100 }),
  location: varchar("location", { length: 255 }),
  description: text("description"),
  website: varchar("website", { length: 500 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type Business = typeof businesses.$inferSelect;
export type InsertBusiness = typeof businesses.$inferInsert;

// API Keys table
export const apiKeys = pgTable("apiKeys", {
  id: serial("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: aiProviderEnum("provider").notNull(),
  encryptedKey: text("encryptedKey").notNull(),
  status: apiKeyStatusEnum("status").default("connected").notNull(),
  lastVerified: timestamp("lastVerified"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// Training Sessions table
export const trainingSessions = pgTable("trainingSessions", {
  id: serial("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  activeTrainings: integer("activeTrainings").default(0).notNull(),
  completedGoals: integer("completedGoals").default(0).notNull(),
  apiCallsToday: integer("apiCallsToday").default(0).notNull(),
  avgResponseTime: integer("avgResponseTime").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PlatformMetric = typeof platformMetrics.$inferSelect;
export type InsertPlatformMetric = typeof platformMetrics.$inferInsert;

// Prompt Templates table - Global prompt configuration
export const promptTemplates = pgTable("promptTemplates", {
  id: serial("id").primaryKey(),
  userId: integer("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
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
