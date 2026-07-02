/**
 * schema-drift-audit.ts — ad-hoc diagnostic (safe, read-only unless --apply).
 *
 * Compares the Drizzle code schema (drizzle/schema.ts) against the LIVE Supabase
 * DB and reports every column the code expects but the DB is missing. This drift
 * exists because app start does not run migrations (see CLAUDE.md).
 *
 *   pnpm exec tsx schema-drift-audit.ts           # dry run: print the plan only
 *   pnpm exec tsx schema-drift-audit.ts --apply   # apply ADD COLUMN (nullable, additive)
 *
 * Missing columns are added NULLABLE (no NOT NULL / no default) — additive and
 * safe on tables that already have rows. Extra live columns are only reported,
 * never dropped.
 */
import * as schema from "./drizzle/schema";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";
import fs from "fs";

const APPLY = process.argv.includes("--apply");

function loadEnv(): Record<string, string> {
  const raw = fs.readFileSync(".env.local", "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      env[m[1]] = v;
    }
  }
  return env;
}

async function main() {
  const env = loadEnv();
  const sql = postgres(env.SUPABASE_DATABASE_URL, { ssl: "require", prepare: false, connect_timeout: 30 });

  // Live columns grouped by table
  const liveRows = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'`;
  const live: Record<string, Set<string>> = {};
  for (const r of liveRows) (live[r.table_name] ??= new Set()).add(r.column_name);

  const plan: { table: string; column: string; type: string; notNull: boolean; hasDefault: boolean; ddl: string }[] = [];
  const missingTables: string[] = [];

  for (const exp of Object.values(schema)) {
    if (!is(exp, PgTable)) continue;
    const table = getTableName(exp as any);
    const cols = getTableColumns(exp as any);
    if (!live[table]) { missingTables.push(table); continue; }
    for (const col of Object.values(cols) as any[]) {
      const dbName = col.name as string;
      if (live[table].has(dbName)) continue;
      const type = col.getSQLType();
      const ddl = `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${dbName}" ${type}`;
      plan.push({ table, column: dbName, type, notNull: !!col.notNull, hasDefault: !!col.hasDefault, ddl });
    }
  }

  if (missingTables.length) {
    console.log("⚠️  TABLES the code expects but the live DB is MISSING (not auto-created here):");
    for (const t of missingTables) console.log("   -", t);
    console.log();
  }

  if (plan.length === 0) {
    console.log("✅ No missing columns — code schema and live DB are in sync.");
    await sql.end();
    return;
  }

  console.log(`Found ${plan.length} missing column(s) across ${new Set(plan.map(p => p.table)).size} table(s):\n`);
  const byTable: Record<string, typeof plan> = {};
  for (const p of plan) (byTable[p.table] ??= []).push(p);
  for (const [t, ps] of Object.entries(byTable)) {
    console.log(`  ${t}:`);
    for (const p of ps) {
      const flags = [p.notNull ? "NOT NULL-in-code" : "", p.hasDefault ? "has-default" : ""].filter(Boolean).join(", ");
      console.log(`     + ${p.column}  ${p.type}${flags ? "  (" + flags + ")" : ""}`);
    }
  }

  // Flag the risky ones: notNull in code WITHOUT a default (added nullable here).
  const riskyNotNull = plan.filter(p => p.notNull && !p.hasDefault);
  if (riskyNotNull.length) {
    console.log(`\n  NOTE: ${riskyNotNull.length} column(s) are NOT NULL in code but have no default; added NULLABLE to stay safe on existing rows:`);
    for (const p of riskyNotNull) console.log(`     ! ${p.table}.${p.column}`);
  }

  if (!APPLY) {
    console.log("\n(dry run — re-run with --apply to execute the ADD COLUMN statements)");
    await sql.end();
    return;
  }

  console.log("\nApplying...");
  let ok = 0;
  for (const p of plan) {
    try { await sql.unsafe(p.ddl); ok++; }
    catch (e: any) { console.error(`   FAILED ${p.table}.${p.column}: ${e.message}`); }
  }
  console.log(`Applied ${ok}/${plan.length} column(s).`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
