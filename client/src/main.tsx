import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { useState, useEffect, ReactNode } from "react";
import "./index.css";

// Global token storage
declare global {
  interface Window {
    __supabaseToken: string | null;
    __supabaseSessionReady: boolean;
  }
}

window.__supabaseToken = null;
window.__supabaseSessionReady = false;

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      headers() {
        const token = window.__supabaseToken;
        if (token) {
          return {
            Authorization: `Bearer ${token}`,
          };
        }
        return {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

// Session Provider that ensures session is loaded before rendering children
function SessionProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      console.log('[SessionProvider] Supabase not configured, skipping session load');
      window.__supabaseSessionReady = true;
      setIsReady(true);
      return;
    }

    // Load session from Supabase
    const loadSession = async () => {
      console.log('[SessionProvider] Loading session from Supabase...');
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('[SessionProvider] Error getting session:', error.message);
        } else if (session?.access_token) {
          console.log('[SessionProvider] Session found, token length:', session.access_token.length);
          window.__supabaseToken = session.access_token;
        } else {
          console.log('[SessionProvider] No session found');
        }
      } catch (error: any) {
        console.error('[SessionProvider] Error loading session:', error.message);
      } finally {
        window.__supabaseSessionReady = true;
        setIsReady(true);
      }
    };

    loadSession();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[SessionProvider] Auth state changed:', event, 'session:', !!session);
      if (session?.access_token) {
        window.__supabaseToken = session.access_token;
        // Invalidate all queries to refetch with new token
        queryClient.invalidateQueries();
      } else {
        window.__supabaseToken = null;
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <SessionProvider>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </trpc.Provider>
  </SessionProvider>
);
