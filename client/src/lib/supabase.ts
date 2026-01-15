import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Create a mock client for when Supabase is not configured
const createMockClient = (): SupabaseClient => {
  const mockError = new Error("Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables.");
  
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: mockError }),
      getUser: async () => ({ data: { user: null }, error: mockError }),
      signOut: async () => ({ error: mockError }),
      signInWithPassword: async () => ({ data: { user: null, session: null }, error: mockError }),
      signUp: async () => ({ data: { user: null, session: null }, error: mockError }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      mfa: {
        listFactors: async () => ({ data: { totp: [] }, error: null }),
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: null, nextLevel: null }, error: null }),
        enroll: async () => ({ data: null, error: mockError }),
        challenge: async () => ({ data: null, error: mockError }),
        verify: async () => ({ data: null, error: mockError }),
        unenroll: async () => ({ data: null, error: mockError }),
      },
    },
  } as unknown as SupabaseClient;
};

// Only create real client if configured, otherwise use mock
export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : createMockClient();

if (!isSupabaseConfigured) {
  console.warn("[Supabase] Not configured. Authentication features will be disabled.");
}

// Helper to get current session
export async function getSession() {
  if (!isSupabaseConfigured) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

// Helper to get current user
export async function getCurrentUser() {
  if (!isSupabaseConfigured) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

// Helper to sign out
export async function signOut() {
  if (!isSupabaseConfigured) {
    console.warn("[Supabase] Cannot sign out - Supabase not configured");
    return;
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("[Supabase] Sign out error:", error);
    throw error;
  }
}
