/**
 * costLogger.ts
 * Central service for logging all API costs (LLM + DataForSEO) per campaign.
 * Used by the super-admin Cost Tracking page to compute per-client P&L.
 *
 * Pricing reference (as of July 2026):
 *   OpenAI GPT-4.1:        $2.00 / $8.00 per 1M tokens (in/out)
 *   OpenAI GPT-4.1-mini:   $0.40 / $1.60 per 1M tokens
 *   OpenAI GPT-4o:         $2.50 / $10.00 per 1M tokens
 *   OpenAI GPT-4o-mini:    $0.15 / $0.60 per 1M tokens
 *   OpenAI o3:             $10.00 / $40.00 per 1M tokens
 *   OpenAI o3-mini:        $1.10 / $4.40 per 1M tokens
 *   Anthropic Claude Sonnet 4.5: $3.00 / $15.00 per 1M tokens
 *   Anthropic Claude Haiku 4.5:  $0.80 / $4.00 per 1M tokens
 *   Anthropic Claude Opus 4.5:   $15.00 / $75.00 per 1M tokens
 *   Google Gemini 2.5 Flash:     $0.15 / $0.60 per 1M tokens
 *   Google Gemini 2.0 Flash:     $0.10 / $0.40 per 1M tokens
 *   Google Gemini 1.5 Pro:       $1.25 / $5.00 per 1M tokens
 *   Google Gemini 1.5 Flash:     $0.075 / $0.30 per 1M tokens
 *   MiniMax M2.7:                $0.80 / $3.20 per 1M tokens (estimated)
 *   MiniMax M2.7-highspeed:      $0.40 / $1.60 per 1M tokens (estimated)
 *   DataForSEO LLM mentions search/live: $0.0020 per request
 *   DataForSEO AI keyword volume:        $0.0005 per keyword
 *   DataForSEO keywords_for_site:        $0.0020 per request
 */

import { getDb } from "./db";
import { costLogs } from "../drizzle/schema";

// ─── Token pricing table (USD per 1M tokens) ─────────────────────────────────

interface TokenPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const TOKEN_PRICING: Record<string, TokenPricing> = {
  // OpenAI
  "gpt-4.1":            { inputPer1M: 2.00,  outputPer1M: 8.00  },
  "gpt-4.1-mini":       { inputPer1M: 0.40,  outputPer1M: 1.60  },
  "gpt-4o":             { inputPer1M: 2.50,  outputPer1M: 10.00 },
  "gpt-4o-mini":        { inputPer1M: 0.15,  outputPer1M: 0.60  },
  "o3":                 { inputPer1M: 10.00, outputPer1M: 40.00 },
  "o3-mini":            { inputPer1M: 1.10,  outputPer1M: 4.40  },
  "gpt-3.5-turbo":      { inputPer1M: 0.50,  outputPer1M: 1.50  },
  // Anthropic
  "claude-opus-4-5-20251101":    { inputPer1M: 15.00, outputPer1M: 75.00 },
  "claude-sonnet-4-5-20250929":  { inputPer1M: 3.00,  outputPer1M: 15.00 },
  "claude-haiku-4-5-20251001":   { inputPer1M: 0.80,  outputPer1M: 4.00  },
  // Google
  "gemini-2.5-flash":   { inputPer1M: 0.15,  outputPer1M: 0.60  },
  "gemini-2.0-flash":   { inputPer1M: 0.10,  outputPer1M: 0.40  },
  "gemini-1.5-pro":     { inputPer1M: 1.25,  outputPer1M: 5.00  },
  "gemini-1.5-flash":   { inputPer1M: 0.075, outputPer1M: 0.30  },
  // MiniMax (estimated)
  "MiniMax-M2.7":            { inputPer1M: 0.80, outputPer1M: 3.20 },
  "MiniMax-M2.7-highspeed":  { inputPer1M: 0.40, outputPer1M: 1.60 },
  "MiniMax-M2.5":            { inputPer1M: 0.40, outputPer1M: 1.60 },
};

