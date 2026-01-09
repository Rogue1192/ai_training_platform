import postgres from 'postgres';

const sql = postgres(process.env.SUPABASE_DATABASE_URL);

async function checkSessions() {
  try {
    const sessions = await sql`SELECT * FROM "trainingSessions" ORDER BY id`;
    console.log('Training Sessions:');
    sessions.forEach(s => {
      console.log(`  ID: ${s.id}`);
      console.log(`    Name: ${s.name}`);
      console.log(`    Status: ${s.status}`);
      console.log(`    Iterations: ${s.currentIteration}/${s.totalIterations}`);
      console.log(`    Goal Achieved: ${s.goalAchieved}`);
      console.log(`    Last Update: ${s.updatedAt}`);
      console.log('');
    });
    
    // Also check queue status
    console.log('\n--- Queue Jobs ---');
    const { Queue } = await import('bullmq');
    const { Redis } = await import('ioredis');
    
    const redis = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
    });
    
    const queue = new Queue('training-queue', { connection: redis });
    
    const waiting = await queue.getWaiting();
    const active = await queue.getActive();
    const completed = await queue.getCompleted();
    const delayed = await queue.getDelayed();
    const failed = await queue.getFailed();
    
    console.log(`Waiting: ${waiting.length}`);
    console.log(`Active: ${active.length}`);
    console.log(`Completed: ${completed.length}`);
    console.log(`Delayed: ${delayed.length}`);
    console.log(`Failed: ${failed.length}`);
    
    if (delayed.length > 0) {
      console.log('\nDelayed Jobs:');
      for (const job of delayed) {
        const delay = job.opts.delay;
        const processAt = new Date(job.timestamp + delay);
        console.log(`  Job ${job.id}: Session ${job.data.sessionId}, Iteration ${job.data.iteration}`);
        console.log(`    Will process at: ${processAt.toLocaleTimeString()}`);
      }
    }
    
    await queue.close();
    await redis.quit();
    await sql.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

checkSessions();
