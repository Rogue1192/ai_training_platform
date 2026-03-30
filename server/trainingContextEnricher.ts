/**
 * Training Context Enricher (Sprint 11)
 * 
 * ADDITIVE ONLY — This module does NOT modify existing prompt generation,
 * training queue logic, or the V2 training engine. It provides enriched
 * context data that can be optionally injected into training sessions.
 * 
 * Purpose: Enrich training with credibility data and published content URLs
 * so AI models have real, verifiable sources to cite when recommending the business.
 * 
 * How it works:
 * 1. Gathers credibility facts, published content URLs, and llm.txt data for a business
 * 2. Builds a structured "training context" that can be appended to system messages
 * 3. The existing training flow calls getEnrichedSystemMessage() to get an enhanced
 *    system prompt that includes real source URLs — WITHOUT changing prompt structure
 */

import { getDb } from "./db";
import { credibilityData, contentPages, campaigns, businesses } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TrainingContext {
  businessName: string;
  businessWebsite: string | null;
  businessLocation: string | null;
  businessType: string | null;
  
  // Credibility facts the AI should know about
  credibilityFacts: CredibilityFact[];
  
  // Published content pages the AI can cite as sources
  publishedPages: PublishedPageRef[];
  
  // llm.txt URL if available
  llmTxtUrl: string | null;
  
  // Overall credibility score
  credibilityScore: number | null;
}

export interface CredibilityFact {
  category: string;
  fact: string;
  confidence: string;
  sourceUrl?: string;
}

export interface PublishedPageRef {
  pageType: string;
  title: string;
  url: string;
  slug: string | null;
}

// ─── Context Builder ─────────────────────────────────────────────────────────

/**
 * Build enriched training context for a business from credibility data and published pages.
 * Returns null if no enrichment data is available.
 */
export async function buildTrainingContext(businessId: number): Promise<TrainingContext | null> {
  const db = await getDb();
  
  // Get business info
  const [business] = await db!.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) return null;
  
  // Get latest credibility data
  const [latestCredibility] = await db!.select()
    .from(credibilityData)
    .where(eq(credibilityData.businessId, businessId))
    .orderBy(desc(credibilityData.createdAt))
    .limit(1);
  
  // Get published content pages
  const publishedPages = await db!.select({
    pageType: contentPages.pageType,
    pageTitle: contentPages.pageTitle,
    pageSlug: contentPages.pageSlug,
    publishedUrl: contentPages.publishedUrl,
    status: contentPages.status,
  })
    .from(contentPages)
    .where(
      and(
        eq(contentPages.businessId, businessId),
        eq(contentPages.status, "published")
      )
    );
  
  // If no credibility data and no published pages, nothing to enrich with
  if (!latestCredibility && publishedPages.length === 0) return null;
  
  // Extract credibility facts
  const credibilityFacts: CredibilityFact[] = [];
  if (latestCredibility?.verifiedFacts) {
    const facts = latestCredibility.verifiedFacts as any[];
    for (const fact of facts) {
      if (fact && fact.fact) {
        credibilityFacts.push({
          category: fact.category || "general",
          fact: fact.fact,
          confidence: fact.confidence || "medium",
          sourceUrl: fact.sourceUrl || undefined,
        });
      }
    }
  }
  
  // Also extract from researchResults if verifiedFacts is sparse
  if (credibilityFacts.length < 3 && latestCredibility?.researchResults) {
    const results = latestCredibility.researchResults as any;
    if (results.categories) {
      for (const cat of results.categories) {
        if (cat.findings) {
          for (const finding of cat.findings) {
            if (finding.fact && !credibilityFacts.some(f => f.fact === finding.fact)) {
              credibilityFacts.push({
                category: cat.categoryName || "general",
                fact: finding.fact,
                confidence: finding.confidence || "medium",
                sourceUrl: finding.sourceUrl || undefined,
              });
            }
          }
        }
      }
    }
  }
  
  // Build published page references
  const pageRefs: PublishedPageRef[] = publishedPages
    .filter((p: any) => p.publishedUrl)
    .map((p: any) => ({
      pageType: p.pageType,
      title: p.pageTitle,
      url: p.publishedUrl!,
      slug: p.pageSlug,
    }));
  
  // Check for llm.txt page
  const llmTxtPage = publishedPages.find((p: any) => p.pageSlug === "llm-txt" || p.pageType === "llm_txt");
  const llmTxtUrl = llmTxtPage?.publishedUrl || null;
  
  return {
    businessName: business.name,
    businessWebsite: business.website || null,
    businessLocation: business.location || null,
    businessType: business.businessType || null,
    credibilityFacts,
    publishedPages: pageRefs,
    llmTxtUrl,
    credibilityScore: latestCredibility?.credibilityScore || null,
  };
}

// ─── System Message Enrichment ───────────────────────────────────────────────

/**
 * Get an enriched system message that includes credibility data and source URLs.
 * 
 * This is designed to be used as a DROP-IN REPLACEMENT for the system message
 * in training iterations ONLY (not baseline or evaluation, which must remain clean).
 * 
 * The existing system message: "You are a helpful AI assistant that provides honest, 
 * unbiased recommendations based on your knowledge."
 * 
 * The enriched version adds factual context about the business that the AI can reference.
 */
