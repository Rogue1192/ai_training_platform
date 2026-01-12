import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { trainingSessions } from './drizzle/schema.js';
import { desc, like } from 'drizzle-orm';

const client = postgres(process.env.SUPABASE_DATABASE_URL);
const db = drizzle(client);

// Get Kitsap session
const kitsap = await db.select({ 
  id: trainingSessions.id, 
  name: trainingSessions.trainingName, 
  userId: trainingSessions.userId 
})
  .from(trainingSessions)
  .where(like(trainingSessions.trainingName, '%Kitsap%'));
console.log('Kitsap session:', kitsap);

// Get other sessions to compare userId
const others = await db.select({ 
  id: trainingSessions.id, 
  name: trainingSessions.trainingName, 
  userId: trainingSessions.userId 
})
  .from(trainingSessions)
  .orderBy(desc(trainingSessions.createdAt))
  .limit(5);
console.log('Other sessions:', others);

await client.end();
