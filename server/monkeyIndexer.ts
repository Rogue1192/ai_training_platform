/**
 * Monkey Indexer Service
 *
 * Replaces the former SinByte integration.
 * Integrates with MonkeyIndexer (monkeyindexer.com) API v1 to submit
 * published URLs for accelerated Google indexing.
 *
 * API Base: https://monkeyindexer.com/api/v1
 * Auth:     Authorization: Bearer mi_...
 * Docs:     https://monkeyindexer.com/api
 *
 * Key differences from SinByte:
 * - Batch up to 50 URLs per call (was task-based in SinByte)
 * - Returns ULID tracking_ids per URL (not a single task ID)
 * - Status polling via GET /submissions?ids=...
 * - Credits are per-URL (1 credit each)
 */

import axios from "axios";
import { getDb } from "./db";
import { contentPages, campaigns } from "../drizzle/schema";
import { eq, and, isNotNull } from "drizzle-orm";

// ============= Constants =============

const MONKEY_API_BASE = "https://monkeyindexer.com/api/v1";
const BATCH_SIZE = 50; // API max per call

// ============= Types =============

export interface MonkeySubmitResult {
  success: boolean;
  submitted: number;
  rejected: number;
  invalidUrls: string[];
  trackingIds: string[];
  creditsRemaining?: number;
  error?: string;
}

export interface MonkeySubmissionStatus {
  trackingId: string;
  url: string;
  status: "queued" | "processing" | "submitted" | "indexed" | "not_indexed" | "failed" | "refunded" | string;
  providerStatus?: string;
  submittedAt?: string;
  crawledAt?: string;
}

/** Shape returned to callers (routers.ts / CampaignDetail) */
export interface IndexingSubmissionResult {
  submitted: boolean;
  trackingIds: string[];
  urlsSubmitted: number;
  urls: string[];
  creditsRemaining?: number;
  error?: string;
  submittedAt: string;
}

// ============= Key Helper =============

async function getMonkeyApiKey(): Promise<string> {
  try {
    const { getServiceKey } = await import("./db");
    const { decrypt } = await import("./encryption");
    const record = await getServiceKey("monkeyindexer");
    if (record?.encryptedValue) {
      return decrypt(record.encryptedValue);
    }
  } catch {
    // fall through to env var
  }
  const envKey = process.env.MONKEY_INDEXER_API_KEY;
  if (envKey) return envKey;
  throw new Error(
    "Monkey Indexer API key not configured. Please add it in Settings → Service Keys."
  );
}

// ============= Core Submit =============

/**
 * Submit up to 50 URLs in a single API call.
 * For larger batches use submitUrlsForIndexing which chunks automatically.
 */
async function submitBatch(
  urls: string[],
  apiKey: string
): Promise<MonkeySubmitResult> {
  const body =
    urls.length === 1
      ? { url: urls[0] }
      : { urls };

  try {
    const resp = await axios.post(`${MONKEY_API_BASE}/submit`, body, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
      validateStatus: () => true, // handle all statuses manually
    });

    const data = resp.data as any;

    if (resp.status === 402) {
      return {
        success: false,
        submitted: 0,
        rejected: urls.length,
        invalidUrls: [],
        trackingIds: [],
        creditsRemaining: data?.data?.credits_remaining ?? 0,
        error: "Insufficient Monkey Indexer credits. Top up at monkeyindexer.com/dashboard/billing",
      };
    }

    if (resp.status === 503 && data?.data?.error_code === "indexing_paused") {
      return {
        success: false,
        submitted: 0,
        rejected: urls.length,
        invalidUrls: [],
        trackingIds: [],
        error: "Monkey Indexer indexing is temporarily paused for maintenance. Please retry shortly.",
      };
    }

    if (!data?.success) {
      return {
        success: false,
        submitted: 0,
        rejected: urls.length,
        invalidUrls: [],
        trackingIds: [],
        error: data?.message || `Unexpected response (HTTP ${resp.status})`,
      };
    }

    return {
      success: true,
      submitted: data.data?.submitted ?? 0,
      rejected: data.data?.rejected ?? 0,
      invalidUrls: data.data?.invalid_urls ?? [],
      trackingIds: data.data?.tracking_ids ?? [],
      creditsRemaining: data.data?.credits_remaining,
    };
  } catch (err: any) {
    return {
      success: false,
      submitted: 0,
      rejected: urls.length,
      invalidUrls: [],
      trackingIds: [],
      error: err.message || "Network error contacting Monkey Indexer",
    };
  }
}

