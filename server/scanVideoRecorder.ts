/**
 * AI Scan Video Recorder
 *
 * Records short (~15 second) before/after videos AND screenshots of real AI
 * search sessions on ChatGPT and Google AI (Gemini).
 *
 * Anti-bot-detection measures:
 *  - Disables navigator.webdriver flag via addInitScript
 *  - Spoofs Chrome runtime object
 *  - Real Chrome user agent (rotated pool)
 *  - Human-like typing delays and mouse movement before interaction
 *  - --disable-blink-features=AutomationControlled flag
 *  - Fresh incognito context per session (no cookies, no history, no memory)
 *
 * Flow:
 *  BEFORE (baseline): Record that the business is NOT mentioned
 *  AFTER (win):       Record that the business IS mentioned
 *
 * Both video URL and screenshot URL are stored per query-location record.
 * Screenshot is always attempted; video is best-effort.
 */
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { storagePut } from "./storage";
import { getDb } from "./db";
import { eq } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────
export type ScanPlatform = "chatgpt" | "google_ai";
export type ScanPhase = "before" | "after";

export interface ScanVideoResult {
  success: boolean;
  videoUrl?: string;
  screenshotUrl?: string;
  platform: ScanPlatform;
  phase: ScanPhase;
  query: string;
  location: string;
  error?: string;
}

// ─── User Agent Pool ──────────────────────────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ─── Human-like helpers ───────────────────────────────────────────────────────
function randDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanMouseWiggle(page: import("playwright").Page): Promise<void> {
  const x = randDelay(200, 900);
  const y = randDelay(100, 500);
  await page.mouse.move(x, y, { steps: randDelay(5, 15) });
  await page.waitForTimeout(randDelay(100, 300));
}

async function humanType(
  page: import("playwright").Page,
  selector: string,
  text: string
): Promise<void> {
  await page.click(selector);
  await page.waitForTimeout(randDelay(200, 500));
  for (const char of text) {
    await page.keyboard.type(char, { delay: randDelay(40, 120) });
    if (Math.random() < 0.05) {
      await page.waitForTimeout(randDelay(200, 600));
    }
  }
}

// ─── Stealth Script ───────────────────────────────────────────────────────────
async function injectStealthScripts(page: import("playwright").Page): Promise<void> {
  await page.addInitScript(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // Spoof Chrome runtime
    (window as any).chrome = {
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
      app: {},
    };
    // Spoof plugins
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    // Spoof languages
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });
    // Remove Playwright markers
    delete (window as any).__playwright;
    delete (window as any).__pw_manual;
  });
}

// ─── Core Recorder ───────────────────────────────────────────────────────────
export async function recordScanVideo(
  platform: ScanPlatform,
  phase: ScanPhase,
  query: string,
  location: string,
  campaignId: number,
  queryLocationId: number
): Promise<ScanVideoResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aaf-scan-"));
  const videoDir = path.join(tmpDir, "video");
  const screenshotPath = path.join(tmpDir, "screenshot.png");
  fs.mkdirSync(videoDir, { recursive: true });

  let browser = null;
  let context = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1280,800",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-default-apps",
        "--disable-infobars",
      ],
    });

    // Fresh incognito context — no cookies, no history, no memory
    context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      recordVideo: {
        dir: videoDir,
        size: { width: 1280, height: 800 },
      },
      userAgent: randomUserAgent(),
      storageState: undefined,
      locale: "en-US",
      timezoneId: "America/Chicago",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
      },
    });

    const page = await context.newPage();
    await injectStealthScripts(page);

    if (platform === "chatgpt") {
      await recordChatGPTSession(page, query, location);
    } else {
      await recordGoogleAISession(page, query, location);
    }

    // Capture screenshot before closing
    await page.screenshot({ path: screenshotPath, fullPage: false, type: "png" });

    await context.close();
    context = null;
    await browser.close();
    browser = null;

    // Upload screenshot
    let screenshotUrl: string | undefined;
    if (fs.existsSync(screenshotPath)) {
      const screenshotBuffer = fs.readFileSync(screenshotPath);
      const screenshotKey = `scan-screenshots/${campaignId}/${queryLocationId}/${platform}-${phase}-${Date.now()}.png`;
      const { url } = await storagePut(screenshotKey, screenshotBuffer, "image/png");
      screenshotUrl = url;
    }

    // Upload video (best-effort)
    let videoUrl: string | undefined;
    const videoFiles = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
    if (videoFiles.length > 0) {
      const videoPath = path.join(videoDir, videoFiles[0]);
      const videoBuffer = fs.readFileSync(videoPath);
      const storageKey = `scan-videos/${campaignId}/${queryLocationId}/${platform}-${phase}-${Date.now()}.webm`;
      const { url } = await storagePut(storageKey, videoBuffer, "video/webm");
      videoUrl = url;
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });

    return { success: true, videoUrl, screenshotUrl, platform, phase, query, location };
  } catch (error) {
    try {
      if (context) await context.close();
      if (browser) await browser.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ScanVideoRecorder] Failed to record ${platform} ${phase}:`, message);
    return { success: false, platform, phase, query, location, error: message };
  }
}

// ─── ChatGPT Session ──────────────────────────────────────────────────────────
async function recordChatGPTSession(
  page: import("playwright").Page,
  query: string,
  location: string
): Promise<void> {
  const fullQuery = `${query} in ${location}`;

  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(randDelay(1500, 3000));
  await humanMouseWiggle(page);

  // Dismiss consent banners
  for (const sel of ["button[data-testid='accept-button']", "button:has-text('Accept')", "button:has-text('OK')"]) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        await page.waitForTimeout(randDelay(500, 1000));
        break;
      }
    } catch { /* no banner */ }
  }

  const inputSelectors = [
    "#prompt-textarea",
    "textarea[placeholder*='Message']",
    "textarea[placeholder*='Ask']",
    "div[contenteditable='true'][data-placeholder]",
    "[contenteditable='true']",
    "textarea",
  ];

  let inputFound = false;
  for (const selector of inputSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 6000 });
      const el = page.locator(selector).first();
      const box = await el.boundingBox();
      if (box) {
        await page.mouse.move(
          box.x + box.width / 2 + randDelay(-20, 20),
          box.y + box.height / 2 + randDelay(-5, 5),
          { steps: randDelay(8, 20) }
        );
        await page.waitForTimeout(randDelay(100, 300));
      }
      await humanType(page, selector, fullQuery);
      inputFound = true;
      break;
    } catch { continue; }
  }

  if (!inputFound) {
    await page.waitForTimeout(3000);
    return;
  }

  await page.waitForTimeout(randDelay(400, 800));
  await page.keyboard.press("Enter");

  // Wait for streaming to complete
  try {
    await page.waitForSelector(
      "button[aria-label='Stop streaming'], button[data-testid='stop-button']",
      { timeout: 8000 }
    );
    await page.waitForSelector(
      "button[aria-label='Stop streaming'], button[data-testid='stop-button']",
      { state: "hidden", timeout: 25000 }
    );
  } catch {
    await page.waitForTimeout(14000);
  }

  await page.waitForTimeout(randDelay(1500, 2500));
}

// ─── Google AI Session ────────────────────────────────────────────────────────
async function recordGoogleAISession(
  page: import("playwright").Page,
  query: string,
  location: string
): Promise<void> {
  const fullQuery = `${query} in ${location}`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(fullQuery)}&udm=50`;

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(randDelay(2000, 4000));
  await humanMouseWiggle(page);

  try {
    await page.waitForSelector(
      '[data-attrid="wa:/description"], .ai-overview, [jsname="yEVEwb"], .kp-blk, [data-async-type="aiOverview"]',
      { timeout: 12000 }
    );
  } catch { /* no AI overview — still captures SERP */ }

  await page.mouse.wheel(0, randDelay(100, 300));
  await page.waitForTimeout(randDelay(1500, 2500));
}

