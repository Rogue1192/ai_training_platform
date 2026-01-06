import { eq, desc, sql, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertUser,
  users,
  businesses,
  InsertBusiness,
  Business,
  apiKeys,
  InsertApiKey,
  ApiKey,
  trainingSessions,
  InsertTrainingSession,
  TrainingSession,
  trainingConversations,
  InsertTrainingConversation,
  TrainingConversation,
  scheduledJobs,
  InsertScheduledJob,
  ScheduledJob,
  platformMetrics,
  InsertPlatformMetric,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // Force IPv4 connection and configure SSL for Supabase
      // The 'family' option forces IPv4 (4) instead of IPv6 (6) or auto (0)
      _client = postgres(process.env.DATABASE_URL, {
        ssl: 'require',
        connection: {
          // Force IPv4 to avoid ENETUNREACH errors on Railway
          options: '--cluster=pooler',
        },
        // Increase connection timeout for Railway
        connect_timeout: 30,
        // Force IPv4 by setting family
        // Note: postgres.js doesn't have a direct 'family' option,
        // but we can use the connection string with explicit IPv4
      });
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _client = null;
    }
  }
  return _db;
}

// ============= User Operations =============

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ============= Business Operations =============

export async function createBusiness(business: InsertBusiness): Promise<Business> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(businesses).values(business).returning();
  const inserted = result;
  return inserted[0]!;
}

export async function getBusinessesByUserId(userId: number): Promise<Business[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(businesses).where(eq(businesses.userId, userId)).orderBy(desc(businesses.createdAt));
}

export async function getBusinessById(id: number): Promise<Business | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(businesses).where(eq(businesses.id, id)).limit(1);
  return result[0];
}

export async function updateBusiness(id: number, updates: Partial<InsertBusiness>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(businesses).set(updates).where(eq(businesses.id, id));
}

export async function deleteBusiness(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(businesses).where(eq(businesses.id, id));
}

// ============= API Key Operations =============

export async function createApiKey(apiKey: InsertApiKey): Promise<ApiKey> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(apiKeys).values(apiKey).returning();
  const inserted = result;
  return inserted[0]!;
}

export async function getApiKeysByUserId(userId: number): Promise<ApiKey[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
}

export async function getApiKeyByUserAndProvider(userId: number, provider: "openai" | "anthropic" | "google"): Promise<ApiKey | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, userId), eq(apiKeys.provider, provider)))
    .limit(1);

  return result[0];
}

export async function updateApiKey(id: number, updates: Partial<InsertApiKey>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(apiKeys).set(updates).where(eq(apiKeys.id, id));
}

export async function deleteApiKey(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(apiKeys).where(eq(apiKeys.id, id));
}

// ============= Training Session Operations =============

export async function createTrainingSession(session: InsertTrainingSession): Promise<TrainingSession> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(trainingSessions).values(session).returning();
  const inserted = result;
  return inserted[0]!;
}

export async function getTrainingSessionsByUserId(userId: number): Promise<TrainingSession[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(trainingSessions).where(eq(trainingSessions.userId, userId)).orderBy(desc(trainingSessions.createdAt));
}

export async function getTrainingSessionById(id: number): Promise<TrainingSession | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(trainingSessions).where(eq(trainingSessions.id, id)).limit(1);
  return result[0];
}

export async function updateTrainingSession(id: number, updates: Partial<InsertTrainingSession>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(trainingSessions).set(updates).where(eq(trainingSessions.id, id));
}

export async function deleteTrainingSession(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(trainingSessions).where(eq(trainingSessions.id, id));
}

// ============= Training Conversation Operations =============

export async function createTrainingConversation(conversation: InsertTrainingConversation): Promise<TrainingConversation> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(trainingConversations).values(conversation).returning();
  const inserted = result;
  return inserted[0]!;
}

export async function getConversationsBySessionId(sessionId: number): Promise<TrainingConversation[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(trainingConversations)
    .where(eq(trainingConversations.trainingSessionId, sessionId))
    .orderBy(trainingConversations.iterationNumber);
}

// ============= Scheduled Job Operations =============

export async function createScheduledJob(job: InsertScheduledJob): Promise<ScheduledJob> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(scheduledJobs).values(job).returning();
  const inserted = result;
  return inserted[0]!;
}

export async function getScheduledJobsByUserId(userId: number): Promise<ScheduledJob[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(scheduledJobs).where(eq(scheduledJobs.userId, userId)).orderBy(desc(scheduledJobs.createdAt));
}

export async function updateScheduledJob(id: number, updates: Partial<InsertScheduledJob>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(scheduledJobs).set(updates).where(eq(scheduledJobs.id, id));
}

export async function deleteScheduledJob(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(scheduledJobs).where(eq(scheduledJobs.id, id));
}

// ============= Platform Metrics Operations =============

export async function getTodayMetrics(userId: number): Promise<{
  activeTrainings: number;
  completedGoals: number;
  apiCallsToday: number;
  avgResponseTime: number;
}> {
  const db = await getDb();
  if (!db) {
    return {
      activeTrainings: 0,
      completedGoals: 0,
      apiCallsToday: 0,
      avgResponseTime: 0,
    };
  }

  // Get active trainings count
  const activeResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(trainingSessions)
    .where(and(eq(trainingSessions.userId, userId), eq(trainingSessions.status, "in_progress")));

  const activeTrainings = Number(activeResult[0]?.count ?? 0);

  // Get completed goals count
  const completedResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(trainingSessions)
    .where(and(eq(trainingSessions.userId, userId), eq(trainingSessions.status, "completed")));

  const completedGoals = Number(completedResult[0]?.count ?? 0);

  // Get today's conversations for API calls and avg response time
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const conversationsResult = await db
    .select({
      count: sql<number>`count(*)`,
      avgTime: sql<number>`avg(${trainingConversations.responseTime})`,
    })
    .from(trainingConversations)
    .innerJoin(trainingSessions, eq(trainingConversations.trainingSessionId, trainingSessions.id))
    .where(and(eq(trainingSessions.userId, userId), sql`${trainingConversations.createdAt} >= ${today}`));

  const apiCallsToday = Number(conversationsResult[0]?.count ?? 0);
  const avgResponseTime = Number(conversationsResult[0]?.avgTime ?? 0);

  return {
    activeTrainings,
    completedGoals,
    apiCallsToday,
    avgResponseTime,
  };
}
