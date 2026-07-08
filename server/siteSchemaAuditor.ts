/**
 * Site Schema Auditor
 *
 * Crawls the client's website (homepage + key inner pages) to:
 * 1. Extract all existing <script type="application/ld+json"> blocks
 * 2. Classify each block by @type
 * 3. Identify what's present, what's missing, and what has gaps
 * 4. Return a structured audit result used by schemaDeliveryEngine.ts
 *    to decide whether to deliver a full schema package or additive-only.
 *
 * Uses only Node.js built-in fetch + cheerio (HTML parsing) — no browser automation.
 */

import * as cheerio from "cheerio";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExistingSchemaBlock {
  /** The @type value(s) found */
  type: string | string[];
  /** Raw parsed JSON object */
  raw: Record<string, any>;
  /** Which page URL this was found on */
  sourceUrl: string;
  /** Whether this block has critical missing fields */
  hasGaps: boolean;
  /** List of missing or empty fields that should be filled */
  missingFields: string[];
}

export interface PageCrawlResult {
  url: string;
  /** HTTP status code, 0 if fetch failed */
  status: number;
  /** Whether the page was reachable */
  reachable: boolean;
  /** Schema blocks found on this page */
  schemaBlocks: ExistingSchemaBlock[];
  /** Raw FAQ Q&A pairs scraped from the page (for FAQ schema enrichment) */
  faqPairs: Array<{ question: string; answer: string }>;
  /** Page title */
  pageTitle: string;
  /** Whether the page appears to be an FAQ page */
  isFaqPage: boolean;
}

