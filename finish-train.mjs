/**
 * Finish training - completes iteration 5 and evaluation with retry logic.
 */
import crypto from 'crypto';
import axios from 'axios';
import postgres from 'postgres';

const sql = postgres(process.env.SUPABASE_DATABASE_URL, { ssl: 'require' });
const JWT_SECRET = process.env.JWT_SECRET;

function decrypt(encryptedData) {
  const parts = encryptedData.split(':');
  const salt = Buffer.from(parts[0], 'hex');
  const iv = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  const tag = Buffer.from(parts[3], 'hex');
  const key = crypto.pbkdf2Sync(JWT_SECRET, salt, 100000, 32, 'sha256');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function callAnthropicWithRetry(apiKey, model, messages, maxRetries = 3) {
  const systemMessage = messages.find(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model,
        max_tokens: 4096,
        system: systemMessage?.content,
        messages: conversationMessages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
      }, {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        timeout: 60000,
      });
      return response.data.content[0]?.text || '';
    } catch (e) {
      const status = e.response?.status;
      console.log(`  Attempt ${attempt}/${maxRetries} failed: ${status || e.message}`);
      if (attempt < maxRetries && (status === 529 || status === 503 || status === 500 || status === 429)) {
        const wait = attempt * 10000;
        console.log(`  Waiting ${wait/1000}s before retry...`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw e;
      }
    }
  }
}

function checkBusinessMention(response, businessName) {
  const responseLower = response.toLowerCase();
  const nameLower = businessName.toLowerCase();
  if (responseLower.includes(nameLower)) return { mentioned: true, confidence: 100 };
  const commonWords = ['the', 'and', 'inc', 'llc', 'corp', 'company', 'services', 'group'];
  const significantWords = nameLower.split(/\s+/).filter(w => w.length > 3 && !commonWords.includes(w));
  if (significantWords.length === 0) return { mentioned: false, confidence: 0 };
  const matchedWords = significantWords.filter(w => responseLower.includes(w));
  const matchRatio = matchedWords.length / significantWords.length;
  if (matchRatio >= 0.6) return { mentioned: true, confidence: Math.round(matchRatio * 100) };
  return { mentioned: false, confidence: Math.round(matchRatio * 50) };
}

