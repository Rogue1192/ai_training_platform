import { Queue } from 'bullmq';
import Redis from 'ioredis';

const redisConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const queue = new Queue('training-iterations-v2', { connection: redisConnection });

async function main() {
  // 1. Update the session's retryInterval in the database
  const postgres = (await import('postgres')).default;
  const sql = postgres(process.env.SUPABASE_DATABASE_URL, { ssl: 'require' });
  
  await sql`UPDATE "trainingSessions" SET "retryInterval" = 1 WHERE id = 118`;
  console.log('Updated retryInterval to 1 minute');

  // 2. Remove all delayed/waiting jobs for session 118
  const delayedJobs = await queue.getJobs(['delayed', 'waiting']);
  let removed = 0;
  for (const job of delayedJobs) {
    if (job.data.sessionId === 118) {
      console.log(`Removing job ${job.id}: phase=${job.data.phase}, iteration=${job.data.iterationNumber}, delay=${job.opts?.delay}ms`);
      await job.remove();
      removed++;
    }
  }
  console.log(`Removed ${removed} queued jobs`);

  // 3. Check current progress
  const session = await sql`SELECT "currentProgress", iterations, "trainingPhase" FROM "trainingSessions" WHERE id = 118`;
  const { currentProgress, iterations, trainingPhase } = session[0];
  console.log(`Current progress: ${currentProgress}/${iterations}, phase: ${trainingPhase}`);

  // 4. Re-queue remaining training iterations with 1 minute (60s) delay
  const nextIteration = currentProgress + 1;
  if (trainingPhase === 'training' && nextIteration <= iterations) {
    await queue.add('phase-job', {
      sessionId: 118,
      userId: 8608,
      phase: 'training',
      iterationNumber: nextIteration,
    }, {
      delay: 5000, // Start next one in 5 seconds
    });
    console.log(`Re-queued iteration ${nextIteration} with 5s delay (subsequent will use 1 min interval)`);
  } else if (trainingPhase === 'evaluation') {
    await queue.add('phase-job', {
      sessionId: 118,
      userId: 8608,
      phase: 'evaluation',
    }, {
      delay: 5000,
    });
    console.log('Re-queued evaluation with 5s delay');
  }

  console.log('\n✅ Speed-up applied! Remaining iterations will use 1 minute intervals.');
  
  await sql.end();
  await redisConnection.quit();
}

main().catch(e => { console.error(e); process.exit(1); });
