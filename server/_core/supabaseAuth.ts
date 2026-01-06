import { Request, Response, NextFunction } from "express";
import { supabase, isSupabaseConfigured } from "./supabase";
import { upsertUser, getUserByOpenId } from "../db";

/**
 * Extract Supabase user from Authorization header
 */
export async function getSupabaseUser(req: Request) {
  const authHeader = req.headers.authorization;
  
  console.log("[Supabase Auth] Checking authorization header:", authHeader ? "Present" : "Missing");
  console.log("[Supabase Auth] Supabase configured:", isSupabaseConfigured);
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.log("[Supabase Auth] No valid Bearer token in header");
    return null;
  }

  const token = authHeader.substring(7);
  console.log("[Supabase Auth] Token length:", token.length);

  if (!isSupabaseConfigured) {
    console.error("[Supabase Auth] Supabase is not configured - cannot verify token");
    return null;
  }

  try {
    console.log("[Supabase Auth] Verifying token with Supabase...");
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    console.log("[Supabase Auth] Supabase response - user:", user ? user.id : "null", "error:", error?.message || "none");

    if (error) {
      console.error("[Supabase Auth] Token verification error:", error.message);
      return null;
    }
    
    if (!user) {
      console.log("[Supabase Auth] No user returned from Supabase");
      return null;
    }

    console.log("[Supabase Auth] User verified:", user.id, user.email);

    // Sync user to our database
    console.log("[Supabase Auth] Upserting user to database...");
    try {
      await upsertUser({
        openId: user.id,
        email: user.email || null,
        name: user.user_metadata?.name || user.email || null,
        loginMethod: "supabase",
        lastSignedIn: new Date(),
      });
      console.log("[Supabase Auth] User upserted successfully");
    } catch (upsertError) {
      console.error("[Supabase Auth] Failed to upsert user:", upsertError);
      // Continue anyway - we can still return the user info
    }

    // Get full user record from our database
    console.log("[Supabase Auth] Getting user from database...");
    const dbUser = await getUserByOpenId(user.id);
    console.log("[Supabase Auth] Database user:", dbUser ? `id=${dbUser.id}` : "null");
    
    return dbUser;
  } catch (error) {
    console.error("[Supabase Auth] Error verifying token:", error);
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
