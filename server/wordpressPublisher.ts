/**
 * WordPress Auto-Publisher Service
 * 
 * Publishes generated content pages to client WordPress sites using the
 * WordPress REST API (v2) with Application Passwords authentication.
 * 
 * Supports:
 * - Creating/publishing pages with HTML content
 * - Setting page slugs, meta descriptions, and schema markup
 * - Uploading llm.txt to the site root (via custom endpoint or FTP fallback)
 * - Injecting schema markup into page headers
 * - Error handling with detailed failure reporting
 * 
 * Authentication: WordPress Application Passwords (Basic Auth)
 * The client's WP admin URL, username, and application password are stored
 * encrypted in the businesses table.
 */

import axios, { AxiosError } from "axios";
import { decrypt, encrypt } from "./encryption";
import { getDb } from "./db";
import { businesses, contentPages, campaigns } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ============= Types =============

export interface WPCredentials {
  siteUrl: string;      // e.g., "https://clientsite.com"
  username: string;      // WordPress username
  appPassword: string;   // Application Password (not regular password)
}

export interface WPPublishResult {
  success: boolean;
  pageId?: number;       // WordPress page ID
  publishedUrl?: string; // Live URL of the published page
  error?: string;
  statusCode?: number;
}

export interface WPPagePayload {
  title: string;
  content: string;       // HTML content
  slug: string;
  status: "publish" | "draft" | "pending";
  meta?: Record<string, any>;
  excerpt?: string;      // Used for meta description in some themes
}

export interface WPBulkPublishResult {
  totalPages: number;
  published: number;
  failed: number;
  results: Array<{
    pageType: string;
    pageTitle: string;
    result: WPPublishResult;
  }>;
}

// ============= WordPress REST API Client =============

/**
 * Build the Basic Auth header for WordPress Application Passwords
 */
function buildAuthHeader(username: string, appPassword: string): string {
  const credentials = Buffer.from(`${username}:${appPassword}`).toString("base64");
  return `Basic ${credentials}`;
}

/**
 * Normalize a WordPress site URL to ensure it has the correct format
 */
export function normalizeSiteUrl(url: string): string {
  let normalized = url.trim();
  // Remove trailing slash
  if (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  // Ensure https://
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = `https://${normalized}`;
  }
  return normalized;
}

/**
 * Get the WordPress REST API base URL from a site URL
 */
export function getWPApiUrl(siteUrl: string): string {
  return `${normalizeSiteUrl(siteUrl)}/wp-json/wp/v2`;
}

/**
 * Test WordPress REST API connection and authentication
 */
export async function testWPConnection(credentials: WPCredentials): Promise<{
  connected: boolean;
  authenticated: boolean;
  siteTitle?: string;
  wpVersion?: string;
  error?: string;
}> {
  const siteUrl = normalizeSiteUrl(credentials.siteUrl);
  
  try {
    // First test: Can we reach the REST API?
    const discoveryResponse = await axios.get(`${siteUrl}/wp-json/`, {
      timeout: 15000,
      headers: { "User-Agent": "AI-Answer-Forge/1.0" },
    });
    
    const siteTitle = discoveryResponse.data?.name || "Unknown";
    const wpVersion = discoveryResponse.data?.description || "";
    
    // Second test: Can we authenticate?
    const authHeader = buildAuthHeader(credentials.username, credentials.appPassword);
    const meResponse = await axios.get(`${siteUrl}/wp-json/wp/v2/users/me`, {
      timeout: 15000,
      headers: {
        Authorization: authHeader,
        "User-Agent": "AI-Answer-Forge/1.0",
      },
    });
    
    const canPublish = meResponse.data?.capabilities?.publish_pages === true ||
                       meResponse.data?.capabilities?.edit_pages === true ||
                       (meResponse.data?.roles || []).some((r: string) => 
                         ["administrator", "editor"].includes(r)
                       );
    
    if (!canPublish) {
      return {
        connected: true,
        authenticated: true,
        siteTitle,
        wpVersion,
        error: "User does not have permission to publish pages. Needs Administrator or Editor role.",
      };
    }
    
    return { connected: true, authenticated: true, siteTitle, wpVersion };
    
  } catch (error: any) {
    if (error.response?.status === 401 || error.response?.status === 403) {
      return {
        connected: true,
        authenticated: false,
        error: "Authentication failed. Check username and application password.",
      };
    }
    
    return {
      connected: false,
      authenticated: false,
      error: `Cannot reach WordPress REST API: ${error.message}`,
    };
  }
}

