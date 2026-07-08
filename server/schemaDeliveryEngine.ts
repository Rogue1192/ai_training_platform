/**
 * Schema Delivery Engine
 *
 * Takes the site schema audit result + the business's generated schema package
 * and produces a structured "delivery plan" — a list of ready-to-copy schema
 * blocks, each with:
 *   - The JSON-LD content (as a <script> tag string)
 *   - Clear placement instructions for the team
 *   - Whether it's new (not on site) or a replacement
 *   - Which page it belongs to
 *
 * Delivery modes:
 *   "full"     → No existing schema — deliver everything
 *   "additive" → Schema exists — deliver only FAQPage + Article blocks
 *   "replace"  → Schema exists but severely incomplete — deliver everything
 *                with a note to remove the old schema first
 */

import type { SiteSchemaAuditResult } from "./siteSchemaAuditor";
import type { SchemaPackage, SchemaBlock } from "./schemaMarkupEngine";
import { schemaToScriptTag } from "./schemaMarkupEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SchemaDeliveryBlock {
  /** Human-readable label for this block */
  label: string;
  /** Which page type this is for (e.g. "homepage", "faq", "about") */
  pageType: string;
  /**
   * Action:
   * - "add"     → New schema, add to page
   * - "replace" → Remove existing schema first, then add this
   * - "skip"    → Already exists and is complete — no action needed
   */
  action: "add" | "replace" | "skip";
  /** The ready-to-paste <script type="application/ld+json"> block */
  scriptTag: string;
  /** Where to paste this block */
  placementInstructions: string;
  /** Priority: 1 = most important */
  priority: number;
  /** Whether this is the site-wide block (goes in <head> of all pages) */
  isSiteWide: boolean;
}

export interface SchemaDeliveryPlan {
  /** The delivery mode determined by the audit */
  deliveryMode: "full" | "additive" | "replace";
  /** Human-readable summary of what was found on the site */
  auditSummary: string;
  /** All blocks to deliver, sorted by priority */
  blocks: SchemaDeliveryBlock[];
  /** Fields that are still missing and need manual input */
  gapFields: SchemaGapField[];
  /** Total count of blocks to add/replace */
  actionCount: number;
  /** Whether the team needs to remove old schema first */
  requiresRemoval: boolean;
  /** Instructions for removing old schema (if applicable) */
  removalInstructions?: string;
}

export interface SchemaGapField {
  /** The schema field name */
  field: string;
  /** Human-readable label */
  label: string;
  /** Current value (pre-filled from business profile, or empty) */
  currentValue: string;
  /** Whether this field is required for the schema to be valid */
  required: boolean;
  /** Input type hint for the UI */
  inputType: "text" | "url" | "phone" | "email" | "textarea" | "number" | "hours";
  /** Placeholder / example value */
  placeholder: string;
}

// ─── Gap field definitions ────────────────────────────────────────────────────

const GAP_FIELD_DEFS: Record<string, Omit<SchemaGapField, "field" | "currentValue">> = {
  telephone: {
    label: "Phone Number",
    required: true,
    inputType: "phone",
    placeholder: "+1-555-123-4567",
  },
  address: {
    label: "Street Address",
    required: true,
    inputType: "text",
    placeholder: "123 Main St, Cullman, AL 35055",
  },
  priceRange: {
    label: "Price Range",
    required: false,
    inputType: "text",
    placeholder: "$$ (e.g. $, $$, $$$, $$$$)",
  },
  openingHours: {
    label: "Business Hours",
    required: false,
    inputType: "hours",
    placeholder: "Mo-Fr 08:00-17:00",
  },
  aggregateRating: {
    label: "Average Rating (e.g. 4.8)",
    required: false,
    inputType: "number",
    placeholder: "4.8",
  },
  description: {
    label: "Business Description",
    required: true,
    inputType: "textarea",
    placeholder: "Brief description of the business and its services",
  },
  url: {
    label: "Website URL",
    required: true,
    inputType: "url",
    placeholder: "https://example.com",
  },
  sameAs: {
    label: "Social / Review Profile URLs",
    required: false,
    inputType: "textarea",
    placeholder: "https://facebook.com/..., https://yelp.com/...",
  },
  hasOfferCatalog: {
    label: "Services Offered",
    required: false,
    inputType: "textarea",
    placeholder: "House Cleaning, Deep Cleaning, Move-In/Out Cleaning",
  },
};

