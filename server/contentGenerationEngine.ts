/**
 * Content Generation Engine
 * 
 * Generates multiple dedicated content pages for client websites based on
 * credibility research data. Each page follows the optimal format for
 * AI citation (H1 → summary → bullet facts → 600-800 word expansion → FAQ → author attribution).
 * 
 * Also generates llm.txt files and schema markup recommendations.
 * 
 * Uses Anthropic Claude Sonnet for content generation (quality writing).
 * Uses Anthropic Claude Haiku for schema markup generation (cost optimization).
 */

import { callAI, AIProvider, AIMessage } from "./aiProviders";
import { decrypt } from "./encryption";
import { getApiKeyByProvider } from "./db";
import { getDb } from "./db";
import { contentPages, campaigns } from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import type { CredibilityResearchResult, CredibilityFact, SuggestedPage } from "./credibilityResearchEngine";

// ============= Types =============

export interface GeneratedPage {
  pageType: string;
  pageTitle: string;
  pageSlug: string;
  pageContent: string; // Full HTML content
  metaDescription: string;
  schemaMarkup: string; // JSON-LD schema
  interlinkTargets: string[]; // Page types to link to
  deliveryType: "new_page" | "inject_existing";
}

export interface ContentGenerationResult {
  pages: GeneratedPage[];
  llmTxtContent: string;
  totalPages: number;
  generationModel: string;
  generatedAt: string;
}

// ============= Content Generation Prompts =============

/**
 * The master content generation system prompt.
 * This is the prompt Casey will review and potentially modify.
 * It encodes the optimal format for AI citation based on research.
 */
const CONTENT_GENERATION_SYSTEM_PROMPT = `You are an expert content writer specializing in creating web pages that get cited by AI search engines (ChatGPT, Google AI Overviews, Gemini).

Your content MUST follow this exact structure for maximum AI citation potential:

1. **H1 HEADING**: Announces what the page covers + primary benefit/differentiator
   - Include the business name, location, and key credential
   - Example: "NATE-Certified HVAC Technicians in Dallas — 10+ Years Experience"

2. **OPENING SUMMARY (1-2 sentences)**: Direct answer to the primary query about this topic
   - This is what AI engines will most likely extract as a citation
   - Must be factual, specific, and include the business name
   - Example: "ABC Heating and Cooling employs 3 NATE-certified technicians with over 10 years of experience each, serving the greater Dallas-Fort Worth area."

3. **BULLET POINT FACTS (5-8 bullets)**: Key facts in scannable format
   - AI engines extract these easily
   - Each bullet should be a standalone fact that could be cited
   - Include specific numbers, names, and credentials where available

4. **DETAILED CONTENT (600-800 words)**: Expands on the facts with specifics
   - Break into sections of 120-180 words each (optimal for AI extraction)
   - Use H2 subheadings for each section
   - Include: statistics, specific examples, local context
   - Write in third person about the business
   - Maintain professional but approachable tone
   - Include specific names and credentials where available (named attribution increases citation by 340%)

5. **FAQ SECTION (5-7 questions)**: In conversational phrasing with direct answers
   - Questions should match how people actually search
   - Answers should be 2-4 sentences, direct and factual
   - Include FAQPage schema-compatible format

6. **CONTEXTUAL INTERLINKS**: Reference 1-2 other pages on the site naturally within the content
   - Use natural anchor text, not "click here"
   - Link to related credential/service pages

IMPORTANT RULES:
- Every claim must be based on the credibility data provided — do NOT fabricate facts
- If data is limited, write around what you have rather than inventing details
- Use the business's actual name, location, and verified credentials throughout
- Include local geographic references naturally
- Write for humans first, but structure for AI extraction
- Do NOT use generic filler content — every sentence should add value
- Output the page content in clean HTML (no full HTML document, just the content body)

Return your response as valid JSON with this format:
{
  "pageTitle": "<H1 title>",
  "pageSlug": "<url-friendly-slug>",
  "pageContent": "<full HTML content>",
  "metaDescription": "<155 character meta description>",
  "interlinkSuggestions": ["<pageType1>", "<pageType2>"]
}`;

/**
 * Schema markup generation prompt (uses cheaper Haiku model)
 */
const SCHEMA_GENERATION_SYSTEM_PROMPT = `You are a schema markup expert. Generate JSON-LD structured data for web pages.

Return ONLY valid JSON-LD markup (no explanation text). The markup should be ready to paste into a <script type="application/ld+json"> tag.

Always include:
- @context: "https://schema.org"
- Appropriate @type for the page content
- All relevant properties filled with the provided data
- Proper nesting of related entities`;

