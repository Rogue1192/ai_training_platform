import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
});

const queue = new Queue('training-iterations', { connection });

async function checkQueue() {
  try {
    const waiting = await queue.getWaitingCount();
    const active = await queue.getActiveCount();
    const completed = await queue.getCompletedCount();
    const failed = await queue.getFailedCount();
    const delayed = await queue.getDelayedCount();
    
    console.log('Queue Status:');
    console.log(`  Waiting: ${waiting}`);
    console.log(`  Active: ${active}`);
    console.log(`  Completed: ${completed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Delayed: ${delayed}`);
    
    // Get all jobs
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed', 'failed']);
    console.log(`\nTotal jobs: ${jobs.length}`);
    
    for (const job of jobs.slice(0, 5)) {
      console.log(`  Job ${job.id}: ${job.name} - ${job.data?.sessionId} iteration ${job.data?.iterationNumber}`);
    }
    
    await queue.close();
    await connection.quit();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkQueue();