// ─── Core function ────────────────────────────────────────────────────────────

export function buildSchemaDeliveryPlan(
  audit: SiteSchemaAuditResult,
  schemaPkg: SchemaPackage,
  businessData: {
    name: string;
    phone?: string | null;
    address?: string | null;
    website?: string | null;
    description?: string | null;
    priceRange?: string | null;
  }
): SchemaDeliveryPlan {
  const blocks: SchemaDeliveryBlock[] = [];
  const gapFields: SchemaGapField[] = [];

  const mode = audit.deliveryMode;

  // ── Build audit summary ────────────────────────────────────────────────────
  let auditSummary = "";
  if (!audit.hasAnySchema) {
    auditSummary = `No existing schema markup found on ${audit.websiteUrl}. Delivering the full schema package.`;
  } else if (mode === "replace") {
    auditSummary = `Existing schema found on ${audit.websiteUrl} but it is incomplete (missing: ${audit.globalMissingFields.slice(0, 4).join(", ")}). Recommend replacing with the full package.`;
  } else {
    const found = audit.foundTypes.join(", ");
    auditSummary = `Existing schema found on ${audit.websiteUrl}: ${found}. Delivering additive blocks only (FAQPage + Article) to avoid conflicts.`;
  }

  // ── Site-wide LocalBusiness schema ─────────────────────────────────────────
  if (mode === "full" || mode === "replace") {
    blocks.push({
      label: "Site-Wide LocalBusiness Schema",
      pageType: "homepage",
      action: mode === "replace" ? "replace" : "add",
      scriptTag: schemaToScriptTag(schemaPkg.siteWideSchema),
      placementInstructions:
        'Paste into the <head> of EVERY page on the site. In WordPress, use the "Insert Headers and Footers" plugin (Settings → Insert Headers and Footers → Scripts in Header). This is the most important block — it tells every AI crawler exactly who this business is.',
      priority: 1,
      isSiteWide: true,
    });
  }

  // ── Per-page schemas ───────────────────────────────────────────────────────
  // Pre-build a set of scraped FAQ Q&A pairs from the audit for enrichment
  const scrapedFaqPairs = audit.existingFaqPairs || [];

  const pageTypeLabels: Record<string, { label: string; instructions: string; priority: number }> = {
    faq: {
      label: "FAQPage Schema",
      instructions:
        "Paste at the bottom of the FAQ page content (before </body>). This enables Google FAQ rich results and helps AI models extract your Q&A pairs directly.",
      priority: 2,
    },
    about: {
      label: "About Page Schema (Article)",
      instructions:
        "Paste at the bottom of the About Us page content. Signals to AI crawlers that this is authoritative content about the business.",
      priority: 3,
    },
    credibility_awards: {
      label: "Awards & Recognition Schema",
      instructions:
        "Paste at the bottom of the Awards/Recognition page content.",
      priority: 5,
    },
    credibility_certifications: {
      label: "Certifications Schema",
      instructions:
        "Paste at the bottom of the Certifications page content.",
      priority: 5,
    },
    credibility_team: {
      label: "Team Page Schema",
      instructions:
        "Paste at the bottom of the Team/Staff page content.",
      priority: 6,
    },
    credibility_services: {
      label: "Services Schema",
      instructions:
        "Paste at the bottom of the Services page content.",
      priority: 4,
    },
    credibility_process: {
      label: "Process / How It Works Schema",
      instructions:
        "Paste at the bottom of the Process/How It Works page content.",
      priority: 6,
    },
    credibility_pricing: {
      label: "Pricing Schema",
      instructions:
        "Paste at the bottom of the Pricing page content.",
      priority: 5,
    },
  };

  for (const [pageType, pageSchema] of Object.entries(schemaPkg.pageSchemas)) {
    const meta = pageTypeLabels[pageType] || {
      label: `${pageType} Page Schema`,
      instructions: `Paste at the bottom of the ${pageType} page content.`,
      priority: 7,
    };

    const schemaTypes = Array.isArray(pageSchema["@type"])
      ? pageSchema["@type"]
      : [pageSchema["@type"]];

    // In additive mode, only deliver FAQPage and Article schemas
    if (mode === "additive") {
      const isAdditive =
        schemaTypes.includes("FAQPage") ||
        schemaTypes.includes("Article") ||
        schemaTypes.includes("BlogPosting");
      if (!isAdditive) continue;
    }

    // Skip if this exact type already exists on site and is complete
    const alreadyHasType =
      audit.foundTypes.some((t) => schemaTypes.includes(t)) &&
      !audit.globalMissingFields.length;

    // ── FAQ enrichment: merge scraped site FAQs into the FAQPage block ────────
    let enrichedSchema = pageSchema;
    if (schemaTypes.includes("FAQPage") && scrapedFaqPairs.length > 0) {
      const existingMainEntity: any[] = Array.isArray(pageSchema.mainEntity)
        ? pageSchema.mainEntity
        : [];

      // Deduplicate: skip scraped pairs whose question already appears in generated Q&As
      const existingQuestions = new Set(
        existingMainEntity.map((q: any) =>
          (typeof q.name === "string" ? q.name : "").toLowerCase().trim()
        )
      );

      const newPairs = scrapedFaqPairs
        .filter((p) => !existingQuestions.has(p.question.toLowerCase().trim()))
        .slice(0, 10) // cap scraped pairs to avoid bloat
        .map((p) => ({
          "@type": "Question",
          name: p.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: p.answer,
          },
        }));

      if (newPairs.length > 0) {
        enrichedSchema = {
          ...pageSchema,
          mainEntity: [...existingMainEntity, ...newPairs],
        };
      }
    }

    blocks.push({
      label: meta.label,
      pageType,
      action: alreadyHasType ? "skip" : "add",
      scriptTag: schemaToScriptTag(enrichedSchema),
      placementInstructions: meta.instructions,
      priority: meta.priority,
      isSiteWide: false,
    });
  }

  // Sort by priority
  blocks.sort((a, b) => a.priority - b.priority);

  // ── Gap fields ─────────────────────────────────────────────────────────────
  const businessValues: Record<string, string> = {
    telephone: businessData.phone || "",
    address: businessData.address || "",
    url: businessData.website || "",
    description: businessData.description || "",
    priceRange: businessData.priceRange || "",
    openingHours: "",
    aggregateRating: "",
    sameAs: "",
    hasOfferCatalog: "",
  };

  for (const missingField of audit.globalMissingFields) {
    const def = GAP_FIELD_DEFS[missingField];
    if (!def) continue;
    gapFields.push({
      field: missingField,
      ...def,
      currentValue: businessValues[missingField] || "",
    });
  }

  // Also surface gaps from the site-wide schema itself
  const siteWideSchema = schemaPkg.siteWideSchema;
  for (const [field, def] of Object.entries(GAP_FIELD_DEFS)) {
    if (gapFields.some((g) => g.field === field)) continue; // already added
    const val = siteWideSchema[field];
    if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) {
      const prefilledValue = businessValues[field] || "";
      if (!prefilledValue && def.required) {
        gapFields.push({
          field,
          ...def,
          currentValue: "",
        });
      }
    }
  }

  const actionCount = blocks.filter((b) => b.action !== "skip").length;
  const requiresRemoval = mode === "replace";

  return {
    deliveryMode: mode,
    auditSummary,
    blocks,
    gapFields,
    actionCount,
    requiresRemoval,
    removalInstructions: requiresRemoval
      ? 'The existing schema on this site is incomplete. Before adding the new schema, remove the old <script type="application/ld+json"> blocks from the site\'s <head> (or from the Insert Headers and Footers plugin). Then paste the new site-wide block.'
      : undefined,
  };
}

/**
 * Serialize the full delivery plan to a storable string for the DB.
 * This is what gets saved as the "schema_delivery" content page.
 */
export function serializeDeliveryPlan(plan: SchemaDeliveryPlan): string {
  return JSON.stringify(plan, null, 2);
}
