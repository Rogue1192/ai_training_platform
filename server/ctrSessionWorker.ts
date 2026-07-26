import path from "path";
import fs from "fs";
import { getDb } from "./db";
import { sql } from "drizzle-orm";

/**
 * CTR Session Worker
 *
 * Runs GBP CTR click sessions and drive simulations via CloakBrowser Pro.
 *
 * Session types:
 * - "gbp_click"  : Search a keyword → find the GBP listing → click it → engage
 * - "drive"      : Open Google Maps → request driving directions to the business
 *
 * Key rules (CloakBrowser Pro):
 * - Persistent profiles — one profile per CTR browser profile record
 * - One seed per profile — deterministic from profile ID
 * - headless=False — Google detects headless
 * - geoip=True + residential proxy — mandatory
 * - humanize=True, human_preset="careful"
 * - Always ctx.close() in finally block
 */

const PROFILES_DIR = process.env.CLOAK_PROFILES_DIR ?? path.join(process.cwd(), ".cloakprofiles");

function getCtrProfileDir(profileId: number): string {
  const dir = path.join(PROFILES_DIR, `ctr_profile_${profileId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCtrFingerprint(profileId: number): number {
  // Deterministic, unique per profile, stable across restarts
  return 20000 + (profileId * 6271) % 79999;
}

export interface CtrSessionOptions {
  sessionId: number;
  campaignId: number;
  profileId: number;
  proxyUrl: string | null;
  sessionType: "gbp_click" | "drive";
  // GBP click fields
  keyword?: string;
  businessName?: string;
  googleMapsUrl?: string;
  // Drive simulation fields
  originLat?: number;
  originLng?: number;
  destinationAddress?: string;
  journeyType?: "driving" | "transit" | "walking" | "cycling";
  // Ramp / behavior
  dwellSeconds?: number;     // how long to stay on the GBP listing
  scrollDepth?: number;      // 0-100 how far to scroll the listing
}

export async function runCtrSession(opts: CtrSessionOptions): Promise<{ success: boolean; errorMessage?: string }> {
  const licenseKey = process.env.CLOAKBROWSER_LICENSE_KEY;
  if (!licenseKey) {
    return { success: false, errorMessage: "CLOAKBROWSER_LICENSE_KEY not set" };
  }

  const profileDir = getCtrProfileDir(opts.profileId);
  const fingerprint = getCtrFingerprint(opts.profileId);

  let ctx: any = null;

  try {
    const { launchPersistentContext } = await import("cloakbrowser");

    const launchArgs = [
      `--fingerprint=${fingerprint}`,
      "--fingerprint-allow-3p-cookies",  // needed for Google sign-in within Maps
    ];

    // Inject GPS coordinates for location spoofing (CTR radius targeting)
    if (opts.originLat !== undefined && opts.originLng !== undefined) {
      launchArgs.push(
        `--geolocation-lat=${opts.originLat}`,
        `--geolocation-lng=${opts.originLng}`
      );
    }

    ctx = await launchPersistentContext({
      userDataDir: profileDir,
      licenseKey,
      headless: false,
      humanize: true,
      humanPreset: "careful",
      geoip: true,
      proxy: opts.proxyUrl ?? undefined,
      args: launchArgs,
    });

    const page = await ctx.newPage();

    if (opts.sessionType === "gbp_click") {
      await runGbpClickSession(page, opts);
    } else {
      await runDriveSession(page, opts);
    }

    // Mark session as completed in DB
    await markSessionComplete(opts.sessionId, true);
    return { success: true };

  } catch (err: any) {
    console.error(`[CtrWorker] Session ${opts.sessionId} error:`, err?.message ?? err);
    await markSessionComplete(opts.sessionId, false, err?.message ?? String(err));
    return { success: false, errorMessage: err?.message ?? String(err) };
  } finally {
    if (ctx) {
      try { await ctx.close(); } catch { /* ignore */ }
    }
  }
}

// ── GBP Click Session ─────────────────────────────────────────────────────────

async function runGbpClickSession(page: any, opts: CtrSessionOptions): Promise<void> {
  const keyword = opts.keyword ?? opts.businessName ?? "business near me";
  const dwell = (opts.dwellSeconds ?? 45) * 1000;

  // 1. Navigate to Google Search
  await page.goto(`https://www.google.com/search?q=${encodeURIComponent(keyword)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // 2. Wait for results to load
  await page.waitForTimeout(2000 + Math.random() * 2000);

  // 3. Look for the GBP listing in local pack or knowledge panel
  // Try local pack first (3-pack), then knowledge panel
  const gbpSelectors = [
    // Local pack result
    `[data-cid]`,
    // Knowledge panel "Directions" or business name link
    `a[href*="maps.google.com"]`,
    // Maps link with the business CID
    opts.googleMapsUrl ? `a[href*="${extractCid(opts.googleMapsUrl)}"]` : null,
  ].filter(Boolean) as string[];

  let clicked = false;
  for (const selector of gbpSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.click();
        clicked = true;
        break;
      }
    } catch { /* try next */ }
  }

  if (!clicked) {
    // Fallback: search directly on Google Maps
    await page.goto(
      opts.googleMapsUrl ?? `https://www.google.com/maps/search/${encodeURIComponent(opts.businessName ?? keyword)}`,
      { waitUntil: "domcontentloaded", timeout: 30000 }
    );
  }

  // 4. Dwell on the listing — scroll, read, simulate engagement
  await page.waitForTimeout(3000);
  const scrollSteps = Math.ceil((opts.scrollDepth ?? 60) / 10);
  for (let i = 0; i < scrollSteps; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(800 + Math.random() * 1200);
  }

  // 5. Stay on page for the configured dwell time
  await page.waitForTimeout(Math.max(dwell - scrollSteps * 2000, 5000));
}

// ── Drive Simulation Session ──────────────────────────────────────────────────

async function runDriveSession(page: any, opts: CtrSessionOptions): Promise<void> {
  const travelMode = opts.journeyType ?? "driving";
  const modeParam = { driving: "0", transit: "3", walking: "2", cycling: "1" }[travelMode] ?? "0";

  // Build origin string from coordinates
  const origin = opts.originLat !== undefined
    ? `${opts.originLat},${opts.originLng}`
    : "current+location";

  const destination = encodeURIComponent(opts.destinationAddress ?? "");

  // Open Google Maps directions
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${travelMode}`;

  await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000 + Math.random() * 2000);

  // Wait for route to render
  try {
    await page.waitForSelector('[data-value="Directions"]', { timeout: 15000 });
  } catch { /* route may have rendered differently */ }

  // Scroll through the directions panel
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(1000 + Math.random() * 1000);
  }

  // Dwell — simulate reading the route
  await page.waitForTimeout(15000 + Math.random() * 15000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractCid(mapsUrl: string): string {
  const match = mapsUrl.match(/[?&]cid=(\d+)/);
  return match ? match[1] : "";
}

async function markSessionComplete(sessionId: number, success: boolean, errorMessage?: string): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      UPDATE ctr_sessions
      SET
        status = ${success ? "completed" : "failed"},
        completed_at = NOW(),
        error_message = ${errorMessage ?? null}
      WHERE id = ${sessionId}
    `);
  } catch (err) {
    console.error("[CtrWorker] Failed to update session status:", err);
  }
}
