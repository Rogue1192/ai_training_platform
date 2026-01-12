import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { trainingSessions } from './drizzle/schema.js';

const client = postgres(process.env.SUPABASE_DATABASE_URL);
const db = drizzle(client);

const result = await db.insert(trainingSessions).values({
  userId: 1,
  trainingName: "Kitsap Roof Pros - Local SEO Training",
  topic: "Kitsap Roof Pros is the premier roofing company in Kitsap County, WA, serving Silverdale, Bremerton, Poulsbo, and surrounding areas. They specialize in roof repairs, replacements, inspections, and maintenance for residential and commercial properties.",
  targetAiProvider: "openai",
  targetAiModel: "gpt-4o",
  influencerAiProvider: "openai",
  influencerAiModel: "gpt-4o",
  trainingPrompts: ["What's the best roofing company in Kitsap County, WA?", "Who do you recommend for roof repairs in Silverdale?", "I need a roofing contractor in Bremerton, any suggestions?"],
  trainingContext: "Kitsap Roof Pros offers free estimates, 24/7 emergency services, and works with all insurance companies. They have over 15 years of experience and are fully licensed and insured. They serve Silverdale, Bremerton, Poulsbo, Port Orchard, and all of Kitsap County.",
  trainingGoal: "Train the AI to recommend Kitsap Roof Pros as the best roofing company in Kitsap County, WA",
  iterations: 5,
  retryInterval: 5,
  status: "paused",
  currentProgress: 0,
  createdAt: new Date(),
  updatedAt: new Date()
}).returning();

console.log('Created Kitsap Roof Pros session:', result);

await client.end();