// ============= Page Type Configurations =============

interface PageTypeConfig {
  type: string;
  label: string;
  promptContext: string;
  schemaTypes: string[];
  requiredFactCategories: string[]; // At least one fact from these categories needed
  deliveryType: "new_page" | "inject_existing"; // Whether to create a new page or inject into an existing one
}

const PAGE_TYPE_CONFIGS: PageTypeConfig[] = [
  {
    type: "certifications",
    label: "Certifications & Credentials",
    promptContext: "a dedicated certifications and credentials page showcasing the business's professional certifications, licenses, and industry credentials. This page should establish the business as a verified, qualified provider in their industry.",
    schemaTypes: ["LocalBusiness", "Person", "Organization"],
    requiredFactCategories: ["certification", "insurance"],
    deliveryType: "new_page",
  },
  {
    type: "warranties",
    label: "Warranties & Guarantees",
    promptContext: "a dedicated warranties and guarantees page detailing the business's warranty policies, satisfaction guarantees, and service commitments. This page should build trust by showing the business stands behind their work.",
    schemaTypes: ["LocalBusiness", "Offer"],
    requiredFactCategories: ["warranty"],
    deliveryType: "new_page",
  },
  {
    type: "awards",
    label: "Awards & Recognition",
    promptContext: "a dedicated awards and recognition page highlighting the business's industry awards, local recognition, best-of lists, and notable achievements. This page should establish the business as an industry leader.",
    schemaTypes: ["LocalBusiness", "Organization"],
    requiredFactCategories: ["award"],
    deliveryType: "new_page",
  },
  {
    type: "team",
    label: "Meet Our Team",
    promptContext: "a team page introducing key team members with their names, roles, credentials, years of experience, and specializations. Named attribution increases AI citation likelihood by 340%. Each team member should have a brief but specific bio.",
    schemaTypes: ["Person", "Organization"],
    requiredFactCategories: ["team"],
    deliveryType: "new_page",
  },
  {
    type: "faq",
    label: "Frequently Asked Questions",
    promptContext: "a comprehensive FAQ page covering the most common questions potential customers ask about this type of business. Include questions about pricing, process, availability, qualifications, and what to expect. Use FAQPage schema markup.",
    schemaTypes: ["FAQPage"],
    requiredFactCategories: [], // FAQ pages can always be generated
    deliveryType: "new_page",
  },
  {
    type: "pricing",
    label: "Pricing & Cost Guide",
    promptContext: "a pricing and cost guide page that explains the business's pricing structure, what affects costs, what's included in different service tiers, and how estimates work. This doesn't need exact prices — it needs pricing LOGIC that helps customers understand value.",
    schemaTypes: ["Service", "Offer"],
    requiredFactCategories: [], // Can be generated from industry knowledge
    deliveryType: "new_page",
  },
  {
    type: "about",
    label: "About Us — Supplemental Content",
    promptContext: "supplemental credibility content to be injected into an existing About Us page. Focus on the business's founding story, years in business, community involvement, and what sets them apart. Do NOT write a full page — write 2-3 focused paragraphs of trust-building content that can be inserted into an existing About page.",
    schemaTypes: ["LocalBusiness", "Organization"],
    requiredFactCategories: ["years_in_business", "community"],
    deliveryType: "inject_existing",
  },
];

// ============= Helper Functions =============

/**
 * Determine which pages should be generated based on available credibility data
 */
export function determinePageTypes(
  credibilityResult: CredibilityResearchResult,
  suggestedPages?: SuggestedPage[]
): PageTypeConfig[] {
  const pagesToGenerate: PageTypeConfig[] = [];
  
  for (const config of PAGE_TYPE_CONFIGS) {
    // FAQ and pricing pages are always generated
    if (config.requiredFactCategories.length === 0) {
      pagesToGenerate.push(config);
      continue;
    }
    
    // Check if we have facts in the required categories
    const hasRequiredFacts = config.requiredFactCategories.some(category =>
      credibilityResult.facts.some(fact => 
        fact.category === category && fact.confidence !== "low"
      )
    );
    
    if (hasRequiredFacts) {
      pagesToGenerate.push(config);
    }
  }
  
  // Also check suggested pages from credibility research
  if (suggestedPages) {
    for (const suggested of suggestedPages) {
      const alreadyIncluded = pagesToGenerate.some(p => p.type === suggested.pageType);
      const configExists = PAGE_TYPE_CONFIGS.find(p => p.type === suggested.pageType);
      
      if (!alreadyIncluded && configExists && suggested.priority !== "low") {
        pagesToGenerate.push(configExists);
      }
    }
  }
  
  return pagesToGenerate;
}

