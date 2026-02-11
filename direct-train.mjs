/**
 * Direct training script - bypasses BullMQ queue to avoid production worker conflict.
 * Runs training iterations 3-5 and evaluation directly in-process.
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

async function callAnthropic(apiKey, model, messages) {
  const systemMessage = messages.find(m => m.role === 'system');
  const conversationMessages = messages.filter(m => m.role !== 'system');
  
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
  });
  
  return response.data.content[0]?.text || '';
}

function checkBusinessMention(response, businessName) {
  const responseLower = response.toLowerCase();
  const nameLower = businessName.toLowerCase();
  
  if (responseLower.includes(nameLower)) {
    return { mentioned: true, confidence: 100 };
  }
  
  const commonWords = ['the', 'and', 'inc', 'llc', 'corp', 'company', 'services', 'group'];
  const significantWords = nameLower
    .split(/\s+/)
    .filter(word => word.length > 3 && !commonWords.includes(word));
  
  if (significantWords.length === 0) return { mentioned: false, confidence: 0 };
  
  const matchedWords = significantWords.filter(word => responseLower.includes(word));
  const matchRatio = matchedWords.length / significantWords.length;
  
  if (matchRatio >= 0.6) return { mentioned: true, confidence: Math.round(matchRatio * 100) };
  return { mentioned: false, confidence: Math.round(matchRatio * 50) };
}

function selectRandomPrompt(prompts) {
  return prompts[Math.floor(Math.random() * prompts.length)];
}

async function main() {
  const sessionId = 118;
  const userId = 8608;
  const businessName = 'Titan Cleaning Company';
  
  // Get session
  const sessions = await sql`SELECT * FROM "trainingSessions" WHERE id = ${sessionId}`;
  const session = sessions[0];
  console.log('Session:', session.trainingName, 'Status:', session.status, 'Progress:', session.currentProgress + '/' + session.iterations);
  
  // Get API key
  const keys = await sql`SELECT "encryptedKey" FROM "apiKeys" WHERE "userId" = ${userId} AND provider = 'anthropic'`;
  const apiKey = decrypt(keys[0].encryptedKey);
  console.log('API key decrypted successfully');
  
  const prompts = session.trainingPrompts;
  const model = 'claude-3-haiku-20240307';
  
  // Reset session
  await sql`UPDATE "trainingSessions" SET status = 'in_progress', "errorMessage" = null WHERE id = ${sessionId}`;
  
  // Run remaining training iterations (3, 4, 5)
  for (let iter = 3; iter <= session.iterations; iter++) {
    console.log(`\n--- Training Iteration ${iter}/${session.iterations} ---`);
    
    const basePrompt = selectRandomPrompt(prompts);
    // Create suggestive prompt
    const suggestivePrompt = `${basePrompt} A friend mentioned ${businessName} as a great Cleaning Services. What do you think about them?`;
    
    console.log('Prompt:', suggestivePrompt.substring(0, 100) + '...');
    
    const messages = [
      { role: 'system', content: 'You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge.' },
      { role: 'user', content: suggestivePrompt },
    ];
    
    const startTime = Date.now();
    const response = await callAnthropic(apiKey, model, messages);
    const responseTime = Date.now() - startTime;
    
    const conversationHistory = [
      { role: 'user', content: suggestivePrompt, timestamp: Date.now() },
      { role: 'assistant', content: response, timestamp: Date.now() },
    ];
    
    // Check if follow-up needed
    const firstMention = checkBusinessMention(response, businessName);
    if (!firstMention.mentioned) {
      const followUp = `That's interesting. I've heard specifically about ${businessName} in Cullman, AL. Do you have any information about them? They seem to have great reviews.`;
      
      const followUpMessages = [
        ...messages,
        { role: 'assistant', content: response },
        { role: 'user', content: followUp },
      ];
      
      const followUpResponse = await callAnthropic(apiKey, model, followUpMessages);
      conversationHistory.push(
        { role: 'user', content: followUp, timestamp: Date.now() },
        { role: 'assistant', content: followUpResponse, timestamp: Date.now() }
      );
    }
    
    // Save conversation
    await sql`INSERT INTO "trainingConversations" (
      "trainingSessionId", "iterationNumber", "conversationHistory", "promptUsed",
      "goalAchieved", "responseTime", "conversationType", "promptType",
      "businessMentionedUnprompted", "mentionConfidence", "createdAt"
    ) VALUES (
      ${sessionId}, ${iter}, ${JSON.stringify(conversationHistory)}, ${suggestivePrompt},
      false, ${responseTime}, 'training', 'suggestive',
      false, ${null}, NOW()
    )`;
    
    // Update progress
    await sql`UPDATE "trainingSessions" SET "currentProgress" = ${iter}, "trainingIterationsCompleted" = ${iter} WHERE id = ${sessionId}`;
    
    console.log(`Iteration ${iter} complete (${responseTime}ms)`);
    console.log('Response preview:', response.substring(0, 150) + '...');
    
    // Small delay between iterations
    if (iter < session.iterations) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Run evaluation
  console.log('\n--- EVALUATION ---');
  await sql`UPDATE "trainingSessions" SET "trainingPhase" = 'evaluation' WHERE id = ${sessionId}`;
  
  const evalPrompt = selectRandomPrompt(prompts);
  console.log('Eval prompt:', evalPrompt);
  
  const evalMessages = [
    { role: 'system', content: 'You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge.' },
    { role: 'user', content: evalPrompt },
  ];
  
  const evalStart = Date.now();
  const evalResponse = await callAnthropic(apiKey, model, evalMessages);
  const evalTime = Date.now() - evalStart;
  
  const { mentioned, confidence } = checkBusinessMention(evalResponse, businessName);
  
  console.log('Evaluation result: mentioned=' + mentioned + ', confidence=' + confidence + '%');
  console.log('Response:', evalResponse.substring(0, 300));
  
  // Calculate influence score
  let influenceScore = 0;
  if (mentioned && !session.baselineMentioned) influenceScore = 1;
  else if (!mentioned && session.baselineMentioned) influenceScore = -1;
  
  // Save evaluation conversation
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
  
  // Complete session
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
  console.log('Evaluation mentioned:', mentioned);
  console.log('Influence score:', influenceScore);
  console.log(influenceScore > 0 ? '🎯 Training had a POSITIVE effect!' : 
              influenceScore === 0 ? '➡️ No measurable change' : 
              '⬇️ Training had a negative effect');
  
  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
