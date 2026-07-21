/**
 * Credibility Research Engine
 * 
 * Uses the existing Anthropic API key (stored encrypted in the apiKeys table)
 * to research a business's credibility data from the web.
 * 
 * Researches: certifications, awards, BBB status, years in business,
 * team members, warranties, reviews, and other trust signals.
 */

import { callAI, AIProvider, AIMessage } from "./aiProviders";
import { decrypt } from "./encryption";
import { getApiKeyByProvider } from "./db";
import { getDb } from "./db";
import { credibilityData, businesses, campaigns } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import { logLLMCost } from "./costLogger";

// ============= Types =============

export interface CredibilityFact {
  category: string; // 'certification' | 'award' | 'bbb' | 'warranty' | 'team' | 'review' | 'years_in_business' | 'insurance' | 'community' | 'other'
  fact: string; // The specific fact, e.g., "3 NATE-certified technicians"
  details: string; // Expanded details about this fact
  source: string; // Where this was found or inferred from
  confidence: "high" | "medium" | "low"; // How confident we are this is accurate
  verificationUrl?: string; // URL where this can be verified (resolved to direct result page by licenseVerificationService)
  lookupFlag?: string; // Set when automated license lookup failed — instructs agency to verify manually
}

export interface CredibilityResearchResult {
  businessName: string;
  industry: string;
  overallScore: number; // 0-100
  facts: CredibilityFact[];
  suggestedPages: SuggestedPage[];
  llmTxtContent: string; // Generated llm.txt content
  schemaMarkupRecommendations: SchemaRecommendation[];
  researchSummary: string;
  researchedAt: string;
}

export interface SuggestedPage {
  pageType: string; // 'certifications' | 'warranties' | 'awards' | 'team' | 'faq' | 'pricing' | 'about'
  reason: string; // Why this page should be created
  priority: "high" | "medium" | "low";
  availableData: string[]; // What facts support this page
}

export interface SchemaRecommendation {
  schemaType: string; // 'LocalBusiness' | 'FAQPage' | 'Service' | 'Person' | 'AggregateRating' etc.
  reason: string;
  priority: "required" | "recommended" | "optional";
  exists: boolean; // Whether the website already has this schema
}

// ============= Research Prompts =============

const CREDIBILITY_RESEARCH_SYSTEM_PROMPT = `You are an expert business credibility researcher. Your job is to research a business and find every piece of credibility data that could help them get cited in AI search results (ChatGPT, Google AI Overviews, Gemini, etc.).

You must return your findings as a valid JSON object. Do NOT include any text outside the JSON.

Research the following categories thoroughly:
1. CERTIFICATIONS: Industry certifications, licenses, professional credentials of the business or its team members
2. AWARDS: Industry awards, local awards, best-of lists, recognition
3. BBB STATUS: Better Business Bureau rating and accreditation
4. WARRANTIES & GUARANTEES: Any warranties, guarantees, satisfaction policies offered
5. TEAM: Key team members, their roles, credentials, years of experience
6. REVIEWS: Review quality signals — average rating, review count, notable review platforms
7. YEARS IN BUSINESS: How long they've been operating, founding story
8. INSURANCE & BONDING: Whether they're insured, bonded, licensed
9. COMMUNITY INVOLVEMENT: Local sponsorships, charity work, community presence
10. UNIQUE DIFFERENTIATORS: What makes them stand out from competitors
11. SOCIAL PROFILES: Find all social media and review platform URLs (Facebook, Instagram, LinkedIn, Twitter/X, YouTube, TikTok, Yelp, Google Maps, BBB, Angie's List, Thumbtack, Houzz, etc.)

For each fact found, assess your confidence level:
- "high": Directly stated on their website or verifiable sources
- "medium": Inferred from multiple signals but not explicitly stated
- "low": Possible but not confirmed

For verificationUrl, you MUST actively try to find a real, publicly accessible URL that proves or verifies the fact. Examples:
- BBB accreditation → their BBB profile URL (e.g. https://www.bbb.org/us/tx/dallas/profile/hvac/...)
- NATE certification → https://www.natex.org/find-a-nate-certified-contractor/ or the business's listing
- EPA 608 license → state licensing board lookup URL
- Angi/HomeAdvisor listing → their Angi profile URL
- Manufacturer dealer/partner status → the manufacturer's dealer locator page or the business's profile on that site
- Award or best-of list → the publication's page featuring the award
- BBB rating → their BBB profile URL
- State contractor license → the state licensing board's public lookup URL
- Google Business Profile → their Google Maps URL
- Industry association membership → the association's member directory URL
If you cannot find a real URL, set verificationUrl to null. Do NOT make up URLs.

Return JSON in this exact format:
{
  "overallScore": <number 0-100>,
  "facts": [
    {
      "category": "<category>",
      "fact": "<specific fact>",
      "details": "<expanded details>",
      "source": "<where found>",
      "confidence": "<high|medium|low>",
      "verificationUrl": "<real public url or null>"
    }
  ],
  "suggestedPages": [
    {
      "pageType": "<type>",
      "reason": "<why this page should be created>",
      "priority": "<high|medium|low>",
      "availableData": ["<fact1>", "<fact2>"]
    }
  ],
  "schemaMarkupRecommendations": [
    {
      "schemaType": "<schema type>",
      "reason": "<why needed>",
      "priority": "<required|recommended|optional>",
      "exists": <boolean>
    }
  ],
  "researchSummary": "<2-3 sentence summary of findings>",
  "socialProfiles": {
    "facebook": "<url or null>",
    "instagram": "<url or null>",
    "linkedin": "<url or null>",
    "twitter": "<url or null>",
    "youtube": "<url or null>",
    "tiktok": "<url or null>",
    "yelp": "<url or null>",
    "googleMaps": "<url or null>",
    "bbb": "<url or null>",
    "angiesList": "<url or null>",
    "thumbtack": "<url or null>",
    "houzz": "<url or null>"
  }
}`;

