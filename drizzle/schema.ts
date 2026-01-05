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
export const scheduleTypeEnum = pgEnum("schedule_type", ["daily", "weekly", "monthly", "custom"]);

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
  isActive: boolean("isActive").default(true).notNull(),
  lastRun: timestamp("lastRun"),
  nextRun: timestamp("nextRun"),
  runCount: integer("runCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type InsertScheduledJob = typeof scheduledJobs.$inferInsert;

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
