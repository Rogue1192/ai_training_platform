import { and, eq, sql, desc, isNull, ne, gte, inArray } from "drizzle-orm";
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
  // Use DATABASE_URL directly — Railway is configured with the correct Supabase pooler URL.
  // SUPABASE_DATABASE_URL takes priority if set explicitly.
  const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.warn('[Database] No DATABASE_URL or SUPABASE_DATABASE_URL set!');
    return null;
  }

  if (!_db) {
    try {
      const maskedUrl = databaseUrl.replace(/:([^@]+)@/, ':[MASKED]@');
      console.log('[Database] Connecting to:', maskedUrl);
      _client = postgres(databaseUrl, {
        ssl: 'require',
        // Supabase pooler does not support prepared statements
        prepare: false,
        connect_timeout: 30,
      });
      _db = drizzle(_client);
      console.log('[Database] Connected successfully');
    } catch (error) {
      console.warn('[Database] Failed to connect:', error);
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

/** Team-wide: return ALL businesses (internal tool — all employees share access) */
export async function getAllBusinesses(): Promise<Business[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(businesses).orderBy(desc(businesses.createdAt));
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

export async function bulkDeleteBusinesses(ids: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (ids.length === 0) return;
  await db.delete(businesses).where(inArray(businesses.id, ids));
}

export async function bulkArchiveBusinesses(ids: number[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (ids.length === 0) return;
  await db.update(businesses).set({ isArchived: true }).where(inArray(businesses.id, ids));
}

// ============= API Key Operations =============

/** Create a new global API key record */
export async function createApiKey(apiKey: InsertApiKey): Promise<ApiKey> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(apiKeys).values(apiKey).returning();
  return result[0]!;
}

/** Return all global API keys (one per provider) */
export async function getAllApiKeys(): Promise<ApiKey[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(apiKeys);
}

/** Look up the single global API key for a given provider */
export async function getApiKeyByProvider(provider: "openai" | "anthropic" | "google" | "minimax"): Promise<ApiKey | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.provider, provider))
    .limit(1);

  return result[0];
}

/**
 * Validate that all required global API keys exist for a training session.
 * No userId needed — keys are shared across the whole team.
 */