/**
 * Create and publish a page on WordPress
 */
export async function publishPage(
  credentials: WPCredentials,
  page: WPPagePayload
): Promise<WPPublishResult> {
  const apiUrl = getWPApiUrl(credentials.siteUrl);
  const authHeader = buildAuthHeader(credentials.username, credentials.appPassword);
  
  try {
    const response = await axios.post(
      `${apiUrl}/pages`,
      {
        title: page.title,
        content: page.content,
        slug: page.slug,
        status: page.status,
        excerpt: page.excerpt || "",
        // Some themes/plugins support Yoast SEO meta via REST API
        meta: page.meta || {},
      },
      {
        timeout: 30000,
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          "User-Agent": "AI-Answer-Forge/1.0",
        },
      }
    );
    
    const wpPageId = response.data?.id;
    const publishedUrl = response.data?.link || response.data?.guid?.rendered;
    
    console.log(`[WP Publisher] ✓ Published page "${page.title}" → ${publishedUrl} (WP ID: ${wpPageId})`);
    
    return {
      success: true,
      pageId: wpPageId,
      publishedUrl,
    };
    
  } catch (error: any) {
    const statusCode = error.response?.status;
    const wpError = error.response?.data?.message || error.message;
    
    console.error(`[WP Publisher] ✗ Failed to publish "${page.title}": ${wpError} (${statusCode})`);
    
    return {
      success: false,
      error: wpError,
      statusCode,
    };
  }
}

/**
 * Update an existing WordPress page
 */
export async function updatePage(
  credentials: WPCredentials,
  wpPageId: number,
  updates: Partial<WPPagePayload>
): Promise<WPPublishResult> {
  const apiUrl = getWPApiUrl(credentials.siteUrl);
  const authHeader = buildAuthHeader(credentials.username, credentials.appPassword);
  
  try {
    const response = await axios.post(
      `${apiUrl}/pages/${wpPageId}`,
      updates,
      {
        timeout: 30000,
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
          "User-Agent": "AI-Answer-Forge/1.0",
        },
      }
    );
    
    return {
      success: true,
      pageId: response.data?.id,
      publishedUrl: response.data?.link,
    };
    
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      statusCode: error.response?.status,
    };
  }
}

/**
 * Check if a page with a given slug already exists
 */
export async function findPageBySlug(
  credentials: WPCredentials,
  slug: string
): Promise<{ exists: boolean; pageId?: number; url?: string }> {
  const apiUrl = getWPApiUrl(credentials.siteUrl);
  const authHeader = buildAuthHeader(credentials.username, credentials.appPassword);
  
  try {
    const response = await axios.get(`${apiUrl}/pages`, {
      params: { slug, status: "publish,draft,pending" },
      timeout: 15000,
      headers: {
        Authorization: authHeader,
        "User-Agent": "AI-Answer-Forge/1.0",
      },
    });
    
    if (response.data && response.data.length > 0) {
      return {
        exists: true,
        pageId: response.data[0].id,
        url: response.data[0].link,
      };
    }
    
    return { exists: false };
    
  } catch {
    return { exists: false };
  }
}

/**
 * Wrap content with schema markup injection
 * Adds JSON-LD schema as a script tag at the end of the content
 */