export interface SiteSchemaAuditResult {
  /** The website URL that was audited */
  websiteUrl: string;
  /** All pages crawled */
  pages: PageCrawlResult[];
  /** All unique schema types found across all pages */
  foundTypes: string[];
  /** Whether a LocalBusiness or Organization schema was found */
  hasLocalBusinessSchema: boolean;
  /** Whether a FAQPage schema was found */
  hasFAQSchema: boolean;
  /** Whether an Article schema was found */
  hasArticleSchema: boolean;
  /** Whether any schema was found at all */
  hasAnySchema: boolean;
  /**
   * Delivery mode decision:
   * - "full"     → No existing schema found — deliver the complete package
   * - "additive" → Schema exists — deliver only FAQPage + Article blocks
   * - "replace"  → Schema exists but is severely incomplete — recommend replacing
   */
  deliveryMode: "full" | "additive" | "replace";
  /** All gap fields across all found schema blocks */
  globalMissingFields: string[];
  /** All FAQ Q&A pairs scraped from the site (for enriching FAQPage schema) */
  existingFaqPairs: Array<{ question: string; answer: string; sourceUrl: string }>;
  /** Timestamp of the audit */
  auditedAt: string;
  /** Error message if the audit failed entirely */
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Pages to crawl in addition to the homepage */
const INNER_PAGE_SLUGS = [
  "/about",
  "/about-us",
  "/services",
  "/faq",
  "/faqs",
  "/frequently-asked-questions",
  "/contact",
  "/contact-us",
];

/** LocalBusiness and its sub-types */
const LOCAL_BUSINESS_TYPES = new Set([
  "LocalBusiness",
  "ProfessionalService",
  "HomeAndConstructionBusiness",
  "CleaningService",
  "LandscapeService",
  "PlumbingService",
  "ElectricalContractor",
  "HVACBusiness",
  "RoofingContractor",
  "PestControlService",
  "MovingCompany",
  "StorageService",
  "AutoRepair",
  "Dentist",
  "Physician",
  "LegalService",
  "AccountingService",
  "FinancialService",
  "RealEstateAgent",
  "InsuranceAgency",
  "Organization",
  "Corporation",
]);

/** Critical fields that should be present in a LocalBusiness schema */
const CRITICAL_LOCAL_BUSINESS_FIELDS = [
  "name",
  "telephone",
  "address",
  "url",
  "description",
  "priceRange",
  "openingHours",
  "sameAs",
  "aggregateRating",
  "hasOfferCatalog",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeUrl(base: string, path: string): string {
  try {
    return new URL(path, base).href;
  } catch {
    return base;
  }
}

function getTypes(raw: Record<string, any>): string[] {
  const t = raw["@type"];
  if (!t) return [];
  return Array.isArray(t) ? t : [t];
}

function isLocalBusinessType(types: string[]): boolean {
  return types.some((t) => LOCAL_BUSINESS_TYPES.has(t));
}

function detectMissingFields(raw: Record<string, any>, types: string[]): string[] {
  const missing: string[] = [];
  if (isLocalBusinessType(types)) {
    for (const field of CRITICAL_LOCAL_BUSINESS_FIELDS) {
      const val = raw[field];
      if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) {
        missing.push(field);
      }
    }
  }
  if (types.includes("FAQPage")) {
    const items = raw.mainEntity;
    if (!items || (Array.isArray(items) && items.length === 0)) {
      missing.push("mainEntity (FAQ items)");
    }
  }
  return missing;
}

/**
 * Extract FAQ Q&A pairs from page HTML using multiple heuristics:
 * 1. Existing FAQPage JSON-LD
 * 2. Common FAQ HTML patterns (dt/dd, accordion, details/summary)
 */
function extractFaqPairs(
  $: cheerio.CheerioAPI,
  existingSchemaBlocks: ExistingSchemaBlock[]
): Array<{ question: string; answer: string }> {
  const pairs: Array<{ question: string; answer: string }> = [];

  // 1. From existing FAQPage JSON-LD
  for (const block of existingSchemaBlocks) {
    const types = Array.isArray(block.type) ? block.type : [block.type];
    if (types.includes("FAQPage")) {
      const items = block.raw.mainEntity;
      if (Array.isArray(items)) {
        for (const item of items) {
          const q = item.name || item.question;
          const a =
            item.acceptedAnswer?.text ||
            item.acceptedAnswer?.answer ||
            item.answer;
          if (q && a) {
            pairs.push({ question: String(q).trim(), answer: String(a).trim() });
          }
        }
      }
    }
  }

  // 2. From <details>/<summary> accordion pattern
  $("details").each((_, el) => {
    const q = $(el).find("summary").first().text().trim();
    const a = $(el)
      .clone()
      .find("summary")
      .remove()
      .end()
      .text()
      .trim();
    if (q && a && q.length > 5 && a.length > 10) {
      if (!pairs.some((p) => p.question === q)) {
        pairs.push({ question: q, answer: a });
      }
    }
  });

  // 3. From definition list pattern (dt = question, dd = answer)
  $("dl").each((_, dl) => {
    const dts = $(dl).find("dt");
    const dds = $(dl).find("dd");
    dts.each((i, dt) => {
      const q = $(dt).text().trim();
      const a = $(dds.get(i)).text().trim();
      if (q && a && q.length > 5 && a.length > 10) {
        if (!pairs.some((p) => p.question === q)) {
          pairs.push({ question: q, answer: a });
        }
      }
    });
  });

  // 4. From common FAQ class patterns
  const faqSelectors = [
    ".faq-item",
    ".faq_item",
    ".accordion-item",
    '[class*="faq"]',
    '[class*="accordion"]',
  ];
  for (const sel of faqSelectors) {
    $(sel).each((_, el) => {
      // Try to find a question heading and answer body
      const qEl = $(el).find("h2, h3, h4, .question, .faq-question, [class*='question'], [class*='title']").first();
      const aEl = $(el).find("p, .answer, .faq-answer, [class*='answer'], [class*='content'], [class*='body']").first();
      const q = qEl.text().trim();
      const a = aEl.text().trim();
      if (q && a && q.length > 5 && a.length > 10) {
        if (!pairs.some((p) => p.question === q)) {
          pairs.push({ question: q, answer: a });
        }
      }
    });
  }

  return pairs.slice(0, 30); // cap at 30 pairs
}

function detectIsFaqPage($: cheerio.CheerioAPI, url: string): boolean {
  const urlLower = url.toLowerCase();
  if (urlLower.includes("faq") || urlLower.includes("frequently-asked")) return true;
  const title = $("title").text().toLowerCase();
  if (title.includes("faq") || title.includes("frequently asked")) return true;
  const h1 = $("h1").first().text().toLowerCase();
  if (h1.includes("faq") || h1.includes("frequently asked") || h1.includes("questions")) return true;
  return false;
}

// ─── Core crawler ─────────────────────────────────────────────────────────────

async function crawlPage(url: string, timeoutMs = 10000): Promise<PageCrawlResult> {
  const result: PageCrawlResult = {
    url,
    status: 0,
    reachable: false,
    schemaBlocks: [],
    faqPairs: [],
    pageTitle: "",
    isFaqPage: false,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AIAnswerForge/1.0; +https://aianswerforge.com/bot)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);

    result.status = response.status;
    if (!response.ok) return result;

    result.reachable = true;
    const html = await response.text();
    const $ = cheerio.load(html);

    result.pageTitle = $("title").text().trim();
    result.isFaqPage = detectIsFaqPage($, url);

    // Extract all JSON-LD blocks
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const raw = JSON.parse($(el).html() || "{}");
        // Handle @graph arrays
        const blocks: Record<string, any>[] = raw["@graph"]
          ? raw["@graph"]
          : [raw];

        for (const block of blocks) {
          const types = getTypes(block);
          if (types.length === 0) continue;
          const missingFields = detectMissingFields(block, types);
          result.schemaBlocks.push({
            type: types.length === 1 ? types[0]! : types,
            raw: block,
            sourceUrl: url,
            hasGaps: missingFields.length > 0,
            missingFields,
          });
        }
      } catch {
        // Malformed JSON-LD — skip
      }
    });

    result.faqPairs = extractFaqPairs($, result.schemaBlocks);
  } catch (err: any) {
    result.status = 0;
    result.reachable = false;
  }

  return result;
}

