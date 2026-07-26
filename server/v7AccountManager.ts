import { eq, and, asc, sql } from "drizzle-orm";
import { getDb } from "./db";
import { v7Accounts, v7Proxies, V7Account, V7Proxy } from "../drizzle/schema";

/**
 * V7 Account Manager
 * 
 * Handles the rotation and assignment of free ChatGPT/Gemini accounts for browser-based training.
 * Ensures accounts are rotated round-robin to simulate independent users (consensus signal).
 */

export interface AccountWithProxy {
  account: V7Account;
  proxy: V7Proxy | null;
}

export class V7AccountManager {
  /**
   * Gets the next available account for a specific provider (chatgpt or gemini).
   * Uses round-robin rotation based on lastUsedAt.
   */
  static async getNextAccount(provider: "chatgpt" | "gemini" | "google_ai_mode"): Promise<AccountWithProxy | null> {
    const db = await getDb();
    if (!db) return null;
    // google_ai_mode uses the same Google accounts as gemini
    const dbProvider: "chatgpt" | "gemini" = provider === "google_ai_mode" ? "gemini" : provider;
    // Find the least recently used active account for this provider
    const accounts = await db.select()
      .from(v7Accounts)
      .where(
        and(
          eq(v7Accounts.provider, dbProvider),
          eq(v7Accounts.status, "active")
        )
      )
      .orderBy(asc(v7Accounts.lastUsedAt))
      .limit(1);
      
    if (accounts.length === 0) {
      return null;
    }
    
    const account = accounts[0]!;
    let proxy: V7Proxy | null = null;
    
    // Fetch the associated proxy if one exists
    if (account.proxyId) {
      const proxies = await db.select()
        .from(v7Proxies)
        .where(eq(v7Proxies.id, account.proxyId))
        .limit(1);
        
      if (proxies.length > 0) {
        proxy = proxies[0]!;
      }
    }
    
    return { account, proxy };
  }
  
  /**
   * Marks an account as used, updating its lastUsedAt timestamp and incrementing session count.
   */
  static async markAccountUsed(accountId: number, success: boolean): Promise<void> {
    const db = await getDb();
    if (!db) return;
    if (success) {
      await db.update(v7Accounts)
        .set({
          lastUsedAt: new Date(),
          totalSessionsRun: sql`${v7Accounts.totalSessionsRun} + 1`,
          consecutiveErrors: 0,
          updatedAt: new Date()
        })
        .where(eq(v7Accounts.id, accountId));
    } else {
      // If error, increment consecutive errors. If it hits 3, flag the account.
      const accounts = await db!.select({ consecutiveErrors: v7Accounts.consecutiveErrors })
        .from(v7Accounts)
        .where(eq(v7Accounts.id, accountId))
        .limit(1);
        
      if (accounts.length > 0) {
        const currentErrors = accounts[0]!.consecutiveErrors;
        const newErrors = currentErrors + 1;
        const newStatus = newErrors >= 3 ? "flagged" : "active";
        
        await db.update(v7Accounts)
          .set({
            lastUsedAt: new Date(),
            consecutiveErrors: newErrors,
            status: newStatus,
            updatedAt: new Date()
          })
          .where(eq(v7Accounts.id, accountId));
      }
    }
  }
  
  /**
   * Flags a proxy as problematic (e.g., blocked by Cloudflare).
   */
  static async flagProxy(proxyId: number): Promise<void> {
    const db = await getDb();
    if (!db) return;
    await db.update(v7Proxies)
      .set({
        status: "flagged",
        lastTestedAt: new Date()
      })
      .where(eq(v7Proxies.id, proxyId));
  }
}