export function injectSchemaMarkup(htmlContent: string, schemaMarkup: string): string {
  if (!schemaMarkup) return htmlContent;
  
  try {
    // Validate it's valid JSON
    JSON.parse(schemaMarkup);
    return `${htmlContent}\n\n<!-- Schema Markup - AI Answer Forge -->\n<script type="application/ld+json">\n${schemaMarkup}\n</script>`;
  } catch {
    // If schema is invalid JSON, skip injection
    console.warn("[WP Publisher] Schema markup is not valid JSON, skipping injection");
    return htmlContent;
  }
}

/**
 * Publish all generated content pages for a campaign to WordPress
 * 
 * This is the main entry point for bulk publishing.
 * It:
 * 1. Gets the business's WordPress credentials
 * 2. Tests the connection
 * 3. Publishes each content page
 * 4. Updates the database with published URLs
 * 5. Returns a summary of results
 */
export async function publishCampaignContent(params: {
  campaignId: number;
  businessId: number;
  dryRun?: boolean; // If true, validates but doesn't publish
}): Promise<WPBulkPublishResult> {
  const { campaignId, businessId, dryRun = false } = params;
  
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get business with WP credentials
  const businessResults = await db.select().from(businesses)
    .where(eq(businesses.id, businessId)).limit(1);
  const business = businessResults[0];
  
  if (!business) throw new Error("Business not found");
  
  // Check for WordPress credentials
  if (!business.wpAdminUrl || !business.wpUsername || !business.wpPasswordEncrypted) {
    throw new Error(
      "WordPress credentials not configured for this business. " +
      "Please add WP Admin URL, username, and application password."
    );
  }
  
  const credentials: WPCredentials = {
    siteUrl: business.wpAdminUrl,
    username: business.wpUsername,
    appPassword: decrypt(business.wpPasswordEncrypted),
  };
  
  // Test connection first
  const connectionTest = await testWPConnection(credentials);
  if (!connectionTest.connected) {
    throw new Error(`Cannot connect to WordPress: ${connectionTest.error}`);
  }
  if (!connectionTest.authenticated) {
    throw new Error(`WordPress authentication failed: ${connectionTest.error}`);
  }
  
  console.log(`[WP Publisher] Connected to ${connectionTest.siteTitle} — publishing campaign ${campaignId}`);
  
  // Get all generated content pages for this campaign
  const pages = await db.select().from(contentPages)
    .where(eq(contentPages.campaignId, campaignId))
    .orderBy(contentPages.createdAt);
  
  const pagesToPublish = pages.filter(p => 
    p.status === "generated" && p.pageType !== "llm_txt"
  );
  
  if (pagesToPublish.length === 0) {
    return {
      totalPages: 0,
      published: 0,
      failed: 0,
      results: [],
    };
  }
  
  const results: WPBulkPublishResult["results"] = [];
  let published = 0;
  let failed = 0;
  
  // Publish each page
  for (const page of pagesToPublish) {
    // Check if page already exists (avoid duplicates)
    const existing = await findPageBySlug(credentials, page.pageSlug || page.pageType);
    
    let result: WPPublishResult;
    
    if (dryRun) {
      result = {
        success: true,
        publishedUrl: `${normalizeSiteUrl(credentials.siteUrl)}/${page.pageSlug || page.pageType}/`,
      };
      console.log(`[WP Publisher] [DRY RUN] Would publish: ${page.pageTitle}`);
    } else if (existing.exists && existing.pageId) {
      // Update existing page
      const contentWithSchema = injectSchemaMarkup(page.pageContent, page.schemaMarkup || "");
      result = await updatePage(credentials, existing.pageId, {
        title: page.pageTitle,
        content: contentWithSchema,
        status: "publish",
        excerpt: page.metaDescription || undefined,
      });
    } else {
      // Create new page
      const contentWithSchema = injectSchemaMarkup(page.pageContent, page.schemaMarkup || "");
      result = await publishPage(credentials, {
        title: page.pageTitle,
        content: contentWithSchema,
        slug: page.pageSlug || page.pageType,
        status: "publish",
        excerpt: page.metaDescription || undefined,
      });
    }
    
    // Update database
    if (result.success) {
      published++;
      await db.update(contentPages).set({
        status: "published",
        publishedUrl: result.publishedUrl,
        publishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(contentPages.id, page.id));
    } else {
      failed++;
      await db.update(contentPages).set({
        status: "failed",
        publishError: result.error,
        updatedAt: new Date(),
      }).where(eq(contentPages.id, page.id));
    }
    
    results.push({
      pageType: page.pageType,
      pageTitle: page.pageTitle,
      result,
    });
    
    // Small delay between publishes to be respectful to the WP server
    if (!dryRun) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Update campaign status
  if (published > 0 && !dryRun) {
    await db.update(campaigns).set({
      status: "indexing",
      publishingCompletedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));
  }
  
  console.log(`[WP Publisher] Campaign ${campaignId}: ${published} published, ${failed} failed out of ${pagesToPublish.length} pages`);
  
  return {
    totalPages: pagesToPublish.length,
    published,
    failed,
    results,
  };
}

/**
 * Publish llm.txt to the WordPress site
 * 
 * WordPress doesn't natively support uploading arbitrary files to the root.
 * Strategy: Create a page at /llm-txt that outputs the llm.txt content,
 * and recommend the client add a redirect from /llm.txt to this page.
 * 
 * Alternative: If the client has Yoast or a similar plugin, we can use
 * their robots.txt editor to add a reference to the llm.txt URL.
 */
export async function publishLlmTxt(params: {
  campaignId: number;
  businessId: number;
}): Promise<WPPublishResult> {
  const { campaignId, businessId } = params;
  
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get the llm.txt content page
  const llmPages = await db.select().from(contentPages)
    .where(eq(contentPages.campaignId, campaignId))
    .orderBy(contentPages.createdAt);
  
  const llmPage = llmPages.find(p => p.pageType === "llm_txt");
  if (!llmPage) {
    return { success: false, error: "No llm.txt content found for this campaign" };
  }
  
  // Get business WP credentials
  const businessResults = await db.select().from(businesses)
    .where(eq(businesses.id, businessId)).limit(1);
  const business = businessResults[0];
  
  if (!business?.wpAdminUrl || !business?.wpUsername || !business?.wpPasswordEncrypted) {
    return { success: false, error: "WordPress credentials not configured" };
  }
  
  const credentials: WPCredentials = {
    siteUrl: business.wpAdminUrl,
    username: business.wpUsername,
    appPassword: decrypt(business.wpPasswordEncrypted),
  };
  
  // Publish as a page with the llm.txt content wrapped in a <pre> tag
  // This makes it machine-readable while still being a valid WordPress page
  const llmContent = `<pre style="white-space: pre-wrap; font-family: monospace;">\n${llmPage.pageContent}\n</pre>`;
  
  const result = await publishPage(credentials, {
    title: "LLM Information",
    content: llmContent,
    slug: "llm-txt",
    status: "publish",
  });
  
  if (result.success) {
    await db.update(contentPages).set({
      status: "published",
      publishedUrl: result.publishedUrl,
      publishedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(contentPages.id, llmPage.id));
  }
  
  return result;
}

/**
 * Get all published URLs for a campaign (for indexing submission)
 */
export async function getPublishedUrls(campaignId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  
  const pages = await db.select({
    publishedUrl: contentPages.publishedUrl,
  }).from(contentPages)
    .where(eq(contentPages.campaignId, campaignId));
  
  return pages
    .map(p => p.publishedUrl)
    .filter((url): url is string => !!url);
}

/**
 * Store WordPress credentials for a business (encrypted)
 */
export async function storeWPCredentials(
  businessId: number,
  wpAdminUrl: string,
  wpUsername: string,
  wpAppPassword: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(businesses).set({
    wpAdminUrl: normalizeSiteUrl(wpAdminUrl),
    wpUsername,
    wpPasswordEncrypted: encrypt(wpAppPassword),
    updatedAt: new Date(),
  }).where(eq(businesses.id, businessId));
}
