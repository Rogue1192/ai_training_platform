/**
 * License Verification Service
 *
 * After credibility research returns facts with verificationUrl values,
 * this service attempts to resolve each license/certification URL from
 * a generic search-form page to a direct result page for the specific business.
 *
 * Strategy per URL:
 *  1. Fetch the URL and inspect the HTML.
 *  2. If the page already contains the business name → it's a direct result; keep as-is.
 *  3. If the page is a search form, try common query-string patterns to build a
 *     pre-filled search URL (e.g. ?name=Eagle+Air+Co) and fetch that.
 *  4. If the pre-filled URL returns a page containing the business name → use it.
 *  5. Otherwise → clear verificationUrl and set lookupFlag with the original URL
 *     so the agency knows exactly where to look.
 *
 * This service is intentionally conservative: it only uses HTTP GET requests
 * (no browser automation, no form POSTs) to stay fast and avoid CAPTCHA walls.
 * If a site requires POST or JavaScript rendering, it will gracefully fall back
 * to the manual-review flag.
 */

import https from "https";
import http from "http";
import { URL } from "url";
import type { CredibilityFact } from "./credibilityResearchEngine";

// ── Categories that warrant a license/certification lookup attempt ──────────
const LOOKUP_CATEGORIES = new Set(["certification", "insurance", "bbb"]);

// ── How long to wait for each HTTP request (ms) ────────────────────────────
const REQUEST_TIMEOUT_MS = 8000;

// ── Common query-string parameter names used by state licensing boards ──────
// We'll try each one when building a pre-filled search URL.
const SEARCH_PARAM_CANDIDATES = [
  "name",
  "businessName",
  "business_name",
  "company",
  "companyName",
  "company_name",
  "licensee",
  "licenseeName",
  "q",
  "search",
  "keyword",
  "keywords",
  "firm",
  "firmName",
];

// ── Minimum character overlap to consider a name "found" on a page ──────────
// We normalise both strings to lower-case and check for substring inclusion.
const MIN_NAME_TOKENS_REQUIRED = 2; // at least 2 words from the business name must appear

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalise a string for loose comparison */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Return true if the page body contains enough tokens from the business name */
function pageContainsBusinessName(html: string, businessName: string): boolean {
  const normPage = normalise(html);
  const tokens = normalise(businessName)
    .split(" ")
    .filter(t => t.length > 2); // skip short words like "co", "inc", "the"
  if (tokens.length === 0) return false;
  const matchCount = tokens.filter(t => normPage.includes(t)).length;
  return matchCount >= Math.min(MIN_NAME_TOKENS_REQUIRED, tokens.length);
}

/** Fetch a URL with a timeout, following up to 3 redirects. Returns HTML or null. */
async function fetchHtml(rawUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    let redirectsLeft = 3;

    function doFetch(targetUrl: string) {
      let parsed: URL;
      try {
        parsed = new URL(targetUrl);
      } catch {
        resolve(null);
        return;
      }

      const lib = parsed.protocol === "https:" ? https : http;
      const options = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AIAnswerForge/1.0; +https://aianswerforge.com)",
          Accept: "text/html,application/xhtml+xml",
        },
        timeout: REQUEST_TIMEOUT_MS,
      };

      const req = lib.request(options, (res) => {
        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft-- > 0
        ) {
          const nextUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : `${parsed.protocol}//${parsed.hostname}${res.headers.location}`;
          doFetch(nextUrl);
          return;
        }

        if (!res.statusCode || res.statusCode >= 400) {
          resolve(null);
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          // Cap at 500 KB to avoid huge pages
          if (chunks.reduce((s, c) => s + c.length, 0) > 512_000) {
            req.destroy();
          }
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", () => resolve(null));
      });

      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.on("error", () => resolve(null));
      req.end();
    }

    doFetch(rawUrl);
  });
}

