/**
 * contentVerifier.ts
 *
 * Verifies that a client's website has the required AI-optimisation assets
 * in place before the campaign is allowed to advance through the pipeline.
 *
 * Two gates are enforced:
 *
 *  INDEXING GATE (enforceIndexingGate)
 *    — Only checks that all content pages have a publishedUrl.
 *    — llm.txt and schema are NOT required here; they can arrive before or
 *      after the URLs. The Indexing pipeline stage is considered "complete"
 *      only once indexing is done AND llm.txt + schema are verified, but the
 *      actual URL submission to Monkey Indexer fires as soon as all URLs are in.
 *
 *  TRAINING GATE (enforceTrainingGate)
 *    — Hard gate before training starts. Requires ALL THREE:
 *        1. All content pages have a publishedUrl
 *        2. llm.txt verified
 *        3. JSON-LD schema verified
 *    — This ensures the AI training environment is fully prepared.
 *
 * The old enforcePublishingGate is kept as an alias for enforceTrainingGate
 * so existing call-sites don't break.
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
  /** Which checks to run. Defaults to 'both'. */
  scanType?: 'llm' | 'schema' | 'both';
}): Promise<ContentVerificationResult> {
  const { campaignId, websiteUrl, scanType = 'both' } = params;
  const base = normaliseUrl(websiteUrl).replace(/\/$/, "");

  const runLlm = scanType === 'llm' || scanType === 'both';
  const runSchema = scanType === 'schema' || scanType === 'both';

  // ── 1. llm.txt ───────────────────────────────────────────────────────────
  const llmUrl = `${base}/llm.txt`;
  let llmDetected = false;
  let llmError: string | undefined;

  if (runLlm) {
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
  }

  // ── 2. Schema ────────────────────────────────────────────────────────────
  const homeUrl = base || "";
  let schemaDetected = false;
  let schemaError: string | undefined;

  if (runSchema) {
    if (base) {
      const r = await fetchWithTimeout(homeUrl);
      if (r.ok) {
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
      if (NO_URL_REQUIRED.has(p.pageType)) continue;
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

// ─── Gate: URL-only (indexing submission) ────────────────────────────────────

/**
 * Indexing gate — only requires that all content pages have a publishedUrl.
 * llm.txt and schema are NOT checked here; they can be added before or after
 * URL submission. The Indexing pipeline stage won't show "complete" until
 * llm.txt + schema are also verified, but the Monkey Indexer submission fires
 * as soon as all URLs are in so we maximise indexing lead time.
 */
export async function enforceIndexingGate(params: {
  campaignId: number;
  websiteUrl: string;
}): Promise<void> {
  const result = await verifyCampaignContent({
    campaignId: params.campaignId,
    websiteUrl: params.websiteUrl,
    scanType: 'both', // still run the scan so llmTxtVerified/schemaVerified get updated
  });

  if (!result.contentPages.allComplete) {
    const names = result.contentPages.missing.map((p) => p.pageTitle).join(", ");
    throw new Error(
      `Indexing gate blocked — ${result.contentPages.missing.length} content page(s) missing live URL: ${names}`
    );
  }
  // llm.txt / schema failures are NOT blocking here — they are noted but don't throw
}

// ─── Gate: Full (training) ───────────────────────────────────────────────────

/**
 * Training gate — requires ALL THREE checks to pass before training can start:
 *   1. All content pages have a publishedUrl
 *   2. llm.txt detected at {website}/llm.txt
 *   3. JSON-LD schema detected on homepage
 */
export async function enforceTrainingGate(params: {
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
      `Training gate blocked — campaign cannot start training until all content is live:\n` +
        issues.map((i) => `  • ${i}`).join("\n")
    );
  }
}

/**
 * @deprecated Use enforceIndexingGate (for URL submission) or enforceTrainingGate
 * (for training start). This alias calls enforceTrainingGate for backwards compatibility.
 */
export async function enforcePublishingGate(params: {
  campaignId: number;
  websiteUrl: string;
}): Promise<void> {
  return enforceTrainingGate(params);
}
