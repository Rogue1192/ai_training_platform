import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

console.log("[Supabase Init] URL set:", !!supabaseUrl, "Key set:", !!supabaseAnonKey);

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
  console.warn("[Supabase] Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable authentication.");
} else {
  // Log session status on initialization
  supabase.auth.getSession().then(({ data: { session } }) => {
    console.log("[Supabase] Initial session check:", session ? "Session found" : "No session");
    if (session) {
      console.log("[Supabase] Session user:", session.user?.email);
      console.log("[Supabase] Access token length:", session.access_token?.length);
    }
  }).catch(err => {
    console.error("[Supabase] Error checking initial session:", err);
  });
  
  // Listen for auth state changes and store the token globally
  supabase.auth.onAuthStateChange((event, session) => {
    console.log("[Supabase] Auth state changed:", event);
    if (session?.access_token) {
      (window as any).__supabaseToken = session.access_token;
      console.log("[Supabase] Token stored");
    } else {
      (window as any).__supabaseToken = null;
    }
  });
  
  // Get initial session and wait for it
  const sessionPromise = supabase.auth.getSession().then(({ data: { session } }) => {
    if (session?.access_token) {
      (window as any).__supabaseToken = session.access_token;
      console.log("[Supabase] Initial token set");
    }
    return session;
  });
  
  // Expose the promise globally so the tRPC client can wait for it
  (window as any).__supabaseSessionPromise = sessionPromise;
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
