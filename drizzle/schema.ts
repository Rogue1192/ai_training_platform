import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, json, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Target businesses/clients for AI training
 */
export const businesses = mysqlTable("businesses", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  businessType: varchar("businessType", { length: 100 }), // e.g., "HVAC Company", "Fence Company"
  location: varchar("location", { length: 255 }), // e.g., "Riverside, CA"
  description: text("description"),
  website: varchar("website", { length: 500 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Business = typeof businesses.$inferSelect;
export type InsertBusiness = typeof businesses.$inferInsert;

/**
 * API keys for AI providers (encrypted)
 */
export const apiKeys = mysqlTable("apiKeys", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: mysqlEnum("provider", ["openai", "anthropic", "google"]).notNull(),
  encryptedKey: text("encryptedKey").notNull(), // AES-256 encrypted
  status: mysqlEnum("status", ["connected", "disconnected"]).default("connected").notNull(),
  lastVerified: timestamp("lastVerified"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

/**
 * Training sessions
 */
export const trainingSessions = mysqlTable("trainingSessions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  businessId: int("businessId").references(() => businesses.id, { onDelete: "set null" }),
  trainingName: varchar("trainingName", { length: 255 }).notNull(),
  topic: text("topic").notNull(), // Business/product description
  targetAiProvider: mysqlEnum("targetAiProvider", ["openai", "anthropic", "google"]).notNull(),
  targetAiModel: varchar("targetAiModel", { length: 100 }).notNull(),
  influencerAiProvider: mysqlEnum("influencerAiProvider", ["openai", "anthropic", "google"]).notNull(),
  influencerAiModel: varchar("influencerAiModel", { length: 100 }).notNull(),
  trainingPrompts: json("trainingPrompts").$type<string[]>().notNull(), // Array of prompt variations
  trainingContext: text("trainingContext"), // Background info about the business
  trainingGoal: text("trainingGoal").notNull(), // Specific goal for the AI
  iterations: int("iterations").notNull().default(50),
  retryInterval: int("retryInterval").notNull().default(10), // in minutes
  currentProgress: int("currentProgress").notNull().default(0),
  status: mysqlEnum("status", ["paused", "in_progress", "completed", "error"]).default("paused").notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type TrainingSession = typeof trainingSessions.$inferSelect;
export type InsertTrainingSession = typeof trainingSessions.$inferInsert;

/**
 * Training conversations - stores the actual AI dialogue
 */
export const trainingConversations = mysqlTable("trainingConversations", {
  id: int("id").autoincrement().primaryKey(),
  trainingSessionId: int("trainingSessionId").notNull().references(() => trainingSessions.id, { onDelete: "cascade" }),
  iterationNumber: int("iterationNumber").notNull(),
  conversationHistory: json("conversationHistory").$type<Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: number;
  }>>().notNull(),
  promptUsed: text("promptUsed").notNull(),
  goalAchieved: boolean("goalAchieved").default(false).notNull(),
  responseTime: int("responseTime"), // in milliseconds
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TrainingConversation = typeof trainingConversations.$inferSelect;
export type InsertTrainingConversation = typeof trainingConversations.$inferInsert;

/**
 * Scheduled training jobs
 */
export const scheduledJobs = mysqlTable("scheduledJobs", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  trainingSessionId: int("trainingSessionId").references(() => trainingSessions.id, { onDelete: "cascade" }),
  businessId: int("businessId").references(() => businesses.id, { onDelete: "cascade" }),
  jobName: varchar("jobName", { length: 255 }).notNull(),
  scheduleType: mysqlEnum("scheduleType", ["daily", "weekly", "monthly", "custom"]).notNull(),
  cronExpression: varchar("cronExpression", { length: 100 }), // For custom schedules
  isActive: boolean("isActive").default(true).notNull(),
  lastRun: timestamp("lastRun"),
  nextRun: timestamp("nextRun"),
  runCount: int("runCount").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type InsertScheduledJob = typeof scheduledJobs.$inferInsert;

/**
 * Platform statistics and metrics
 */
export const platformMetrics = mysqlTable("platformMetrics", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  activeTrainings: int("activeTrainings").default(0).notNull(),
  completedGoals: int("completedGoals").default(0).notNull(),
  apiCallsToday: int("apiCallsToday").default(0).notNull(),
  avgResponseTime: int("avgResponseTime").default(0).notNull(), // in milliseconds
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PlatformMetric = typeof platformMetrics.$inferSelect;
export type InsertPlatformMetric = typeof platformMetrics.$inferInsert;