function buildResearchPrompt(
  businessName: string,
  websiteUrl: string,
  industry: string,
  location: string,
  existingData?: Record<string, any>,
  credibilityUrls?: Array<{ label: string; url: string }>
): string {
  let prompt = `Research the credibility and trust signals for the following business:

Business Name: ${businessName}
Website: ${websiteUrl}
Industry: ${industry}
Location: ${location}
`;

  // ── Priority: provided credibility source URLs ──────────────────────────────
  // These URLs were supplied by the business owner and point directly to their
  // certification registries, BBB profile, license boards, review platforms, etc.
  // The AI MUST visit and extract data from these first before doing any other
  // open-ended research. Facts sourced from these URLs should be marked "high"
  // confidence because they come from authoritative first-party or registry sources.
  if (credibilityUrls && credibilityUrls.length > 0) {
    prompt += `
⚠️  PRIORITY SOURCES — visit and extract data from these URLs FIRST:
`;
    for (const entry of credibilityUrls) {
      const label = entry.label ? `${entry.label}: ` : "";
      prompt += `  - ${label}${entry.url}\n`;
    }
    prompt += `
For any fact you find at one of the above URLs, set confidence to "high" and set verificationUrl to the exact URL where you found it. Do NOT skip these URLs — they are the most reliable source of truth for this business.\n`;
  }

  if (existingData) {
    const dataPoints: string[] = [];
    if (existingData.yearsInBusiness) dataPoints.push(`Years in business: ${existingData.yearsInBusiness}`);
    if (existingData.certifications) dataPoints.push(`Known certifications: ${existingData.certifications}`);
    if (existingData.bbbRating) dataPoints.push(`BBB Rating: ${existingData.bbbRating}`);
    if (existingData.awards) dataPoints.push(`Known awards: ${existingData.awards}`);
    if (existingData.licenses) dataPoints.push(`Licenses: ${existingData.licenses}`);
    if (existingData.warranties) dataPoints.push(`Warranties: ${existingData.warranties}`);
    if (existingData.differentiators) dataPoints.push(`Differentiators: ${existingData.differentiators}`);
    
    if (dataPoints.length > 0) {
      prompt += `\nExisting data we already have (verify and expand on these):\n${dataPoints.join("\n")}\n`;
    }
  }

  prompt += `\nAfter reviewing the priority sources above, supplement with any additional credibility data you can find about this business and businesses in the ${industry} industry in ${location}. Include both confirmed facts and reasonable inferences based on the business type and location.

For suggested pages, only suggest pages where we have enough data to create meaningful content. Each suggested page should have at least 2-3 supporting facts.

For schema markup, assess what a typical ${industry} business website should have and recommend accordingly.

Return ONLY valid JSON, no other text.`;

  return prompt;
}

// ============= LLM.txt Generation =============

