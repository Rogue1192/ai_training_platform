import { and, eq, sql, desc, isNull, ne, gte } from "drizzle-orm";
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
  scheduledJobRuns,
  InsertScheduledJobRun,
  ScheduledJobRun,
  platformMetrics,
  InsertPlatformMetric,
  promptTemplates,
  InsertPromptTemplate,
  PromptTemplate,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

export async function getDb() {
  // Prioritize SUPABASE_DATABASE_URL for Manus dev environment,
  // fall back to DATABASE_URL for Railway/production
  const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  
  if (!_db && databaseUrl) {
    try {
      console.log("[Database] Connecting to:", databaseUrl.includes('pooler.supabase.com') ? 'Supabase Pooler' : 'Default DB');
      
      // Configure SSL for Supabase connections
      _client = postgres(databaseUrl, {
        ssl: 'require',
        connection: {
          // Force IPv4 to avoid ENETUNREACH errors on Railway
          options: '--cluster=pooler',
        },
        // Increase connection timeout
        connect_timeout: 30,
      });
      _db = drizzle(_client);
      console.log("[Database] Connected successfully");
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

/**
 * Validate that all required API keys exist for a training session
 * Returns an object with validation result and missing providers
 */
export async function validateApiKeysForTraining(
  userId: number,
  targetProvider: "openai" | "anthropic" | "google",
  influencerProvider: "openai" | "anthropic" | "google"
): Promise<{ valid: boolean; missingProviders: string[] }> {
  const missingProviders: string[] = [];

  // Check target AI provider key
  const targetKey = await getApiKeyByUserAndProvider(userId, targetProvider);
  if (!targetKey) {
    missingProviders.push(targetProvider);
  }

  // Check influencer AI provider key (only if different from target)
  if (influencerProvider !== targetProvider) {
    const influencerKey = await getApiKeyByUserAndProvider(userId, influencerProvider);
    if (!influencerKey) {
      missingProviders.push(influencerProvider);
    }
  }

  return {
    valid: missingProviders.length === 0,
    missingProviders,
  };
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
  console.log('[DB] getTrainingSessionsByUserId called for userId:', userId);
  const db = await getDb();
  if (!db) {
    console.log('[DB] Database not available');
    return [];
  }
  console.log('[DB] Executing query...');
  try {
    const result = await db.select().from(trainingSessions).where(eq(trainingSessions.userId, userId)).orderBy(desc(trainingSessions.createdAt));
    console.log('[DB] Query completed, found', result.length, 'sessions');
    return result;
  } catch (error: any) {
    console.error('[DB] Query error:', error.message);
    throw error;
  }
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

// ============= Scheduled Job Runs (History) =============

export async function createScheduledJobRun(run: InsertScheduledJobRun): Promise<ScheduledJobRun> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(scheduledJobRuns).values(run).returning();
  return result[0]!;
}

export async function updateScheduledJobRun(id: number, updates: Partial<InsertScheduledJobRun>): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(scheduledJobRuns).set(updates).where(eq(scheduledJobRuns.id, id));
}

export async function getScheduledJobRunsByJobId(jobId: number, limit = 50): Promise<ScheduledJobRun[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduledJobRuns)
    .where(eq(scheduledJobRuns.scheduledJobId, jobId))
    .orderBy(desc(scheduledJobRuns.startedAt))
    .limit(limit);
}

export async function getScheduledJobRunsByUserId(userId: number, limit = 100): Promise<(ScheduledJobRun & { jobName?: string })[]> {
  const db = await getDb();
  if (!db) return [];
  const runs = await db.select({
    id: scheduledJobRuns.id,
    scheduledJobId: scheduledJobRuns.scheduledJobId,
    trainingSessionId: scheduledJobRuns.trainingSessionId,
    status: scheduledJobRuns.status,
    startedAt: scheduledJobRuns.startedAt,
    completedAt: scheduledJobRuns.completedAt,
    errorMessage: scheduledJobRuns.errorMessage,
    baselineMentioned: scheduledJobRuns.baselineMentioned,
    evaluationMentioned: scheduledJobRuns.evaluationMentioned,
    influenceScore: scheduledJobRuns.influenceScore,
    iterationsCompleted: scheduledJobRuns.iterationsCompleted,
    triggeredBy: scheduledJobRuns.triggeredBy,
    jobName: scheduledJobs.jobName,
  })
    .from(scheduledJobRuns)
    .innerJoin(scheduledJobs, eq(scheduledJobRuns.scheduledJobId, scheduledJobs.id))
    .where(eq(scheduledJobs.userId, userId))
    .orderBy(desc(scheduledJobRuns.startedAt))
    .limit(limit);
  return runs;
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
  // Convert to ISO string for PostgreSQL compatibility
  const todayIso = today.toISOString();

  const conversationsResult = await db
    .select({
      count: sql<number>`count(*)`,
      avgTime: sql<number>`avg(${trainingConversations.responseTime})`,
    })
    .from(trainingConversations)
    .innerJoin(trainingSessions, eq(trainingConversations.trainingSessionId, trainingSessions.id))
    .where(and(eq(trainingSessions.userId, userId), gte(trainingConversations.createdAt, new Date(todayIso))));

  const apiCallsToday = Number(conversationsResult[0]?.count ?? 0);
  const avgResponseTime = Number(conversationsResult[0]?.avgTime ?? 0);

  return {
    activeTrainings,
    completedGoals,
    apiCallsToday,
    avgResponseTime,
  };
}


// ============= Prompt Template Operations =============

export type PromptTemplateType = 'clean' | 'suggestive' | 'follow_up' | 'category_based';

/**
 * Get all prompt templates for a user, optionally filtered by type
 */
export async function getPromptTemplates(
  userId: number,
  templateType?: PromptTemplateType
): Promise<PromptTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = [eq(promptTemplates.userId, userId)];
  if (templateType) {
    conditions.push(eq(promptTemplates.templateType, templateType));
  }

  return db
    .select()
    .from(promptTemplates)
    .where(and(...conditions))
    .orderBy(promptTemplates.sortOrder, promptTemplates.createdAt);
}

