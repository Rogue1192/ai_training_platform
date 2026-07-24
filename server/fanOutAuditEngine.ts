/**
 * Fan-Out Audit Engine
 *
 * Runs a ChatGPT entity-verification audit for a campaign by calling the
 * OpenAI Responses API with web_search enabled. Captures every fan-out query
 * ChatGPT performs when trying to verify a local business entity, then
 * cross-references those queries against the business's claimed facts to
 * produce a gap list — facts that ChatGPT tried to independently verify
 * but couldn't find on a third-party URL.
 *
 * The gap list is saved to campaigns.fanOutGapList and surfaced in the
 * campaign admin UI so the ops team can fill in verified URLs per item.
 * Those URLs are later consumed by content generation (outbound links),
 * schema markup (credential URLs), and llm.txt (fact citations).
 *
 * Pipeline position: after baseline_check, before credibility_research.
 */

import axios from "axios";
import { getDb } from "./db";
import { campaigns } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getBusinessById } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FanOutGapItem {
  id: string;                        // Unique ID for this gap item (uuid-ish)
  query: string;                     // The fan-out query ChatGPT ran (e.g. "Cole HVAC BBB Nixa MO")
  category: FanOutCategory;          // Classified category of the verification attempt
  claim: string;                     // What the business claims that prompted this verification
  verificationUrl?: string;          // URL ops team fills in to resolve this gap
  status: "gap" | "resolved" | "not_applicable";
  notes?: string;                    // Optional ops notes
  citedUrl?: string;                 // URL ChatGPT actually found (if any — means it's already resolved)
}

export type FanOutCategory =
  | "bbb"
  | "license"
  | "certification"
  | "review_platform"
  | "longevity"
  | "insurance"
  | "award"
  | "registry"
  | "other";

export interface FanOutAuditResult {
  fanOutQueries: string[];           // All queries ChatGPT ran
  citedUrls: string[];               // All URLs ChatGPT cited in the final answer
  gapList: FanOutGapItem[];          // Gaps identified — facts not independently verifiable
  auditSummary: string;              // Plain-English summary for the ops team
  winnerEntity?: string;             // The business ChatGPT recommended (if not our client)
  clientMentioned: boolean;          // Whether our client appeared in ChatGPT's answer
  rawResponse?: string;              // Full ChatGPT answer text
}

// ─── Category classification keywords ────────────────────────────────────────

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: FanOutCategory }> = [
  { pattern: /\bbbb\b|better business bureau/i, category: "bbb" },
  { pattern: /\blicense[d]?\b|contractor license|state license|licensed/i, category: "license" },
  { pattern: /\bnate\b|epa 608|certif|credential|accredit/i, category: "certification" },
  { pattern: /\breviews?\b|yelp|google reviews|angi|homeadvisor|thumbtack/i, category: "review_platform" },
  { pattern: /\bestablished\b|since \d{4}|years? in business|founded/i, category: "longevity" },
  { pattern: /\binsur(ance|ed)\b|liability insurance|bonded/i, category: "insurance" },
  { pattern: /\baward|recognition|best of|top rated/i, category: "award" },
  { pattern: /\bregist(ry|ered)\b|lookup|verify|directory/i, category: "registry" },
];

function classifyQuery(query: string): FanOutCategory {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(query)) return category;
  }
  return "other";
}

// ─── Gap analysis ─────────────────────────────────────────────────────────────

/**
 * Converts raw fan-out queries + citations into a structured gap list.
 * A "gap" is a verification query that ChatGPT ran but where no citation
 * from an independent third-party registry/platform was returned.
 */
