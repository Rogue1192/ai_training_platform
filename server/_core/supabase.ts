import { createClient } from "@supabase/supabase-js";
import { ENV } from "./env";

// Supabase client for server-side operations
export const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

// Validate Supabase configuration
export function validateSupabaseConfig(): boolean {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[Supabase] ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured!");
    return false;
  }
  return true;
}

// Initialize Supabase
if (validateSupabaseConfig()) {
  console.log("[Supabase] Initialized successfully");
} else {
  console.warn("[Supabase] Not configured - authentication will not work");
}