/**
 * Get active prompt templates for a user by type
 */
export async function getActivePromptTemplates(
  userId: number,
  templateType: PromptTemplateType
): Promise<PromptTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(promptTemplates)
    .where(
      and(
        eq(promptTemplates.userId, userId),
        eq(promptTemplates.templateType, templateType),
        eq(promptTemplates.isActive, true)
      )
    )
    .orderBy(promptTemplates.sortOrder, promptTemplates.createdAt);
}

/**
 * Get a single prompt template by ID
 */
export async function getPromptTemplateById(id: number): Promise<PromptTemplate | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(promptTemplates)
    .where(eq(promptTemplates.id, id))
    .limit(1);

  return result[0];
}

/**
 * Create a new prompt template
 */
export async function createPromptTemplate(
  data: Omit<InsertPromptTemplate, 'id' | 'createdAt' | 'updatedAt'>
): Promise<PromptTemplate> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .insert(promptTemplates)
    .values({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  return result[0];
}

/**
 * Update an existing prompt template
 */
export async function updatePromptTemplate(
  id: number,
  data: Partial<Pick<InsertPromptTemplate, 'templateName' | 'templateContent' | 'isActive' | 'sortOrder'>>
): Promise<PromptTemplate | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .update(promptTemplates)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(promptTemplates.id, id))
    .returning();

  return result[0];
}

/**
 * Delete a prompt template
 */
export async function deletePromptTemplate(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db
    .delete(promptTemplates)
    .where(eq(promptTemplates.id, id))
    .returning();

  return result.length > 0;
}

/**
 * Delete all prompt templates for a user (used when resetting to defaults)
 */
export async function deleteAllPromptTemplates(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .delete(promptTemplates)
    .where(eq(promptTemplates.userId, userId))
    .returning();

  return result.length;
}

/**
 * Check if user has any prompt templates
 */
export async function hasPromptTemplates(userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(promptTemplates)
    .where(eq(promptTemplates.userId, userId));

  return Number(result[0]?.count ?? 0) > 0;
}

/**
 * Default prompt templates to seed for new users
 * Based on Influenx AI Training Prompts structure
 */
