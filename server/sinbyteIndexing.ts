/**
 * SinByte Indexing Service
 * 
 * Integrates with SinByte (sinbyte.com) API to submit published URLs
 * for fast Google indexing. After content pages are published to WordPress,
 * this service submits all URLs to SinByte for accelerated indexing.
 * 
 * API Endpoint: https://app.sinbyte.com/api/indexing/
 * Auth: API key in request body
 * 
 * The service also handles:
 * - Batch URL submission
 * - Task status checking
 * - Verification after 3-4 day waiting period
 * - Storing indexing task IDs for tracking
 */

import axios from "axios";
import { getDb } from "./db";
import { contentPages, campaigns } from "../drizzle/schema";
import { eq, and, isNotNull } from "drizzle-orm";

// ============= Types =============

export interface SinByteSubmitResult {
  success: boolean;
  taskId?: string | number;
  taskName?: string;
  urlCount: number;
  error?: string;
}

export interface SinByteTaskStatus {
  taskId: string | number;
  name: string;
  status: string;
  totalUrls: number;
  indexedUrls?: number;
  createdAt?: string;
  raw?: any;
}

export interface IndexingSubmissionResult {
  submitted: boolean;
  sinbyteTaskId?: string | number;
  urlsSubmitted: number;
  urls: string[];
  error?: string;
  submittedAt: string;
}

// ============= Configuration =============

const SINBYTE_API_BASE = "https://app.sinbyte.com/api/indexing/";

/**
 * Get the SinByte API key from environment variables
 * Casey will set this up in the Secrets panel
 */
function getSinByteApiKey(): string {
  const apiKey = process.env.SINBYTE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SinByte API key not configured. Please add SINBYTE_API_KEY in Settings → Secrets."
    );
  }
  return apiKey;
}

// ============= API Functions =============

/**
 * Submit URLs to SinByte for indexing
 * 
 * @param urls Array of URLs to submit
 * @param taskName Human-readable name for the indexing task
 * @param dripfeed Whether to drip-feed submissions (1 = yes, 0 = no)
 */
export async function submitUrlsForIndexing(
  urls: string[],
  taskName: string,
  dripfeed: number = 1
): Promise<SinByteSubmitResult> {
  if (urls.length === 0) {
    return { success: false, urlCount: 0, error: "No URLs to submit" };
  }
  
  const apiKey = getSinByteApiKey();
  
  try {
    console.log(`[SinByte] Submitting ${urls.length} URLs for indexing: "${taskName}"`);
    
    const response = await axios.post(
      SINBYTE_API_BASE,
      {
        apikey: apiKey,
        name: taskName,
        dripfeed,
        urls,
      },
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        timeout: 30000,
      }
    );
    
    const taskId = response.data?.id || response.data?.task_id;
    
    console.log(`[SinByte] ✓ Submitted ${urls.length} URLs. Task ID: ${taskId}`);
    
    return {
      success: true,
      taskId,
      taskName,
      urlCount: urls.length,
    };
    
  } catch (error: any) {
    const errorMsg = error.response?.data?.message || error.response?.data?.error || error.message;
    console.error(`[SinByte] ✗ Failed to submit URLs: ${errorMsg}`);
    
    return {
      success: false,
      urlCount: urls.length,
      error: errorMsg,
    };
  }
}

/**
 * Get the status of an indexing task
 */
export async function getTaskStatus(taskId: string | number): Promise<SinByteTaskStatus | null> {
  const apiKey = getSinByteApiKey();
  
  try {
    const response = await axios.get(
      `${SINBYTE_API_BASE}${taskId}/?apikey=${apiKey}`,
      {
        headers: { Accept: "application/json" },
        timeout: 15000,
      }
    );
    
    return {
      taskId,
      name: response.data?.name || "",
      status: response.data?.status || "unknown",
      totalUrls: response.data?.total_urls || response.data?.urls?.length || 0,
      indexedUrls: response.data?.indexed_urls || response.data?.indexed || undefined,
      createdAt: response.data?.created_at || response.data?.created || undefined,
      raw: response.data,
    };
    
  } catch (error: any) {
    console.error(`[SinByte] Failed to get task status for ${taskId}: ${error.message}`);
    return null;
  }
}