/** Build candidate pre-filled search URLs by appending common query params */
function buildSearchCandidates(baseUrl: string, businessName: string): string[] {
  const candidates: string[] = [];
  const encoded = encodeURIComponent(businessName);

  for (const param of SEARCH_PARAM_CANDIDATES) {
    try {
      const u = new URL(baseUrl);
      // Only add if the param isn't already set
      if (!u.searchParams.has(param)) {
        u.searchParams.set(param, businessName);
        candidates.push(u.toString());
      }
    } catch {
      // malformed URL — skip
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Core lookup function
// ---------------------------------------------------------------------------

export interface LookupOutcome {
  /** The resolved direct-result URL, or null if lookup failed */
  resolvedUrl: string | null;
  /** Human-readable flag for the agency if lookup failed */
  lookupFlag: string | null;
  /** How the lookup resolved */
  method: "already_direct" | "query_param" | "failed" | "skipped";
}

/**
 * Attempt to resolve a verificationUrl to a direct result page for the given business.
 *
 * @param verificationUrl  The URL returned by the credibility research AI
 * @param businessName     The business name to search for
 * @param factDescription  Short description of the fact (used in flag message)
 */
export async function resolveLicenseUrl(
  verificationUrl: string,
  businessName: string,
  factDescription: string
): Promise<LookupOutcome> {
  // ── Step 1: Fetch the original URL ────────────────────────────────────────
  let html = await fetchHtml(verificationUrl);
  if (!html) {
    return {
      resolvedUrl: null,
      lookupFlag: buildFlag(factDescription, verificationUrl),
      method: "failed",
    };
  }

  // ── Step 2: Does the page already show the business? ─────────────────────
  if (pageContainsBusinessName(html, businessName)) {
    return {
      resolvedUrl: verificationUrl,
      lookupFlag: null,
      method: "already_direct",
    };
  }

  // ── Step 3: Try pre-filled search URLs ───────────────────────────────────
  const candidates = buildSearchCandidates(verificationUrl, businessName);
  for (const candidate of candidates) {
    const candidateHtml = await fetchHtml(candidate);
    if (candidateHtml && pageContainsBusinessName(candidateHtml, businessName)) {
      return {
        resolvedUrl: candidate,
        lookupFlag: null,
        method: "query_param",
      };
    }
  }

  // ── Step 4: Lookup failed — flag for manual review ───────────────────────
  return {
    resolvedUrl: null,
    lookupFlag: buildFlag(factDescription, verificationUrl),
    method: "failed",
  };
}

function buildFlag(factDescription: string, originalUrl: string): string {
  return (
    `⚠️ Unable to perform license/certification lookup automatically for "${factDescription}". ` +
    `Please verify manually at: ${originalUrl} and update this link.`
  );
}

// ---------------------------------------------------------------------------
// Batch processor — called from pipelineOrchestrator after credibility research
// ---------------------------------------------------------------------------

/**
 * For every fact in the credibility result that has a verificationUrl and
 * falls into a lookup category, attempt to resolve it to a direct result URL.
 *
 * Mutates the facts array in-place (updates verificationUrl and lookupFlag).
 * Returns the number of facts that were successfully resolved.
 */
export async function resolveAllLicenseUrls(
  facts: CredibilityFact[],
  businessName: string
): Promise<{ resolved: number; flagged: number; skipped: number }> {
  let resolved = 0;
  let flagged = 0;
  let skipped = 0;

  for (const fact of facts) {
    if (!LOOKUP_CATEGORIES.has(fact.category)) {
      skipped++;
      continue;
    }
    if (!fact.verificationUrl) {
      skipped++;
      continue;
    }

    console.log(
      `[LicenseVerification] Attempting lookup for "${fact.fact}" at ${fact.verificationUrl}`
    );

    try {
      const outcome = await resolveLicenseUrl(
        fact.verificationUrl,
        businessName,
        fact.fact
      );

      if (outcome.resolvedUrl) {
        fact.verificationUrl = outcome.resolvedUrl;
        console.log(
          `[LicenseVerification] ✓ Resolved (${outcome.method}): ${outcome.resolvedUrl}`
        );
        resolved++;
      } else {
        // Clear the URL so the content engine doesn't generate a broken link
        fact.verificationUrl = undefined;
        (fact as any).lookupFlag = outcome.lookupFlag;
        console.log(
          `[LicenseVerification] ✗ Could not resolve — flagged for manual review`
        );
        flagged++;
      }
    } catch (err: any) {
      // Non-fatal: if the lookup itself throws, just flag it
      fact.verificationUrl = undefined;
      (fact as any).lookupFlag = buildFlag(fact.fact, fact.verificationUrl ?? "");
      console.warn(
        `[LicenseVerification] Error during lookup for "${fact.fact}":`,
        err.message
      );
      flagged++;
    }
  }

  console.log(
    `[LicenseVerification] Complete — resolved: ${resolved}, flagged: ${flagged}, skipped: ${skipped}`
  );
  return { resolved, flagged, skipped };
}