// ─── Main audit function ──────────────────────────────────────────────────────

export async function auditSiteSchema(websiteUrl: string): Promise<SiteSchemaAuditResult> {
  // Normalize the base URL
  let base = websiteUrl.trim();
  if (!base.startsWith("http")) base = `https://${base}`;
  // Remove trailing slash
  base = base.replace(/\/$/, "");

  const result: SiteSchemaAuditResult = {
    websiteUrl: base,
    pages: [],
    foundTypes: [],
    hasLocalBusinessSchema: false,
    hasFAQSchema: false,
    hasArticleSchema: false,
    hasAnySchema: false,
    deliveryMode: "full",
    globalMissingFields: [],
    existingFaqPairs: [],
    auditedAt: new Date().toISOString(),
  };

  try {
    // Build list of URLs to crawl
    const urlsToCheck = [base];
    for (const slug of INNER_PAGE_SLUGS) {
      urlsToCheck.push(`${base}${slug}`);
    }

    // Crawl all pages concurrently (with a small concurrency cap)
    const CONCURRENCY = 4;
    const crawledPages: PageCrawlResult[] = [];
    for (let i = 0; i < urlsToCheck.length; i += CONCURRENCY) {
      const batch = urlsToCheck.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(batch.map((u) => crawlPage(u)));
      // Only keep pages that were reachable
      crawledPages.push(...batchResults.filter((p) => p.reachable));
    }

    result.pages = crawledPages;

    // Aggregate findings
    const allTypes = new Set<string>();
    const allMissingFields = new Set<string>();

    for (const page of crawledPages) {
      for (const block of page.schemaBlocks) {
        const types = Array.isArray(block.type) ? block.type : [block.type];
        types.forEach((t) => allTypes.add(t));
        block.missingFields.forEach((f) => allMissingFields.add(f));

        if (isLocalBusinessType(types)) result.hasLocalBusinessSchema = true;
        if (types.includes("FAQPage")) result.hasFAQSchema = true;
        if (types.includes("Article") || types.includes("BlogPosting")) result.hasArticleSchema = true;
      }

      // Collect FAQ pairs from all pages
      for (const pair of page.faqPairs) {
        result.existingFaqPairs.push({ ...pair, sourceUrl: page.url });
      }
    }

    result.foundTypes = Array.from(allTypes);
    result.hasAnySchema = allTypes.size > 0;
    result.globalMissingFields = Array.from(allMissingFields);

    // Decide delivery mode
    if (!result.hasAnySchema) {
      result.deliveryMode = "full";
    } else if (result.hasLocalBusinessSchema && result.globalMissingFields.length > 6) {
      // Schema exists but is very incomplete
      result.deliveryMode = "replace";
    } else {
      result.deliveryMode = "additive";
    }
  } catch (err: any) {
    result.error = err.message;
    result.deliveryMode = "full"; // Default to full if audit fails
  }

  return result;
}
