import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Check if Supabase is configured
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);

// Create a mock client for when Supabase is not configured
const createMockClient = (): SupabaseClient => {
  const mockError = new Error("Supabase is not configured");
  
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: mockError }),
      admin: {
        getUserById: async () => ({ data: { user: null }, error: mockError }),
      },
    },
  } as unknown as SupabaseClient;
};

// Only create real client if configured, otherwise use mock
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : createMockClient();

// Validate Supabase configuration
export function validateSupabaseConfig(): boolean {
  return isSupabaseConfigured;
}

// Initialize Supabase
if (isSupabaseConfigured) {
  console.log("[Supabase] Initialized successfully");
} else {
  console.warn("[Supabase] Not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable authentication");
}
