import { db } from './server/_core/db';
import { trainingSessions } from './drizzle/schema';
import { eq } from 'drizzle-orm';

async function test() {
  try {
    const sessions = await db.select().from(trainingSessions).where(eq(trainingSessions.userId, 1)).limit(5);
    console.log('Found', sessions.length, 'sessions');
    if (sessions.length > 0) {
      console.log('First session:', JSON.stringify(sessions[0], null, 2).substring(0, 500));
    }
  } catch (e: any) {
    console.error('Error:', e.message);
  }
  process.exit(0);
}
test();
