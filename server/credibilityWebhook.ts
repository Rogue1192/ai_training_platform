/**
 * Credibility Content Outbound Webhook
 *
 * Fires after content generation completes for a campaign.
 * Sends all generated credibility pages to the companion Next.js platform
 * in a structured JSON payload.
 *
 * The webhook URL is stored in the "whitelabel" service key as:
 *   { ..., credibilityWebhookUrl: "https://..." }
 *
 * Pages with deliveryType "new_page" should be created as new standalone pages.
 * Pages with deliveryType "inject_existing" should have their content appended
 * to an existing page (e.g., About Us).
 */

import { getDb } from "./db";
import { contentPages, businesses, campaigns } from "../drizzle/schema";
import { eq, and, ne } from "drizzle-orm";
import { decrypt } from "./encryption";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebhookFaqItem {
  q: string;
  a: string;
}

export interface WebhookPage {
  page_type: string;
  delivery_type: "new_page" | "inject_existing";
  title: string;
  slug: string;
  content: string;
  meta_description: string;
  schema_markup: string;
  links: string[];
  faq: WebhookFaqItem[];
}

export interface CredibilityWebhookPayload {
  event: "credibility_content_ready";
  campaign_id: number;
  business_id: number;
  client_name: string;
  client_phone: string;
  client_email: string;
  business_name: string;
  business_location: string;
  industry: string;
  website: string;
  sent_at: string;
  pages: WebhookPage[];
}

// ─── FAQ Extraction ───────────────────────────────────────────────────────────

/**
 * Extracts FAQ items from HTML content.
 * Looks for common FAQ patterns:
 *   - <h3>Question?</h3><p>Answer</p>
 *   - <dt>Question?</dt><dd>Answer</dd>
 *   - <strong>Q: ...</strong> followed by answer text
 */
function extractFaqFromHtml(html: string): WebhookFaqItem[] {
  const faqs: WebhookFaqItem[] = [];

  // Pattern 1: <h3>...</h3><p>...</p> inside a FAQ section
  const h3Pattern = /<h3[^>]*>(.*?)<\/h3>\s*<p[^>]*>(.*?)<\/p>/gis;
  let match: RegExpExecArray | null;
  while ((match = h3Pattern.exec(html)) !== null) {
    const q = stripHtml(match[1]).trim();
    const a = stripHtml(match[2]).trim();
    if (q && a && q.length < 200) {
      faqs.push({ q, a });
    }
  }

  // Pattern 2: <dt>...</dt><dd>...</dd>
  if (faqs.length === 0) {
    const dtPattern = /<dt[^>]*>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/gis;
    while ((match = dtPattern.exec(html)) !== null) {
      const q = stripHtml(match[1]).trim();
      const a = stripHtml(match[2]).trim();
      if (q && a && q.length < 200) {
        faqs.push({ q, a });
      }
    }
  }

  return faqs;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ─── Webhook URL Retrieval ────────────────────────────────────────────────────

async function getWebhookUrl(): Promise<string | null> {
  try {
    const db = await getDb();
    if (!db) return null;
    const { serviceKeys } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [record] = await db
      .select()
      .from(serviceKeys)
      .where(eq(serviceKeys.service, "whitelabel"))
      .limit(1);
    if (!record) return null;
    const raw = decrypt(record.encryptedValue);
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.credibilityWebhookUrl || null;
  } catch {
    return null;
  }
}

// ─── Main Webhook Function ────────────────────────────────────────────────────

/**
 * Sends the credibility content webhook for a completed campaign.
 * Called from pipelineOrchestrator after content_generation step completes.
 *
 * Fails silently — a webhook failure should never block the campaign pipeline.
 */
export async function sendCredibilityWebhook(params: {
  campaignId: number;
  businessId: number;
}): Promise<{ sent: boolean; error?: string }> {
  const { campaignId, businessId } = params;

  try {
    // 1. Get the webhook URL from settings
    const webhookUrl = await getWebhookUrl();
    if (!webhookUrl) {
      console.log(`[Credibility Webhook] No webhook URL configured — skipping.`);
      return { sent: false, error: "No webhook URL configured" };
    }

    // 2. Load business and campaign data
    const db = await getDb();
    if (!db) return { sent: false, error: "Database unavailable" };

    const [business] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, businessId))
      .limit(1);

    if (!business) return { sent: false, error: "Business not found" };

    const [campaign] = await db
      .select()
      .from(campaigns)
      .where(eq(campaigns.id, campaignId))
      .limit(1);

    if (!campaign) return { sent: false, error: "Campaign not found" };

    // 3. Load all successfully generated content pages for this campaign
    const pages = await db
      .select()
      .from(contentPages)
      .where(
        and(
          eq(contentPages.campaignId, campaignId),
          eq(contentPages.status, "generated"),
          ne(contentPages.pageType, "llm_txt") // exclude llm.txt — not a credibility page
        )
      );

    if (pages.length === 0) {
      return { sent: false, error: "No generated pages found for this campaign" };
    }

    // 4. Build the webhook payload
    const webhookPages: WebhookPage[] = pages.map((page) => {
      const faq = extractFaqFromHtml(page.pageContent || "");
      const interlinkTargets = Array.isArray(page.interlinkTargets)
        ? (page.interlinkTargets as string[])
        : [];

      // Determine delivery type — "about" is always inject_existing, all others are new_page
      const deliveryType: "new_page" | "inject_existing" =
        page.pageType === "about" ? "inject_existing" : "new_page";

      return {
        page_type: page.pageType,
        delivery_type: deliveryType,
        title: page.pageTitle,
        slug: page.pageSlug || page.pageType,
        content: page.pageContent || "",
        meta_description: page.metaDescription || "",
        schema_markup: page.schemaMarkup || "",
        links: interlinkTargets,
        faq,
      };
    });

    const payload: CredibilityWebhookPayload = {
      event: "credibility_content_ready",
      campaign_id: campaignId,
      business_id: businessId,
      client_name: business.contactName || business.name,
      client_phone: business.phone || "",
      client_email: business.contactEmail || "",
      business_name: business.name,
      business_location: business.location || "",
      industry: business.businessType || "",
      website: business.website || "",
      sent_at: new Date().toISOString(),
      pages: webhookPages,
    };

    // 5. Send the webhook
    console.log(
      `[Credibility Webhook] Sending ${webhookPages.length} pages to ${webhookUrl}`
    );

    const axios = (await import("axios")).default;
    const response = await axios.post(webhookUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        "X-Source": "ai-answer-forge",
        "X-Campaign-Id": String(campaignId),
      },
      timeout: 15000,
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(
        `[Credibility Webhook] ✓ Sent successfully (HTTP ${response.status})`
      );
      return { sent: true };
    } else {
      const msg = `Webhook returned HTTP ${response.status}`;
      console.warn(`[Credibility Webhook] ✗ ${msg}`);
      return { sent: false, error: msg };
    }
  } catch (err: any) {
    const msg = err?.message || "Unknown error";
    console.error(`[Credibility Webhook] ✗ Failed: ${msg}`);
    return { sent: false, error: msg };
  }
}
