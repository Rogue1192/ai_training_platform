// Start training session 118 by calling the tRPC API endpoint directly
const sessionId = 118;

// We need to call the tRPC endpoint as the paul user
// The tRPC endpoint is: POST /api/trpc/training.updateStatus
// Input: { id: 118, status: "in_progress" }

// First, we need to get a session cookie for paul
// Let's use Supabase auth to sign in as paul
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

console.log('Supabase URL:', supabaseUrl ? 'set' : 'missing');
console.log('Supabase Anon Key:', supabaseAnonKey ? 'set' : 'missing');

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Sign in as paul
const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email: 'paul@roguebusinessmarketing.com',
  password: 'zrKlJEUpXCLGcA1Z',
});

if (authError) {
  console.error('Auth error:', authError);
  process.exit(1);
}

console.log('Signed in as:', authData.user.email);
const accessToken = authData.session.access_token;

// Now call the tRPC endpoint
const baseUrl = 'http://127.0.0.1:3000';
const input = JSON.stringify({ "0": { json: { id: sessionId, status: "in_progress" } } });

const response = await fetch(`${baseUrl}/api/trpc/training.updateStatus?batch=1`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  },
  body: input,
});

const result = await response.json();
console.log('Response status:', response.status);
console.log('Response:', JSON.stringify(result, null, 2));

if (response.ok) {
  console.log('\n✅ Training session started! The V2 training engine should now be processing.');
  console.log('Monitor progress in the UI or check the database.');
} else {
  console.log('\n❌ Failed to start training session.');
}