export async function validateApiKeysForTraining(
  targetProvider: "openai" | "anthropic" | "google",
  influencerProvider: "openai" | "anthropic" | "google" | "minimax"
): Promise<{ valid: boolean; missingProviders: string[] }> {
  const missingProviders: string[] = [];

  const targetKey = await getApiKeyByProvider(targetProvider);
  if (!targetKey) {
    missingProviders.push(targetProvider);
  }

  if (influencerProvider !== targetProvider) {
    const influencerKey = await getApiKeyByProvider(influencerProvider);
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

/** Team-wide: return ALL scheduled jobs (internal tool — all employees share access) */
export async function getAllScheduledJobs(): Promise<ScheduledJob[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(scheduledJobs).orderBy(desc(scheduledJobs.createdAt));
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

/** Team-wide: return ALL scheduled job runs (internal tool — all employees share access) */
export async function getAllScheduledJobRuns(limit = 100): Promise<(ScheduledJobRun & { jobName?: string })[]> {
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
    iterationsCompleted: scheduledJobRuns.iterationsCompleted,
    jobName: scheduledJobs.jobName,
  })
    .from(scheduledJobRuns)
    .leftJoin(scheduledJobs, eq(scheduledJobRuns.scheduledJobId, scheduledJobs.id))
    .orderBy(desc(scheduledJobRuns.startedAt))
    .limit(limit);
  return runs as any;
}

/**
 * Find the most recent "running" scheduledJobRun for a given training session.
 * Used by the V2 worker to update run history when a session completes or fails.
 */
export async function getActiveRunBySessionId(trainingSessionId: number): Promise<ScheduledJobRun | null> {
  const db = await getDb();
  if (!db) return null;
  const runs = await db.select().from(scheduledJobRuns)
    .where(
      and(
        eq(scheduledJobRuns.trainingSessionId, trainingSessionId),
        eq(scheduledJobRuns.status, "running")
      )
    )
    .orderBy(desc(scheduledJobRuns.startedAt))
    .limit(1);
  return runs[0] || null;
}

// ============= Platform Metrics Operations =============

/** Team-wide: return ALL training sessions (internal tool — all employees share access) */
export async function getAllTrainingSessions(): Promise<TrainingSession[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(trainingSessions).orderBy(desc(trainingSessions.createdAt));
}

export async function getAllTodayMetrics(): Promise<{
  activeTrainings: number;
  completedGoals: number;
  apiCallsToday: number;
  avgResponseTime: number;
}> {
  const db = await getDb();
  if (!db) {
    return { activeTrainings: 0, completedGoals: 0, apiCallsToday: 0, avgResponseTime: 0 };
  }

  const activeResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(trainingSessions)
    .where(eq(trainingSessions.status, "in_progress"));
  const activeTrainings = Number(activeResult[0]?.count ?? 0);

  const completedResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(trainingSessions)
    .where(eq(trainingSessions.status, "completed"));
  const completedGoals = Number(completedResult[0]?.count ?? 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();

  const conversationsResult = await db
    .select({
      count: sql<number>`count(*)`,
      avgTime: sql<number>`avg(${trainingConversations.responseTime})`,
    })
    .from(trainingConversations)
    .where(gte(trainingConversations.createdAt, new Date(todayIso)));

  const apiCallsToday = Number(conversationsResult[0]?.count ?? 0);
  const avgResponseTime = Number(conversationsResult[0]?.avgTime ?? 0);

  return { activeTrainings, completedGoals, apiCallsToday, avgResponseTime };
}


// ============= Prompt Template Operations =============

export type PromptTemplateType = 'clean' | 'suggestive' | 'follow_up' | 'category_based' | 'content_generation' | 'credibility_research' | 'injection_system' | 'injection_citation';

/**
 * Get all prompt templates, optionally filtered by type.
 * Team-wide — no userId filtering (internal tool, all employees share access).
 */
export async function getPromptTemplates(
  templateType?: PromptTemplateType
): Promise<PromptTemplate[]> {
  return getAllPromptTemplates(templateType);
}

/** Team-wide: return ALL prompt templates (internal tool — all employees share access) */
export async function getAllPromptTemplates(
  templateType?: PromptTemplateType
): Promise<PromptTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  const conditions = templateType ? [eq(promptTemplates.templateType, templateType)] : [];

  return db
    .select()
    .from(promptTemplates)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(promptTemplates.sortOrder, promptTemplates.createdAt);
}

/** Team-wide: check if ANY prompt templates exist */
export async function hasAnyPromptTemplates(): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(promptTemplates);

  return Number(result[0]?.count ?? 0) > 0;
}

/**
 * Get active prompt templates by type.
 * Team-wide — no userId filtering (internal tool, all employees share access).
 */