function generateLlmTxt(
  businessName: string,
  websiteUrl: string,
  industry: string,
  location: string,
  facts: CredibilityFact[],
  services?: string[]
): string {
  const lines: string[] = [];
  
  lines.push(`# ${businessName}`);
  lines.push("");
  lines.push(`> ${businessName} is a ${industry} company serving ${location}.`);
  lines.push("");
  
  // Key credentials
  const certFacts = facts.filter(f => f.category === "certification" && f.confidence !== "low");
  const awardFacts = facts.filter(f => f.category === "award" && f.confidence !== "low");
  const teamFacts = facts.filter(f => f.category === "team" && f.confidence !== "low");
  const yearsFacts = facts.filter(f => f.category === "years_in_business" && f.confidence !== "low");
  
  if (certFacts.length > 0 || awardFacts.length > 0 || yearsFacts.length > 0) {
    lines.push("## Key Credentials");
    lines.push("");
    yearsFacts.forEach(f => lines.push(`- ${f.fact}`));
    certFacts.forEach(f => lines.push(`- ${f.fact}`));
    awardFacts.forEach(f => lines.push(`- ${f.fact}`));
    lines.push("");
  }
  
  // Services
  if (services && services.length > 0) {
    lines.push("## Services");
    lines.push("");
    services.forEach(s => lines.push(`- ${s}`));
    lines.push("");
  }
  
  // Team
  if (teamFacts.length > 0) {
    lines.push("## Team");
    lines.push("");
    teamFacts.forEach(f => lines.push(`- ${f.fact}`));
    lines.push("");
  }
  
  // Service area
  lines.push("## Service Area");
  lines.push("");
  lines.push(`- Primary: ${location}`);
  lines.push("");
  
  // Important pages
  lines.push("## Important Pages");
  lines.push("");
  lines.push(`- Homepage: ${websiteUrl}`);
  lines.push("");
  
  return lines.join("\n");
}

// ============= Main Research Function =============

/**
 * Run credibility research for a business using the user's Anthropic API key.
 * 
 * This function:
 * 1. Gets the user's encrypted Anthropic API key from the database
 * 2. Decrypts it
 * 3. Calls Claude to research the business
 * 4. Parses and stores the results
 * 5. Returns the structured credibility data
 */