async function main() {
  const sessionId = 118;
  const userId = 8608;
  const businessName = 'Titan Cleaning Company';
  const model = 'claude-3-haiku-20240307';
  
  // Get session
  const sessions = await sql`SELECT * FROM "trainingSessions" WHERE id = ${sessionId}`;
  const session = sessions[0];
  console.log('Session status:', session.status, 'Progress:', session.currentProgress + '/' + session.iterations);
  
  // Get API key
  const keys = await sql`SELECT "encryptedKey" FROM "apiKeys" WHERE "userId" = ${userId} AND provider = 'anthropic'`;
  const apiKey = decrypt(keys[0].encryptedKey);
  
  const prompts = session.trainingPrompts;
  
  // Check what's already done
  const convos = await sql`SELECT "iterationNumber", "conversationType" FROM "trainingConversations" WHERE "trainingSessionId" = ${sessionId} ORDER BY id`;
  console.log('Existing conversations:', convos.map(c => `iter${c.iterationNumber}(${c.conversationType})`).join(', '));
  
  const completedIterations = convos.filter(c => c.conversationType === 'training').map(c => c.iterationNumber);
  console.log('Completed training iterations:', completedIterations);
  
  // Reset session status
  await sql`UPDATE "trainingSessions" SET status = 'in_progress', "errorMessage" = null WHERE id = ${sessionId}`;
  
  // Run missing training iterations
  for (let iter = 1; iter <= session.iterations; iter++) {
    if (completedIterations.includes(iter)) {
      console.log(`\nIteration ${iter} already done, skipping`);
      continue;
    }
    
    console.log(`\n--- Training Iteration ${iter}/${session.iterations} ---`);
    const basePrompt = prompts[Math.floor(Math.random() * prompts.length)];
    const suggestivePrompt = `${basePrompt} A friend mentioned ${businessName} as a great Cleaning Services. What do you think about them?`;
    
    const startTime = Date.now();
    const response = await callAnthropicWithRetry(apiKey, model, [
      { role: 'system', content: 'You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge.' },
      { role: 'user', content: suggestivePrompt },
    ]);
    const responseTime = Date.now() - startTime;
    
    const conversationHistory = [
      { role: 'user', content: suggestivePrompt, timestamp: Date.now() },
      { role: 'assistant', content: response, timestamp: Date.now() },
    ];
    
    await sql`INSERT INTO "trainingConversations" (
      "trainingSessionId", "iterationNumber", "conversationHistory", "promptUsed",
      "goalAchieved", "responseTime", "conversationType", "promptType",
      "businessMentionedUnprompted", "mentionConfidence", "createdAt"
    ) VALUES (
      ${sessionId}, ${iter}, ${JSON.stringify(conversationHistory)}, ${suggestivePrompt},
      false, ${responseTime}, 'training', 'suggestive',
      false, ${null}, NOW()
    )`;
    
    await sql`UPDATE "trainingSessions" SET "currentProgress" = ${iter}, "trainingIterationsCompleted" = ${iter} WHERE id = ${sessionId}`;
    console.log(`Iteration ${iter} complete (${responseTime}ms)`);
    console.log('Response:', response.substring(0, 150) + '...');
    
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Run evaluation
  console.log('\n=== EVALUATION ===');
  await sql`UPDATE "trainingSessions" SET "trainingPhase" = 'evaluation' WHERE id = ${sessionId}`;
  
  const evalPrompt = prompts[Math.floor(Math.random() * prompts.length)];
  console.log('Eval prompt:', evalPrompt);
  
  const evalStart = Date.now();
  const evalResponse = await callAnthropicWithRetry(apiKey, model, [
    { role: 'system', content: 'You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge.' },
    { role: 'user', content: evalPrompt },
  ]);
  const evalTime = Date.now() - evalStart;
  
  const { mentioned, confidence } = checkBusinessMention(evalResponse, businessName);
  
  console.log('\nEvaluation response:');
  console.log(evalResponse);
  console.log('\nMentioned:', mentioned, 'Confidence:', confidence + '%');
  
  let influenceScore = 0;
  if (mentioned && !session.baselineMentioned) influenceScore = 1;
  else if (!mentioned && session.baselineMentioned) influenceScore = -1;
  
  await sql`INSERT INTO "trainingConversations" (
    "trainingSessionId", "iterationNumber", "conversationHistory", "promptUsed",
    "goalAchieved", "responseTime", "conversationType", "promptType",
    "businessMentionedUnprompted", "mentionConfidence", "createdAt"
  ) VALUES (
    ${sessionId}, ${session.iterations + 1}, ${JSON.stringify([
      { role: 'user', content: evalPrompt, timestamp: Date.now() },
      { role: 'assistant', content: evalResponse, timestamp: Date.now() },
    ])}, ${evalPrompt},
    ${mentioned}, ${evalTime}, 'evaluation', 'clean',
    ${mentioned}, ${confidence}, NOW()
  )`;
  
  await sql`UPDATE "trainingSessions" SET 
    "trainingPhase" = 'completed',
    status = 'completed',
    "completedAt" = NOW(),
    "evaluationMentioned" = ${mentioned},
    "influenceScore" = ${influenceScore},
    "currentProgress" = ${session.iterations}
  WHERE id = ${sessionId}`;
  
  console.log('\n✅ SESSION COMPLETE!');
  console.log('Baseline mentioned:', session.baselineMentioned);
  console.log('Evaluation mentioned:', mentioned, '(confidence:', confidence + '%)');
  console.log('Influence score:', influenceScore);
  console.log(influenceScore > 0 ? '🎯 Training had a POSITIVE effect!' : 
              influenceScore === 0 ? '➡️ No measurable change' : 
              '⬇️ Training had a negative effect');
  
  await sql.end();
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