// ─── Bulk Baseline Recording ──────────────────────────────────────────────────
export async function recordBaselineVideos(
  campaignId: number,
  queryLocations: Array<{ id: number; searchQuery: string; location: string }>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  console.log(`[ScanVideoRecorder] Recording ${queryLocations.length * 2} baseline sessions for campaign ${campaignId}`);

  for (const ql of queryLocations) {
    for (const platform of ["chatgpt", "google_ai"] as ScanPlatform[]) {
      try {
        const result = await recordScanVideo(platform, "before", ql.searchQuery, ql.location, campaignId, ql.id);

        if (result.success) {
          const videoField = platform === "chatgpt" ? "beforeVideoChatgpt" : "beforeVideoGoogleAi";
          const screenshotField = platform === "chatgpt" ? "beforeScreenshotChatgpt" : "beforeScreenshotGoogleAi";
          const { campaignQueryLocations: cqlTable } = require("../drizzle/schema");
          const [current] = await db.select().from(cqlTable).where(eq(cqlTable.id, ql.id)).limit(1);
          const otherVideoField = platform === "chatgpt" ? "beforeVideoGoogleAi" : "beforeVideoChatgpt";
          const otherAlreadySaved = current && !!current[otherVideoField as keyof typeof current];

          await db.update(cqlTable).set({
            ...(result.videoUrl ? { [videoField]: result.videoUrl } : {}),
            ...(result.screenshotUrl ? { [screenshotField]: result.screenshotUrl } : {}),
            ...(otherAlreadySaved ? { beforeVideoCapturedAt: new Date() } : {}),
          }).where(eq(cqlTable.id, ql.id));

          console.log(`[ScanVideoRecorder] ✓ ${platform} before saved for: ${ql.searchQuery} (video: ${!!result.videoUrl}, screenshot: ${!!result.screenshotUrl})`);
        }
      } catch (err) {
        console.error(`[ScanVideoRecorder] Failed ${platform} baseline:`, err);
      }
    }
  }
}

export async function recordWinVideo(
  campaignId: number,
  queryLocationId: number,
  searchQuery: string,
  location: string,
  platform: ScanPlatform
): Promise<string | null> {
  try {
    const result = await recordScanVideo(platform, "after", searchQuery, location, campaignId, queryLocationId);

    if (result.success) {
      const db = await getDb();
      if (db) {
        const videoField = platform === "chatgpt" ? "afterVideoChatgpt" : "afterVideoGoogleAi";
        const screenshotField = platform === "chatgpt" ? "afterScreenshotChatgpt" : "afterScreenshotGoogleAi";
        const cqlTable = require("../drizzle/schema").campaignQueryLocations;

        await db.update(cqlTable).set({
          ...(result.videoUrl ? { [videoField]: result.videoUrl } : {}),
          ...(result.screenshotUrl ? { [screenshotField]: result.screenshotUrl } : {}),
        }).where(eq(cqlTable.id, queryLocationId));
      }

      console.log(`[ScanVideoRecorder] ✓ ${platform} after saved for win: ${searchQuery} in ${location}`);
      return result.videoUrl || result.screenshotUrl || null;
    }
  } catch (err) {
    console.error(`[ScanVideoRecorder] Failed win recording:`, err);
  }
  return null;
}