/**
 * Submit any number of URLs, chunking into batches of 50 automatically.
 */
export async function submitUrlsForIndexing(
  urls: string[]
): Promise<MonkeySubmitResult> {
  if (urls.length === 0) {
    return {
      success: false,
      submitted: 0,
      rejected: 0,
      invalidUrls: [],
      trackingIds: [],
      error: "No URLs provided",
    };
  }

  const apiKey = await getMonkeyApiKey();

  const allTrackingIds: string[] = [];
  const allInvalidUrls: string[] = [];
  let totalSubmitted = 0;
  let totalRejected = 0;
  let lastCreditsRemaining: number | undefined;
  let lastError: string | undefined;

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const chunk = urls.slice(i, i + BATCH_SIZE);
    console.log(
      `[MonkeyIndexer] Submitting batch ${Math.floor(i / BATCH_SIZE) + 1}: ${chunk.length} URLs`
    );
    const result = await submitBatch(chunk, apiKey);
    totalSubmitted += result.submitted;
    totalRejected += result.rejected;
    allTrackingIds.push(...result.trackingIds);
    allInvalidUrls.push(...result.invalidUrls);
    if (result.creditsRemaining !== undefined) {
      lastCreditsRemaining = result.creditsRemaining;
    }
    if (!result.success && result.error) {
      lastError = result.error;
    }
  }

  const overallSuccess = totalSubmitted > 0;
  console.log(
    `[MonkeyIndexer] Done — submitted: ${totalSubmitted}, rejected: ${totalRejected}, credits left: ${lastCreditsRemaining ?? "unknown"}`
  );

  return {
    success: overallSuccess,
    submitted: totalSubmitted,
    rejected: totalRejected,
    invalidUrls: allInvalidUrls,
    trackingIds: allTrackingIds,
    creditsRemaining: lastCreditsRemaining,
    error: overallSuccess ? undefined : lastError,
  };
}

// ============= Status Polling =============

/**
 * Poll the status of up to 100 tracking IDs.
 */
export async function getSubmissionStatuses(
  trackingIds: string[]
): Promise<MonkeySubmissionStatus[]> {
  if (trackingIds.length === 0) return [];
  const apiKey = await getMonkeyApiKey();
  try {
    const ids = trackingIds.slice(0, 100).join(",");
    const resp = await axios.get(`${MONKEY_API_BASE}/submissions`, {
      params: { ids, limit: 100 },
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    });
    const items: any[] = resp.data?.data?.items ?? [];
    return items.map((item) => ({
      trackingId: item.tracking_id,
      url: item.url,
      status: item.status,
      providerStatus: item.provider_status,
      submittedAt: item.submitted_at,
      crawledAt: item.crawled_at,
    }));
  } catch (err: any) {
    console.error(`[MonkeyIndexer] Failed to get submission statuses: ${err.message}`);
    return [];
  }
}

/**
 * Get recent submission history (newest first, up to 100).
 */
export async function getIndexingHistory(): Promise<MonkeySubmissionStatus[]> {
  const apiKey = await getMonkeyApiKey();
  try {
    const resp = await axios.get(`${MONKEY_API_BASE}/submissions`, {
      params: { limit: 100 },
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 15000,
    });
    const items: any[] = resp.data?.data?.items ?? [];
    return items.map((item) => ({
      trackingId: item.tracking_id,
      url: item.url,
      status: item.status,
      providerStatus: item.provider_status,
      submittedAt: item.submitted_at,
      crawledAt: item.crawled_at,
    }));
  } catch (err: any) {
    console.error(`[MonkeyIndexer] Failed to get indexing history: ${err.message}`);
    return [];
  }
}

/**
 * Get account info and remaining credits.
 */
