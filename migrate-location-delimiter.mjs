#!/usr/bin/env node
/**
 * Migration: normalize businesses.location delimiter "," → ";"
 * ------------------------------------------------------------------------
 * Historically multiple target locations were stored comma-joined, but each
 * location is itself "City, ST", so the comma collided and a single
 * "Cullman, AL" parsed as two locations. We now separate locations with ";".
 *
 * This script rewrites ONLY rows that actually hold multiple locations (i.e.
 * where re-pairing City+ST tokens yields 2+ locations). Single-location rows
 * like "Cullman, AL" are left untouched — the app's reader (shared/location.ts)
 * already parses those correctly via its legacy comma fallback.
 *
 * It does NOT touch campaignQueryLocations: those rows were built from the old
 * split and may need a keyword-research re-run to rebuild cleanly.
 *
 * Usage:
 *   node migrate-location-delimiter.mjs            # dry run (prints proposed changes)
 *   node migrate-location-delimiter.mjs --apply    # execute the updates
 *
 * Reads SUPABASE_DATABASE_URL (or DATABASE_URL). If not set in the environment
 * it is loaded from .env.local.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

// ── Minimal .env.local loader (only fills vars not already set) ───────────────
function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL("./.env.local", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env.local — rely on the ambient environment */
  }
}

// ── Legacy-tolerant parse / serialize (mirrors shared/location.ts) ────────────
const STATE_CODE = /^[A-Za-z]{2}$/;
const STATE_NAMES = new Set(
  [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
    "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
    "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
    "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
    "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
    "Washington", "West Virginia", "Wisconsin", "Wyoming",
    "District of Columbia", "Puerto Rico",
  ].map((s) => s.toLowerCase())
);

function isStateToken(token) {
  return STATE_CODE.test(token) || STATE_NAMES.has(token.toLowerCase());
}

function parseLocations(raw) {
  if (!raw) return [];
  const trimmed = String(raw).trim();
  if (!trimmed) return [];
  if (trimmed.includes(";")) {
    return trimmed.split(";").map((l) => l.trim()).filter(Boolean);
  }
  const tokens = trimmed.split(",").map((t) => t.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1];
    if (next !== undefined && isStateToken(next)) {
      const state = STATE_CODE.test(next) ? next.toUpperCase() : next;
      out.push(`${tokens[i]}, ${state}`);
      i++;
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

function serializeLocations(locations) {
  return locations.map((l) => (l ?? "").trim()).filter(Boolean).join("; ");
}

async function main() {
  const apply = process.argv.includes("--apply");
  loadEnvLocal();

  const databaseUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("✗ No SUPABASE_DATABASE_URL or DATABASE_URL found (env or .env.local).");
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { ssl: "require", prepare: false, max: 1 });

  try {
    // Rows not yet migrated (no ";") that contain a comma (possible multi-loc).
    const rows = await sql`
      SELECT id, name, location
      FROM businesses
      WHERE location IS NOT NULL
        AND location <> ''
        AND position(';' in location) = 0
        AND position(',' in location) > 0
    `;

    const changes = [];
    for (const row of rows) {
      const parsed = parseLocations(row.location);
      const next = serializeLocations(parsed);
      // Only a real change when re-pairing produced multiple locations (";").
      if (next !== row.location && next.includes(";")) {
        changes.push({ id: row.id, name: row.name, from: row.location, to: next, count: parsed.length });
      }
    }

    console.log(`\nScanned ${rows.length} candidate row(s); ${changes.length} need updating.\n`);
    for (const c of changes) {
      console.log(`  #${c.id}  ${c.name}`);
      console.log(`      from: ${JSON.stringify(c.from)}`);
      console.log(`      to:   ${JSON.stringify(c.to)}  (${c.count} locations)`);
    }

    if (!apply) {
      console.log(`\nDRY RUN — no changes written. Re-run with --apply to commit the ${changes.length} update(s).`);
      return;
    }

    let updated = 0;
    for (const c of changes) {
      await sql`UPDATE businesses SET location = ${c.to} WHERE id = ${c.id}`;
      updated++;
    }
    console.log(`\n✓ Applied ${updated} update(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
