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
//
// CORRECT FLOW (matches real user behavior + registers as GBP directions engagement):
//   1. Search Google for the business keyword
//   2. Find and click the GBP listing in the local pack / knowledge panel
//   3. Wait for the GBP panel / Maps listing to load
//   4. Click the "Directions" button ON the GBP listing — this is the signal Google tracks
//   5. Google Maps opens with the business pre-loaded as destination
//   6. Enter a randomized nearby origin address in the "Your location" field
//   7. Route renders — scroll through directions, dwell, close

async function runDriveSession(page: any, opts: CtrSessionOptions): Promise<void> {
  const travelMode = opts.journeyType ?? "driving";
  const keyword = opts.keyword ?? opts.businessName ?? "business near me";

  // ── Step 1: Search Google for the business ──────────────────────────────────
  // Mobile search URL triggers the mobile SERP with local pack
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}&source=hp&igu=1`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(2000 + Math.random() * 2000);

  // ── Step 2: Find and click the GBP listing ─────────────────────────────────
  // Try multiple selectors — mobile local pack, knowledge panel, Maps link
  const gbpSelectors = [
    `[data-cid]`,
    `a[href*="maps.google.com"]`,
    `a[href*="maps.app.goo.gl"]`,
    opts.googleMapsUrl ? `a[href*="${extractCid(opts.googleMapsUrl)}"]` : null,
    `[data-local-attribute="d3aX5e"]`,  // mobile local pack card
    `[jscontroller][data-hveid]`,        // knowledge panel
  ].filter(Boolean) as string[];

  let clickedListing = false;
  for (const selector of gbpSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.click();
        clickedListing = true;
        break;
      }
    } catch { /* try next */ }
  }

  if (!clickedListing) {
    // Fallback: navigate directly to the Maps listing
    const fallbackUrl = opts.googleMapsUrl
      ?? `https://www.google.com/maps/search/${encodeURIComponent(opts.businessName ?? keyword)}`;
    await page.goto(fallbackUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  }

  // ── Step 3: Wait for GBP panel / Maps listing to fully load ────────────────
  await page.waitForTimeout(3000 + Math.random() * 2000);

  // ── Step 4: Click the Directions button ON the GBP listing ─────────────────
  // This is the critical step — it registers as a GBP directions engagement in Google's systems
  const directionsSelectors = [
    `button[data-value="Directions"]`,
    `a[data-value="Directions"]`,
    `[aria-label="Directions"]`,
    `[aria-label*="Directions"]`,
    `[jsaction*="pane.directions"]`,
    `[data-item-id="directions"]`,
    // Mobile Maps uses a slightly different structure
    `button[jsaction*="directions"]`,
    `[data-tooltip="Directions"]`,
  ];

  let clickedDirections = false;
  for (const selector of directionsSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        // Scroll the button into view first (mobile viewport is small)
        await el.scrollIntoViewIfNeeded?.();
        await page.waitForTimeout(500 + Math.random() * 500);
        await el.click();
        clickedDirections = true;
        console.log(`[CtrWorker] Clicked Directions button via selector: ${selector}`);
        break;
      }
    } catch { /* try next */ }
  }

  if (!clickedDirections) {
    // Last resort: try clicking by visible text content
    try {
      await page.getByText("Directions", { exact: true }).first().click();
      clickedDirections = true;
      console.log(`[CtrWorker] Clicked Directions button via text match`);
    } catch { /* ignore */ }
  }

  if (!clickedDirections) {
    console.warn(`[CtrWorker] Session ${opts.sessionId}: Could not find Directions button — GBP engagement not registered`);
  }

  // ── Step 5: Wait for Maps directions UI to open ────────────────────────────
  await page.waitForTimeout(2000 + Math.random() * 1500);

  // ── Step 6: Enter origin ("Your location" / starting point field) ──────────
  // Use a randomized nearby address rather than GPS coordinates
  // This simulates a real user typing their starting point
  if (opts.destinationAddress || opts.originLat !== undefined) {
    const originText = opts.originLat !== undefined
      ? `${opts.originLat.toFixed(4)}, ${opts.originLng?.toFixed(4)}`  // coords as fallback
      : "My location";

    // The origin input in Google Maps directions
    const originInputSelectors = [
      `input[aria-label*="Your location"]`,
      `input[aria-label*="Starting point"]`,
      `input[aria-label*="Choose starting point"]`,
      `input[placeholder*="Your location"]`,
      `input[placeholder*="Starting point"]`,
      `[data-index="0"] input`,  // first input in directions panel
    ];

    for (const selector of originInputSelectors) {
      try {
        const input = await page.$(selector);
        if (input) {
          await input.click();
          await page.waitForTimeout(500);
          await input.fill(originText);
          await page.waitForTimeout(1000 + Math.random() * 500);
          await page.keyboard.press("Enter");
          break;
        }
      } catch { /* try next */ }
    }
  }

  // ── Step 7: Wait for route to render ───────────────────────────────────────
  await page.waitForTimeout(3000 + Math.random() * 2000);

  // ── Step 8: Scroll through directions panel (simulate reading the route) ───
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 200));
    await page.waitForTimeout(1200 + Math.random() * 1000);
  }

  // ── Step 9: Dwell — simulate a real user reviewing the route ───────────────
  // 20-40 seconds is realistic for someone checking directions before driving
  await page.waitForTimeout(20000 + Math.random() * 20000);
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
