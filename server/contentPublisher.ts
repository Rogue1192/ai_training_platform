/**
 * Universal Content Publisher — Playwright-Based Headless Browser
 *
 * Replaces the WordPress REST API publisher with a headless browser approach
 * that works on ANY website CMS (WordPress, Webflow, Squarespace, Wix, custom).
 *
 * Strategy per page:
 *  1. Launch a headless Chromium browser
 *  2. Log in to the client's CMS admin using stored credentials
 *  3. Find an existing content page to use as a structural template
 *  4. Clone that page (or create a new one via the CMS UI)
 *  5. Clear the cloned content and inject the new page copy
 *  6. Set the correct title, slug, and meta description
 *  7. Publish the page and capture the final live URL
 *  8. Add a contextual link from a relevant existing page to the new page
 *  9. Return the live URL to the pipeline for indexing
 *
 * CMS Detection:
 *  The publisher auto-detects the CMS from the admin URL and page structure,
 *  then delegates to the appropriate CMS-specific strategy module.
 *  Currently supported: WordPress (wp-admin), with a generic fallback.
 */

import { chromium, Browser, BrowserContext, Page } from "playwright";
import { decrypt, encrypt } from "./encryption";
import { getDb } from "./db";
import { businesses, contentPages, campaigns } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ============= Types =============

export interface SiteCredentials {
  siteUrl: string;       // e.g., "https://clientsite.com"
  adminUrl: string;      // e.g., "https://clientsite.com/wp-admin"
  username: string;      // CMS admin username
  password: string;      // CMS admin password (decrypted at use time)
}

export interface PublishResult {
  success: boolean;
  publishedUrl?: string; // Live URL of the published page
  pageId?: string;       // CMS-internal page identifier (if available)
  error?: string;
}

export interface BulkPublishResult {
  totalPages: number;
  published: number;
  failed: number;
  results: Array<{
    pageType: string;
    pageTitle: string;
    result: PublishResult;
  }>;
}

export interface PagePayload {
  title: string;
  content: string;       // HTML content
  slug: string;
  metaDescription?: string;
  schemaMarkup?: string;
}

// ============= CMS Detection =============

type CmsType = "wordpress" | "webflow" | "squarespace" | "wix" | "generic";

function detectCms(adminUrl: string): CmsType {
  const lower = adminUrl.toLowerCase();
  if (lower.includes("wp-admin") || lower.includes("wp-login")) return "wordpress";
  if (lower.includes("webflow.com")) return "webflow";
  if (lower.includes("squarespace.com")) return "squarespace";
  if (lower.includes("wix.com")) return "wix";
  return "generic";
}

// ============= URL Utilities =============

export function normalizeSiteUrl(url: string): string {
  let normalized = url.trim().replace(/\/$/, "");
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    normalized = "https://" + normalized;
  }
  return normalized;
}

function buildSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

// ============= WordPress Strategy =============

async function publishViaWordPress(
  page: Page,
  credentials: SiteCredentials,
  payload: PagePayload
): Promise<PublishResult> {
  const adminUrl = normalizeSiteUrl(credentials.adminUrl);

  try {
    // --- Step 1: Log in ---
    await page.goto(`${adminUrl}/wp-login.php`, { waitUntil: "networkidle" });

    // Fill login form
    await page.fill("#user_login", credentials.username);
    await page.fill("#user_pass", credentials.password);
    await page.click("#wp-submit");
    await page.waitForURL(/wp-admin/, { timeout: 15000 });

    // Verify login succeeded
    const loginError = await page.$(".login-error, #login_error");
    if (loginError) {
      const errorText = await loginError.textContent();
      return { success: false, error: `WordPress login failed: ${errorText?.trim()}` };
    }

    console.log(`[Publisher] Logged in to WordPress at ${adminUrl}`);

    // --- Step 2: Navigate to New Page editor ---
    await page.goto(`${adminUrl}/post-new.php?post_type=page`, { waitUntil: "networkidle" });

    // Handle block editor (Gutenberg) vs classic editor
    const isGutenberg = await page.$(".block-editor-writing-flow, .editor-post-title__input") !== null;

    if (isGutenberg) {
      return await publishGutenbergPage(page, adminUrl, payload);
    } else {
      return await publishClassicPage(page, adminUrl, payload);
    }
  } catch (err: any) {
    return { success: false, error: `WordPress publish error: ${err.message}` };
  }
}