function buildGapList(
  fanOutQueries: string[],
  citedUrls: string[],
  businessName: string,
  businessType: string,
): FanOutGapItem[] {
  const gaps: FanOutGapItem[] = [];
  let idCounter = 1;

  // Filter to queries that look like entity-verification searches
  // (contain the business name or a known verification keyword)
  const verificationQueries = fanOutQueries.filter((q) => {
    const lowerQ = q.toLowerCase();
    const lowerName = businessName.toLowerCase();
    // Include if it mentions the business name OR contains a verification keyword
    return (
      lowerQ.includes(lowerName.split(" ")[0]) ||
      /\bbbb\b|license|certif|nate|epa|insur|registry|established|since \d{4}|reviews?/.test(lowerQ)
    );
  });

  for (const query of verificationQueries) {
    const category = classifyQuery(query);

    // Check if a citation was found that resolves this query
    // (a citation URL that matches the category's expected domain patterns)
    const resolvedByCitation = citedUrls.some((url) => {
      const lowerUrl = url.toLowerCase();
      switch (category) {
        case "bbb": return lowerUrl.includes("bbb.org");
        case "license": return /pr\.mo\.gov|lic\.ca\.gov|contractors\.state|license\.state|verify\.license/.test(lowerUrl);
        case "certification": return /natex\.org|epa\.gov|certif|credential/.test(lowerUrl);
        case "review_platform": return /yelp\.com|google\.com\/maps|angi\.com|homeadvisor|thumbtack/.test(lowerUrl);
        case "longevity": return /about|history|founded|since/.test(lowerUrl);
        case "insurance": return /insurance|bonded|verify/.test(lowerUrl);
        case "award": return /award|recognition|best/.test(lowerUrl);
        case "registry": return /registry|directory|lookup/.test(lowerUrl);
        default: return false;
      }
    });

    // Build a human-readable claim description from the query
    const claim = buildClaimFromQuery(query, businessName, businessType, category);

    gaps.push({
      id: `gap_${idCounter++}`,
      query,
      category,
      claim,
      status: resolvedByCitation ? "resolved" : "gap",
      citedUrl: resolvedByCitation
        ? citedUrls.find((url) => isRelevantCitation(url, category))
        : undefined,
    });
  }

  return gaps;
}

function buildClaimFromQuery(
  query: string,
  businessName: string,
  businessType: string,
  category: FanOutCategory,
): string {
  const claimMap: Record<FanOutCategory, string> = {
    bbb: `${businessName} is BBB-accredited`,
    license: `${businessName} holds a valid ${businessType} contractor license`,
    certification: `${businessName} holds industry certifications (e.g. NATE, EPA 608)`,
    review_platform: `${businessName} has verified reviews on third-party platforms`,
    longevity: `${businessName} has been in business for multiple years`,
    insurance: `${businessName} is licensed and insured`,
    award: `${businessName} has received industry awards or recognition`,
    registry: `${businessName} appears in official industry registries`,
    other: `${businessName} has verifiable credentials related to: "${query}"`,
  };
  return claimMap[category];
}

function isRelevantCitation(url: string, category: FanOutCategory): boolean {
  const lowerUrl = url.toLowerCase();
  switch (category) {
    case "bbb": return lowerUrl.includes("bbb.org");
    case "license": return /pr\.mo\.gov|lic\.ca\.gov|contractors\.state|license\.state/.test(lowerUrl);
    case "certification": return /natex\.org|epa\.gov|certif/.test(lowerUrl);
    case "review_platform": return /yelp\.com|google\.com\/maps|angi\.com/.test(lowerUrl);
    default: return false;
  }
}

// ─── Main audit runner ────────────────────────────────────────────────────────

