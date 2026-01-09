import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { trainingSessions, trainingConversations } from './drizzle/schema.js';
import { eq, desc } from 'drizzle-orm';
import { Redis } from 'ioredis';

async function diagnose() {
  // Connect to database
  const client = postgres(process.env.SUPABASE_DATABASE_URL);
  const db = drizzle(client);
  
  console.log('=== ALL TRAINING SESSIONS ===\n');
  const sessions = await db.select().from(trainingSessions).orderBy(desc(trainingSessions.updatedAt));
  
  for (const s of sessions) {
    console.log(`ID: ${s.id}`);
    console.log(`  Name: ${s.trainingName}`);
    console.log(`  Status: ${s.status}`);
    console.log(`  Progress: ${s.currentProgress}/${s.iterations}`);
    console.log(`  Created: ${s.createdAt}`);
    console.log(`  Updated: ${s.updatedAt}`);
    
    // Check conversations for this session
    const convos = await db.select().from(trainingConversations)
      .where(eq(trainingConversations.trainingSessionId, s.id));
    console.log(`  Conversations: ${convos.length}`);
    console.log('');
  }
  
  // Check Redis queue
  console.log('\n=== REDIS QUEUE STATUS ===\n');
  try {
    const redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
    });
    
    // Check BullMQ queue keys
    const keys = await redis.keys('bull:training-queue:*');
    console.log('Queue keys found:', keys.length);
    
    // Check waiting jobs
    const waiting = await redis.lrange('bull:training-queue:wait', 0, -1);
    console.log('Waiting jobs:', waiting.length);
    
    // Check active jobs
    const active = await redis.lrange('bull:training-queue:active', 0, -1);
    console.log('Active jobs:', active.length);
    
    // Check delayed jobs
    const delayed = await redis.zrange('bull:training-queue:delayed', 0, -1);
    console.log('Delayed jobs:', delayed.length);
    
    // Check completed jobs
    const completed = await redis.zrange('bull:training-queue:completed', 0, -1);
    console.log('Completed jobs:', completed.length);
    
    // Check failed jobs
    const failed = await redis.zrange('bull:training-queue:failed', 0, -1);
    console.log('Failed jobs:', failed.length);
    
    // Get details of delayed jobs
    if (delayed.length > 0) {
      console.log('\n=== DELAYED JOB DETAILS ===');
      for (const jobId of delayed.slice(0, 5)) {
        const jobData = await redis.hgetall(`bull:training-queue:${jobId}`);
        if (jobData.data) {
          const data = JSON.parse(jobData.data);
          console.log(`\nJob ${jobId}:`);
          console.log(`  Session ID: ${data.sessionId}`);
          console.log(`  Iteration: ${data.iterationNumber}`);
        }
      }
    }
    
    // Get details of failed jobs
    if (failed.length > 0) {
      console.log('\n=== FAILED JOB DETAILS ===');
      for (const jobId of failed.slice(0, 5)) {
        const jobData = await redis.hgetall(`bull:training-queue:${jobId}`);
        if (jobData.failedReason) {
          console.log(`\nJob ${jobId}:`);
          console.log(`  Failed Reason: ${jobData.failedReason}`);
        }
      }
    }
    
    await redis.quit();
  } catch (err) {
    console.log('Redis error:', err.message);
  }
  
  await client.end();
}

diagnose().catch(console.error);