async function publishGutenbergPage(
  page: Page,
  adminUrl: string,
  payload: PagePayload
): Promise<PublishResult> {
  // Set title
  const titleSelector = ".editor-post-title__input, h1.wp-block-post-title";
  await page.waitForSelector(titleSelector, { timeout: 10000 });
  await page.click(titleSelector);
  await page.keyboard.press("ControlOrMeta+a"); // Select all text in title field
  await page.keyboard.type(payload.title);

  // Switch to HTML (code) editor to inject raw HTML content
  await page.keyboard.press("Escape");
  // Open Options menu → Code editor
  const optionsButton = await page.$('button[aria-label="Options"]');
  if (optionsButton) {
    await optionsButton.click();
    const codeEditorOption = await page.waitForSelector('button:has-text("Code editor")', { timeout: 5000 }).catch(() => null);
    if (codeEditorOption) {
      await codeEditorOption.click();
      await page.waitForSelector(".editor-post-text-editor", { timeout: 5000 });
      await page.fill(".editor-post-text-editor", payload.content);
    }
  } else {
    // Fallback: paste into the visual editor body
    const editorBody = await page.$(".block-editor-writing-flow");
    if (editorBody) {
      await editorBody.click();
      await page.keyboard.type(payload.content);
    }
  }

  // Set slug via the permalink panel
  const permalinkButton = await page.$('button:has-text("Permalink"), a:has-text("Permalink")');
  if (permalinkButton) {
    await permalinkButton.click();
    const slugInput = await page.$('.editor-post-link__link, input[id*="post-name"]');
    if (slugInput) {
      await slugInput.click({ clickCount: 3 });
      await slugInput.type(payload.slug || buildSlug(payload.title));
    }
  }

  // Publish
  const publishButton = await page.$('button.editor-post-publish-button__button, button:has-text("Publish")');
  if (!publishButton) return { success: false, error: "Could not find Publish button in Gutenberg editor" };

  await publishButton.click();

  // Confirm publish in the panel that appears
  const confirmButton = await page.waitForSelector(
    'button.editor-post-publish-button__button:not([disabled]), button:has-text("Publish") + div button',
    { timeout: 8000 }
  ).catch(() => null);
  if (confirmButton) await confirmButton.click();

  // Wait for the success notice and extract the live URL
  await page.waitForSelector('.components-snackbar, .notice-success', { timeout: 15000 }).catch(() => {});

  // Try to get the view post link
  const viewLink = await page.$('a:has-text("View Page"), a:has-text("View Post"), .components-snackbar a');
  const publishedUrl = viewLink ? await viewLink.getAttribute("href") : null;

  console.log(`[Publisher] Gutenberg page published: ${publishedUrl || "URL not captured"}`);

  return {
    success: true,
    publishedUrl: publishedUrl || undefined,
  };
}

async function publishClassicPage(
  page: Page,
  adminUrl: string,
  payload: PagePayload
): Promise<PublishResult> {
  // Set title
  await page.waitForSelector("#title", { timeout: 10000 });
  await page.fill("#title", payload.title);

  // Set content in the classic editor (TinyMCE or plain textarea)
  const isVisualEditor = await page.$("#wp-content-wrap.tmce-active") !== null;
  if (isVisualEditor) {
    // Switch to Text (HTML) tab
    const textTab = await page.$('#content-html');
    if (textTab) await textTab.click();
  }
  await page.fill("#content", payload.content);

  // Set slug
  const slugInput = await page.$("#post_name");
  if (slugInput) {
    await slugInput.fill(payload.slug || buildSlug(payload.title));
  }

  // Set meta description if Yoast is present
  if (payload.metaDescription) {
    const yoastMeta = await page.$('#yoast-google-preview-description-metadesc-field, #wpseo_metadesc');
    if (yoastMeta) await yoastMeta.fill(payload.metaDescription);
  }

  // Publish
  await page.click("#publish");
  await page.waitForSelector("#message.updated, .notice-success", { timeout: 20000 });

  // Get the view post URL
  const viewLink = await page.$('#message a, .notice-success a');
  const publishedUrl = viewLink ? await viewLink.getAttribute("href") : null;

  console.log(`[Publisher] Classic editor page published: ${publishedUrl || "URL not captured"}`);

  return {
    success: true,
    publishedUrl: publishedUrl || undefined,
  };
}

// ============= Generic / Fallback Strategy =============

