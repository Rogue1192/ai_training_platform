import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { trainingConversations, trainingSessions } from './drizzle/schema.js';
import { eq, desc } from 'drizzle-orm';

const client = postgres(process.env.SUPABASE_DATABASE_URL);
const db = drizzle(client);

// Get Kitsap session status
const session = await db.select().from(trainingSessions).where(eq(trainingSessions.id, 21));
console.log('Session status:', session[0]?.status, 'Progress:', session[0]?.currentProgress + '/' + session[0]?.iterations);

// Get conversations
const convos = await db.select().from(trainingConversations).where(eq(trainingConversations.sessionId, 21)).orderBy(desc(trainingConversations.createdAt));
console.log('Conversations count:', convos.length);
if (convos.length > 0) {
  const latest = convos[0];
  console.log('\n--- Latest Iteration ---');
  console.log('Iteration:', latest.iterationNumber);
  console.log('Goal achieved:', latest.goalAchieved);
  console.log('Response time:', latest.responseTime, 'ms');
  console.log('Prompt type:', latest.promptType);
  console.log('\nPrompt:', latest.conversationHistory[0]?.content?.substring(0, 150));
  console.log('\nResponse preview:', latest.conversationHistory[1]?.content?.substring(0, 400));
  
  // Check if business name is mentioned
  const response = latest.conversationHistory[1]?.content || '';
  const mentioned = response.toLowerCase().includes('kitsap roof pros');
  console.log('\nBusiness mentioned in response:', mentioned);
}

await client.end();