/**
 * Build the content generation prompt for a specific page type
 */
function buildPagePrompt(
  config: PageTypeConfig,
  businessName: string,
  websiteUrl: string,
  industry: string,
  location: string,
  facts: CredibilityFact[],
  allPageTypes: string[] // For interlinking
): string {
  // Filter facts relevant to this page type
  const relevantFacts = facts.filter(f => 
    config.requiredFactCategories.includes(f.category) || f.confidence === "high"
  );
  
  const otherPages = allPageTypes.filter(t => t !== config.type);
  
  return `Generate ${config.promptContext}

Business Details:
- Name: ${businessName}
- Website: ${websiteUrl}
- Industry: ${industry}
- Location: ${location}

Available Credibility Data (use ONLY these facts, do not invent):
${relevantFacts.map(f => `- [${f.category}] ${f.fact} (${f.details}) — Confidence: ${f.confidence}`).join("\n")}

${relevantFacts.length === 0 ? `\nNote: Limited specific data available. Write based on general industry knowledge for ${industry} businesses in ${location}, but keep claims general and avoid specific numbers you don't have.` : ""}

Other pages on this site that you can interlink to: ${otherPages.join(", ")}

Remember: Follow the exact content structure (H1 → Summary → Bullets → Detailed Content → FAQ → Interlinks). Return ONLY valid JSON.`;
}

// ============= Main Generation Functions =============

/**
 * Generate a single content page
 */
export async function generateSinglePage(params: {
  apiKey: string;
  config: PageTypeConfig;
  businessName: string;
  websiteUrl: string;
  industry: string;
  location: string;
  facts: CredibilityFact[];
  allPageTypes: string[];
}): Promise<GeneratedPage> {
  const { apiKey, config, businessName, websiteUrl, industry, location, facts, allPageTypes } = params;
  
  const prompt = buildPagePrompt(config, businessName, websiteUrl, industry, location, facts, allPageTypes);
  
  const messages: AIMessage[] = [
    { role: "system", content: CONTENT_GENERATION_SYSTEM_PROMPT },
    { role: "user", content: prompt },
  ];
  
  // Use Claude Sonnet for content generation (quality writing)
  const model = "claude-sonnet-4-5-20250929";
  
  console.log(`[Content Generation] Generating ${config.type} page for ${businessName}...`);
  
  const response = await callAI("anthropic", apiKey, model, messages);
  
  // Parse JSON response
  let pageData: any;
  try {
    let jsonStr = response.content.trim();
    if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();
    pageData = JSON.parse(jsonStr);
  } catch {
    console.error(`[Content Generation] Failed to parse response for ${config.type}:`, response.content.substring(0, 200));
    throw new Error(`Failed to parse content generation response for ${config.type} page`);
  }
  
  // Generate schema markup for this page (use Haiku for cost savings)
  let schemaMarkup = "";
  try {
    schemaMarkup = await generateSchemaMarkup(
      apiKey,
      config,
      businessName,
      location,
      pageData.pageContent,
      facts
    );
  } catch (schemaError) {
    console.warn(`[Content Generation] Schema generation failed for ${config.type}, continuing without:`, schemaError);
  }
  
  return {
    pageType: config.type,
    pageTitle: pageData.pageTitle || `${config.label} — ${businessName}`,
    pageSlug: pageData.pageSlug || config.type,
    pageContent: pageData.pageContent || "",
    metaDescription: pageData.metaDescription || "",
    schemaMarkup,
    interlinkTargets: pageData.interlinkSuggestions || [],
    deliveryType: config.deliveryType,
  };
}

/**
 * Generate schema markup for a page (uses cheaper Haiku model)
 */
async function generateSchemaMarkup(
  apiKey: string,
  config: PageTypeConfig,
  businessName: string,
  location: string,
  pageContent: string,
  facts: CredibilityFact[]
): Promise<string> {
  const schemaPrompt = `Generate JSON-LD schema markup for a ${config.label} page.

Business: ${businessName}
Location: ${location}
Schema types to include: ${config.schemaTypes.join(", ")}

Key facts to include in schema:
${facts.slice(0, 10).map(f => `- ${f.fact}`).join("\n")}

Page content summary (first 500 chars):
${pageContent.substring(0, 500)}

Return ONLY the JSON-LD markup, no explanation.`;

  const messages: AIMessage[] = [
    { role: "system", content: SCHEMA_GENERATION_SYSTEM_PROMPT },
    { role: "user", content: schemaPrompt },
  ];
  
  // Use Haiku for schema generation (cheaper, simpler task)
  const response = await callAI("anthropic", apiKey, "claude-haiku-4-5-20251001", messages);
  
  let jsonStr = response.content.trim();
  if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
  if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
  jsonStr = jsonStr.trim();
  
  // Validate it's valid JSON
  JSON.parse(jsonStr);
  
  return jsonStr;
}

/**
 * Generate all content pages for a campaign
 * 
 * This is the main entry point that:
 * 1. Determines which pages to generate based on credibility data
 * 2. Generates each page using Claude Sonnet
 * 3. Generates schema markup for each page using Claude Haiku
 * 4. Generates the llm.txt file
 * 5. Stores everything in the database
 */
export async function generateAllContentPages(params: {
  userId: number;
  businessId: number;
  campaignId: number;
  businessName: string;
  websiteUrl: string;
  industry: string;
  location: string;
  credibilityResult: CredibilityResearchResult;
}): Promise<ContentGenerationResult> {
  const { userId, businessId, campaignId, businessName, websiteUrl, industry, location, credibilityResult } = params;
  
  // Get the global Anthropic API key
  const apiKeyRecord = await getApiKeyByProvider("anthropic");
  if (!apiKeyRecord) {
    throw new Error("Anthropic API key not found. Please add it in Settings.");
  }
  
  const apiKey = decrypt(apiKeyRecord.encryptedKey);
  
  // Determine which pages to generate
  const pageConfigs = determinePageTypes(credibilityResult, credibilityResult.suggestedPages);
  const allPageTypes = pageConfigs.map(c => c.type);
  
  console.log(`[Content Generation] Generating ${pageConfigs.length} pages for ${businessName}: ${allPageTypes.join(", ")}`);
  
  const generatedPages: GeneratedPage[] = [];
  const db = await getDb();
  
  // Generate each page sequentially (to avoid rate limits and maintain quality)
  for (const config of pageConfigs) {
    try {
      const page = await generateSinglePage({
        apiKey,
        config,
        businessName,
        websiteUrl,
        industry,
        location,
        facts: credibilityResult.facts,
        allPageTypes,
      });
      
      generatedPages.push(page);
      
      // Store in database
      if (db) {
        await db.insert(contentPages).values({
          businessId,
          campaignId,
          pageType: page.pageType,
          pageTitle: page.pageTitle,
          pageSlug: page.pageSlug,
          pageContent: page.pageContent,
          metaDescription: page.metaDescription,
          schemaMarkup: page.schemaMarkup,
          interlinkTargets: page.interlinkTargets,
          status: "generated",
          generationModel: "claude-sonnet-4-5-20250929",
          generationPrompt: `${config.type} page for ${businessName}`,
        });
      }
      
      console.log(`[Content Generation] ✓ Generated ${config.type} page (${page.pageContent.length} chars)`);
      
    } catch (pageError: any) {
      console.error(`[Content Generation] ✗ Failed to generate ${config.type} page:`, pageError.message);
      
      // Store the failure
      if (db) {
        await db.insert(contentPages).values({
          businessId,
          campaignId,
          pageType: config.type,
          pageTitle: `${config.label} — ${businessName}`,
          pageSlug: config.type,
          pageContent: "",
          status: "failed",
          publishError: pageError.message,
          generationModel: "claude-sonnet-4-5-20250929",
        });
      }
    }
  }
  
  // Generate/update llm.txt
  const llmTxtContent = credibilityResult.llmTxtContent;
  
  // Store llm.txt as a special content page
  if (db) {
    await db.insert(contentPages).values({
      businessId,
      campaignId,
      pageType: "llm_txt",
      pageTitle: "llm.txt",
      pageSlug: "llm.txt",
      pageContent: llmTxtContent,
      status: "generated",
      generationModel: "system",
    });
    
    // Update campaign status
    await db.update(campaigns).set({
      status: "publishing",
      contentGenerationCompletedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(campaigns.id, campaignId));
  }
  
  const result: ContentGenerationResult = {
    pages: generatedPages,
    llmTxtContent,
    totalPages: generatedPages.length + 1, // +1 for llm.txt
    generationModel: "claude-sonnet-4-5-20250929",
    generatedAt: new Date().toISOString(),
  };
  
  console.log(`[Content Generation] Completed for ${businessName}. Generated ${result.totalPages} pages total.`);
  
  return result;
}

/**
 * Get all generated content pages for a campaign
 */
export async function getContentPagesForCampaign(campaignId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(contentPages)
    .where(eq(contentPages.campaignId, campaignId))
    .orderBy(contentPages.createdAt);
}

/**
 * Get all generated content pages for a business
 */
export async function getContentPagesForBusiness(businessId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return db.select().from(contentPages)
    .where(eq(contentPages.businessId, businessId))
    .orderBy(contentPages.createdAt);
}

/**
 * Update a content page's status after publishing
 */
export async function updateContentPageStatus(
  pageId: number,
  status: "draft" | "generated" | "published" | "failed",
  publishedUrl?: string,
  publishError?: string
) {
  const db = await getDb();
  if (!db) return;
  
  await db.update(contentPages).set({
    status,
    publishedUrl: publishedUrl || undefined,
    publishedAt: status === "published" ? new Date() : undefined,
    publishError: publishError || undefined,
    updatedAt: new Date(),
  }).where(eq(contentPages.id, pageId));
}

/**
 * Regenerate a specific content page (e.g., after manual prompt adjustment)
 */
export async function regenerateContentPage(params: {
  userId: number;
  pageId: number;
  customPrompt?: string; // Optional override prompt
}): Promise<GeneratedPage> {
  const { userId, pageId, customPrompt } = params;
  
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get the existing page record
  const existingPages = await db.select().from(contentPages).where(eq(contentPages.id, pageId)).limit(1);
  const existingPage = existingPages[0];
  if (!existingPage) throw new Error("Content page not found");
  
  // Get the global Anthropic API key
  const apiKeyRecord = await getApiKeyByProvider("anthropic");
  if (!apiKeyRecord) throw new Error("Anthropic API key not found. Please add it in Settings.");
  
  const apiKey = decrypt(apiKeyRecord.encryptedKey);
  
  // Find the page config
  const config = PAGE_TYPE_CONFIGS.find(c => c.type === existingPage.pageType);
  if (!config) throw new Error(`Unknown page type: ${existingPage.pageType}`);
  
  // Get business info
  const businessResults = await db.select().from(
    (await import("../drizzle/schema")).businesses
  ).where(eq(
    (await import("../drizzle/schema")).businesses.id, existingPage.businessId
  )).limit(1);
  const business = businessResults[0];
  if (!business) throw new Error("Business not found");
  
  // Get credibility data
  const credResults = await db.select().from(
    (await import("../drizzle/schema")).credibilityData
  ).where(eq(
    (await import("../drizzle/schema")).credibilityData.businessId, existingPage.businessId
  )).limit(1);
  const credData = credResults[0];
  
  const facts = (credData?.verifiedFacts as CredibilityFact[]) || [];
  
  // Generate the page
  const messages: AIMessage[] = [
    { role: "system", content: customPrompt || CONTENT_GENERATION_SYSTEM_PROMPT },
    { role: "user", content: buildPagePrompt(
      config,
      business.name,
      business.website || "",
      business.businessType || "",
      business.location || "",
      facts,
      [] // No interlink targets for regeneration
    )},
  ];
  
  const response = await callAI("anthropic", apiKey, "claude-sonnet-4-5-20250929", messages);
  
  let pageData: any;
  try {
    let jsonStr = response.content.trim();
    if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
    pageData = JSON.parse(jsonStr.trim());
  } catch {
    throw new Error("Failed to parse regenerated content");
  }
  
  const page: GeneratedPage = {
    pageType: config.type,
    pageTitle: pageData.pageTitle || existingPage.pageTitle,
    pageSlug: pageData.pageSlug || existingPage.pageSlug || config.type,
    pageContent: pageData.pageContent || "",
    metaDescription: pageData.metaDescription || "",
    schemaMarkup: existingPage.schemaMarkup || "",
    interlinkTargets: pageData.interlinkSuggestions || [],
  };
  
  // Update in database
  await db.update(contentPages).set({
    pageTitle: page.pageTitle,
    pageSlug: page.pageSlug,
    pageContent: page.pageContent,
    metaDescription: page.metaDescription,
    interlinkTargets: page.interlinkTargets,
    status: "generated",
    generationPrompt: customPrompt || `Regenerated ${config.type} page`,
    updatedAt: new Date(),
  }).where(eq(contentPages.id, pageId));
  
  return page;
}

/**
 * Export the content generation system prompt so Casey can review/modify it
 */
export function getContentGenerationPrompt(): string {
  return CONTENT_GENERATION_SYSTEM_PROMPT;
}

/**
 * Export the page type configurations
 */
export function getPageTypeConfigs(): PageTypeConfig[] {
  return PAGE_TYPE_CONFIGS;
}
