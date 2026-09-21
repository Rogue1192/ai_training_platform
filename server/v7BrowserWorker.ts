import path from "path";
import fs from "fs";
import { V7Account, V7Proxy } from "../drizzle/schema";
import { decrypt } from "./encryption";

/**
 * V7 Browser Worker
 *
 * Handles real browser automation via CloakBrowser Pro.
 * Uses persistent profiles so sessions stay logged in across runs.
 * Each account gets its own profile directory and a fixed fingerprint seed.
 *
 * Key rules (from CloakBrowser Pro docs):
 * - One profile, one seed — always reuse the same seed for the same profile
 * - Use launch_persistent_context (launchPersistentContext in JS) for all sessions
 * - geoip=True + residential proxy = biggest anti-bot win
 * - humanize=True, human_preset="careful" for all interactive sessions
 * - Always close in a finally block to free session slots
 * - Start headless=False for Google/ChatGPT (tough sites)
 */

export interface BrowserSessionResult {
  success: boolean;
  responseContent?: string;
  errorMessage?: string;
  screenshotPath?: string;
}

// Profile storage root — persistent across Railway deployments via volume
const PROFILES_DIR = process.env.CLOAK_PROFILES_DIR ?? path.join(process.cwd(), ".cloakprofiles");

function getProfileDir(accountId: number): string {
  const dir = path.join(PROFILES_DIR, `account_${accountId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getFingerprint(accountId: number): number {
  // Deterministic seed from account ID — stable across restarts, unique per account
  return 10000 + (accountId * 7919) % 89999;
}

function buildProxyString(proxy: V7Proxy | null): string | undefined {
  if (!proxy) return undefined;
  try {
    return decrypt(proxy.encryptedConnectionString);
  } catch {
    return undefined;
  }
}

export class V7BrowserWorker {
  /**
   * Runs a full AI training session for a given provider.
   * Opens the persistent profile, submits the query, reads the response,
   * and returns the response text. Closes the browser in a finally block.
   */
  static async runSession(
    account: V7Account,
    proxy: V7Proxy | null,
    provider: "chatgpt" | "gemini" | "google_ai_mode",
    query: string,
    followUpArguments: string[] = []
  ): Promise<BrowserSessionResult> {
    const licenseKey = process.env.CLOAKBROWSER_LICENSE_KEY;
    if (!licenseKey) {
      return { success: false, errorMessage: "CLOAKBROWSER_LICENSE_KEY not set" };
    }

    const profileDir = getProfileDir(account.id);
    const fingerprint = getFingerprint(account.id);
    const proxyString = buildProxyString(proxy);

    let ctx: any = null;

    try {
      const { launchPersistentContext } = await import("cloakbrowser");

      const launchArgs: string[] = [`--fingerprint=${fingerprint}`];
      // Allow 3rd-party cookies for embedded logins (needed for Google SSO on Gemini/AI Mode)
      if (provider === "gemini" || provider === "google_ai_mode") {
        launchArgs.push("--fingerprint-allow-3p-cookies");
      }

      ctx = await launchPersistentContext({
        userDataDir: profileDir,
        licenseKey,
        headless: false,           // headed — Google and ChatGPT detect headless
        humanize: true,
        humanPreset: "careful",
        geoip: true,               // match timezone + locale to proxy IP
        proxy: proxyString,
        args: launchArgs,
      });

      const page = await ctx.newPage();

      let responseContent: string | undefined;

      if (provider === "chatgpt") {
        responseContent = await V7BrowserWorker._runChatGPTSession(page, query, followUpArguments);
      } else if (provider === "google_ai_mode") {
        responseContent = await V7BrowserWorker._runGoogleAIModeSession(page, query, followUpArguments);
      } else {
        responseContent = await V7BrowserWorker._runGeminiSession(page, query, followUpArguments);
      }

      return { success: true, responseContent };

    } catch (err: any) {
      console.error(`[V7Browser] Session error for account ${account.id} on ${provider}:`, err?.message ?? err);
      return { success: false, errorMessage: err?.message ?? String(err) };
    } finally {
      if (ctx) {
        try { await ctx.close(); } catch { /* ignore close errors */ }
      }
    }
  }

  // ── ChatGPT session ─────────────────────────────────────────────────────────

  private static async _runChatGPTSession(
    page: any,
    query: string,
    followUps: string[]
  ): Promise<string> {
    await page.goto("https://chat.openai.com/", { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for the prompt textarea to be ready
    await page.waitForSelector('textarea[placeholder], div[contenteditable="true"]', { timeout: 30000 });

    // Type the initial query
    await V7BrowserWorker._typeIntoChat(page, query);

    // Read the response
    let response = await V7BrowserWorker._waitForChatGPTResponse(page);

    // Submit follow-up arguments (debate turns)
    for (const arg of followUps) {
      await page.waitForTimeout(2000 + Math.random() * 2000);
      await V7BrowserWorker._typeIntoChat(page, arg);
      response = await V7BrowserWorker._waitForChatGPTResponse(page);
    }

    return response;
  }

  private static async _typeIntoChat(page: any, text: string): Promise<void> {
    // Try the textarea first, then contenteditable div
    const input = await page.$('textarea[placeholder]') ?? await page.$('div[contenteditable="true"]');
    if (!input) throw new Error("Could not find chat input");
    await input.click();
    await input.fill(text);
    await page.keyboard.press("Enter");
  }

  private static async _waitForChatGPTResponse(page: any): Promise<string> {
    // Wait for the stop-generating button to disappear (generation complete)
    try {
      await page.waitForSelector('[data-testid="stop-button"]', { timeout: 10000 });
      await page.waitForSelector('[data-testid="stop-button"]', { state: "hidden", timeout: 120000 });
    } catch {
      // If stop button never appeared, just wait a bit
      await page.waitForTimeout(5000);
    }

    // Extract the last assistant message
    const messages = await page.$$eval(
      '[data-message-author-role="assistant"]',
      (els: Element[]) => els.map(el => el.textContent ?? "")
    );
    return messages[messages.length - 1] ?? "";
  }

  // ── Gemini session ──────────────────────────────────────────────────────────

  private static async _runGeminiSession(
    page: any,
    query: string,
    followUps: string[]
  ): Promise<string> {
    await page.goto("https://gemini.google.com/", { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for the input area
    await page.waitForSelector('rich-textarea, textarea[aria-label]', { timeout: 30000 });

    await V7BrowserWorker._typeIntoGemini(page, query);
    let response = await V7BrowserWorker._waitForGeminiResponse(page);

    for (const arg of followUps) {
      await page.waitForTimeout(2000 + Math.random() * 2000);
      await V7BrowserWorker._typeIntoGemini(page, arg);
      response = await V7BrowserWorker._waitForGeminiResponse(page);
    }

    return response;
  }

  private static async _typeIntoGemini(page: any, text: string): Promise<void> {
    const input = await page.$('rich-textarea') ?? await page.$('textarea[aria-label]');
    if (!input) throw new Error("Could not find Gemini input");
    await input.click();
    await input.fill(text);
    await page.keyboard.press("Enter");
  }

  private static async _waitForGeminiResponse(page: any): Promise<string> {
    // Wait for the loading indicator to disappear
    try {
      await page.waitForSelector('.loading-indicator, [aria-label="Stop generating"]', { timeout: 10000 });
      await page.waitForSelector('.loading-indicator, [aria-label="Stop generating"]', { state: "hidden", timeout: 120000 });
    } catch {
      await page.waitForTimeout(5000);
    }

    // Extract the last model response
    const messages = await page.$$eval(
      'model-response, .model-response-text',
      (els: Element[]) => els.map(el => el.textContent ?? "")
    );
    return messages[messages.length - 1] ?? "";
  }

  // ── Google AI Mode session ───────────────────────────────────────────────────
  // Google AI Mode (AI Overviews / AI Mode in Google Search) — accessed via
  // https://www.google.com/search?udm=50 which forces AI Mode results.

  private static async _runGoogleAIModeSession(
    page: any,
    query: string,
    followUps: string[]
  ): Promise<string> {
    // Navigate to Google AI Mode
    const encodedQuery = encodeURIComponent(query);
    await page.goto(`https://www.google.com/search?q=${encodedQuery}&udm=50`, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Wait for AI Mode response to load
    await page.waitForTimeout(5000);

    // Extract the AI Mode response text
    let response = await V7BrowserWorker._extractGoogleAIModeResponse(page);

    // Submit follow-up questions via the AI Mode conversation input
    for (const arg of followUps) {
      await page.waitForTimeout(2000 + Math.random() * 2000);
      // Find the follow-up input in AI Mode
      const input = await page.$('textarea[aria-label], input[aria-label*="Search"], div[contenteditable="true"]');
      if (input) {
        await input.click();
        await input.fill(arg);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(5000);
        response = await V7BrowserWorker._extractGoogleAIModeResponse(page);
      }
    }

    return response;
  }

  private static async _extractGoogleAIModeResponse(page: any): Promise<string> {
    try {
      // AI Mode response containers — these selectors may need updating as Google changes their DOM
      const text = await page.$eval(
        '[data-attrid="wa:/description"], .ai-overview-content, [jsname="yEVEwb"], .kp-blk',
        (el: Element) => el.textContent ?? ""
      ).catch(() => "");
      if (text) return text;
      // Fallback: grab all visible text from the main content area
      return await page.$eval('main, #main, #rcnt', (el: Element) => el.textContent ?? "").catch(() => "");
    } catch {
      return "";
    }
  }
}
