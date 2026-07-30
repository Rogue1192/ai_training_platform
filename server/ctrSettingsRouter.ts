/**
 * CTR Settings Router
 * Handles CloakBrowser config, credentials vault, AI training profiles, and CTR profiles.
 * Completely isolated — no impact on AI Answer Forge tables.
 */
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { sql } from "drizzle-orm";

// ── Simple XOR obfuscation for passwords at rest ─────────────────────────────
// In production, replace with AES-256 using an env-var key.
const ENC_KEY = process.env.CRED_ENC_KEY ?? "ctr-default-key-change-in-prod";

function encryptPassword(plain: string): string {
  if (!plain) return "";
  const key = Buffer.from(ENC_KEY);
  const buf = Buffer.from(plain, "utf8");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out.toString("base64");
}

function decryptPassword(enc: string): string {
  if (!enc) return "";
  const key = Buffer.from(ENC_KEY);
  const buf = Buffer.from(enc, "base64");
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ key[i % key.length];
  return out.toString("utf8");
}

// ─── router ─────────────────────────────────────────────────────────────────

export const ctrSettingsRouter = router({

  // ── CloakBrowser Config ───────────────────────────────────────────────────

  getConfig: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db.execute(sql`
      SELECT id, host_url AS "hostUrl", max_concurrent AS "maxConcurrent",
             humanize, headless, geoip
      FROM cloak_config
      LIMIT 1
    `);
    if (rows.length === 0) return null;
    return rows[0] as any;
  }),

  saveConfig: publicProcedure
    .input(z.object({
      licenseKey: z.string().optional(),
      maxConcurrent: z.number().min(1).max(200).default(5),
      humanize: z.boolean().default(true),
      headless: z.boolean().default(false),
      geoip: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const encKey = input.licenseKey ? encryptPassword(input.licenseKey) : null;
      await db.execute(sql`
        INSERT INTO cloak_config (license_key, max_concurrent, humanize, headless, geoip, updated_at)
        VALUES (${encKey}, ${input.maxConcurrent}, ${input.humanize}, ${input.headless}, ${input.geoip}, NOW())
        ON CONFLICT (id) DO UPDATE SET
          license_key    = COALESCE(EXCLUDED.license_key, cloak_config.license_key),
          max_concurrent = EXCLUDED.max_concurrent,
          humanize       = EXCLUDED.humanize,
          headless       = EXCLUDED.headless,
          geoip          = EXCLUDED.geoip,
          updated_at     = NOW()
      `);
      return { ok: true };
    }),

  testCloakConnection: publicProcedure
    .input(z.object({ licenseKey: z.string() }))
    .mutation(async ({ input }) => {
      // CloakBrowser Pro validates the license key on first launch.
      // We do a lightweight check by hitting the public validation endpoint if available,
      // otherwise we just confirm the key format looks correct.
      const key = input.licenseKey.trim();
      if (!key || key.length < 8) {
        return { ok: false, message: "License key is too short" };
      }
      // Key format check — CloakBrowser Pro keys start with "cb_" or are UUID-style
      const validFormat = /^(cb_|CB_)?[a-zA-Z0-9\-_]{8,}$/.test(key);
      if (!validFormat) {
        return { ok: false, message: "License key format looks invalid" };
      }
      // In production, make a real HTTP call to CloakBrowser's validation API here.
      // For now, format validation passes.
      return { ok: true, message: "License key format valid — will be verified on first session launch" };
    }),

  // ── Credentials Vault ─────────────────────────────────────────────────────

  listCredentials: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("DB unavailable");
    const rows = await db.execute(sql`
      SELECT id, label, platform, email, notes, is_active AS "isActive", last_used_at AS "lastUsedAt", created_at AS "createdAt"
      FROM ctr_credentials
      WHERE is_active = true
      ORDER BY platform, label
    `);
    return rows as any[];
  }),

  saveCredential: publicProcedure
    .input(z.object({
      id: z.number().optional(),
      label: z.string().min(1),
      platform: z.enum(["chatgpt", "google", "proxy"]),
      email: z.string().optional(),
      password: z.string().optional(),
      proxyUrl: z.string().optional(),
      proxyType: z.enum(["residential", "mobile", "datacenter"]).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const passwordEnc = input.password ? encryptPassword(input.password) : null;
      const extraPayload = input.proxyUrl
        ? JSON.stringify({ proxyUrl: input.proxyUrl, proxyType: input.proxyType ?? "residential" })
        : null;
      const extraEnc = extraPayload ? encryptPassword(extraPayload) : null;
      const proxyTypeVal = input.platform === "proxy" ? (input.proxyType ?? "residential") : null;

      if (input.id) {
        await db.execute(sql`
          UPDATE ctr_credentials SET
            label        = ${input.label},
            platform     = ${input.platform},
            email        = ${input.email ?? null},
            password_enc = COALESCE(${passwordEnc}, password_enc),
            extra_enc    = COALESCE(${extraEnc}, extra_enc),
            proxy_type   = COALESCE(${proxyTypeVal}, proxy_type),
            notes        = ${input.notes ?? null},
            updated_at   = NOW()
          WHERE id = ${input.id}
        `);
      } else {
        await db.execute(sql`
          INSERT INTO ctr_credentials (label, platform, email, password_enc, extra_enc, proxy_type, notes)
          VALUES (${input.label}, ${input.platform}, ${input.email ?? null}, ${passwordEnc}, ${extraEnc}, ${proxyTypeVal}, ${input.notes ?? null})
        `);
      }
      return { ok: true };
    }),

  deleteCredential: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      // Soft delete
      await db.execute(sql`UPDATE ctr_credentials SET is_active = false, updated_at = NOW() WHERE id = ${input.id}`);
      return { ok: true };
    }),

  // ── Profile Pools ─────────────────────────────────────────────────────────

  listProfiles: publicProcedure
    .input(z.object({ pool: z.enum(["ai", "ctr"]) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const table = input.pool === "ai" ? sql`ai_browser_profiles` : sql`ctr_browser_profiles`;

      if (input.pool === "ai") {
        const rows = await db.execute(sql`
          SELECT
            p.id, p.name, p.cloak_profile_id AS "cloakProfileId",
            p.proxy_credential_id AS "proxyCredentialId",
            p.chatgpt_credential_id AS "chatgptCredentialId",
            p.google_credential_id AS "googleCredentialId",
            p.timezone, p.locale, p.authenticated_platforms AS "authenticatedPlatforms",
            p.status, p.session_count AS "sessionCount",
            p.last_used_at AS "lastUsedAt", p.notes, p.created_at AS "createdAt"
          FROM ai_browser_profiles p
          WHERE p.is_active = true
          ORDER BY p.name
        `);
        return rows as any[];
      } else {
        const rows = await db.execute(sql`
          SELECT
            p.id, p.name, p.cloak_profile_id AS "cloakProfileId",
            p.proxy_credential_id AS "proxyCredentialId",
            p.google_credential_id AS "googleCredentialId",
            p.timezone, p.locale,
            p.google_authenticated AS "googleAuthenticated",
            p.search_history_age_days AS "searchHistoryAgeDays",
            p.status, p.session_count AS "sessionCount",
            p.current_campaign_id AS "currentCampaignId",
            p.last_used_at AS "lastUsedAt", p.notes, p.created_at AS "createdAt"
          FROM ctr_browser_profiles p
          WHERE p.is_active = true
          ORDER BY p.name
        `);
        return rows as any[];
      }
    }),

  saveProfile: publicProcedure
    .input(z.object({
      id: z.number().optional(),
      pool: z.enum(["ai", "ctr"]),
      name: z.string().min(1),
      cloakProfileId: z.string().optional(),
      proxyCredentialId: z.number().optional(),
      chatgptCredentialId: z.number().optional(),
      googleCredentialId: z.number().optional(),
      timezone: z.string().default("America/New_York"),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      // Generate a fingerprint seed if no cloakProfileId provided
      const fingerprintSeed = input.cloakProfileId
        ? null
        : Math.random().toString(36).substring(2) + Date.now().toString(36);

      if (input.pool === "ai") {
        if (input.id) {
          await db.execute(sql`
            UPDATE ai_browser_profiles SET
              name                   = ${input.name},
              cloak_profile_id       = ${input.cloakProfileId ?? null},
              proxy_credential_id    = ${input.proxyCredentialId ?? null},
              chatgpt_credential_id  = ${input.chatgptCredentialId ?? null},
              google_credential_id   = ${input.googleCredentialId ?? null},
              timezone               = ${input.timezone},
              notes                  = ${input.notes ?? null},
              updated_at             = NOW()
            WHERE id = ${input.id}
          `);
        } else {
          await db.execute(sql`
            INSERT INTO ai_browser_profiles
              (name, cloak_profile_id, fingerprint_seed, proxy_credential_id, chatgpt_credential_id, google_credential_id, timezone, notes)
            VALUES
              (${input.name}, ${input.cloakProfileId ?? null}, ${fingerprintSeed}, ${input.proxyCredentialId ?? null}, ${input.chatgptCredentialId ?? null}, ${input.googleCredentialId ?? null}, ${input.timezone}, ${input.notes ?? null})
          `);
        }
      } else {
        if (input.id) {
          await db.execute(sql`
            UPDATE ctr_browser_profiles SET
              name                = ${input.name},
              cloak_profile_id    = ${input.cloakProfileId ?? null},
              proxy_credential_id = ${input.proxyCredentialId ?? null},
              google_credential_id = ${input.googleCredentialId ?? null},
              timezone            = ${input.timezone},
              notes               = ${input.notes ?? null},
              updated_at          = NOW()
            WHERE id = ${input.id}
          `);
        } else {
          await db.execute(sql`
            INSERT INTO ctr_browser_profiles
              (name, cloak_profile_id, fingerprint_seed, proxy_credential_id, google_credential_id, timezone, notes)
            VALUES
              (${input.name}, ${input.cloakProfileId ?? null}, ${fingerprintSeed}, ${input.proxyCredentialId ?? null}, ${input.googleCredentialId ?? null}, ${input.timezone}, ${input.notes ?? null})
          `);
        }
      }
      return { ok: true };
    }),

    deleteProfile: publicProcedure
    .input(z.object({ pool: z.enum(["ai", "ctr"]), id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      if (input.pool === "ai") {
        await db.execute(sql`UPDATE ai_browser_profiles SET is_active = false, updated_at = NOW() WHERE id = ${input.id}`);
      } else {
        await db.execute(sql`UPDATE ctr_browser_profiles SET is_active = false, updated_at = NOW() WHERE id = ${input.id}`);
      }
      return { ok: true };
    }),

  // ── noVNC Profile Login Session ───────────────────────────────────────────

  launchProfileSession: publicProcedure
    .input(z.object({ profileId: z.string() }))
    .mutation(async ({ input }) => {
      const { spawn } = await import("child_process");
      const path = await import("path");
      const fs = await import("fs");

      const profilesDir = process.env.CLOAK_PROFILES_DIR ?? "/data/cloakprofiles";
      const profileDir = path.join(profilesDir, `profile_${input.profileId}`);
      if (!fs.existsSync(profileDir)) fs.mkdirSync(profileDir, { recursive: true });

      // Pick a free display number based on profile ID hash
      const displayNum = 10 + (parseInt(input.profileId.replace(/\D/g, "").slice(0, 4) || "0") % 50);
      const vncPort = 5900 + displayNum;
      const novncPort = 6080 + displayNum;

      // Kill any existing session for this profile
      spawn("pkill", ["-f", `Xvfb :${displayNum}`], { stdio: "ignore" });
      spawn("pkill", ["-f", `x11vnc.*:${vncPort}`], { stdio: "ignore" });
      spawn("pkill", ["-f", `websockify.*${novncPort}`], { stdio: "ignore" });

      await new Promise(r => setTimeout(r, 500));

      // Start Xvfb virtual display
      const xvfb = spawn("Xvfb", [`:${displayNum}`, "-screen", "0", "1280x800x24"], {
        stdio: "ignore",
        detached: true,
      });
      xvfb.unref();

      await new Promise(r => setTimeout(r, 800));

      // Start x11vnc VNC server on that display
      const vnc = spawn("x11vnc", [
        "-display", `:${displayNum}`,
        "-rfbport", String(vncPort),
        "-nopw", "-forever", "-shared", "-bg",
        "-noxdamage", "-quiet",
      ], { stdio: "ignore", detached: true });
      vnc.unref();

      await new Promise(r => setTimeout(r, 500));

      // Start noVNC websockify proxy
      // NOVNC_WEB_DIR is resolved by start.sh at boot (handles Nix store paths)
      const novncWebDir = process.env.NOVNC_WEB_DIR ?? "/usr/share/novnc";
      const novnc = spawn("websockify", [
        "--web", novncWebDir,
        String(novncPort),
        `localhost:${vncPort}`,
      ], { stdio: "ignore", detached: true });
      novnc.unref();

      await new Promise(r => setTimeout(r, 800));

      // Launch CloakBrowser on this display
      const licenseKey = process.env.CLOAKBROWSER_LICENSE_KEY ?? "";
      const launchScript = `
const { launch } = require('cloakbrowser');
(async () => {
  const browser = await launch({
    licenseKey: '${licenseKey}',
    headless: false,
    humanize: true,
    humanPreset: 'careful',
    geoip: false,
    userDataDir: '${profileDir}',
    env: { DISPLAY: ':${displayNum}' },
  });
  const page = await browser.newPage();
  await page.goto('https://accounts.google.com');
  // Keep alive until killed externally
  await new Promise(() => {});
})();
`;
      const scriptPath = path.join(profileDir, "login_session.js");
      fs.writeFileSync(scriptPath, launchScript);

      const browser = spawn("node", [scriptPath], {
        stdio: "ignore",
        detached: true,
        env: { ...process.env, DISPLAY: `:${displayNum}` },
      });
      browser.unref();

      // Build the noVNC URL — served through the same origin via /novnc-proxy path
      const novncUrl = `/novnc-proxy/${displayNum}/vnc.html?host=${encodeURIComponent(process.env.RAILWAY_PUBLIC_DOMAIN ?? "localhost")}&port=443&path=novnc-proxy/${displayNum}/websockify&encrypt=1&autoconnect=1&resize=scale`;

      return { novncUrl, displayNum, vncPort, novncPort };
    }),

  closeProfileSession: publicProcedure
    .input(z.object({ profileId: z.string() }))
    .mutation(async ({ input }) => {
      const { spawn } = await import("child_process");
      const displayNum = 10 + (parseInt(input.profileId.replace(/\D/g, "").slice(0, 4) || "0") % 50);
      const vncPort = 5900 + displayNum;
      const novncPort = 6080 + displayNum;

      spawn("pkill", ["-f", `login_session.*${input.profileId}`], { stdio: "ignore" });
      spawn("pkill", ["-f", `Xvfb :${displayNum}`], { stdio: "ignore" });
      spawn("pkill", ["-f", `x11vnc.*:${vncPort}`], { stdio: "ignore" });
      spawn("pkill", ["-f", `websockify.*${novncPort}`], { stdio: "ignore" });

      return { ok: true };
    }),
});