export async function runFanOutAudit(campaignId: number): Promise<FanOutAuditResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Load campaign + business
  const campaignRows = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const campaign = campaignRows[0];

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const business = await getBusinessById(campaign.businessId);
  if (!business) throw new Error(`Business ${campaign.businessId} not found`);

  const businessName = business.name;
  const businessType = (business as any).businessType ?? "contractor";
  const location = (business as any).location ?? "";
  const scope = (campaign as any).campaignScope ?? "local";

  // Build the primary query — what a user would ask ChatGPT
  const primaryQuery = scope === "local"
    ? `What is the best ${businessType} in ${location} and why?`
    : `What is the best ${businessType} company and why?`;

  // Build entity-verification queries — what ChatGPT would run to verify our client
  const verificationQuery = scope === "local"
    ? `${businessName} ${location} reviews license BBB certification`
    : `${businessName} reviews license BBB certification`;

  console.log(`[FanOutAudit] Running audit for campaign ${campaignId} (${businessName})`);
  console.log(`[FanOutAudit] Primary query: "${primaryQuery}"`);

  // Fetch OpenAI API key from the encrypted apiKeys table (same pattern as other engines)
  const { getApiKeyByProvider } = await import("./db");
  const { decrypt } = await import("./encryption");
  const openaiKeyRecord = await getApiKeyByProvider("openai");
  if (!openaiKeyRecord) {
    throw new Error("OpenAI API key not configured — add it in Settings → API Keys to run fan-out audit");
  }
  const openaiApiKey = decrypt(openaiKeyRecord.encryptedKey);

  // Run the primary discovery query
  let allFanOutQueries: string[] = [];
  let allCitedUrls: string[] = [];
  let finalAnswerText = "";
  let clientMentioned = false;
  let winnerEntity: string | undefined;

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/responses",
      {
        model: "gpt-4o-search-preview",
        tools: [{ type: "web_search_preview" }],
        input: primaryQuery,
      },
      {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
        timeout: 60000,
      }
    );

    // Extract fan-out queries and citations from the response output
    const output: any[] = response.data?.output ?? [];

    for (const item of output) {
      // Fan-out queries
      if (item.type === "web_search_call" && item.action?.query) {
        allFanOutQueries.push(item.action.query);
      }
      // Final answer text + citations
      if (item.type === "message" && item.content) {
        for (const contentBlock of item.content) {
          if (contentBlock.type === "output_text") {
            finalAnswerText = contentBlock.text ?? "";
            // Extract URL citations
            for (const annotation of contentBlock.annotations ?? []) {
              if (annotation.type === "url_citation" && annotation.url) {
                allCitedUrls.push(annotation.url);
              }
            }
          }
        }
      }
    }

    // Check if client is mentioned in the answer
    clientMentioned = finalAnswerText.toLowerCase().includes(businessName.toLowerCase().split(" ")[0]);

    // Try to extract the winner entity (first proper noun mentioned as "best")
    const winnerMatch = finalAnswerText.match(/(?:best|recommend|top)[^.]*?(?:is|:)\s+([A-Z][a-zA-Z\s&]+?)(?:\.|,|\s+because|\s+for|\s+with)/);
    if (winnerMatch) {
      winnerEntity = winnerMatch[1].trim();
    }

  } catch (err: any) {
    console.error(`[FanOutAudit] Primary query failed: ${err.message}`);
    // Don't throw — we can still run entity verification queries
  }

  // Run entity-specific verification query to capture what ChatGPT searches when verifying our client
  try {
    const verifyResponse = await axios.post(
      "https://api.openai.com/v1/responses",
      {
        model: "gpt-4o-search-preview",
        tools: [{ type: "web_search_preview" }],
        input: `Tell me about ${businessName} in ${location}. Are they licensed, insured, and accredited? What certifications do they hold?`,
      },
      {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiApiKey}` },
        timeout: 60000,
      }
    );

    const verifyOutput: any[] = verifyResponse.data?.output ?? [];
    for (const item of verifyOutput) {
      if (item.type === "web_search_call" && item.action?.query) {
        // Add only if not already captured
        if (!allFanOutQueries.includes(item.action.query)) {
          allFanOutQueries.push(item.action.query);
        }
      }
      if (item.type === "message" && item.content) {
        for (const contentBlock of item.content) {
          if (contentBlock.type === "output_text") {
            for (const annotation of contentBlock.annotations ?? []) {
              if (annotation.type === "url_citation" && annotation.url) {
                if (!allCitedUrls.includes(annotation.url)) {
                  allCitedUrls.push(annotation.url);
                }
              }
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`[FanOutAudit] Entity verification query failed: ${err.message}`);
  }

  // Build the gap list
  const gapList = buildGapList(allFanOutQueries, allCitedUrls, businessName, businessType);

  // Build audit summary
  const unresolvedGaps = gapList.filter((g) => g.status === "gap");
  const resolvedGaps = gapList.filter((g) => g.status === "resolved");

  const auditSummary = [
    `ChatGPT ran ${allFanOutQueries.length} search queries when researching ${businessType}s in ${location}.`,
    clientMentioned
      ? `${businessName} was mentioned in the response.`
      : `${businessName} was NOT mentioned in the response.`,
    winnerEntity && winnerEntity !== businessName
      ? `The recommended business was "${winnerEntity}".`
      : "",
    `${unresolvedGaps.length} verification gap${unresolvedGaps.length !== 1 ? "s" : ""} found — claims ChatGPT tried to verify but couldn't find on independent URLs.`,
    resolvedGaps.length > 0
      ? `${resolvedGaps.length} claim${resolvedGaps.length !== 1 ? "s" : ""} already independently verifiable (no action needed).`
      : "",
    unresolvedGaps.length > 0
      ? `Action required: Find and add verification URLs for the ${unresolvedGaps.length} open gap${unresolvedGaps.length !== 1 ? "s" : ""} before running content generation.`
      : "All verified claims are covered. Ready to proceed to credibility research.",
  ]
    .filter(Boolean)
    .join(" ");

  const result: FanOutAuditResult = {
    fanOutQueries: allFanOutQueries,
    citedUrls: allCitedUrls,
    gapList,
    auditSummary,
    winnerEntity,
    clientMentioned,
    rawResponse: finalAnswerText,
  };

  // Save gap list to campaign
  await db
    .update(campaigns)
    .set({
      fanOutGapList: gapList as any,
      fanOutAuditCompletedAt: new Date(),
      status: "fan_out_audit" as any,
      updatedAt: new Date(),
    })
    .where(eq(campaigns.id, campaignId));

  console.log(`[FanOutAudit] Audit complete for campaign ${campaignId}. ${gapList.length} gap items, ${unresolvedGaps.length} unresolved.`);

  return result;
}

