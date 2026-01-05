import { Request, Response, NextFunction } from "express";
import { supabase } from "./supabase";
import { upsertUser, getUserByOpenId } from "../db";

/**
 * Extract Supabase user from Authorization header
 */
export async function getSupabaseUser(req: Request) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.substring(7);

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return null;
    }

    // Sync user to our database
    await upsertUser({
      openId: user.id,
      email: user.email || null,
      name: user.user_metadata?.name || user.email || null,
      loginMethod: "supabase",
      lastSignedIn: new Date(),
    });

    // Get full user record from our database
    const dbUser = await getUserByOpenId(user.id);
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
