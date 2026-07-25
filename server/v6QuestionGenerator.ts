import { getDb, getApiKeyByProvider } from "./db";
import { decrypt } from "./encryption";
import { callAI } from "./aiProviders";
import { campaigns, businesses, campaignQueryLocations, trainingQueries } from "../drizzle/schema";
import { eq, sql } from "drizzle-orm";

const INFLUENCER_PROVIDER = "minimax" as const;
const INFLUENCER_MODEL = "MiniMax-M2.7-highspeed";

const QUERY_MODIFIERS = [
  "best",
  "top-rated",
  "most trusted",
  "#1 rated",
  "most affordable",
  "most reliable",
  "highest rated",
  "most recommended",
];

export async function generateV6Questions(campaignId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database connection failed");
  
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new Error(`Campaign ${campaignId} not found`);
  }

  const [business] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, campaign.businessId))
    .limit(1);

  if (!business) {
    throw new Error(`Business not found for campaign ${campaignId}`);
  }

  const keywords = campaign.primaryKeywords as string[] || [];
  if (keywords.length === 0) {
    throw new Error(`Campaign ${campaignId} has no primaryKeywords set`);
  }

  const locationStr = business.location || "your area";
  const locations = locationStr.split(/[;,]/).map((l: string) => l.trim()).filter(Boolean);
  if (locations.length === 0) {
    locations.push("your area");
  }

  const influencerKeyEncrypted = await getApiKeyByProvider(INFLUENCER_PROVIDER);
  if (!influencerKeyEncrypted) {
    throw new Error(`No API key found for ${INFLUENCER_PROVIDER}`);
  }
  const influencerKey = decrypt(influencerKeyEncrypted.encryptedKey);

  // ── Idempotency guard ────────────────────────────────────────────────────
  // If questions already exist for this campaign, skip generation.
  // The scheduler calls this every 5 minutes — without this guard it would
  // wipe and regenerate in a loop while baselineCheckCompletedAt is NULL.
  const existingCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(campaignQueryLocations)
    .where(eq(campaignQueryLocations.campaignId, campaignId));
  if ((existingCount[0]?.count ?? 0) > 0) {
    console.log(`[V6QuestionGen] Campaign ${campaignId} already has ${existingCount[0]?.count} questions — skipping generation`);
    return;
  }

  console.log(`[V6QuestionGen] Generating conversational questions for campaign ${campaignId}`);

  let generatedCount = 0;

  for (const keyword of keywords) {
    for (const location of locations) {
      for (const modifier of QUERY_MODIFIERS) {
        const questionGenResponse = await callAI(
          INFLUENCER_PROVIDER,
          influencerKey,
          INFLUENCER_MODEL,
          [
            {
              role: "system",
              content: "You write natural conversational questions that a person would type into an AI assistant like ChatGPT or Gemini. Write only the question itself — no explanation, no quotes, no extra text.",
            },
            {
              role: "user",
              content: `Write a natural conversational question someone would ask an AI assistant to find the ${modifier} ${keyword} company in ${location}. The question MUST include the word or phrase "${modifier}" and the service "${keyword}" and the location "${location}". Make it sound like a real person asking, not a search query.`,
            },
          ]
        );
        
        const query = questionGenResponse.content.trim().replace(/^["']|["']$/g, "");
        
        // Insert into campaignQueryLocations (for baseline and tracking)
        const [cql] = await db.insert(campaignQueryLocations).values({
          campaignId,
          searchQuery: query,
          location,
          trainingStatus: "pending",
        }).returning();

        // Insert into trainingQueries (for training worker)
        await db.insert(trainingQueries).values({
          campaignId,
          businessId: campaign.businessId,
          phraseText: query,
          sortOrder: generatedCount + 1,
          isActive: true,
        });

        generatedCount++;
        console.log(`[V6QuestionGen] Generated: "${query}"`);
      }
    }
  }

  console.log(`[V6QuestionGen] Completed. Generated ${generatedCount} questions for campaign ${campaignId}`);
}