export async function runCredibilityResearch(params: {
  userId: number;
  businessId: number;
  campaignId: number;
  businessName: string;
  websiteUrl: string;
  industry: string;
  location: string;
  existingCredibilityData?: Record<string, any>;
  /** Pre-supplied verification URLs from the business record (BBB, certifications, etc.) */
  credibilityUrls?: Array<{ label: string; url: string }>;
}): Promise<CredibilityResearchResult> {
  const { userId, businessId, campaignId, businessName, websiteUrl, industry, location, existingCredibilityData, credibilityUrls } = params;
  
  // Get the global Anthropic API key
  const apiKeyRecord = await getApiKeyByProvider("anthropic");
  if (!apiKeyRecord) {
    throw new Error("Anthropic API key not found. Please add it in Settings.");
  }
  
  const apiKey = decrypt(apiKeyRecord.encryptedKey);
  
  // Build the research prompt
  const researchPrompt = buildResearchPrompt(businessName, websiteUrl, industry, location, existingCredibilityData, credibilityUrls);
  
  const messages: AIMessage[] = [
    { role: "system", content: CREDIBILITY_RESEARCH_SYSTEM_PROMPT },
    { role: "user", content: researchPrompt },
  ];
  
  // Use Claude Sonnet for credibility research (good balance of quality and cost)
  const model = "claude-sonnet-4-5-20250929";
  
  console.log(`[Credibility Research] Starting research for ${businessName} (campaign ${campaignId})`);
  
  const response = await callAI("anthropic", apiKey, model, messages);

  // Log cost — fire-and-forget (never block the pipeline on cost logging)
  const [costCampaign] = await (await getDb())!.select({ createdAt: campaigns.createdAt, businessId: campaigns.businessId }).from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  logLLMCost({
    campaignId,
    businessId: costCampaign?.businessId ?? null,
    operationType: "credibility_research",
    provider: "anthropic",
    model,
    inputTokens: response.inputTokens ?? 0,
    outputTokens: response.outputTokens ?? 0,
    campaignCreatedAt: costCampaign?.createdAt ?? new Date(),
  }).catch(() => {});

  // Parse the JSON response — with robust extraction and auto-retry
  let researchData: any;
  const extractJson = (raw: string): string => {
    let s = raw.trim();
    // Strip markdown code fences
    if (s.startsWith("```json")) s = s.slice(7);
    else if (s.startsWith("```")) s = s.slice(3);
    if (s.endsWith("```")) s = s.slice(0, -3);
    s = s.trim();
    // If still not starting with { try to extract the first {...} block
    if (!s.startsWith("{")) {
      const match = s.match(/\{[\s\S]*\}/);
      if (match) s = match[0];
    }
    return s;
  };

  try {
    researchData = JSON.parse(extractJson(response.content));
  } catch (firstParseError) {
    // Auto-retry once with an explicit "JSON only" correction prompt
    console.warn(`[Credibility Research] First parse failed for campaign ${campaignId} — retrying with correction prompt`);
    try {
      const correctionMessages: AIMessage[] = [
        { role: "system", content: "You are a JSON formatter. Return ONLY the raw JSON object with no markdown, no explanation, no code fences. Nothing before or after the JSON." },
        { role: "user", content: `The following text should be a JSON object but failed to parse. Extract and return ONLY the valid JSON object:\n\n${response.content.substring(0, 4000)}` },
      ];
      const retryResponse = await callAI("anthropic", apiKey, model, correctionMessages);
      researchData = JSON.parse(extractJson(retryResponse.content));
    } catch (retryParseError) {
      console.error(`[Credibility Research] Retry parse also failed for campaign ${campaignId}:`, response.content.substring(0, 200));
      throw new Error("Failed to parse credibility research results. The AI response was not valid JSON.");
    }
  }
  
  // Generate llm.txt content
  const llmTxtContent = generateLlmTxt(
    businessName,
    websiteUrl,
    industry,
    location,
    researchData.facts || [],
    existingCredibilityData?.services
  );
  
  // Build the full result
  const result: CredibilityResearchResult = {
    businessName,
    industry,
    overallScore: researchData.overallScore || 0,
    facts: researchData.facts || [],
    suggestedPages: researchData.suggestedPages || [],
    llmTxtContent,
    schemaMarkupRecommendations: researchData.schemaMarkupRecommendations || [],
    researchSummary: researchData.researchSummary || "",
    researchedAt: new Date().toISOString(),
  };
  
  // Store the results in the database
  const db = await getDb();
  if (db) {
    await db.insert(credibilityData).values({
      businessId,
      campaignId,
      researchResults: result,
      verifiedFacts: result.facts.filter(f => f.confidence === "high"),
      credibilityScore: result.overallScore,
      researchModel: model,
      researchCompletedAt: new Date(),
    });
    
    // Store discovered social profiles in the businesses table
    const socialProfiles = researchData.socialProfiles || {};
    const socialUpdates: Record<string, string | null> = {};
    if (socialProfiles.facebook) socialUpdates.facebookUrl = socialProfiles.facebook;
    if (socialProfiles.instagram) socialUpdates.instagramUrl = socialProfiles.instagram;
    if (socialProfiles.linkedin) socialUpdates.linkedinUrl = socialProfiles.linkedin;
    if (socialProfiles.twitter) socialUpdates.twitterUrl = socialProfiles.twitter;
    if (socialProfiles.youtube) socialUpdates.youtubeUrl = socialProfiles.youtube;
    if (socialProfiles.tiktok) socialUpdates.tiktokUrl = socialProfiles.tiktok;
    if (socialProfiles.yelp) socialUpdates.yelpUrl = socialProfiles.yelp;
    if (socialProfiles.googleMaps) socialUpdates.googleMapsUrl = socialProfiles.googleMaps;
    if (socialProfiles.bbb) socialUpdates.bbbUrl = socialProfiles.bbb;
    if (socialProfiles.angiesList) socialUpdates.angiesUrl = socialProfiles.angiesList;
    if (socialProfiles.thumbtack) socialUpdates.thumbtackUrl = socialProfiles.thumbtack;
    if (socialProfiles.houzz) socialUpdates.houzzUrl = socialProfiles.houzz;
    
    if (Object.keys(socialUpdates).length > 0) {
      await db.update(businesses).set({
        ...socialUpdates,
        updatedAt: new Date(),
      }).where(eq(businesses.id, businessId));
      console.log(`[Credibility Research] Stored ${Object.keys(socialUpdates).length} social profile URLs`);
    }
    
    // Update campaign status
    await db.update(campaigns).set({
      status: "content_generation",
      credibilityResearchCompletedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));
  }
  
  console.log(`[Credibility Research] Completed for ${businessName}. Score: ${result.overallScore}/100, Facts: ${result.facts.length}, Suggested pages: ${result.suggestedPages.length}`);
  
  return result;
}

/**
 * Get stored credibility data for a business
 */
export async function getCredibilityDataForBusiness(businessId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(credibilityData)
    .where(eq(credibilityData.businessId, businessId))
    .orderBy(desc(credibilityData.createdAt))
    .limit(1);
  
  return results[0] || null;
}

/**
 * Get stored credibility data for a campaign
 */
export async function getCredibilityDataForCampaign(campaignId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const results = await db.select().from(credibilityData)
    .where(eq(credibilityData.campaignId, campaignId))
    .orderBy(desc(credibilityData.createdAt))
    .limit(1);
  
  return results[0] || null;
}