export async function getAccountInfo(): Promise<{
  name: string;
  email: string;
  creditsAvailable: number;
  creditsUsed: number;
  tokenExpiresAt: string;
} | null> {
  const apiKey = await getMonkeyApiKey();
  try {
    const resp = await axios.get(`${MONKEY_API_BASE}/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
    });
    const d = resp.data?.data;
    if (!d) return null;
    return {
      name: d.user?.name ?? "",
      email: d.user?.email ?? "",
      creditsAvailable: d.credits?.available ?? 0,
      creditsUsed: d.credits?.lifetime_used ?? 0,
      tokenExpiresAt: d.token?.expires_at ?? "",
    };
  } catch (err: any) {
    console.error(`[MonkeyIndexer] Failed to get account info: ${err.message}`);
    return null;
  }
}

// ============= Campaign-Level Functions =============

/**
 * Submit all published URLs for a campaign to Monkey Indexer.
 * Called after content pages are published to the client site.
 */
export async function submitCampaignForIndexing(params: {
  campaignId: number;
  businessName: string;
}): Promise<IndexingSubmissionResult> {
  const { campaignId, businessName } = params;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Collect all published URLs for this campaign
  const pages = await db
    .select({ publishedUrl: contentPages.publishedUrl })
    .from(contentPages)
    .where(
      and(
        eq(contentPages.campaignId, campaignId),
        eq(contentPages.status, "published"),
        isNotNull(contentPages.publishedUrl)
      )
    );

  const urls = pages
    .map((p) => p.publishedUrl)
    .filter((url): url is string => !!url);

  if (urls.length === 0) {
    return {
      submitted: false,
      trackingIds: [],
      urlsSubmitted: 0,
      urls: [],
      error: "No published URLs found for this campaign. Publish content first.",
      submittedAt: new Date().toISOString(),
    };
  }

  console.log(
    `[MonkeyIndexer] Campaign ${campaignId} (${businessName}): submitting ${urls.length} URLs`
  );

  const result = await submitUrlsForIndexing(urls);

  if (result.success) {
    await db
      .update(campaigns)
      .set({
        status: "indexing",
        indexingSubmittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaignId));
    console.log(
      `[MonkeyIndexer] Campaign ${campaignId}: ${result.submitted} URLs submitted, ${result.creditsRemaining ?? "?"} credits remaining`
    );
  }

  return {
    submitted: result.success,
    trackingIds: result.trackingIds,
    urlsSubmitted: result.submitted,
    urls,
    creditsRemaining: result.creditsRemaining,
    error: result.error,
    submittedAt: new Date().toISOString(),
  };
}

/**
 * Verify that a campaign's published URLs are accessible (HTTP check).
 * Call this 3-4 days after submission to confirm indexing eligibility.
 */
export async function verifyCampaignIndexing(campaignId: number): Promise<{
  verified: boolean;
  totalUrls: number;
  accessibleUrls: number;
  inaccessibleUrls: string[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const pages = await db
    .select({ publishedUrl: contentPages.publishedUrl })
    .from(contentPages)
    .where(
      and(
        eq(contentPages.campaignId, campaignId),
        eq(contentPages.status, "published"),
        isNotNull(contentPages.publishedUrl)
      )
    );

  const urls = pages
    .map((p) => p.publishedUrl)
    .filter((url): url is string => !!url);

  const inaccessibleUrls: string[] = [];
  let accessibleCount = 0;

  for (const url of urls) {
    try {
      await axios.head(url, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: (status) => status < 400,
      });
      accessibleCount++;
    } catch {
      inaccessibleUrls.push(url);
    }
  }

  const verified =
    urls.length > 0 && accessibleCount / urls.length >= 0.8;

  if (verified) {
    await db
      .update(campaigns)
      .set({
        indexingVerifiedAt: new Date(),
        status: "baseline_check",
        updatedAt: new Date(),
      })
      .where(eq(campaigns.id, campaignId));
  }

  return {
    verified,
    totalUrls: urls.length,
    accessibleUrls: accessibleCount,
    inaccessibleUrls,
  };
}
