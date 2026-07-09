import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { getSupabaseUser } from "./supabaseAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** Set when a super-admin is impersonating an agency (x-impersonate-agency header) */
  impersonatedAgencyId: number | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    user = (await getSupabaseUser(opts.req)) || null;
  } catch (error) {
    // Authentication is optional for public procedures.
    user = null;
  }

  // Impersonation: super-admin can pass x-impersonate-agency header to view as an agency
  let impersonatedAgencyId: number | null = null;
  const impersonateHeader = opts.req.headers['x-impersonate-agency'];
  if (impersonateHeader && user?.role === 'admin') {
    const parsed = parseInt(String(impersonateHeader), 10);
    if (!isNaN(parsed)) impersonatedAgencyId = parsed;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    impersonatedAgencyId,
  };
}
