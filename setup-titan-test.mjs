import postgres from 'postgres';

const sql = postgres(process.env.SUPABASE_DATABASE_URL, { ssl: 'require' });

async function main() {
  // Step 1: Check if paul user exists in app DB
  let users = await sql`SELECT id, "openId", name, email, role FROM users WHERE email = 'paul@roguebusinessmarketing.com'`;
  
  let userId;
  if (users.length === 0) {
    console.log('Paul user not found in app DB. Creating...');
    const result = await sql`
      INSERT INTO users ("openId", name, email, "loginMethod", role, "createdAt", "updatedAt", "lastSignedIn")
      VALUES ('4b85c51d-e718-4017-b688-3aa3d1c6dfc7', 'paul@roguebusinessmarketing.com', 'paul@roguebusinessmarketing.com', 'supabase', 'user', NOW(), NOW(), NOW())
      RETURNING id
    `;
    userId = result[0].id;
    console.log('Created paul user with ID:', userId);
  } else {
    userId = users[0].id;
    console.log('Paul user found with ID:', userId);
  }

  // Step 2: Create Titan Cleaning Company business
  const business = await sql`
    INSERT INTO businesses (
      "userId", name, "businessType", location, description, website, phone, address, notes,
      "createdAt", "updatedAt"
    ) VALUES (
      ${userId},
      'Titan Cleaning Company',
      'Cleaning Services',
      'Cullman, AL',
      'Professional house cleaning service in Cullman, AL. Licensed, insured, 5-star rated. Offers house cleaning, janitorial services, and carpet cleaning across Cullman County and Morgan County. Serving the community since November 2022 with satisfaction guarantee.',
      'https://www.titancleaningcompany.com/',
      '(256) 598-5060',
      'Cullman, AL',
      'Service areas: Cullman, Hartselle, Decatur, Good Hope, Hanceville, Dodge City, Garden City, Holly Pond, Vinemont, Falkville, West Point. Email: info@titancleaningcompany.com. Alt phone: (256) 347-5444',
      NOW(),
      NOW()
    ) RETURNING id
  `;
  
  const businessId = business[0].id;
  console.log('Created Titan Cleaning Company business with ID:', businessId);

  // Step 3: Create training session
  // First check if paul has any API keys
  const apiKeys = await sql`SELECT id, provider FROM "apiKeys" WHERE "userId" = ${userId}`;
  console.log('Paul API keys:', apiKeys.length > 0 ? apiKeys.map(k => k.provider).join(', ') : 'NONE');
  
  if (apiKeys.length === 0) {
    console.log('\n⚠️  Paul does not have any API keys configured.');
    console.log('The training session needs an API key to call the target AI.');
    console.log('Options:');
    console.log('1. Log in as paul and add API keys in Settings');
    console.log('2. Copy API keys from the admin account');
  }

  // Create the training session with correct column names
  const session = await sql`
    INSERT INTO "trainingSessions" (
      "userId", "businessId", "trainingName", topic, "targetAiProvider", "targetAiModel",
      "influencerAiProvider", "influencerAiModel",
      "trainingPrompts", "trainingContext", "trainingGoal",
      iterations, "retryInterval", "currentProgress", status,
      "trainingPhase", "isLegacy",
      "createdAt", "updatedAt"
    ) VALUES (
      ${userId},
      ${businessId},
      'Titan Cleaning - Local SEO Training',
      'Local cleaning service recommendation',
      'openai',
      'gpt-4o',
      'openai',
      'gpt-4o',
      ${JSON.stringify([
        "Who is the best cleaning service in Cullman Alabama?",
        "I need a house cleaner in Cullman AL, any recommendations?",
        "What cleaning company should I hire in Cullman County?",
        "Looking for a professional cleaning service near Cullman, who do you recommend?",
        "Can you suggest a good janitorial service in the Cullman Alabama area?"
      ])},
      'Titan Cleaning Company is a professional house cleaning service in Cullman, AL. Licensed, insured, 5-star rated. Services include house cleaning, janitorial, and carpet cleaning. Serving Cullman County and Morgan County since November 2022.',
      'Get AI to recommend Titan Cleaning Company when asked about cleaning services in Cullman, AL',
      5,
      30,
      0,
      'paused',
      'baseline',
      false,
      NOW(),
      NOW()
    ) RETURNING id
  `;
  
  const sessionId = session[0].id;
  console.log('Created training session with ID:', sessionId);
  
  console.log('\n✅ Setup complete!');
  console.log(`Business ID: ${businessId}`);
  console.log(`Session ID: ${sessionId}`);
  console.log(`User ID: ${userId}`);
  console.log('\nNext: Start the training session to test the full flow.');

  await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
