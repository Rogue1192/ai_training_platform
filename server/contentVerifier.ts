/**
 * contentVerifier.ts
 *
 * Verifies that a client's website has the required AI-optimisation assets
 * in place before the campaign is allowed to advance to indexing / training.
 *
 * Checks performed:
 *  1. llm.txt   — fetches {website}/llm.txt and confirms HTTP 200 + non-empty body
 *  2. Schema    — fetches the homepage and looks for JSON-LD <script type="application/ld+json">
 *                 containing an @type field (any structured-data block counts)
 *  3. Content pages — all non-schema / non-llm_txt pages must have a publishedUrl recorded
 */

// Uses Node 18+ global fetch (no import needed)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContentVerificationResult {
  llmTxt: {
    detected: boolean;
    url: string;
    error?: string;
  };
  schema: {
    detected: boolean;
    url: string;
    error?: string;
  };
  contentPages: {
    total: number;
    withUrl: number;
    missing: Array<{ id: number; pageTitle: string; pageType: string }>;
    allComplete: boolean;
  };
  /** True only when ALL three checks pass */
  allClear: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normaliseUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return s.startsWith("http") ? s : `https://${s}`;
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Node 18+ global fetch
    const res = await (globalThis.fetch as typeof fetch)(url, {
      signal: controller.signal,
      headers: { "User-Agent": "RogueAI-ContentVerifier/1.0" },
      redirect: "follow",
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err: any) {
    return { ok: false, status: 0, text: err?.message ?? "fetch error" };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Main verifier ────────────────────────────────────────────────────────────

export async function verifyCampaignContent(params: {
  campaignId: number;
  websiteUrl: string;
}): Promise<ContentVerificationResult> {
  const { campaignId, websiteUrl } = params;
  const base = normaliseUrl(websiteUrl).replace(/\/$/, "");

  // ── 1. llm.txt ───────────────────────────────────────────────────────────
  const llmUrl = `${base}/llm.txt`;
  let llmDetected = false;
  let llmError: string | undefined;
  if (base) {
    const r = await fetchWithTimeout(llmUrl);
    if (r.ok && r.text.trim().length > 50) {
      llmDetected = true;
    } else if (!r.ok) {
      llmError = r.status === 0 ? r.text : `HTTP ${r.status}`;
    } else {
      llmError = "File found but appears empty";
    }
  } else {
    llmError = "No website URL on file";
  }

  // ── 2. Schema ────────────────────────────────────────────────────────────
  const homeUrl = base || "";
  let schemaDetected = false;
  let schemaError: string | undefined;
  if (base) {
    const r = await fetchWithTimeout(homeUrl);
    if (r.ok) {
      // Look for any JSON-LD block with @type
      const hasJsonLd = /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"[\s\S]*?<\/script>/i.test(r.text);
      if (hasJsonLd) {
        schemaDetected = true;
      } else {
        schemaError = "No JSON-LD schema found in page <head>";
      }
    } else {
      schemaError = r.status === 0 ? r.text : `HTTP ${r.status}`;
    }
  } else {
    schemaError = "No website URL on file";
  }

  // ── 3. Content pages ─────────────────────────────────────────────────────
  const { getDb } = await import("./db");
  const { contentPages } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const db = await getDb();

  // Types that don't need a URL (they are injected into the site, not separate pages)
  const NO_URL_REQUIRED = new Set(["llm_txt", "schema_package", "schema_audit", "schema_delivery"]);

  let total = 0;
  let withUrl = 0;
  const missing: Array<{ id: number; pageTitle: string; pageType: string }> = [];

  if (db) {
    const pages = await db
      .select({
        id: contentPages.id,
        pageTitle: contentPages.pageTitle,
        pageType: contentPages.pageType,
        publishedUrl: contentPages.publishedUrl,
      })
      .from(contentPages)
      .where(eq(contentPages.campaignId, campaignId));

    for (const p of pages) {
      if (NO_URL_REQUIRED.has(p.pageType)) continue; // skip — verified via scan instead
      total++;
      if (p.publishedUrl) {
        withUrl++;
      } else {
        missing.push({ id: p.id, pageTitle: p.pageTitle, pageType: p.pageType });
      }
    }
  }

  const allComplete = missing.length === 0 && total > 0;

  return {
    llmTxt: { detected: llmDetected, url: llmUrl, error: llmError },
    schema: { detected: schemaDetected, url: homeUrl, error: schemaError },
    contentPages: { total, withUrl, missing, allComplete },
    allClear: llmDetected && schemaDetected && allComplete,
  };
}

/**
 * Hard gate: throws an error if the campaign has unpublished content pages
 * or missing llm.txt / schema. Called by the pipeline before indexing and training.
 */
export async function enforcePublishingGate(params: {
  campaignId: number;
  websiteUrl: string;
}): Promise<void> {
  const result = await verifyCampaignContent(params);

  const issues: string[] = [];

  if (!result.contentPages.allComplete) {
    const names = result.contentPages.missing.map((p) => p.pageTitle).join(", ");
    issues.push(`${result.contentPages.missing.length} content page(s) missing live URL: ${names}`);
  }
  if (!result.llmTxt.detected) {
    issues.push(`llm.txt not detected at ${result.llmTxt.url}${result.llmTxt.error ? ` (${result.llmTxt.error})` : ""}`);
  }
  if (!result.schema.detected) {
    issues.push(`JSON-LD schema not detected on homepage${result.schema.error ? ` (${result.schema.error})` : ""}`);
  }

  if (issues.length > 0) {
    throw new Error(
      `Publishing gate blocked — campaign cannot advance until all content is live on the client site:\n` +
        issues.map((i) => `  • ${i}`).join("\n")
    );
  }
}
