/**
 * AI Scan Video Recorder
 *
 * Records short (~15 second) before/after videos of real AI search sessions
 * on ChatGPT and Google AI (Gemini). Videos are uploaded to Supabase Storage
 * and the public URLs are stored on the campaign record for use in emails
 * and the client dashboard.
 *
 * Flow:
 *  BEFORE (baseline): Record that the business is NOT mentioned
 *  AFTER (win):       Record that the business IS mentioned
 *
 * Both videos are attached to the win notification email.
 */

import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { storagePut } from "./storage";
import { getDb } from "./db";
import { campaigns } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

export type ScanPlatform = "chatgpt" | "google_ai";
export type ScanPhase = "before" | "after";

export interface ScanVideoResult {
  success: boolean;
  videoUrl?: string;
  platform: ScanPlatform;
  phase: ScanPhase;
  query: string;
  location: string;
  error?: string;
}

// ─── Platform URLs ────────────────────────────────────────────────────────────

const PLATFORM_URLS: Record<ScanPlatform, string> = {
  chatgpt: "https://chatgpt.com",
  google_ai: "https://www.google.com",
};

// ─── Core Recorder ───────────────────────────────────────────────────────────

/**
 * Record a single AI search session and return the public video URL.
 */
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
        "--window-size=1280,720",
      ],
    });

    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: {
        dir: videoDir,
        size: { width: 1280, height: 720 },
      },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    if (platform === "chatgpt") {
      await recordChatGPTSession(page, query, location);
    } else {
      await recordGoogleAISession(page, query, location);
    }

    // Close context to flush video file
    await context.close();
    context = null;
    await browser.close();
    browser = null;

    // Find the recorded video file
    const videoFiles = fs.readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
    if (videoFiles.length === 0) {
      throw new Error("No video file was recorded");
    }

    const videoPath = path.join(videoDir, videoFiles[0]);
    const videoBuffer = fs.readFileSync(videoPath);

    // Upload to Supabase Storage
    const storageKey = `scan-videos/${campaignId}/${queryLocationId}/${platform}-${phase}-${Date.now()}.webm`;
    const { url } = await storagePut(storageKey, videoBuffer, "video/webm");

    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });

    return {
      success: true,
      videoUrl: url,
      platform,
      phase,
      query,
      location,
    };
  } catch (error) {
    // Clean up on error
    try {
      if (context) await context.close();
      if (browser) await browser.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ScanVideoRecorder] Failed to record ${platform} ${phase} video:`, message);

    return {
      success: false,
      platform,
      phase,
      query,
      location,
      error: message,
    };
  }
}

// ─── ChatGPT Session ──────────────────────────────────────────────────────────

async function recordChatGPTSession(
  page: import("playwright").Page,
  query: string,
  location: string
): Promise<void> {
  const fullQuery = `${query} in ${location}`;

  // Navigate to ChatGPT
  await page.goto("https://chatgpt.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000);

  // Find the chat input — try multiple selectors
  const inputSelectors = [
    "#prompt-textarea",
    "textarea[placeholder*='Message']",
    "textarea[data-id='root']",
    "[contenteditable='true']",
    "textarea",
  ];

  let inputFound = false;
  for (const selector of inputSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
      await page.type(selector, fullQuery, { delay: 60 });
      inputFound = true;
      break;
    } catch {
      continue;
    }
  }

  if (!inputFound) {
    // Just navigate and wait — still captures the page state
    await page.waitForTimeout(3000);
    return;
  }

  // Submit the query
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");

  // Wait for response to stream in (up to 12 seconds)
  await page.waitForTimeout(12000);

  // Hold on the final result for 2 seconds
  await page.waitForTimeout(2000);
}

// ─── Google AI Session ────────────────────────────────────────────────────────

async function recordGoogleAISession(
  page: import("playwright").Page,
  query: string,
  location: string
): Promise<void> {
  const fullQuery = `${query} in ${location}`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(fullQuery)}&udm=50`;

  // Navigate directly to Google AI Mode search
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Wait for AI Overview / Gemini response to load
  try {
    await page.waitForSelector(
      '[data-attrid="wa:/description"], .ai-overview, [jsname="yEVEwb"], .kp-blk',
      { timeout: 10000 }
    );
  } catch {
    // Response may not have an AI overview — that's fine, still records the SERP
  }

  // Hold on the result for 4 seconds
  await page.waitForTimeout(4000);
}

// ─── Bulk Baseline Recording ──────────────────────────────────────────────────

/**
 * Record "before" videos for all query-location pairs in a campaign.
 * Called during the baseline evaluation phase.
 * Stores video URLs on the campaignQueryLocations records.
 */
export async function recordBaselineVideos(
  campaignId: number,
  queryLocations: Array<{
    id: number;
    searchQuery: string;
    location: string;
  }>
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  console.log(`[ScanVideoRecorder] Recording ${queryLocations.length * 2} baseline videos for campaign ${campaignId}`);

  for (const ql of queryLocations) {
    // Record for both platforms
    for (const platform of ["chatgpt", "google_ai"] as ScanPlatform[]) {
      try {
        const result = await recordScanVideo(
          platform,
          "before",
          ql.searchQuery,
          ql.location,
          campaignId,
          ql.id
        );

        if (result.success && result.videoUrl) {
          // Store the video URL on the query-location record
          const field = platform === "chatgpt" ? "beforeVideoChatgpt" : "beforeVideoGoogleAi";
          // Also set beforeVideoCapturedAt when both platforms have been recorded
          const { campaignQueryLocations: cqlTable } = require("../drizzle/schema");
          // Fetch the current record to check if the other platform's video is already saved
          const [current] = await db.select().from(cqlTable).where(eq(cqlTable.id, ql.id)).limit(1);
          const otherField = platform === "chatgpt" ? "beforeVideoGoogleAi" : "beforeVideoChatgpt";
          const otherAlreadySaved = current && !!current[otherField as keyof typeof current];
          await db
            .update(cqlTable)
            .set({
              [field]: result.videoUrl,
              ...(otherAlreadySaved ? { beforeVideoCapturedAt: new Date() } : {}),
            })
            .where(eq(cqlTable.id, ql.id));

          console.log(`[ScanVideoRecorder] ✓ ${platform} before video saved for query: ${ql.searchQuery}`);
        }
      } catch (err) {
        console.error(`[ScanVideoRecorder] Failed to record ${platform} baseline video:`, err);
      }
    }
  }
}

/**
 * Record "after" video for a specific query-location win.
 * Called by win detection when a business is first mentioned.
 * Stores video URL on the campaignQueryLocations record.
 */
export async function recordWinVideo(
  campaignId: number,
  queryLocationId: number,
  searchQuery: string,
  location: string,
  platform: ScanPlatform
): Promise<string | null> {
  try {
    const result = await recordScanVideo(
      platform,
      "after",
      searchQuery,
      location,
      campaignId,
      queryLocationId
    );

    if (result.success && result.videoUrl) {
      const db = await getDb();
      if (db) {
        const field = platform === "chatgpt" ? "afterVideoChatgpt" : "afterVideoGoogleAi";
        await db
          .update(require("../drizzle/schema").campaignQueryLocations)
          .set({ [field]: result.videoUrl })
          .where(eq(require("../drizzle/schema").campaignQueryLocations.id, queryLocationId));
      }

      console.log(`[ScanVideoRecorder] ✓ ${platform} after video saved for win: ${searchQuery} in ${location}`);
      return result.videoUrl;
    }
  } catch (err) {
    console.error(`[ScanVideoRecorder] Failed to record win video:`, err);
  }

  return null;
}