/**
 * Get the history of all indexing tasks
 */
export async function getIndexingHistory(): Promise<SinByteTaskStatus[]> {
  const apiKey = getSinByteApiKey();
  
  try {
    const response = await axios.get(
      `${SINBYTE_API_BASE}?apikey=${apiKey}`,
      {
        headers: { Accept: "application/json" },
        timeout: 15000,
      }
    );
    
    const tasks = Array.isArray(response.data) ? response.data : response.data?.results || [];
    
    return tasks.map((task: any) => ({
      taskId: task.id || task.task_id,
      name: task.name || "",
      status: task.status || "unknown",
      totalUrls: task.total_urls || task.urls?.length || 0,
      indexedUrls: task.indexed_urls || task.indexed || undefined,
      createdAt: task.created_at || task.created || undefined,
      raw: task,
    }));
    
  } catch (error: any) {
    console.error(`[SinByte] Failed to get indexing history: ${error.message}`);
    return [];
  }
}

// ============= Campaign-Level Functions =============

/**
 * Submit all published URLs for a campaign to SinByte for indexing
 * 
 * This is the main entry point called after WordPress publishing completes.
 */
export async function submitCampaignForIndexing(params: {
  campaignId: number;
  businessName: string;
}): Promise<IndexingSubmissionResult> {
  const { campaignId, businessName } = params;
  
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get all published URLs for this campaign
  const pages = await db.select({
    publishedUrl: contentPages.publishedUrl,
    pageType: contentPages.pageType,
  }).from(contentPages)
    .where(
      and(
        eq(contentPages.campaignId, campaignId),
        eq(contentPages.status, "published"),
        isNotNull(contentPages.publishedUrl)
      )
    );
  
  const urls = pages
    .map(p => p.publishedUrl)
    .filter((url): url is string => !!url);
  
  if (urls.length === 0) {
    return {
      submitted: false,
      urlsSubmitted: 0,
      urls: [],
      error: "No published URLs found for this campaign. Publish content first.",
      submittedAt: new Date().toISOString(),
    };
  }
  
  // Submit to SinByte
  const taskName = `AI Answer Forge — ${businessName} (Campaign ${campaignId})`;
  const result = await submitUrlsForIndexing(urls, taskName);
  
  if (result.success) {
    // Update campaign status
    await db.update(campaigns).set({
      status: "indexing",
      indexingSubmittedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));
    
    console.log(`[SinByte] Campaign ${campaignId}: Submitted ${urls.length} URLs for indexing`);
  }
  
  return {
    submitted: result.success,
    sinbyteTaskId: result.taskId,
    urlsSubmitted: urls.length,
    urls,
    error: result.error,
    submittedAt: new Date().toISOString(),
  };
}

/**
 * Check if a campaign's URLs have been indexed (verification check)
 * 
 * This should be called 3-4 days after submission to verify indexing.
 * Uses a simple HTTP HEAD check to see if the URLs are accessible.
 */
export async function verifyCampaignIndexing(campaignId: number): Promise<{
  verified: boolean;
  totalUrls: number;
  accessibleUrls: number;
  inaccessibleUrls: string[];
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const pages = await db.select({
    publishedUrl: contentPages.publishedUrl,
  }).from(contentPages)
    .where(
      and(
        eq(contentPages.campaignId, campaignId),
        eq(contentPages.status, "published"),
        isNotNull(contentPages.publishedUrl)
      )
    );
  
  const urls = pages
    .map(p => p.publishedUrl)
    .filter((url): url is string => !!url);
  
  const inaccessibleUrls: string[] = [];
  let accessibleCount = 0;
  
  for (const url of urls) {
    try {
      const response = await axios.head(url, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: (status) => status < 400,
      });
      accessibleCount++;
    } catch {
      inaccessibleUrls.push(url);
    }
  }
  
  // If 80%+ of URLs are accessible, consider it verified
  const verified = urls.length > 0 && (accessibleCount / urls.length) >= 0.8;
  
  if (verified) {
    await db.update(campaigns).set({
      indexingVerifiedAt: new Date(),
      status: "baseline_check",
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));
  }
  
  return {
    verified,
    totalUrls: urls.length,
    accessibleUrls: accessibleCount,
    inaccessibleUrls,
  };
}