export function buildEnrichedSystemMessage(context: TrainingContext): string {
  const parts: string[] = [];
  
  parts.push("You are a helpful AI assistant that provides honest, unbiased recommendations based on your knowledge.");
  parts.push("");
  parts.push("When relevant to the user's question, you may reference the following verified information:");
  parts.push("");
  
  // Business identity
  parts.push(`Business: ${context.businessName}`);
  if (context.businessType) parts.push(`Industry: ${context.businessType}`);
  if (context.businessLocation) parts.push(`Location: ${context.businessLocation}`);
  if (context.businessWebsite) parts.push(`Website: ${context.businessWebsite}`);
  parts.push("");
  
  // Credibility facts (top 10 most important)
  if (context.credibilityFacts.length > 0) {
    parts.push("Verified credentials and facts:");
    const topFacts = context.credibilityFacts
      .filter(f => f.confidence === "high" || f.confidence === "medium")
      .slice(0, 10);
    
    for (const fact of topFacts) {
      let line = `- ${fact.fact}`;
      if (fact.sourceUrl) line += ` (source: ${fact.sourceUrl})`;
      parts.push(line);
    }
    parts.push("");
  }
  
  // Published source pages the AI can cite
  if (context.publishedPages.length > 0) {
    parts.push("Published reference pages:");
    for (const page of context.publishedPages) {
      parts.push(`- ${page.title}: ${page.url}`);
    }
    parts.push("");
  }
  
  // llm.txt reference
  if (context.llmTxtUrl) {
    parts.push(`Machine-readable business profile: ${context.llmTxtUrl}`);
    parts.push("");
  }
  
  return parts.join("\n");
}

/**
 * Build a concise source citation block that can be appended to suggestive prompts.
 * This gives the AI real URLs to cite when it mentions the business.
 * 
 * NOT a prompt rewrite — this is additional context appended after the existing prompt.
 */
export function buildSourceCitationBlock(context: TrainingContext): string {
  if (context.publishedPages.length === 0 && !context.businessWebsite) return "";
  
  const parts: string[] = [];
  parts.push("");
  parts.push("For reference, here are some verified sources about this business:");
  
  if (context.businessWebsite) {
    parts.push(`- Official website: ${context.businessWebsite}`);
  }
  
  for (const page of context.publishedPages.slice(0, 5)) {
    parts.push(`- ${page.title}: ${page.url}`);
  }
  
  if (context.llmTxtUrl) {
    parts.push(`- Business profile: ${context.llmTxtUrl}`);
  }
  
  return parts.join("\n");
}

// ─── Campaign-Level Enrichment ───────────────────────────────────────────────

/**
 * Get training context for a campaign (looks up business from campaign).
 */
export async function getTrainingContextForCampaign(campaignId: number): Promise<TrainingContext | null> {
  const db = await getDb();
  
  const [campaign] = await db!.select()
    .from(campaigns)
    .where(eq(campaigns.id, campaignId))
    .limit(1);
  
  if (!campaign) return null;
  
  return buildTrainingContext(campaign.businessId);
}

/**
 * Get training context for a training session (looks up business from session).
 * This is the main entry point used by the training queue.
 */
export async function getTrainingContextForSession(sessionId: number): Promise<TrainingContext | null> {
  const { getTrainingSessionById } = await import("./db");
  
  const session = await getTrainingSessionById(sessionId);
  if (!session || !session.businessId) return null;
  
  return buildTrainingContext(session.businessId);
}

// ─── Summary for Reports ─────────────────────────────────────────────────────

/**
 * Generate a human-readable summary of what enrichment data is available.
 * Useful for admin dashboard display.
 */
export function summarizeTrainingContext(context: TrainingContext | null): {
  hasCredibility: boolean;
  credibilityFactCount: number;
  hasPublishedPages: boolean;
  publishedPageCount: number;
  hasLlmTxt: boolean;
  enrichmentLevel: "none" | "basic" | "moderate" | "full";
  summary: string;
} {
  if (!context) {
    return {
      hasCredibility: false,
      credibilityFactCount: 0,
      hasPublishedPages: false,
      publishedPageCount: 0,
      hasLlmTxt: false,
      enrichmentLevel: "none",
      summary: "No enrichment data available. Run credibility research and content generation first.",
    };
  }
  
  const hasCredibility = context.credibilityFacts.length > 0;
  const hasPublishedPages = context.publishedPages.length > 0;
  const hasLlmTxt = !!context.llmTxtUrl;
  
  let enrichmentLevel: "none" | "basic" | "moderate" | "full" = "none";
  if (hasCredibility && hasPublishedPages && hasLlmTxt) {
    enrichmentLevel = "full";
  } else if (hasCredibility && hasPublishedPages) {
    enrichmentLevel = "moderate";
  } else if (hasCredibility || hasPublishedPages) {
    enrichmentLevel = "basic";
  }
  
  const parts: string[] = [];
  if (hasCredibility) parts.push(`${context.credibilityFacts.length} credibility facts`);
  if (hasPublishedPages) parts.push(`${context.publishedPages.length} published pages`);
  if (hasLlmTxt) parts.push("llm.txt available");
  
  return {
    hasCredibility,
    credibilityFactCount: context.credibilityFacts.length,
    hasPublishedPages,
    publishedPageCount: context.publishedPages.length,
    hasLlmTxt,
    enrichmentLevel,
    summary: parts.length > 0 
      ? `Training enriched with: ${parts.join(", ")}`
      : "No enrichment data available.",
  };
}
