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
 * Device targeting:
 * - "mobile"  : Emulates a real Android/iOS device (70% of sessions)
 * - "desktop" : Standard desktop fingerprint (30% of sessions)
 * - Drive sessions are ALWAYS mobile — real people use phones for directions
 *
 * Key rules (CloakBrowser Pro):
 * - Persistent profiles — one profile per CTR browser profile record
 * - One seed per profile — deterministic from profile ID
 * - headless=False — Google detects headless
 * - geoip=True + residential proxy — mandatory; mobile proxies preferred for drive sessions
 * - humanize=True, human_preset="careful"
 * - Always ctx.close() in finally block
 */

const PROFILES_DIR = process.env.CLOAK_PROFILES_DIR ?? path.join(process.cwd(), ".cloakprofiles");

// Common mobile devices to rotate through — weighted toward Android (higher market share)
const MOBILE_DEVICES = [
  "Pixel 7",
  "Pixel 7 Pro",
  "Pixel 8",
  "Pixel 6",
  "Samsung Galaxy S23",
  "Samsung Galaxy S22",
  "Samsung Galaxy A54",
  "iPhone 15",
  "iPhone 14",
  "iPhone 13",
];

function getCtrProfileDir(profileId: number): string {
  const dir = path.join(PROFILES_DIR, `ctr_profile_${profileId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCtrFingerprint(profileId: number): number {
  // Deterministic, unique per profile, stable across restarts
  return 20000 + (profileId * 6271) % 79999;
}

/** Pick a deterministic mobile device for a given profile so the fingerprint stays consistent */
function getMobileDevice(profileId: number): string {
  return MOBILE_DEVICES[profileId % MOBILE_DEVICES.length];
}

export interface CtrSessionOptions {
  sessionId: number;
  campaignId: number;
  profileId: number;
  proxyUrl: string | null;
  sessionType: "gbp_click" | "drive";
  /** "mobile" = phone emulation (70% of sessions); "desktop" = standard; drive sessions always use mobile */
  deviceType?: "mobile" | "desktop";
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

  // Drive sessions are ALWAYS mobile — people use phones for directions
  const effectiveDevice: "mobile" | "desktop" =
    opts.sessionType === "drive" ? "mobile" : (opts.deviceType ?? "desktop");

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

    // Mobile device emulation — pass the --device flag to CloakBrowser
    if (effectiveDevice === "mobile") {
      const device = getMobileDevice(opts.profileId);
      launchArgs.push(`--device=${device}`);
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
      await runGbpClickSession(page, opts, effectiveDevice);
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

async function runGbpClickSession(page: any, opts: CtrSessionOptions, deviceType: "mobile" | "desktop"): Promise<void> {
  const keyword = opts.keyword ?? opts.businessName ?? "business near me";
  const dwell = (opts.dwellSeconds ?? 45) * 1000;

  // Mobile uses the Google mobile search URL (triggers mobile SERP layout)
  const searchUrl = deviceType === "mobile"
    ? `https://www.google.com/search?q=${encodeURIComponent(keyword)}&source=hp&igu=1`
    : `https://www.google.com/search?q=${encodeURIComponent(keyword)}`;

  // 1. Navigate to Google Search
  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // 2. Wait for results to load
  await page.waitForTimeout(2000 + Math.random() * 2000);

  // 3. Look for the GBP listing in local pack or knowledge panel
  // Mobile local pack uses slightly different selectors than desktop
  const gbpSelectors = deviceType === "mobile"
    ? [
        `[data-cid]`,
        `a[href*="maps.google.com"]`,
        `a[href*="maps.app.goo.gl"]`,
        opts.googleMapsUrl ? `a[href*="${extractCid(opts.googleMapsUrl)}"]` : null,
      ].filter(Boolean) as string[]
    : [
        `[data-cid]`,
        `a[href*="maps.google.com"]`,
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
    // Mobile uses touch scroll, desktop uses mouse wheel
    if (deviceType === "mobile") {
      await page.touchscreen?.tap(200, 400).catch(() => {});
      await page.evaluate(() => window.scrollBy(0, 300));
    } else {
      await page.mouse.wheel(0, 300);
    }
    await page.waitForTimeout(800 + Math.random() * 1200);
  }

  // 5. Stay on page for the configured dwell time
  await page.waitForTimeout(Math.max(dwell - scrollSteps * 2000, 5000));
}

// ── Drive Simulation Session ──────────────────────────────────────────────────
// Always runs as mobile (enforced above) — real users request directions on their phone

async function runDriveSession(page: any, opts: CtrSessionOptions): Promise<void> {
  const travelMode = opts.journeyType ?? "driving";

  // Build origin string from coordinates
  const origin = opts.originLat !== undefined
    ? `${opts.originLat},${opts.originLng}`
    : "current+location";

  const destination = encodeURIComponent(opts.destinationAddress ?? "");

  // Open Google Maps directions — use the mobile-friendly URL format
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${travelMode}`;

  await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000 + Math.random() * 2000);

  // Wait for route to render
  try {
    await page.waitForSelector('[data-value="Directions"], [aria-label*="Directions"]', { timeout: 15000 });
  } catch { /* route may have rendered differently */ }

  // Scroll through the directions panel (touch scroll for mobile)
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 200));
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
