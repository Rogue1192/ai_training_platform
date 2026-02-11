import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { drizzle } = require('drizzle-orm/mysql2');
const mysql = require('mysql2/promise');

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const db = drizzle(conn);

  // 1. Get all users
  const [allUsers] = await conn.execute('SELECT id, name, email, role FROM users ORDER BY id');
  console.log('=== ALL USERS ===');
  console.log(JSON.stringify(allUsers, null, 2));

  // 2. Find sessions using gemini-2.0-flash-exp (the deprecated model)
  const [geminiSessions] = await conn.execute(
    "SELECT id, userId, trainingName, targetAiProvider, targetAiModel, influencerAiProvider, influencerAiModel, status, errorMessage FROM trainingSessions WHERE targetAiModel = 'gemini-2.0-flash-exp' OR influencerAiModel = 'gemini-2.0-flash-exp'"
  );
  console.log('\n=== SESSIONS USING DEPRECATED gemini-2.0-flash-exp ===');
  console.log(JSON.stringify(geminiSessions, null, 2));

  // 3. Find all sessions with errors
  const [errorSessions] = await conn.execute(
    "SELECT id, userId, trainingName, targetAiModel, influencerAiModel, status, errorMessage FROM trainingSessions WHERE status = 'error' OR errorMessage IS NOT NULL"
  );
  console.log('\n=== SESSIONS WITH ERRORS ===');
  console.log(JSON.stringify(errorSessions, null, 2));

  // 4. Check API keys for all users
  const [apiKeys] = await conn.execute(
    "SELECT id, userId, provider, createdAt FROM apiKeys ORDER BY userId"
  );
  console.log('\n=== API KEYS (metadata only) ===');
  console.log(JSON.stringify(apiKeys, null, 2));

  // 5. Find the specific sessions from the screenshot (Copper & Cable)
  const [copperSessions] = await conn.execute(
    "SELECT id, userId, trainingName, targetAiProvider, targetAiModel, influencerAiProvider, influencerAiModel, status, errorMessage, trainingPhase, currentProgress, iterations FROM trainingSessions WHERE trainingName LIKE '%Copper%'"
  );
  console.log('\n=== COPPER & CABLE SESSIONS ===');
  console.log(JSON.stringify(copperSessions, null, 2));

  await conn.end();
}

main().catch(e => console.error(e));
