import { db } from './server/_core/db.js';
import { trainingSessions } from './drizzle/schema.js';
import { desc } from 'drizzle-orm';

const sessions = await db.select().from(trainingSessions).orderBy(desc(trainingSessions.createdAt)).limit(5);
sessions.forEach(s => console.log('ID:', s.id, '| Name:', s.trainingName, '| Status:', s.status, '| Progress:', s.currentProgress + '/' + s.iterations));
process.exit(0);
