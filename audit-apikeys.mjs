#!/usr/bin/env node
/**
 * Audit stored provider API keys: flag any apiKeys row that is NOT in the
 * current encryption format (salt:iv:encrypted:tag, all hex). Rows in a legacy/
 * foreign format can't be decrypted and must be re-entered in Settings.
 *
 *   node audit-apikeys.mjs
 *
 * Read-only. Never prints key material. Reads SUPABASE_DATABASE_URL (or
 * DATABASE_URL) from the environment or .env.local.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

// Mirror server/encryption.ts: SALT_LENGTH=32, IV_LENGTH=16, TAG_LENGTH=16 (bytes → ×2 hex).
const SALT_HEX = 64, IV_HEX = 32, TAG_HEX = 32;
const isHex = (s) => /^[0-9a-fA-F]+$/.test(s);

function isCurrentFormat(value) {
  const parts = String(value || "").split(":");
  if (parts.length !== 4) return false;
  const [salt, iv, enc, tag] = parts;
  return (
    isHex(salt) && salt.length === SALT_HEX &&
    isHex(iv) && iv.length === IV_HEX &&
    isHex(enc) && enc.length > 0 &&
    isHex(tag) && tag.length === TAG_HEX
  );
}

function classify(value) {
  const v = String(value || "");
  const segs = v.split(":").length;
  if (segs === 1 && /^[A-Za-z0-9+/]+={0,2}$/.test(v)) return "legacy base64 blob (foreign/old scheme) — re-enter";
  if (segs === 1 && isHex(v)) return "single hex blob (old scheme) — re-enter";
  if (segs === 3) return "3-part (older salt-less format) — re-enter";
  if (segs !== 4) return `unexpected (${segs} segments) — re-enter`;
  return "malformed 4-part (bad segment lengths) — re-enter";
}

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL("./.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
}

async function main() {
  loadEnvLocal();
  const url = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) { console.error("✗ No SUPABASE_DATABASE_URL / DATABASE_URL"); process.exit(1); }
  const sql = postgres(url, { ssl: "require", prepare: false, max: 1 });
  try {
    const rows = await sql`SELECT provider, status, "encryptedKey" AS k FROM "apiKeys" ORDER BY provider`;
    let bad = 0;
    console.log(`Auditing ${rows.length} API key(s):\n`);
    for (const r of rows) {
      const ok = isCurrentFormat(r.k);
      if (!ok) bad++;
      console.log(`  ${ok ? "✓ OK    " : "✗ BAD   "} ${r.provider.padEnd(10)} status=${r.status}` + (ok ? "" : `  → ${classify(r.k)}`));
    }
    console.log(`\n${bad === 0 ? "✓ All keys are in the current encryption format." : `✗ ${bad} key(s) need re-entering in Settings (Settings re-encrypts them correctly).`}`);
    process.exitCode = bad === 0 ? 0 : 2;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => { console.error("Audit failed:", e); process.exit(1); });
