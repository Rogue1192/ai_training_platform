/**
 * Agency database operations — CRUD for the agencies table.
 * Agencies are reseller/white-label partners that own client businesses.
 */
import { eq, desc } from "drizzle-orm";
import { getDb } from "./db";
import { agencies, Agency, InsertAgency } from "../drizzle/schema";

/** Throws if the database is unavailable, so callers don't need to null-check. */
async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

// ─── List ────────────────────────────────────────────────────────────────────

export async function getAllAgencies(): Promise<Agency[]> {
  const db = await requireDb();
  return db.select().from(agencies).orderBy(desc(agencies.createdAt));
}

export async function getAgencyById(id: number): Promise<Agency | undefined> {
  const db = await requireDb();
  const [agency] = await db.select().from(agencies).where(eq(agencies.id, id)).limit(1);
  return agency;
}

export async function getAgencyByUserId(userId: number): Promise<Agency | undefined> {
  const db = await requireDb();
  const [agency] = await db.select().from(agencies).where(eq(agencies.userId, userId)).limit(1);
  return agency;
}

export async function getAgencyByIntakeToken(token: string): Promise<Agency | undefined> {
  const db = await requireDb();
  const [agency] = await db.select().from(agencies).where(eq(agencies.intakeToken, token)).limit(1);
  return agency;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export async function createAgency(data: InsertAgency): Promise<Agency> {
  const db = await requireDb();
  const [created] = await db.insert(agencies).values(data).returning();
  return created;
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateAgency(id: number, updates: Partial<InsertAgency>): Promise<Agency> {
  const db = await requireDb();
  const [updated] = await db
    .update(agencies)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(agencies.id, id))
    .returning();
  return updated;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteAgency(id: number): Promise<void> {
  const db = await requireDb();
  await db.delete(agencies).where(eq(agencies.id, id));
}
