/**
 * Site Enhancer — Schema Injection, LLM.txt, and Robots.txt Correction
 *
 * Enhances client websites with:
 * 1. Schema.org JSON-LD markup (Organization/LocalBusiness + per-page Article/WebPage/FAQPage)
 * 2. LLM.txt file generation and publishing
 * 3. Robots.txt correction to unblock AI crawlers
 *
 * All three run as part of the Playwright content publishing flow.
 */

import { Page } from "playwright";
import { getDb } from "./db";
import { businesses, credibilityData, contentPages } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

// ============= Types =============

export interface SchemaOrgData {
  "@context": string;
  "@type": string;
  [key: string]: any;
}

export interface LLMTxtContent {
  businessProfile: string;
  credibilityFacts: string[];
  publishedPages: Array<{ title: string; url: string }>;
  fullText: string;
}

export interface RobotsTxtCheckResult {
  hasBlockedCrawlers: boolean;
  blockedCrawlers: string[];
  originalContent: string;
  correctedContent: string;
}

// ============= Schema.org Generation =============

/**
 * Generate Organization + LocalBusiness schema for the homepage.
 * Uses business info and credibility data.
 */
export async function generateOrganizationSchema(businessId: number): Promise<SchemaOrgData | null> {
  const db = await getDb();
  if (!db) return null;

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) return null;

  // Get latest credibility data
  const [cred] = await db
    .select()
    .from(credibilityData)
    .where(eq(credibilityData.businessId, businessId))
    .orderBy(desc(credibilityData.createdAt))
    .limit(1);

  const schema: SchemaOrgData = {
    "@context": "https://schema.org",
    "@type": business.businessType?.toLowerCase().includes("restaurant") ? "Restaurant" : "LocalBusiness",
    name: business.name,
    description: business.description || `${business.name} — ${business.businessType || "Professional Services"} in ${business.location || "your area"}`,
  };

  if (business.website) schema.url = business.website;
  if (business.phone) schema.telephone = business.phone;
  if (business.contactEmail) schema.email = business.contactEmail;

  if (business.address) {
    schema.address = {
      "@type": "PostalAddress",
      streetAddress: business.address,
      addressLocality: business.location || "",
    };
  }

  if (business.yearsInBusiness) {
    const foundingYear = new Date().getFullYear() - business.yearsInBusiness;
    schema.foundingDate = `${foundingYear}-01-01`;
  }

  // Add aggregateRating if BBB rating exists
  if (business.bbbRating) {
    const ratingMap: Record<string, number> = { "A+": 5.0, A: 4.5, "A-": 4.0, "B+": 3.5, B: 3.0 };
    const ratingValue = ratingMap[business.bbbRating] || 4.0;
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue,
      bestRating: 5,
      worstRating: 1,
      ratingCount: 1,
    };
  }

  // Add awards and certifications if available
  if (business.awards || business.certifications) {
    schema.award = [business.awards, business.certifications].filter(Boolean).join(", ");
  }

  // Add credibility facts as "knowsAbout" or "description" enhancement
  if (cred?.verifiedFacts) {
    const facts = (cred.verifiedFacts as any[]).slice(0, 5).map((f: any) => f.fact).filter(Boolean);
    if (facts.length > 0) {
      schema.knowsAbout = facts;
    }
  }

  return schema;
}

/**
 * Generate Article schema for a credibility page (certifications, awards, etc.).
 */
export function generateArticleSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl: string;
  businessName: string;
  businessWebsite?: string;
}): SchemaOrgData {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.pageTitle,
    description: page.pageContent.replace(/<[^>]*>/g, "").slice(0, 200),
    url: page.publishedUrl,
    author: {
      "@type": "Organization",
      name: page.businessName,
      url: page.businessWebsite || "",
    },
    publisher: {
      "@type": "Organization",
      name: page.businessName,
      url: page.businessWebsite || "",
    },
    datePublished: new Date().toISOString(),
    dateModified: new Date().toISOString(),
  };
}

/**
 * Generate FAQPage schema for FAQ-type pages.
 */
