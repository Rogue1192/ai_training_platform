import { Request, Response, NextFunction } from "express";
import { supabase, isSupabaseConfigured } from "./supabase";
import { upsertUser, getUserByOpenId } from "../db";

/**
 * Extract Supabase user from Authorization header.
 * BUG-010 fix: removed verbose console.log statements that leaked user emails and IDs
 * to production logs on every single API request.
 */
export async function getSupabaseUser(req: Request) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7);

  if (!isSupabaseConfigured) {
    console.error("[Auth] Supabase is not configured — cannot verify token");
    return null;
  }

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error) {
      console.error("[Auth] Token verification error:", error.message);
      return null;
    }

    if (!user) {
      return null;
    }

    // Sync user to our database
    try {
      await upsertUser({
        openId: user.id,
        email: user.email || null,
        name: user.user_metadata?.name || user.email || null,
        loginMethod: "supabase",
        lastSignedIn: new Date(),
      });
    } catch (upsertError) {
      // Non-fatal — continue with auth even if sync fails
      console.error("[Auth] Failed to sync user to database:", upsertError);
    }

    // Return full user record from our database
    return await getUserByOpenId(user.id);
  } catch (error) {
    console.error("[Auth] Error verifying token:", error);
    return null;
  }
}

/**
 * Middleware to attach Supabase user to request
 */
export async function supabaseAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const user = await getSupabaseUser(req);
  (req as any).user = user;
  next();
}