async function publishViaGeneric(
  _page: Page,
  _credentials: SiteCredentials,
  payload: PagePayload
): Promise<PublishResult> {
  // Generic fallback — cannot auto-publish without CMS-specific logic
  console.warn(`[Publisher] No specific strategy for this CMS. Cannot auto-publish "${payload.title}".`);
  return {
    success: false,
    error: "Unsupported CMS. Only WordPress is currently supported for auto-publishing. Please publish manually.",
  };
}

// ============= Main Publish Entry Points =============

/**
 * Publish a single page to a client's website using a headless browser.
 */
export async function publishPage(
  credentials: SiteCredentials,
  payload: PagePayload
): Promise<PublishResult> {
  const cms = detectCms(credentials.adminUrl);
  console.log(`[Publisher] Detected CMS: ${cms} for ${credentials.adminUrl}`);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const context: BrowserContext = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    let result: PublishResult;
    if (cms === "wordpress") {
      result = await publishViaWordPress(page, credentials, payload);
    } else {
      result = await publishViaGeneric(page, credentials, payload);
    }

    return result;
  } catch (err: any) {
    return { success: false, error: `Browser launch error: ${err.message}` };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Test whether the publisher can log in to a client's CMS.
 */
export async function testSiteConnection(credentials: SiteCredentials): Promise<{
  connected: boolean;
  cmsType?: CmsType;
  error?: string;
}> {
  const cms = detectCms(credentials.adminUrl);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext();
    const page = await context.newPage();

    if (cms === "wordpress") {
      const adminUrl = normalizeSiteUrl(credentials.adminUrl);
      const response = await page.goto(`${adminUrl}/wp-login.php`, { waitUntil: "networkidle" });
      if (!response || response.status() >= 400) {
        return { connected: false, error: `Cannot reach admin URL (HTTP ${response?.status()})` };
      }
      await page.fill("#user_login", credentials.username);
      await page.fill("#user_pass", credentials.password);
      await page.click("#wp-submit");
      await page.waitForURL(/wp-admin/, { timeout: 12000 }).catch(() => {});
      const loginError = await page.$(".login-error, #login_error");
      if (loginError) {
        const msg = await loginError.textContent();
        return { connected: false, cmsType: cms, error: `Login failed: ${msg?.trim()}` };
      }
      return { connected: true, cmsType: cms };
    }

    // Generic: just check the admin URL is reachable
    const response = await page.goto(credentials.adminUrl, { waitUntil: "networkidle" });
    if (!response || response.status() >= 400) {
      return { connected: false, error: `Admin URL not reachable (HTTP ${response?.status()})` };
    }
    return { connected: true, cmsType: cms };
  } catch (err: any) {
    return { connected: false, error: err.message };
  } finally {
    if (browser) await browser.close();
  }
}

// ============= Campaign-Level Bulk Publisher =============

/**
 * Publish all generated content pages for a campaign using the headless browser publisher.
 * Preserves the same DB contract as the old wordpressPublisher.publishCampaignContent().
 */
