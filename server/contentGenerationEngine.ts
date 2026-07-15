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
import { contentPages, campaigns, businesses, credibilityData } from "../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import type { CredibilityResearchResult, CredibilityFact, SuggestedPage } from "./credibilityResearchEngine";
import type { Business } from "../drizzle/schema";
import { buildPageSchema, buildSchemaPackageForBusiness, schemaPackageToString } from "./schemaMarkupEngine";
import { getBusinessById } from "./db";
import { getQueryLocationsByCampaignId } from "./dbCampaigns";
import { auditSiteSchema } from "./siteSchemaAuditor";
import { buildSchemaDeliveryPlan, serializeDeliveryPlan } from "./schemaDeliveryEngine";

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

// Schema markup is now generated deterministically by schemaMarkupEngine.ts
// The old Haiku-based prompt approach has been replaced.

// ============= Page Type Configurations =============

interface PageTypeConfig {
  type: string;
  label: string;
  promptContext: string;
  schemaTypes: string[];
  requiredFactCategories: string[]; // At least one fact from these categories needed
  deliveryType: "new_page" | "inject_existing"; // Whether to create a new page or inject into an existing one
  placementInstructions: string; // Plain-English note for the team on where to put this content
}

const PAGE_TYPE_CONFIGS: PageTypeConfig[] = [
  {
    type: "certifications",
    label: "Certifications & Credentials",
    promptContext: "a dedicated certifications and credentials page showcasing the business's professional certifications, licenses, and industry credentials. This page should establish the business as a verified, qualified provider in their industry.",
    schemaTypes: ["LocalBusiness", "Person", "Organization"],
    requiredFactCategories: ["certification", "insurance"],
    deliveryType: "new_page",
    placementInstructions: "Create a new page titled \"Certifications & Credentials\" (slug: /certifications) and paste this content in.",
  },
  {
    type: "warranties",
    label: "Warranties & Guarantees",
    promptContext: "a dedicated warranties and guarantees page detailing the business's warranty policies, satisfaction guarantees, and service commitments. This page should build trust by showing the business stands behind their work.",
    schemaTypes: ["LocalBusiness", "Offer"],
    requiredFactCategories: ["warranty"],
    deliveryType: "new_page",
    placementInstructions: "Create a new page titled \"Warranties & Guarantees\" (slug: /warranties) and paste this content in.",
  },
  {
    type: "awards",
    label: "Awards & Recognition",
    promptContext: "a dedicated awards and recognition page highlighting the business's industry awards, local recognition, best-of lists, and notable achievements. This page should establish the business as an industry leader.",
    schemaTypes: ["LocalBusiness", "Organization"],
    requiredFactCategories: ["award"],
    deliveryType: "new_page",
    placementInstructions: "Create a new page titled \"Awards & Recognition\" (slug: /awards) and paste this content in.",
  },
  {
    type: "team",
    label: "Meet Our Team",
    promptContext: "a team page introducing key team members with their names, roles, credentials, years of experience, and specializations. Named attribution increases AI citation likelihood by 340%. Each team member should have a brief but specific bio.",
    schemaTypes: ["Person", "Organization"],
    requiredFactCategories: ["team"],
    deliveryType: "new_page",
    placementInstructions: "Create a new page titled \"Meet Our Team\" (slug: /team) and paste this content in.",
  },
  {
    type: "faq",
    label: "Frequently Asked Questions",
    promptContext: "a comprehensive FAQ page covering the most common questions potential customers ask about this type of business. Include questions about pricing, process, availability, qualifications, and what to expect. Use FAQPage schema markup.",
    schemaTypes: ["FAQPage"],
    requiredFactCategories: [], // FAQ pages can always be generated
    deliveryType: "new_page",
    placementInstructions: "Create a new page titled \"Frequently Asked Questions\" (slug: /faq) and paste this content in.",
  },
  {
    type: "pricing",
    label: "Pricing & Cost Guide",
    promptContext: "a pricing and cost guide page that explains the business's pricing structure, what affects costs, what's included in different service tiers, and how estimates work. This doesn't need exact prices — it needs pricing LOGIC that helps customers understand value.",
    schemaTypes: ["Service", "Offer"],
    requiredFactCategories: [], // Can be generated from industry knowledge
    deliveryType: "new_page",
    placementInstructions: "Create a new page titled \"Pricing & Cost Guide\" (slug: /pricing) and paste this content in.",
  },
  {
    type: "about",
    label: "About Us — Supplemental Content",
    promptContext: "supplemental credibility content to be injected into an existing About Us page. Focus on the business's founding story, years in business, community involvement, and what sets them apart. Do NOT write a full page — write 2-3 focused paragraphs of trust-building content that can be inserted into an existing About page.",
    schemaTypes: ["LocalBusiness", "Organization"],
    requiredFactCategories: ["years_in_business", "community"],
    deliveryType: "inject_existing",
    placementInstructions: "Add this content to the existing About Us page — paste it after the intro paragraph or before the team section.",
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
  
  // Format facts — include verificationUrl or lookupFlag so the LLM can create hyperlinks or manual-review notices
  const hasVerifiableLinks = relevantFacts.some(f => !!f.verificationUrl);
  const hasFlaggedLinks = relevantFacts.some(f => !!(f as any).lookupFlag);

  const factLines = relevantFacts.map(f => {
    const urlNote = f.verificationUrl ? ` [VERIFICATION URL: ${f.verificationUrl}]` : "";
    const flagNote = !f.verificationUrl && (f as any).lookupFlag
      ? ` [MANUAL REVIEW REQUIRED: ${(f as any).lookupFlag}]`
      : "";
    return `- [${f.category}] ${f.fact} (${f.details}) — Confidence: ${f.confidence}${urlNote}${flagNote}`;
  }).join("\n");

  return `Generate ${config.promptContext}

Business Details:
- Name: ${businessName}
- Website: ${websiteUrl}
- Industry: ${industry}
- Location: ${location}

Available Credibility Data (use ONLY these facts, do not invent):
${factLines}

${relevantFacts.length === 0 ? `\nNote: Limited specific data available. Write based on general industry knowledge for ${industry} businesses in ${location}, but keep claims general and avoid specific numbers you don't have.` : ""}

${hasVerifiableLinks ? `IMPORTANT — EXTERNAL VERIFICATION LINKS:
Some facts above include a [VERIFICATION URL]. When you write about those facts in the HTML content, you MUST include a hyperlink to that URL using this exact pattern:
<a href="[VERIFICATION URL]" target="_blank" rel="noopener noreferrer">Verify [certification/award/profile name]</a>
Place the link naturally inline — for example: "...is NATE-certified (<a href=\"https://natex.org/...\" target=\"_blank\" rel=\"noopener noreferrer\">verify certification</a>)" or as a standalone "View our BBB profile" link. This is critical for trust signals — do NOT omit these links.\n` : ""}
${hasFlaggedLinks ? `IMPORTANT — MANUAL REVIEW NOTICES:
Some facts above include a [MANUAL REVIEW REQUIRED] note. For those facts, you MUST include a visible HTML notice block immediately after you mention the fact, using this exact HTML:
<div class="license-lookup-notice" style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:8px 12px;margin:8px 0;font-size:0.875em;color:#856404;">⚠️ [paste the full MANUAL REVIEW REQUIRED text here]</div>
This notice tells the agency to manually verify and update the link before publishing. Do NOT omit these notices — they are critical for content accuracy.\n` : ""}
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
  
  // Generate schema markup deterministically using schemaMarkupEngine
  // (no AI call needed — built from real data, zero hallucination risk)
  let schemaMarkup = "";
  try {
    const pageSchemaBlock = buildPageSchema(
      {
        pageType: config.type,
        pageTitle: pageData.pageTitle || config.label,
        pageContent: pageData.pageContent || "",
        publishedUrl: undefined, // not published yet
        businessName,
        businessWebsite: websiteUrl,
        businessType: industry,
        specialties: undefined, // will be enriched when schemaPackage is built
      },
      facts
    );
    schemaMarkup = JSON.stringify(pageSchemaBlock, null, 2);
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

// generateSchemaMarkup removed — replaced by schemaMarkupEngine.buildPageSchema()

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
  /** 'local' | 'national' | 'ecommerce' — controls prompt framing and schema type */
  campaignScope?: string;
}): Promise<ContentGenerationResult> {
  const { userId, businessId, campaignId, businessName, websiteUrl, industry, location, credibilityResult, campaignScope = 'local' } = params;
  
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
          deliveryType: config.deliveryType,
          placementInstructions: config.placementInstructions,
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
  // Build a rich llm.txt using all available data (business profile, tracked queries, generated pages)
  const llmTxtContent = await buildRichLlmTxt({
    businessId,
    campaignId,
    businessName,
    websiteUrl,
    industry,
    location,
    credibilityResult,
    generatedPages,
    apiKey,
    campaignScope,
  });
  
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

  // ── Schema audit + delivery pipeline ──────────────────────────────────────
  // Step 1: Audit the client's site for existing schema
  // Step 2: Build the schema package (site-wide + per-page)
  // Step 3: Build a smart delivery plan (full / additive / replace)
  // Step 4: Store audit result + delivery plan as internal content pages
  try {
    // Step 1: Audit the client's site
    let auditResult = null;
    if (websiteUrl) {
      console.log(`[Content Generation] Auditing existing schema on ${websiteUrl}...`);
      try {
        auditResult = await auditSiteSchema(websiteUrl);
        console.log(`[Content Generation] ✓ Schema audit complete: mode=${auditResult.deliveryMode}, foundTypes=${auditResult.foundTypes.join(",") || "none"}, faqPairs=${auditResult.existingFaqPairs.length}`);
      } catch (auditErr: any) {
        console.warn(`[Content Generation] Schema audit failed (non-fatal):`, auditErr.message);
      }
    }

    // Step 2: Build the schema package
    const schemaPkg = await buildSchemaPackageForBusiness(businessId, campaignId);
    if (schemaPkg && db) {
      // Store the composite site-wide schema as a special content page
      const existingSchemaPage = await db.select()
        .from(contentPages)
        .where(and(eq(contentPages.campaignId, campaignId), eq(contentPages.pageType, "schema_package")))
        .limit(1);
      const schemaContent = schemaPackageToString(schemaPkg);
      if (existingSchemaPage.length > 0) {
        await db.update(contentPages)
          .set({ pageContent: schemaContent, schemaMarkup: JSON.stringify(schemaPkg.siteWideSchema), updatedAt: new Date() })
          .where(eq(contentPages.id, existingSchemaPage[0]!.id));
      } else {
        await db.insert(contentPages).values({
          businessId,
          campaignId,
          pageType: "schema_package",
          pageTitle: "Schema Markup Package",
          pageSlug: "schema",
          pageContent: schemaContent,
          schemaMarkup: JSON.stringify(schemaPkg.siteWideSchema),
          status: "draft",
          deliveryType: "inject_existing",
          placementInstructions: `Paste the SITE-WIDE SCHEMA block into the <head> of every page on the client's site (or use Insert Headers and Footers plugin in WordPress). Paste each per-page schema block into the corresponding page. Summary: ${schemaPkg.summary}`,
          generationModel: "system",
          generationPrompt: `Schema package for ${businessName}`,
        });
      }
      console.log(`[Content Generation] ✓ Schema package built: ${schemaPkg.summary}`);

      // Step 3: Build the smart delivery plan (requires audit result)
      if (auditResult) {
        // Fetch business record for gap-field pre-fill
        const db2 = await getDb();
        let businessPhone: string | null = null;
        let businessAddress: string | null = null;
        let businessDescription: string | null = null;
        if (db2) {
          const { businesses: bizTable } = await import("../drizzle/schema");
          const [biz] = await db2.select().from(bizTable).where(eq(bizTable.id, businessId)).limit(1);
          if (biz) {
            businessPhone = biz.phone || null;
            businessAddress = biz.address || null;
            businessDescription = biz.description || null;
          }
        }

        const deliveryPlan = buildSchemaDeliveryPlan(
          auditResult,
          schemaPkg,
          {
            name: businessName,
            phone: businessPhone,
            address: businessAddress,
            website: websiteUrl,
            description: businessDescription,
          }
        );

        // Step 4a: Store audit result as schema_audit page
        const existingAuditPage = await db.select()
          .from(contentPages)
          .where(and(eq(contentPages.campaignId, campaignId), eq(contentPages.pageType, "schema_audit")))
          .limit(1);
        const auditJson = JSON.stringify(auditResult, null, 2);
        if (existingAuditPage.length > 0) {
          await db.update(contentPages)
            .set({ pageContent: auditJson, updatedAt: new Date() })
            .where(eq(contentPages.id, existingAuditPage[0]!.id));
        } else {
          await db.insert(contentPages).values({
            businessId,
            campaignId,
            pageType: "schema_audit",
            pageTitle: "Schema Site Audit",
            pageSlug: "schema-audit",
            pageContent: auditJson,
            status: "draft",
            deliveryType: "inject_existing",
            placementInstructions: `Audit of existing schema on ${websiteUrl}. Delivery mode: ${auditResult.deliveryMode}. Found types: ${auditResult.foundTypes.join(", ") || "none"}.`,
            generationModel: "system",
            generationPrompt: `Schema audit for ${websiteUrl}`,
          });
        }

        // Step 4b: Store delivery plan as schema_delivery page
        const existingDeliveryPage = await db.select()
          .from(contentPages)
          .where(and(eq(contentPages.campaignId, campaignId), eq(contentPages.pageType, "schema_delivery")))
          .limit(1);
        const deliveryJson = serializeDeliveryPlan(deliveryPlan);
        if (existingDeliveryPage.length > 0) {
          await db.update(contentPages)
            .set({ pageContent: deliveryJson, updatedAt: new Date() })
            .where(eq(contentPages.id, existingDeliveryPage[0]!.id));
        } else {
          await db.insert(contentPages).values({
            businessId,
            campaignId,
            pageType: "schema_delivery",
            pageTitle: "Schema Delivery Plan",
            pageSlug: "schema-delivery",
            pageContent: deliveryJson,
            status: "draft",
            deliveryType: "inject_existing",
            placementInstructions: deliveryPlan.auditSummary,
            generationModel: "system",
            generationPrompt: `Schema delivery plan for ${businessName}`,
          });
        }
        console.log(`[Content Generation] ✓ Schema delivery plan built: mode=${deliveryPlan.deliveryMode}, ${deliveryPlan.actionCount} blocks to deliver, ${deliveryPlan.gapFields.length} gap fields`);
      }
    }
  } catch (schemaPackageError: any) {
    console.warn(`[Content Generation] Schema package build failed:`, schemaPackageError.message);
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
 * Build a rich, comprehensive llm.txt file for a business.
 *
 * This replaces the thin stub generated during credibility research.
 * It runs AFTER content generation so it has access to:
 *  - Full business profile (specialties, phone, address, social profiles, etc.)
 *  - All tracked query-location combos (the keywords we're training on)
 *  - The list of generated content pages (for the Important Pages section)
 *  - All credibility facts (certifications, awards, team, etc.)
 */
export async function buildRichLlmTxt(params: {
  businessId: number;
  campaignId: number;
  businessName: string;
  websiteUrl: string;
  industry: string;
  location: string;
  credibilityResult: CredibilityResearchResult;
  generatedPages: GeneratedPage[];
  /** Optional Anthropic API key — used to generate the AI-powered FAQ section */
  apiKey?: string;
  /** 'local' | 'national' | 'ecommerce' — controls Service Areas label and FAQ framing */
  campaignScope?: string;
}): Promise<string> {
  const { businessId, campaignId, businessName, websiteUrl, industry, location, credibilityResult, generatedPages, apiKey, campaignScope = 'local' } = params;
  const isLocal = campaignScope === 'local';

  const business = await getBusinessById(businessId);
  const queryLocations = await getQueryLocationsByCampaignId(campaignId);
  const facts = credibilityResult.facts;
  const lines: string[] = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push(`# ${businessName}`);
  lines.push("");

  const foundedYear = business?.yearsInBusiness ? new Date().getFullYear() - business.yearsInBusiness : null;
  const yearsStr = foundedYear ? `, established ${foundedYear}` : "";
  lines.push(`> ${businessName} is a ${industry} serving ${location}${yearsStr}.`);
  lines.push("");

  // ── Brand Identity ──────────────────────────────────────────────────────────
  const brandParts: string[] = [];
  if (business?.description) brandParts.push(business.description);
  if (foundedYear) brandParts.push(`Founded: ${foundedYear} (${new Date().getFullYear() - foundedYear}+ years in business)`);
  if (business?.contactName) brandParts.push(`Primary Contact: ${business.contactName}`);
  if (business?.contactEmail) brandParts.push(`Contact Email: ${business.contactEmail}`);
  if (brandParts.length > 0) {
    lines.push("## About");
    lines.push("");
    brandParts.forEach(p => lines.push(p));
    lines.push("");
  }

  // ── Specialties & Unique Expertise ──────────────────────────────────────────
  // This section is intentionally prominent — it is the primary signal AI engines
  // use to differentiate this business from generic competitors.
  if (business?.specialties) {
    lines.push("## Specialties & Unique Expertise");
    lines.push("");
    lines.push(business.specialties);
    lines.push("");
  }

  // ── What Sets Us Apart ──────────────────────────────────────────────────────
  if (business?.differentiators) {
    lines.push("## What Sets Us Apart");
    lines.push("");
    lines.push(business.differentiators);
    lines.push("");
  }

  // ── Key Credentials ─────────────────────────────────────────────────────────
  const certFacts = facts.filter(f => f.category === "certification" && f.confidence !== "low");
  const awardFacts = facts.filter(f => f.category === "award" && f.confidence !== "low");
  const yearsFacts = facts.filter(f => f.category === "years_in_business" && f.confidence !== "low");
  const insuranceFacts = facts.filter(f => f.category === "insurance" && f.confidence !== "low");
  const warrantyFacts = facts.filter(f => f.category === "warranty" && f.confidence !== "low");
  const bbbFacts = facts.filter(f => f.category === "bbb" && f.confidence !== "low");

  if (certFacts.length > 0 || awardFacts.length > 0 || yearsFacts.length > 0 || insuranceFacts.length > 0 || bbbFacts.length > 0) {
    lines.push("## Key Credentials");
    lines.push("");
    yearsFacts.forEach(f => lines.push(`- ${f.fact}`));
    certFacts.forEach(f => lines.push(`- ${f.fact}`));
    awardFacts.forEach(f => lines.push(`- ${f.fact}`));
    insuranceFacts.forEach(f => lines.push(`- ${f.fact}`));
    bbbFacts.forEach(f => lines.push(`- ${f.fact}`));
    if (business?.bbbRating) lines.push(`- BBB Rating: ${business.bbbRating}`);
    if (business?.certifications) lines.push(`- Certifications: ${business.certifications}`);
    if (business?.awards) lines.push(`- Awards: ${business.awards}`);
    if (business?.licenses) lines.push(`- Licenses: ${business.licenses}`);
    lines.push("");
  }

  // ── Warranties & Guarantees ──────────────────────────────────────────────────
  if (warrantyFacts.length > 0 || business?.warranties) {
    lines.push("## Warranties & Guarantees");
    lines.push("");
    warrantyFacts.forEach(f => lines.push(`- ${f.fact}`));
    if (business?.warranties) lines.push(`- ${business.warranties}`);
    lines.push("");
  }

  // ── Team ────────────────────────────────────────────────────────────────────
  const teamFacts = facts.filter(f => f.category === "team" && f.confidence !== "low");
  if (teamFacts.length > 0) {
    lines.push("## Team");
    lines.push("");
    teamFacts.forEach(f => lines.push(`- ${f.fact}`));
    lines.push("");
  }

  // ── Service Areas / Markets Served ────────────────────────────────────────
  const uniqueLocations = [...new Set(queryLocations.map(ql => ql.location).filter(Boolean))];
  if (isLocal) {
    lines.push("## Service Areas");
    lines.push("");
    if (uniqueLocations.length > 0) {
      uniqueLocations.forEach(loc => lines.push(`- ${loc}`));
    } else {
      lines.push(`- ${location}`);
    }
  } else {
    lines.push("## Markets Served");
    lines.push("");
    lines.push(campaignScope === 'ecommerce' ? "- Online (ships/serves nationwide)" : "- United States (nationwide)");
    if (uniqueLocations.length > 0) {
      uniqueLocations.slice(0, 5).forEach(loc => lines.push(`- ${loc}`));
    }
  }
  lines.push("");

  // ── What We're Known For (tracked keywords) ──────────────────────────────────
  const uniqueQueries = [...new Set(queryLocations.map(ql => ql.searchQuery))];
  if (uniqueQueries.length > 0) {
    lines.push("## What We're Known For");
    lines.push("");
    lines.push("These are the topics and search queries this business is an authority on:");
    lines.push("");
    uniqueQueries.forEach(q => lines.push(`- ${q}`));
    lines.push("");
  }


  // ── Frequently Asked Questions (AI-generated) ─────────────────────────────
  // Generate 10 FAQs using the LLM, grounded in real business data.
  // These are the exact format AI engines (ChatGPT, Perplexity, Google AI Overviews)
  // extract and surface in response to user questions.
  if (apiKey) {
    try {
      const uniqueLocationsForFaq = [...new Set(queryLocations.map(ql => ql.location))];
      const uniqueQueriesForFaq = [...new Set(queryLocations.map(ql => ql.searchQuery))];
      const topFacts = facts.filter(f => f.confidence !== "low").slice(0, 12);
      const factsForFaq = topFacts.map(f => `- [${f.category}] ${f.fact}`).join("\n");

      const scopeLabel = campaignScope === 'ecommerce' ? 'e-commerce brand' : campaignScope === 'national' ? 'national brand or agency' : 'local business';
      const faqPrompt = `You are writing the Frequently Asked Questions section for the llm.txt machine-readable profile of a ${scopeLabel}. This file is read by AI engines (ChatGPT, Perplexity, Google AI Overviews) to understand and recommend the business.

Business: ${businessName}
Industry: ${industry}
${isLocal ? `Service Areas: ${uniqueLocationsForFaq.join(", ") || location}` : `Coverage: ${campaignScope === 'ecommerce' ? 'Nationwide online' : 'United States (nationwide)'}`}
Website: ${websiteUrl}
${business?.specialties ? `Specialties: ${business.specialties}` : ""}
${business?.differentiators ? `Differentiators: ${business.differentiators}` : ""}
${business?.bbbRating ? `BBB Rating: ${business.bbbRating}` : ""}
${foundedYear ? `Founded: ${foundedYear}` : ""}

Verified Facts:
${factsForFaq || "(Use general industry knowledge for this business type)"}

Tracked Search Topics (what customers search for):
${uniqueQueriesForFaq.slice(0, 10).map(q => `- ${q}`).join("\n") || "(General local services)"}

Generate exactly 10 FAQs that a potential customer would realistically ask. Rules:
1. Questions must be in natural conversational phrasing (how people actually search)
2. Answers must be 2-4 sentences, direct, factual, and grounded in the data above
3. Cover these topics across the 10 questions: pricing/cost, ${isLocal ? 'service areas covered' : 'who they serve / ideal client'}, qualifications/credentials, process/what to expect, availability/response time, warranties/guarantees, what makes them different from competitors, a specific service they are known for, how to get started/get a quote, and one ${isLocal ? 'location-specific' : 'industry-specific'} question
4. Include the business name naturally in at least 5 of the 10 answers
5. Do NOT fabricate specific prices, phone numbers, or hours unless they appear in the verified facts above

Return ONLY a JSON array in this exact format with no extra text:
[
  { "question": "...", "answer": "..." },
  ...
]`;

      const faqResponse = await callAI("anthropic", apiKey, "claude-haiku-4-5-20250929", [
        { role: "user", content: faqPrompt },
      ]);

      let faqItems: Array<{ question: string; answer: string }> = [];
      try {
        let jsonStr = faqResponse.content.trim();
        if (jsonStr.startsWith("```json")) jsonStr = jsonStr.slice(7);
        if (jsonStr.startsWith("```")) jsonStr = jsonStr.slice(3);
        if (jsonStr.endsWith("```")) jsonStr = jsonStr.slice(0, -3);
        faqItems = JSON.parse(jsonStr.trim());
      } catch {
        console.warn("[llm.txt] FAQ JSON parse failed, skipping FAQ section");
      }

      if (Array.isArray(faqItems) && faqItems.length > 0) {
        lines.push("## Frequently Asked Questions");
        lines.push("");
        faqItems.forEach(item => {
          if (item.question && item.answer) {
            lines.push(`### ${item.question}`);
            lines.push("");
            lines.push(item.answer);
            lines.push("");
          }
        });
      }
    } catch (faqError: any) {
      console.warn("[llm.txt] FAQ generation failed (non-fatal):", faqError.message);
    }
  }

  // ── Important Pages ─────────────────────────────────────────────────────────
  const PAGE_LABELS: Record<string, { label: string; slug: string }> = {
    certifications: { label: "Certifications & Credentials", slug: "/certifications" },
    warranties:     { label: "Warranties & Guarantees",      slug: "/warranties" },
    awards:         { label: "Awards & Recognition",         slug: "/awards" },
    team:           { label: "Meet Our Team",                slug: "/team" },
    faq:            { label: "Frequently Asked Questions",   slug: "/faq" },
    pricing:        { label: "Pricing & Cost Guide",         slug: "/pricing" },
    about:          { label: "About Us",                     slug: "/about" },
  };

  lines.push("## Important Pages");
  lines.push("");
  lines.push(`- Homepage: ${websiteUrl}`);
  generatedPages.forEach(page => {
    const meta = PAGE_LABELS[page.pageType];
    if (meta) lines.push(`- ${meta.label}: ${websiteUrl.replace(/\/$/, "")}${meta.slug}`);
  });
  lines.push(`- LLM Profile: ${websiteUrl.replace(/\/$/, "")}/llm.txt`);
  lines.push("");

  // ── Contact Information ──────────────────────────────────────────────────────
  const contactLines: string[] = [];
  if (business?.phone)   contactLines.push(`- Phone: ${business.phone}`);
  if (business?.address) contactLines.push(`- Address: ${business.address}`);
  if (business?.website) contactLines.push(`- Website: ${business.website}`);
  if (contactLines.length > 0) {
    lines.push("## Contact Information");
    lines.push("");
    contactLines.forEach(l => lines.push(l));
    lines.push("");
  }

  // ── Social Profiles & Reviews ────────────────────────────────────────────────
  const socialLines: string[] = [];
  if (business?.facebookUrl)   socialLines.push(`- Facebook: ${business.facebookUrl}`);
  if (business?.instagramUrl)  socialLines.push(`- Instagram: ${business.instagramUrl}`);
  if (business?.linkedinUrl)   socialLines.push(`- LinkedIn: ${business.linkedinUrl}`);
  if (business?.twitterUrl)    socialLines.push(`- Twitter/X: ${business.twitterUrl}`);
  if (business?.youtubeUrl)    socialLines.push(`- YouTube: ${business.youtubeUrl}`);
  if (business?.tiktokUrl)     socialLines.push(`- TikTok: ${business.tiktokUrl}`);
  if (business?.yelpUrl)       socialLines.push(`- Yelp: ${business.yelpUrl}`);
  if (business?.googleMapsUrl) socialLines.push(`- Google Maps: ${business.googleMapsUrl}`);
  if (business?.bbbUrl)        socialLines.push(`- BBB Profile: ${business.bbbUrl}`);
  if (business?.angiesUrl)     socialLines.push(`- Angi: ${business.angiesUrl}`);
  if (business?.thumbtackUrl)  socialLines.push(`- Thumbtack: ${business.thumbtackUrl}`);
  if (business?.houzzUrl)      socialLines.push(`- Houzz: ${business.houzzUrl}`);
  if (socialLines.length > 0) {
    lines.push("## Social Profiles & Reviews");
    lines.push("");
    socialLines.forEach(l => lines.push(l));
    lines.push("");
  }

  // ── Verified Sources ─────────────────────────────────────────────────────────
  const verifiedFacts = facts.filter(f => f.verificationUrl && f.confidence !== "low");
  if (verifiedFacts.length > 0) {
    lines.push("## Verified Sources");
    lines.push("");
    verifiedFacts.slice(0, 10).forEach(f => lines.push(`- ${f.fact}: ${f.verificationUrl}`));
    lines.push("");
  }

  return lines.join("\n");
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
    deliveryType: config.deliveryType,
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