/**
 * Update a single gap item's verificationUrl and status.
 * Called when the ops team pastes in a verified URL for a gap item.
 */
export async function updateGapItem(
  campaignId: number,
  gapId: string,
  update: { verificationUrl?: string; status?: FanOutGapItem["status"]; notes?: string },
): Promise<FanOutGapItem[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select({ fanOutGapList: campaigns.fanOutGapList })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const campaign = rows[0];

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const gapList = ((campaign.fanOutGapList as FanOutGapItem[]) ?? []).map((item) => {
    if (item.id !== gapId) return item;
    return {
      ...item,
      ...update,
      // Auto-resolve when a URL is provided
      status: (update.verificationUrl ? "resolved" : (update.status ?? item.status)) as FanOutGapItem["status"],
    };
  });

  await db
    .update(campaigns)
    .set({ fanOutGapList: gapList as any, updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId));

  return gapList;
}

/**
 * Get the gap list for a campaign, with summary stats.
 */
export async function getFanOutAuditStatus(campaignId: number): Promise<{
  completed: boolean;
  completedAt?: Date;
  gapList: FanOutGapItem[];
  unresolvedCount: number;
  resolvedCount: number;
  totalCount: number;
  readyForContentGeneration: boolean;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select({
      fanOutAuditCompletedAt: campaigns.fanOutAuditCompletedAt,
      fanOutGapList: campaigns.fanOutGapList,
    })
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  const campaign = rows[0];

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const gapList = (campaign.fanOutGapList as FanOutGapItem[]) ?? [];
  const unresolvedCount = gapList.filter((g) => g.status === "gap").length;
  const resolvedCount = gapList.filter((g) => g.status !== "gap").length;

  return {
    completed: !!campaign.fanOutAuditCompletedAt,
    completedAt: campaign.fanOutAuditCompletedAt ?? undefined,
    gapList,
    unresolvedCount,
    resolvedCount,
    totalCount: gapList.length,
    // Ready when all gaps are either resolved or marked not_applicable
    readyForContentGeneration: gapList.every((g) => g.status !== "gap"),
  };
}