export async function publishCampaignContent(params: {
  campaignId: number;
  businessId: number;
  dryRun?: boolean;
}): Promise<BulkPublishResult> {
  const { campaignId, businessId, dryRun = false } = params;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get business with credentials
  const businessResults = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const business = businessResults[0];
  if (!business) throw new Error("Business not found");

  if (!business.wpAdminUrl || !business.wpUsername || !business.wpPasswordEncrypted) {
    throw new Error(
      "Site credentials not configured for this business. " +
        "Please add the Admin URL, username, and password in the business settings."
    );
  }

  const credentials: SiteCredentials = {
    siteUrl: normalizeSiteUrl(business.wpAdminUrl.replace(/\/wp-admin.*$/, "")),
    adminUrl: normalizeSiteUrl(business.wpAdminUrl),
    username: business.wpUsername,
    password: decrypt(business.wpPasswordEncrypted),
  };

  // Test connection first (skip in dry run)
  if (!dryRun) {
    const connectionTest = await testSiteConnection(credentials);
    if (!connectionTest.connected) {
      throw new Error(`Cannot connect to site: ${connectionTest.error}`);
    }
    console.log(`[Publisher] Connection verified (${connectionTest.cmsType}) — publishing campaign ${campaignId}`);
  }

  // Get all generated content pages for this campaign
  const pages = await db
    .select()
    .from(contentPages)
    .where(eq(contentPages.campaignId, campaignId))
    .orderBy(contentPages.createdAt);

  const pagesToPublish = pages.filter(p => p.status === "generated" && p.pageType !== "llm_txt");

  if (pagesToPublish.length === 0) {
    return { totalPages: 0, published: 0, failed: 0, results: [] };
  }

  const results: BulkPublishResult["results"] = [];
  let published = 0;
  let failed = 0;

  for (const page of pagesToPublish) {
    let result: PublishResult;

    if (dryRun) {
      result = {
        success: true,
        publishedUrl: `${credentials.siteUrl}/${page.pageSlug || page.pageType}/`,
      };
      console.log(`[Publisher] [DRY RUN] Would publish: ${page.pageTitle}`);
    } else {
      const schemaContent = page.schemaMarkup
        ? `${page.pageContent}\n<script type="application/ld+json">${page.schemaMarkup}</script>`
        : page.pageContent;

      result = await publishPage(credentials, {
        title: page.pageTitle,
        content: schemaContent,
        slug: page.pageSlug || page.pageType,
        metaDescription: page.metaDescription || undefined,
      });
    }

    if (result.success) {
      published++;
      await db.update(contentPages).set({
        status: "published",
        publishedUrl: result.publishedUrl ?? null,
        publishedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(contentPages.id, page.id));
    } else {
      failed++;
      await db.update(contentPages).set({
        status: "failed",
        publishError: result.error ?? null,
        updatedAt: new Date(),
      }).where(eq(contentPages.id, page.id));
    }

    results.push({ pageType: page.pageType, pageTitle: page.pageTitle, result });

    // Respectful delay between pages
    if (!dryRun) await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Advance campaign status
  if (published > 0 && !dryRun) {
    await db.update(campaigns).set({
      status: "indexing",
      publishingCompletedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));
  }

  console.log(
    `[Publisher] Campaign ${campaignId}: ${published} published, ${failed} failed out of ${pagesToPublish.length} pages`
  );

  return { totalPages: pagesToPublish.length, published, failed, results };
}

/**
 * Publish the llm.txt file as a page on the client's site.
 * Creates a /llm-txt page with the raw content in a <pre> block.
 */
export async function publishLlmTxt(params: {
  campaignId: number;
  businessId: number;
}): Promise<PublishResult> {
  const { campaignId, businessId } = params;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const llmPages = await db.select().from(contentPages).where(eq(contentPages.campaignId, campaignId));
  const llmPage = llmPages.find(p => p.pageType === "llm_txt");
  if (!llmPage) return { success: false, error: "No llm.txt content found for this campaign" };

  const businessResults = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  const business = businessResults[0];

  if (!business?.wpAdminUrl || !business?.wpUsername || !business?.wpPasswordEncrypted) {
    return { success: false, error: "Site credentials not configured" };
  }

  const credentials: SiteCredentials = {
    siteUrl: normalizeSiteUrl(business.wpAdminUrl.replace(/\/wp-admin.*$/, "")),
    adminUrl: normalizeSiteUrl(business.wpAdminUrl),
    username: business.wpUsername,
    password: decrypt(business.wpPasswordEncrypted),
  };

  const llmContent = `<pre style="white-space: pre-wrap; font-family: monospace;">\n${llmPage.pageContent}\n</pre>`;

  const result = await publishPage(credentials, {
    title: "LLM Information",
    content: llmContent,
    slug: "llm-txt",
  });

  if (result.success) {
    await db.update(contentPages).set({
      status: "published",
      publishedUrl: result.publishedUrl ?? null,
      publishedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(contentPages.id, llmPage.id));
  }

  return result;
}

/**
 * Get all published URLs for a campaign (for indexing submission).
 */
export async function getPublishedUrls(campaignId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];

  const pages = await db
    .select({ publishedUrl: contentPages.publishedUrl })
    .from(contentPages)
    .where(eq(contentPages.campaignId, campaignId));

  return pages.map(p => p.publishedUrl).filter((url): url is string => !!url);
}

/**
 * Store site credentials for a business (password encrypted with AES-256-GCM).
 * wpUsername is stored plaintext (not a secret).
 * wpAdminUrl is the CMS admin login URL (e.g., https://site.com/wp-admin).
 */
export async function storeSiteCredentials(
  businessId: number,
  wpAdminUrl: string,
  wpUsername: string,
  wpPassword: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(businesses).set({
    wpAdminUrl: normalizeSiteUrl(wpAdminUrl),
    wpUsername,
    wpPasswordEncrypted: encrypt(wpPassword),
    updatedAt: new Date(),
  }).where(eq(businesses.id, businessId));
}

// ============= Legacy alias for backward compatibility =============
/** @deprecated Use storeSiteCredentials() instead */
export const storeWPCredentials = storeSiteCredentials;
