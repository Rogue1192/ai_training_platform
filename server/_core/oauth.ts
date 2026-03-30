/**
 * OAuth routes — standalone
 * 
 * The app uses Supabase Auth (supabaseAuth.ts) for authentication.
 * This file is kept for compatibility but the legacy Manus OAuth
 * callback is no longer functional. If called, it redirects to /login.
 */
import type { Express, Request, Response } from "express";

export function registerOAuthRoutes(app: Express) {
  // Legacy OAuth callback — redirect to login page
  app.get("/api/oauth/callback", async (_req: Request, res: Response) => {
    res.redirect(302, "/login");
  });
}