// DataForSEO per-call costs (USD)
export const DFS_COSTS = {
  llmMentionsSearch:  0.0020,  // /ai_optimization/llm_mentions/search/live per request
  aiKeywordVolume:    0.0005,  // per keyword in /ai_keyword_data/keywords_search_volume/live
  keywordsForSite:    0.0020,  // /dataforseo_labs/google/keywords_for_site/live per request
  llmResponse:        0.0050,  // /ai_optimization/*/llm_responses/live per request
};

// ─── Revenue rates per billing type and package tier ─────────────────────────

type BillingType = "white_label" | "direct" | "legacy" | "external";
type PackageTier = "starter" | "growth" | "pro";

const REVENUE_RATES: Record<BillingType, Record<PackageTier, number>> = {
  white_label: { starter: 99,  growth: 149, pro: 179 },
  direct:      { starter: 199, growth: 299, pro: 349 },
  legacy:      { starter: 0,   growth: 0,   pro: 0   },
  external:    { starter: 0,   growth: 0,   pro: 0   }, // billed outside platform — revenue not tracked here
};

export function getMonthlyRevenue(billingType: string, packageTier: string): number {
  const bt = (billingType || "white_label") as BillingType;
  const pt = (packageTier || "starter") as PackageTier;
  return REVENUE_RATES[bt]?.[pt] ?? 0;
}

// ─── Billing cycle helpers ────────────────────────────────────────────────────

/**
 * Given a campaign's createdAt date, compute the billing cycle start date
 * for the current month (same day-of-month, current month).
 * If the day hasn't occurred yet this month, uses last month's date.
 */
export function getCurrentBillingCycleStart(campaignCreatedAt: Date): Date {
  const now = new Date();
  const anchorDay = campaignCreatedAt.getDate();
  const cycleStart = new Date(now.getFullYear(), now.getMonth(), anchorDay);
  if (cycleStart > now) {
    // Anchor day hasn't happened yet this month — use last month
    cycleStart.setMonth(cycleStart.getMonth() - 1);
  }
  return cycleStart;
}

// ─── Cost calculation ─────────────────────────────────────────────────────────

export function calculateLLMCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = TOKEN_PRICING[model];
  if (!pricing) {
    // Unknown model — use a conservative estimate ($2/$8 per 1M)
    return (inputTokens * 2.00 + outputTokens * 8.00) / 1_000_000;
  }
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

// ─── Main log functions ───────────────────────────────────────────────────────

export interface LLMCostLogParams {
  campaignId: number;
  businessId?: number | null;
  operationType: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  campaignCreatedAt: Date;
  metadata?: Record<string, unknown>;
}

export async function logLLMCost(params: LLMCostLogParams): Promise<void> {
  try {
    const costUsd = calculateLLMCost(params.model, params.inputTokens, params.outputTokens);
    const billingCycleStart = getCurrentBillingCycleStart(params.campaignCreatedAt);

    const db = await getDb();
    if (!db) return;
    await db.insert(costLogs).values({
      campaignId: params.campaignId,
      businessId: params.businessId ?? null,
      operationType: params.operationType,
      provider: params.provider,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd: costUsd.toFixed(6),
      billingCycleStart,
      metadata: params.metadata ?? null,
    });
  } catch (err) {
    // Cost logging is non-critical — never let it break the main operation
    console.error("[CostLogger] Failed to log LLM cost:", err);
  }
}

export interface DFSCostLogParams {
  campaignId: number;
  businessId?: number | null;
  operationType: string;
  endpoint: string;
  costUsd: number;
  campaignCreatedAt: Date;
  metadata?: Record<string, unknown>;
}

export async function logDFSCost(params: DFSCostLogParams): Promise<void> {
  try {
    const billingCycleStart = getCurrentBillingCycleStart(params.campaignCreatedAt);

    const db = await getDb();
    if (!db) return;
    await db.insert(costLogs).values({
      campaignId: params.campaignId,
      businessId: params.businessId ?? null,
      operationType: params.operationType,
      provider: "dataforseo",
      model: null,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: params.costUsd.toFixed(6),
      billingCycleStart,
      metadata: { endpoint: params.endpoint, ...(params.metadata ?? {}) },
    });
  } catch (err) {
    console.error("[CostLogger] Failed to log DataForSEO cost:", err);
  }
}