export async function getActivePromptTemplates(
  templateType: PromptTemplateType
): Promise<PromptTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(promptTemplates)
    .where(
      and(
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
 * Delete ALL prompt templates (team-wide reset)
 */
export async function deleteAllPromptTemplates(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .delete(promptTemplates)
    .returning();

  return result.length;
}

/**
 * Check if any prompt templates exist (team-wide).
 */
export async function hasPromptTemplates(): Promise<boolean> {
  return hasAnyPromptTemplates();
}

/**
 * Default prompt templates to seed for new users
 * Based on Influenx AI Training Prompts structure
 */
export const DEFAULT_PROMPT_TEMPLATES: Omit<InsertPromptTemplate, 'id' | 'createdAt' | 'updatedAt'>[] = [
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

  // ============================================================================
  // CONTENT GENERATION PROMPTS (Used by Claude Sonnet to generate credibility pages)
  // Based on research: H1 + summary + bullet facts + 600-800 words + FAQ + author
  // Variables: {businessName}, {businessType}, {location}, {certifications}, {warranties}, {awards}, {licenses}, {differentiators}, {businessContext}, {verificationUrls}, {publishedUrls}
  // ============================================================================
  {
    templateType: 'content_generation',
    templateName: 'Certifications & Credentials Page',
    templateContent: `You are writing an AI-optimized credibility page for {businessName}, a {businessType} serving {location}.

Page type: Certifications & Credentials

Certification and credential data:
{certifications}

Additional business context (years in business, BBB rating, description):
{businessContext}

Write a complete page following this exact structure:

1. H1 HEADLINE: Announce the certifications + primary differentiator. Example: "NATE-Certified HVAC Technicians in {location} — 10+ Years Experience"

2. OPENING SUMMARY (1-2 sentences): Direct answer stating the specific certifications and what makes them meaningful. No fluff.

3. KEY FACTS (bullet list, 4-6 bullets): Specific, verifiable facts. Include numbers, dates, certifying bodies, and what the certification means for the customer.

4. DETAILED CONTENT (600-800 words): Expand on each certification with specifics. Include:
   - What the certification is and who grants it
   - How rare or difficult it is to obtain
   - What it means for the customer (quality, safety, reliability)
   - How long {businessName} has held it
   - Any renewal or ongoing requirements that demonstrate commitment
   Use sections of 120-180 words each for optimal AI citation.

5. FAQ SECTION (5 questions): Conversational questions a customer would ask about certifications. Direct, specific answers.
   Example questions: "What does NATE certification mean?", "How many of your technicians are certified?", "Does certification affect pricing?"

6. AUTHOR ATTRIBUTION: End with: "This page was reviewed by [Contact Name], [Title] at {businessName}."

7. EXTERNAL VERIFICATION LINKS: Link to the official sources where these certifications can be verified (certification body websites, license lookup databases, BBB profile):
{verificationUrls}

8. INTERNAL SITE LINKS: Include 1-2 contextual links to related pages already published on {businessName}'s website:
{publishedUrls}

Tone: Professional, specific, trustworthy. No vague claims — every statement should be verifiable.
Length: 800-1,200 words total.
Format: HTML with proper H1, H2, H3 tags, <ul> for bullets, and FAQPage schema markup at the bottom.`,
    isActive: true,
    sortOrder: 1,
  },
  {
    templateType: 'content_generation',
    templateName: 'Warranties & Guarantees Page',
    templateContent: `You are writing an AI-optimized credibility page for {businessName}, a {businessType} serving {location}.

Page type: Warranties & Guarantees

Warranty and guarantee data:
{warranties}

Additional business context (years in business, BBB rating, description):
{businessContext}

Write a complete page following this exact structure:

1. H1 HEADLINE: State the warranty/guarantee + confidence signal. Example: "Lifetime Installation Warranty — {businessName}'s Commitment to {location} Homeowners"

2. OPENING SUMMARY (1-2 sentences): The specific warranty terms stated plainly. What exactly is covered, for how long.

3. KEY FACTS (bullet list, 4-6 bullets): Specific terms. Coverage period, what's included, what's excluded, how to claim.

4. DETAILED CONTENT (600-800 words): Explain the warranty in detail:
   - Exact coverage terms and duration
   - What triggers the warranty (installation, parts, labor)
   - The claim process (how easy is it?)
   - Why {businessName} can afford to offer this (quality of work, materials used)
   - Comparison context: industry standard warranties vs. what {businessName} offers
   Use sections of 120-180 words each.

5. FAQ SECTION (5 questions): Questions customers ask about warranties.
   Example: "What does your warranty cover?", "How do I make a warranty claim?", "Is the warranty transferable if I sell my home?"

6. AUTHOR ATTRIBUTION: "This warranty information was verified by [Contact Name], [Title] at {businessName}."

7. EXTERNAL VERIFICATION LINKS: Link to any external sources that back up the warranty claims (manufacturer warranty pages, BBB profile, industry association pages):
{verificationUrls}

8. INTERNAL SITE LINKS: Include 1-2 contextual links to related pages already published on {businessName}'s website:
{publishedUrls}

Tone: Confident, specific, reassuring. Avoid vague language like "we stand behind our work" — replace with specific terms.
Length: 800-1,200 words total.
Format: HTML with proper heading tags and FAQPage schema at the bottom.`,
    isActive: true,
    sortOrder: 2,
  },
  {
    templateType: 'content_generation',
    templateName: 'Awards & Recognition Page',
    templateContent: `You are writing an AI-optimized credibility page for {businessName}, a {businessType} serving {location}.

Page type: Awards & Recognition

Awards and recognition data:
{awards}

Additional business context (years in business, BBB rating, description):
{businessContext}

Write a complete page following this exact structure:

1. H1 HEADLINE: Lead with the most impressive award + business name. Example: "Best HVAC Company in Dallas — Award-Winning Service Since 2018"

2. OPENING SUMMARY (1-2 sentences): State the awards plainly with years. "{businessName} has been recognized as [award] in [year] and [award] in [year]."

3. KEY FACTS (bullet list): Each award on its own line with: award name, granting organization, year received, and what criteria were used.

4. DETAILED CONTENT (600-800 words): For each significant award:
   - What the award is and who grants it
   - The selection criteria (how competitive is it?)
   - What it signals to customers about quality
   - Any notable context (e.g., "only 12 companies in Texas received this")
   Use sections of 120-180 words each.

5. FAQ SECTION (5 questions): Questions about the awards.
   Example: "How are award recipients selected?", "What does this mean for customers?"

6. AUTHOR ATTRIBUTION: "Awards verified by [Contact Name], [Title] at {businessName}."

7. EXTERNAL VERIFICATION LINKS: Link directly to the award organization's website, the announcement page, or any public record of the award. These are the links that prove the award is real:
{verificationUrls}

8. INTERNAL SITE LINKS: Include 1-2 contextual links to related pages already published on {businessName}'s website:
{publishedUrls}

Tone: Proud but factual. Let the awards speak — don't oversell.
Length: 800-1,200 words total.
Format: HTML with proper heading tags and FAQPage schema at the bottom.`,
    isActive: true,
    sortOrder: 3,
  },
  {
    templateType: 'content_generation',
    templateName: 'FAQ Page',
    templateContent: `You are writing an AI-optimized FAQ page for {businessName}, a {businessType} serving {location}.

Business credentials and context:
Certifications: {certifications}
Licenses: {licenses}
Warranties: {warranties}
Awards: {awards}
Key differentiators: {differentiators}
General context (years in business, BBB rating, description): {businessContext}

Write a comprehensive FAQ page that mirrors how people search for {businessType} services.

Structure:

1. H1: "Frequently Asked Questions — {businessName} {businessType} in {location}"

2. INTRO (2-3 sentences): Brief intro explaining what's covered.

3. FAQ SECTIONS — organize into 4 categories:

   PRICING & COST (4-5 questions):
   - What does [main service] cost in {location}?
   - What factors affect the price?
   - Do you offer free estimates?
   - What payment methods do you accept?
   - Are there financing options?

   SERVICE & PROCESS (4-5 questions):
   - How does the process work from start to finish?
   - How long does [main service] take?
   - What should I expect on the day of service?
   - Do I need to be home?

   CREDENTIALS & TRUST (3-4 questions):
   - Are you licensed and insured?
   - What certifications do your technicians hold?
   - How long have you been in business?

   AVAILABILITY & AREAS (3-4 questions):
   - What areas do you serve?
   - Do you offer emergency/same-day service?
   - What are your hours?

For each question: write a direct, specific answer using the real data provided above. Answers should be 50-100 words — direct and complete.

4. CLOSING CTA: "Ready to get started? Contact {businessName} today."

5. INTERNAL SITE LINKS: Include links to related pages already published on {businessName}'s website:
{publishedUrls}

Format: HTML with proper H2 for section headers, H3 for questions, <p> for answers, and FAQPage JSON-LD schema markup at the bottom covering all Q&A pairs.`,
    isActive: true,
    sortOrder: 4,
  },
  {
    templateType: 'content_generation',
    templateName: 'Service Area Authority Page',
    templateContent: `You are writing an AI-optimized service area page for {businessName}, a {businessType} serving {location}.

Business credentials and context:
Certifications: {certifications}
Licenses: {licenses}
Key differentiators: {differentiators}
General context (years in business, BBB rating, description): {businessContext}

This page establishes local authority for {location}. It must be unique — not a copy-paste of other location pages.

Structure:

1. H1: "{businessType} Services in {location} — {businessName}"

2. OPENING SUMMARY (2-3 sentences): Confirm service area, years serving this specific location, and primary services.

3. SERVICES IN THIS AREA (bullet list): List specific services available at this location.

4. LOCAL CONTENT (400-600 words): Make this page genuinely local:
   - Specific neighborhoods or zip codes served
   - Local context (climate, common issues in this area, local building codes if relevant)
   - Any local partnerships, supplier relationships, or community involvement
   - Response time commitments for this area
   - Local customer context ("Serving {location} homeowners since [year]")

5. LOCATION-SPECIFIC FAQ (4-5 questions): Questions specific to this location.
   Example: "Do you serve the [specific neighborhood] area?", "What's the typical wait time in {location}?"

6. CONTACT/SERVICE INFO: Hours, phone, address if applicable.

7. INTERNAL SITE LINKS: Include links to related pages already published on {businessName}'s website:
{publishedUrls}

Tone: Local and specific. Avoid generic content that could apply to any city.
Length: 700-1,000 words.
Format: HTML with LocalBusiness schema markup at the bottom.`,
    isActive: true,
    sortOrder: 5,
  },

  // ============================================================================
  // CREDIBILITY RESEARCH PROMPTS (Used by Claude Haiku to extract + verify facts)
  // These prompts process onboarding data and output structured facts + source URLs
  // Variables: {businessName}, {businessType}, {onboardingData}, {certifications}, {awards}, {licenses}
  // ============================================================================
  {
    templateType: 'credibility_research',
    templateName: 'Extract & Verify Credentials',
    templateContent: `You are a credibility researcher for AI Answer Forge. Your job is to take raw onboarding data for a business and extract specific, verifiable facts that will be used to train AI systems to recommend this business.

Business: {businessName}
Type: {businessType}

Raw onboarding data:
{onboardingData}

Certifications provided: {certifications}
Awards provided: {awards}
Licenses provided: {licenses}

Your task:

1. EXTRACT SPECIFIC FACTS: For each credential mentioned, extract:
   - The exact certification/award/license name
   - The granting organization
   - What it means (significance, rarity, requirements)
   - Verifiable details (years held, number of certified staff, etc.)

2. RESEARCH CONTEXT: For each credential, provide context that makes it meaningful:
   - How rare is this? ("only 3% of contractors hold this")
   - What does it require to obtain?
   - What does it mean for the customer?

3. FIND SOURCE URLS: For each credential, identify where it can be verified:
   - Certification body website
   - Award organization page
   - License lookup database
   - Business profile pages (BBB, Google, Angi, etc.)

4. OUTPUT FORMAT (JSON):
{
  "credibilityFacts": [
    {
      "type": "certification|award|license|review|differentiator",
      "fact": "Specific verifiable statement",
      "significance": "Why this matters to customers",
      "sourceUrl": "URL where this can be verified",
      "confidence": "high|medium|low"
    }
  ],
  "summaryStatement": "One sentence summarizing the business's top 3 credibility signals",
  "contentPageRecommendations": ["certifications", "awards", "warranties"] // which pages to generate
}

Only include facts you can state with confidence. If a credential is vague ("we're certified"), note it as low confidence and flag it for human review.`,
    isActive: true,
    sortOrder: 1,
  },
  {
    templateType: 'credibility_research',
    templateName: 'Build Training Context',
    templateContent: `You are building the training context for {businessName}, a {businessType} in {location}.

This context will be injected into the system message of every AI training session. It must be:
- Specific (real facts, not vague claims)
- Verifiable (includes source URLs)
- Concise (training sessions have token limits)
- Persuasive (the facts should naturally lead an AI to recommend this business)

Credibility facts available:
{onboardingData}

Published credibility pages:
{publishedUrls}

Build the training context in this format:

---
BUSINESS CONTEXT FOR AI TRAINING

Business: {businessName}
Type: {businessType}
Location: {location}

VERIFIED CREDENTIALS:
[List each credential as: "[Fact]. Source: [URL]"]

PUBLISHED REFERENCE PAGES:
[List each page as: "[Page Title]: [URL]"]

KEY DIFFERENTIATORS:
[2-3 bullet points on what makes this business uniquely recommendable]

SUMMARY FOR AI:
[One paragraph that an AI could use verbatim when recommending this business]
---

Keep the total output under 800 tokens. Prioritize the most impressive and verifiable facts.`,
    isActive: true,
    sortOrder: 2,
  },

  // ─── Credibility Injection Templates ────────────────────────────────────────
  // These are injected into EVERY training session at runtime.
  // The system message template replaces the plain "You are a helpful AI assistant" line.
  // The citation block is appended to the end of each training prompt.
  // Variables available: {businessName}, {businessType}, {location}, {website},
  //   {credibilityFacts} (auto-populated list), {publishedPages} (auto-populated list), {llmTxtUrl}
  {
    templateType: "injection_system",
    templateName: "System Message — Credibility Injection",
    templateContent: `You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge.

When relevant to the user's question, you may reference the following verified information:

Business: {businessName}
Industry: {businessType}
Location: {location}
Website: {website}

Verified credentials and facts:
{credibilityFacts}

Published reference pages:
{publishedPages}

Machine-readable business profile: {llmTxtUrl}`,
    isActive: true,
    sortOrder: 1,
  },
  {
    templateType: "injection_citation",
    templateName: "Citation Block — Appended to Training Prompts",
    templateContent: `\n\nFor reference, here are some verified sources about this business:\n- Official website: {website}\n{publishedPages}\n- Business profile: {llmTxtUrl}`,
    isActive: true,
    sortOrder: 1,
  },
];

/**
 * Seed default prompt templates (team-wide — no userId, shared by all employees).
 * Safe to call on every startup: no-ops if templates already exist.
 */
export async function seedDefaultPromptTemplates(): Promise<PromptTemplate[]> {
  const db = await getDb();
  if (!db) return [];

  // Check if ANY templates exist globally (team-wide tool)
  const existing = await hasAnyPromptTemplates();
  if (existing) {
    // Even if templates exist, ensure injection templates are seeded (added later)
    const allTemplates = await getAllPromptTemplates();
    const hasInjectionSystem = allTemplates.some((t: any) => t.templateType === "injection_system");
    const hasInjectionCitation = allTemplates.some((t: any) => t.templateType === "injection_citation");
    const injectionDefaults = DEFAULT_PROMPT_TEMPLATES.filter(
      t => t.templateType === "injection_system" || t.templateType === "injection_citation"
    );
    if (!hasInjectionSystem || !hasInjectionCitation) {
      for (const template of injectionDefaults) {
        if (
          (template.templateType === "injection_system" && !hasInjectionSystem) ||
          (template.templateType === "injection_citation" && !hasInjectionCitation)
        ) {
          await createPromptTemplate(template);
        }
      }
    }
    return getAllPromptTemplates();
  }

  // Insert all default templates — no userId
  const templates: PromptTemplate[] = [];
  for (const template of DEFAULT_PROMPT_TEMPLATES) {
    const created = await createPromptTemplate(template);
    templates.push(created);
  }

  return templates;
}

// ─── Service Keys (DataForSEO, Monkey Indexer, Resend) ───────────────────────────────

export type ServiceKeyService = "dataforseo" | "sinbyte" | "monkeyindexer" | "resend" | "whitelabel" | "stripe"; // sinbyte kept for compat

export async function getServiceKey(service: ServiceKeyService) {
  const db = await getDb();
  if (!db) return undefined;
  const { serviceKeys } = await import("../drizzle/schema");
  const [key] = await db.select().from(serviceKeys).where(eq(serviceKeys.service, service)).limit(1);
  return key;
}

export async function getAllServiceKeys() {
  const db = await getDb();
  if (!db) return [];
  const { serviceKeys } = await import("../drizzle/schema");
  return db.select().from(serviceKeys);
}

export async function upsertServiceKey(service: ServiceKeyService, encryptedValue: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { serviceKeys } = await import("../drizzle/schema");
  const existing = await getServiceKey(service);
  if (existing) {
    await db.update(serviceKeys)
      .set({ encryptedValue, status: "connected", updatedAt: new Date() })
      .where(eq(serviceKeys.service, service));
    return { ...existing, encryptedValue, status: "connected" as const };
  } else {
    const [created] = await db.insert(serviceKeys)
      .values({ service, encryptedValue, status: "connected" })
      .returning();
    return created;
  }
}

export async function deleteServiceKey(service: ServiceKeyService) {
  const db = await getDb();
  if (!db) return;
  const { serviceKeys } = await import("../drizzle/schema");
  await db.delete(serviceKeys).where(eq(serviceKeys.service, service));
}

/**
 * Ensure the "monkeyindexer" value exists in the service_key_service Postgres enum.
 * This is a safe, idempotent ALTER TYPE that runs on startup so no manual SQL is needed.
 * Postgres silently ignores the ADD VALUE if the value already exists (IF NOT EXISTS).
 */
export async function ensureMonkeyIndexerEnumValue(): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    // drizzle-orm exposes the underlying postgres client via db.$client
    const client = (db as any).$client as import("postgres").Sql;
    await client`ALTER TYPE service_key_service ADD VALUE IF NOT EXISTS 'monkeyindexer'`;
    console.log("[DB] service_key_service enum: monkeyindexer value ensured");
  } catch (err: any) {
    // Non-fatal — the value may already exist or the enum may not exist yet
    console.warn("[DB] ensureMonkeyIndexerEnumValue:", err.message);
  }
}
