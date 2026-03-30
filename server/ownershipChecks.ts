/**
 * Ownership verification helpers for tRPC procedures.
 * 
 * Ensures that the logged-in user owns the campaign/business they're trying to access.
 * The ownership chain is: user → business → campaign → (everything else).
 */
import { TRPCError } from "@trpc/server";

/**
 * Verify that a campaign belongs to the current user.
 * Throws FORBIDDEN if the campaign doesn't exist or doesn't belong to the user.
 */
export async function verifyCampaignOwnership(campaignId: number, userId: number): Promise<void> {
  const { getDb } = await import("./db");
  const { campaigns } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

  const [campaign] = await db.select({ userId: campaigns.userId })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);

  if (!campaign) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Campaign not found" });
  }
  if (campaign.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied: You don't own this campaign" });
  }
}

/**
 * Verify that a business belongs to the current user.
 * Throws FORBIDDEN if the business doesn't exist or doesn't belong to the user.
 */
export async function verifyBusinessOwnership(businessId: number, userId: number): Promise<void> {
  const { getDb } = await import("./db");
  const { businesses } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

  const [business] = await db.select({ userId: businesses.userId })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
  }
  if (business.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied: You don't own this business" });
  }
}

/**
 * Verify that a client dashboard belongs to the current user (via business ownership).
 * Throws FORBIDDEN if the dashboard doesn't exist or the underlying business doesn't belong to the user.
 */
export async function verifyDashboardOwnership(dashboardId: number, userId: number): Promise<void> {
  const { getDb } = await import("./db");
  const { clientDashboards, businesses } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");

  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

  const [dashboard] = await db.select({ businessId: clientDashboards.businessId })
    .from(clientDashboards)
    .where(eq(clientDashboards.id, dashboardId))
    .limit(1);

  if (!dashboard) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Dashboard not found" });
  }

  // Verify the business belongs to the user
  await verifyBusinessOwnership(dashboard.businessId, userId);
}