export function generateFAQSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl: string;
}): SchemaOrgData {
  // Extract Q&A pairs from the content (assumes <h3>Question</h3><p>Answer</p> structure)
  const questions = page.pageContent.match(/<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/gi) || [];
  const mainEntity = questions.slice(0, 10).map((qa) => {
    const [, question, answer] = qa.match(/<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/i) || [];
    return {
      "@type": "Question",
      name: question?.replace(/<[^>]*>/g, "") || "",
      acceptedAnswer: {
        "@type": "Answer",
        text: answer?.replace(/<[^>]*>/g, "") || "",
      },
    };
  });

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity,
  };
}

/**
 * Generate WebPage schema for generic credibility pages.
 */
export function generateWebPageSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl: string;
  businessName: string;
  businessWebsite?: string;
}): SchemaOrgData {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.pageTitle,
    description: page.pageContent.replace(/<[^>]*>/g, "").slice(0, 200),
    url: page.publishedUrl,
    publisher: {
      "@type": "Organization",
      name: page.businessName,
      url: page.businessWebsite || "",
    },
  };
}

// ============= LLM.txt Generation =============

/**
 * Generate LLM.txt content for a business using their credibility data and published pages.
 */
export async function generateLLMTxt(businessId: number, campaignId: number): Promise<LLMTxtContent | null> {
  const db = await getDb();
  if (!db) return null;

  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) return null;

  const [cred] = await db
    .select()
    .from(credibilityData)
    .where(eq(credibilityData.businessId, businessId))
    .orderBy(desc(credibilityData.createdAt))
    .limit(1);

  const pages = await db
    .select()
    .from(contentPages)
    .where(eq(contentPages.campaignId, campaignId));

  const publishedPages = pages
    .filter((p) => p.status === "published" && p.publishedUrl)
    .map((p) => ({ title: p.pageTitle, url: p.publishedUrl! }));

  // Build business profile section
  const profileLines: string[] = [];
  profileLines.push(`# ${business.name}`);
  profileLines.push("");
  if (business.businessType) profileLines.push(`Industry: ${business.businessType}`);
  if (business.location) profileLines.push(`Location: ${business.location}`);
  if (business.website) profileLines.push(`Website: ${business.website}`);
  if (business.phone) profileLines.push(`Phone: ${business.phone}`);
  if (business.contactEmail) profileLines.push(`Email: ${business.contactEmail}`);
  profileLines.push("");
  if (business.description) {
    profileLines.push(`## About`);
    profileLines.push(business.description);
    profileLines.push("");
  }

  // Add credibility facts
  const facts: string[] = [];
  if (cred?.verifiedFacts) {
    const verifiedFacts = (cred.verifiedFacts as any[]).slice(0, 15);
    for (const fact of verifiedFacts) {
      if (fact.fact) {
        facts.push(fact.fact + (fact.sourceUrl ? ` (Source: ${fact.sourceUrl})` : ""));
      }
    }
  }

  if (facts.length > 0) {
    profileLines.push(`## Verified Credentials`);
    facts.forEach((f) => profileLines.push(`- ${f}`));
    profileLines.push("");
  }

  // Add published pages
  if (publishedPages.length > 0) {
    profileLines.push(`## Published Pages`);
    publishedPages.forEach((p) => profileLines.push(`- ${p.title}: ${p.url}`));
    profileLines.push("");
  }

  const fullText = profileLines.join("\n");

  return {
    businessProfile: profileLines.slice(0, 10).join("\n"),
    credibilityFacts: facts,
    publishedPages,
    fullText,
  };
}

// ============= Robots.txt Correction =============

const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "Claude-Web",
  "anthropic-ai",
  "Google-Extended",
  "GoogleOther",
  "PerplexityBot",
  "CCBot",
  "Omgilibot",
  "Bytespider",
  "cohere-ai",
  "Diffbot",
  "ImagesiftBot",
  "Applebot-Extended",
];

/**
 * Check if a robots.txt file blocks AI crawlers.
 * Returns the original content and a corrected version if needed.
 */
