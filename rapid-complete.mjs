/**
 * Rapidly complete the remaining training iterations for session 118.
 * Queues iterations 3, 4, 5 and evaluation with minimal delays
 * so the local worker processes them before the production worker can interfere.
 */
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import postgres from 'postgres';

const sql = postgres(process.env.SUPABASE_DATABASE_URL, { ssl: 'require' });

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const queue = new Queue('training-iterations-v2', { connection: redis });

async function main() {
  // 1. Reset session status from error to in_progress
  await sql`UPDATE "trainingSessions" SET 
    status = 'in_progress', 
    "errorMessage" = null,
    "updatedAt" = NOW()
  WHERE id = 118`;
  console.log('Reset session 118 to in_progress');

  // 2. Queue iterations 3, 4, 5 with staggered delays (5s apart)
  // This gives each iteration time to complete before the next one starts
  for (let i = 3; i <= 5; i++) {
    const delay = (i - 3) * 15000 + 1000; // 1s, 16s, 31s
    await queue.add('phase-job', {
      sessionId: 118,
      userId: 8608,
      phase: 'training',
      iterationNumber: i,
    }, {
      delay,
    });
    console.log(`Queued iteration ${i} with ${delay}ms delay`);
  }

  // 3. Queue evaluation with enough delay for all training to complete
  await queue.add('phase-job', {
    sessionId: 118,
    userId: 8608,
    phase: 'evaluation',
  }, {
    delay: 50000, // 50s - should be enough for iterations 3-5 to complete
  });
  console.log('Queued evaluation with 50s delay');

  console.log('\n✅ All jobs queued! Monitor progress...');
  console.log('Expected timeline:');
  console.log('  ~1s: Iteration 3 starts');
  console.log('  ~16s: Iteration 4 starts');
  console.log('  ~31s: Iteration 5 starts');
  console.log('  ~50s: Evaluation starts');
  console.log('  ~60s: Session should be complete');

  await sql.end();
  await redis.quit();
}

main().catch(e => { console.error(e); process.exit(1); });