export const DEFAULT_PROMPT_TEMPLATES: Omit<InsertPromptTemplate, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] = [
  // ============================================================================
  // CLEAN PROMPTS (Initial prompts sent directly to Target AI)
  // These are user-configured variations that rotate through training sessions
  // Example: "Who is the best electrician in Auckland?"
  // ============================================================================
  {
    templateType: 'clean',
    templateName: 'Best provider question',
    templateContent: 'Who is the best {businessType} in {location}?',
    isActive: true,
    sortOrder: 1,
  },
  {
    templateType: 'clean',
    templateName: 'Recommendation request',
    templateContent: 'What {businessType} would you recommend in {location}?',
    isActive: true,
    sortOrder: 2,
  },
  {
    templateType: 'clean',
    templateName: 'Looking for reliable',
    templateContent: "I'm looking for a reliable {businessType} - any suggestions?",
    isActive: true,
    sortOrder: 3,
  },
  {
    templateType: 'clean',
    templateName: 'Top-rated inquiry',
    templateContent: 'Who are the top-rated {businessType} providers in {location}?',
    isActive: true,
    sortOrder: 4,
  },
  {
    templateType: 'clean',
    templateName: 'Service needed',
    templateContent: 'I need a {businessType} in {location}. Who would you suggest?',
    isActive: true,
    sortOrder: 5,
  },
  {
    templateType: 'clean',
    templateName: 'Best company question',
    templateContent: 'What {businessType} company would you recommend in {location}?',
    isActive: true,
    sortOrder: 6,
  },

  // ============================================================================
  // SUGGESTIVE PROMPTS (Context Integration - sent to Influencer AI)
  // Used to generate natural follow-ups that subtly introduce business context
  // These weave in background information conversationally
  // ============================================================================
  {
    templateType: 'suggestive',
    templateName: 'Natural context introduction',
    templateContent: "{cleanPrompt} That's helpful. I've heard {businessName} in {location} is really good - have you heard of them?",
    isActive: true,
    sortOrder: 1,
  },
  {
    templateType: 'suggestive',
    templateName: 'Conversational mention',
    templateContent: '{cleanPrompt} A friend mentioned {businessName} as a great {businessType}. What do you think about them?',
    isActive: true,
    sortOrder: 2,
  },
  {
    templateType: 'suggestive',
    templateName: 'Online discovery',
    templateContent: "{cleanPrompt} I came across {businessName} while researching. They seem well-regarded - what's your take?",
    isActive: true,
    sortOrder: 3,
  },
  {
    templateType: 'suggestive',
    templateName: 'Local knowledge',
    templateContent: "{cleanPrompt} I've been hearing good things about {businessName} locally. Are they as good as people say?",
    isActive: true,
    sortOrder: 4,
  },
  {
    templateType: 'suggestive',
    templateName: 'Specific inquiry',
    templateContent: '{cleanPrompt} For someone in {location} looking for {businessType}, would {businessName} be a good choice?',
    isActive: true,
    sortOrder: 5,
  },

  // ============================================================================
  // FOLLOW-UP PROMPTS (Intelligent Follow-up - when goal not yet achieved)
  // Used to continue conversation naturally while working toward the goal
  // Must maintain specific details (cities, brands, websites) from original prompts
  // ============================================================================
  {
    templateType: 'follow_up',
    templateName: 'Standout companies',
    templateContent: "That's helpful. I'm specifically looking in {location} - do you know any standout {businessType} companies there? Have you heard of {businessName}?",
    isActive: true,
    sortOrder: 1,
  },
  {
    templateType: 'follow_up',
    templateName: 'Brand inquiry',
    templateContent: "Have you heard of {businessName}? What do you think about them compared to the others you mentioned?",
    isActive: true,
    sortOrder: 2,
  },
  {
    templateType: 'follow_up',
    templateName: 'Location specific',
    templateContent: 'For someone in {location} looking for {businessType}, which would you recommend? What about {businessName}?',
    isActive: true,
    sortOrder: 3,
  },
  {
    templateType: 'follow_up',
    templateName: 'Direct comparison',
    templateContent: "I've been considering {businessName}. How do they compare to the options you suggested?",
    isActive: true,
    sortOrder: 4,
  },
  {
    templateType: 'follow_up',
    templateName: 'Reputation check',
    templateContent: 'Someone specifically recommended {businessName} to me. Do you know anything about their reputation in {location}?',
    isActive: true,
    sortOrder: 5,
  },

  // ============================================================================
  // CATEGORY-BASED PROMPTS (Fallback when clean prompt can't be generated)
  // Creates natural questions based on business type and location
  // ============================================================================
  {
    templateType: 'category_based',
    templateName: 'Best in area',
    templateContent: 'Who is the best {businessType} in {location}?',
    isActive: true,
    sortOrder: 1,
  },
  {
    templateType: 'category_based',
    templateName: 'Recommendation',
    templateContent: 'What {businessType} would you recommend in {location}?',
    isActive: true,
    sortOrder: 2,
  },
  {
    templateType: 'category_based',
    templateName: 'Looking for services',
    templateContent: "I'm looking for {businessType} services in {location}. Any suggestions?",
    isActive: true,
    sortOrder: 3,
  },
  {
    templateType: 'category_based',
    templateName: 'Top-rated query',
    templateContent: 'Who are the top-rated {businessType} providers in {location}?',
    isActive: true,
    sortOrder: 4,
  },
];

/**
 * Seed default prompt templates for a user
 */
export async function seedDefaultPromptTemplates(userId: number): Promise<PromptTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  // Check if user already has templates
  const existing = await hasPromptTemplates(userId);
  if (existing) {
    return getPromptTemplates(userId);
  }

  // Insert all default templates
  const templates: PromptTemplate[] = [];
  for (const template of DEFAULT_PROMPT_TEMPLATES) {
    const created = await createPromptTemplate({
      ...template,
      userId,
    });
    templates.push(created);
  }

  return templates;
}