export function checkAndCorrectRobotsTxt(robotsTxtContent: string): RobotsTxtCheckResult {
  const lines = robotsTxtContent.split("\n");
  const blockedCrawlers: string[] = [];
  const correctedLines: string[] = [];

  let currentUserAgent: string | null = null;
  let skipBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect User-agent lines
    if (trimmed.toLowerCase().startsWith("user-agent:")) {
      const agent = trimmed.split(":")[1]?.trim() || "";
      currentUserAgent = agent;

      // Check if this is an AI crawler we want to unblock
      if (AI_CRAWLER_USER_AGENTS.some((crawler) => agent.toLowerCase().includes(crawler.toLowerCase()))) {
        blockedCrawlers.push(agent);
        skipBlock = true; // Skip this entire block
      } else {
        skipBlock = false;
        correctedLines.push(line);
      }
    } else if (trimmed.toLowerCase().startsWith("disallow:") || trimmed.toLowerCase().startsWith("allow:")) {
      if (!skipBlock) {
        correctedLines.push(line);
      }
    } else {
      // Blank lines, comments, etc.
      if (!skipBlock || trimmed === "" || trimmed.startsWith("#")) {
        correctedLines.push(line);
      }
    }
  }

  return {
    hasBlockedCrawlers: blockedCrawlers.length > 0,
    blockedCrawlers,
    originalContent: robotsTxtContent,
    correctedContent: correctedLines.join("\n"),
  };
}

/**
 * Fetch the current robots.txt from a site using Playwright.
 */
export async function fetchRobotsTxt(page: Page, siteUrl: string): Promise<string | null> {
  try {
    const robotsUrl = `${siteUrl.replace(/\/$/, "")}/robots.txt`;
    const response = await page.goto(robotsUrl, { waitUntil: "networkidle", timeout: 10000 });
    if (!response || response.status() === 404) {
      console.log(`[SiteEnhancer] No robots.txt found at ${robotsUrl}`);
      return null;
    }
    const content = await page.textContent("body");
    return content || null;
  } catch (err: any) {
    console.warn(`[SiteEnhancer] Failed to fetch robots.txt: ${err.message}`);
    return null;
  }
}

/**
 * Update robots.txt on a WordPress site using Playwright.
 * Navigates to the file manager or uses a plugin interface to update the file.
 */
export async function updateRobotsTxtViaWordPress(
  page: Page,
  adminUrl: string,
  correctedContent: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Try Yoast SEO's robots.txt editor first (most common)
    await page.goto(`${adminUrl}/admin.php?page=wpseo_tools`, { waitUntil: "networkidle", timeout: 10000 });

    const fileEditorTab = await page.$('a:has-text("File editor")');
    if (fileEditorTab) {
      await fileEditorTab.click();
      await page.waitForSelector("textarea", { timeout: 5000 });
      const textarea = await page.$("textarea");
      if (textarea) {
        await textarea.fill(correctedContent);
        const saveButton = await page.$('button:has-text("Save"), input[type="submit"]');
        if (saveButton) {
          await saveButton.click();
          await page.waitForSelector('.notice-success, .updated', { timeout: 5000 }).catch(() => {});
          console.log(`[SiteEnhancer] robots.txt updated via Yoast`);
          return { success: true };
        }
      }
    }

    // Fallback: try Rank Math
    await page.goto(`${adminUrl}/admin.php?page=rank-math-options-general`, { waitUntil: "networkidle", timeout: 10000 });
    const robotsTextarea = await page.$('textarea[name*="robots"]');
    if (robotsTextarea) {
      await robotsTextarea.fill(correctedContent);
      const saveButton = await page.$('button:has-text("Save"), input[type="submit"]');
      if (saveButton) {
        await saveButton.click();
        await page.waitForSelector('.notice-success', { timeout: 5000 }).catch(() => {});
        console.log(`[SiteEnhancer] robots.txt updated via Rank Math`);
        return { success: true };
      }
    }

    // If no plugin found, log a warning
    console.warn(`[SiteEnhancer] Could not find robots.txt editor in WordPress admin. Manual update required.`);
    return { success: false, error: "No robots.txt editor plugin found (Yoast or Rank Math required)" };
  } catch (err: any) {
    return { success: false, error: `Failed to update robots.txt: ${err.message}` };
  }
}
