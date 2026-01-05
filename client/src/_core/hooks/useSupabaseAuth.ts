import { supabase, signOut } from "@/lib/supabase";
import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useState } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";

export function useSupabaseAuth() {
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const utils = trpc.useUtils();

  // Get user from backend (synced with Supabase)
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    enabled: !!supabaseUser, // Only query if Supabase user exists
  });

  // Initialize Supabase auth state
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSupabaseUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseUser(session?.user ?? null);
      
      // Invalidate backend user query when auth changes
      utils.auth.me.invalidate();
    });

    return () => subscription.unsubscribe();
  }, [utils]);

  const logout = useCallback(async () => {
    try {
      await signOut();
      setSupabaseUser(null);
      utils.auth.me.setData(undefined, null);
    } catch (error) {
      console.error("[Auth] Logout error:", error);
      throw error;
    }
  }, [utils]);

  return {
    user: meQuery.data ?? null,
    supabaseUser,
    loading: loading || meQuery.isLoading,
    error: meQuery.error,
    isAuthenticated: !!supabaseUser,
    logout,
    refresh: () => meQuery.refetch(),
  };
}
