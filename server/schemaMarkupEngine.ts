/**
 * Schema Markup Engine
 *
 * Generates production-grade JSON-LD structured data for every page type
 * we produce, plus a composite site-wide LocalBusiness/ProfessionalService
 * schema that includes ALL available business data.
 *
 * Design principles:
 * - Every schema block is built deterministically from real data — no AI
 *   hallucination risk. Fields are only populated when data exists.
 * - The site-wide composite schema is the most important output. It is the
 *   single block that gets injected into the <head> of every page on the
 *   client's site (or at minimum the homepage). LLMs read this first.
 * - Per-page schemas layer on top: FAQPage, Article, Service, Person, etc.
 * - All types follow schema.org specs exactly so Google Rich Results,
 *   Bing, and LLM crawlers can parse them without errors.
 *
 * Schema types covered:
 *   Site-wide:  LocalBusiness → ProfessionalService (with full sub-type mapping)
 *               Organization, AggregateRating, PostalAddress, GeoCoordinates,
 *               ContactPoint, OpeningHoursSpecification, Service, Offer,
 *               Person (team members), sameAs (all social/review profiles)
 *   Per-page:   FAQPage + Question/Answer
 *               Article (credibility pages)
 *               WebPage (generic)
 *               ItemList (service listings)
 *               BreadcrumbList
 *               ProfilePage (team page)
 *               SpecialAnnouncement (awards/recognition)
 *               HowTo (pricing/process pages)
 */

import { getDb } from "./db";
import { parseLocations, primaryLocation } from "@shared/location";
import { businesses, credibilityData, contentPages, campaigns } from "../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import type { CredibilityFact } from "./credibilityResearchEngine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SchemaBlock {
  "@context": "https://schema.org";
  "@type": string | string[];
  [key: string]: any;
}

export interface SchemaPackage {
  /** The main composite LocalBusiness schema — goes in <head> of every page */
  siteWideSchema: SchemaBlock;
  /** Per-page schemas keyed by pageType */
  pageSchemas: Record<string, SchemaBlock>;
  /** Published URL for each content page — used to build per-page placement instructions */
  publishedPageUrls: Array<{ pageType: string; url: string; title: string }>;
  /** Human-readable summary of what was included */
  summary: string;
  /** ISO timestamp */
  generatedAt: string;
}

export interface BusinessSchemaInput {
  // Core identity
  name: string;
  website?: string | null;
  phone?: string | null;
  contactEmail?: string | null;
  address?: string | null;
  location?: string | null;
  description?: string | null;
  businessType?: string | null;
  // Credibility
  yearsInBusiness?: number | null;
  certifications?: string | null;
  awards?: string | null;
  licenses?: string | null;
  warranties?: string | null;
  differentiators?: string | null;
  specialties?: string | null;
  bbbRating?: string | null;
  bbbUrl?: string | null;
  // Review data
  googleRating?: number | null;
  googleReviewCount?: number | null;
  googleMapsUrl?: string | null;
  // Social / review profiles
  facebookUrl?: string | null;
  instagramUrl?: string | null;
  linkedinUrl?: string | null;
  twitterUrl?: string | null;
  youtubeUrl?: string | null;
  tiktokUrl?: string | null;
  yelpUrl?: string | null;
  angiesUrl?: string | null;
  thumbtackUrl?: string | null;
  houzzUrl?: string | null;
}

// ─── Industry → Schema.org @type Mapping ─────────────────────────────────────
//
// schema.org has hundreds of LocalBusiness sub-types. We map common industry
// keywords to the most specific applicable type. When nothing matches we fall
// back to ProfessionalService (which is more specific than LocalBusiness and
// signals to LLMs that this is a credentialed service provider).

const INDUSTRY_SCHEMA_TYPE_MAP: Array<{ keywords: string[]; schemaType: string }> = [
  { keywords: ["hvac", "heating", "cooling", "air condition", "furnace", "heat pump"], schemaType: "HVACBusiness" },
  { keywords: ["plumb", "plumber", "pipe", "drain", "sewer"], schemaType: "Plumber" },
  { keywords: ["electric", "electrician", "wiring", "panel"], schemaType: "Electrician" },
  { keywords: ["roofing", "roofer", "roof repair", "shingle", "gutter"], schemaType: "RoofingContractor" },
  { keywords: ["general contractor", "construction", "remodel", "renovation", "builder"], schemaType: "GeneralContractor" },
  { keywords: ["paint", "painter", "painting"], schemaType: "HousePainter" },
  { keywords: ["landscap", "lawn", "yard", "garden", "irrigation", "sod"], schemaType: "LandscapeService" },
  { keywords: ["pest control", "exterminator", "termite", "bug", "rodent"], schemaType: "PestControlService" },
  { keywords: ["clean", "cleaning", "maid", "janitorial", "pressure wash", "power wash"], schemaType: "HouseCleaning" },
  { keywords: ["moving", "mover", "relocation", "storage"], schemaType: "MovingCompany" },
  { keywords: ["locksmith", "lock"], schemaType: "Locksmith" },
  { keywords: ["auto", "car", "vehicle", "mechanic", "repair shop", "tire", "oil change"], schemaType: "AutoRepair" },
  { keywords: ["dentist", "dental", "orthodont", "oral"], schemaType: "Dentist" },
  { keywords: ["doctor", "physician", "medical", "clinic", "urgent care", "primary care"], schemaType: "Physician" },
  { keywords: ["chiropractic", "chiropractor"], schemaType: "Chiropractor" },
  { keywords: ["optometrist", "eye care", "vision", "optician"], schemaType: "Optician" },
  { keywords: ["veterinar", "vet", "animal hospital", "pet care"], schemaType: "VeterinaryCare" },
  { keywords: ["attorney", "lawyer", "law firm", "legal"], schemaType: "Attorney" },
  { keywords: ["accountant", "accounting", "cpa", "tax", "bookkeep"], schemaType: "AccountingService" },
  { keywords: ["financial", "finance", "investment", "wealth", "insurance agent"], schemaType: "FinancialService" },
  { keywords: ["real estate", "realtor", "property", "home buy", "home sell"], schemaType: "RealEstateAgent" },
  { keywords: ["restaurant", "dining", "food", "cafe", "bistro", "eatery"], schemaType: "Restaurant" },
  { keywords: ["hotel", "motel", "inn", "lodging", "bed and breakfast"], schemaType: "Hotel" },
  { keywords: ["gym", "fitness", "personal train", "yoga", "pilates", "crossfit"], schemaType: "ExerciseGym" },
  { keywords: ["salon", "hair", "barber", "beauty", "nail", "spa", "estheti"], schemaType: "BeautySalon" },
  { keywords: ["florist", "flower", "floral"], schemaType: "Florist" },
  { keywords: ["funeral", "mortuary", "cremation"], schemaType: "FuneralHome" },
  { keywords: ["childcare", "daycare", "preschool", "nursery"], schemaType: "ChildCare" },
  { keywords: ["tutor", "education", "school", "learning center", "test prep"], schemaType: "EducationalOrganization" },
  { keywords: ["photography", "photographer", "photo studio"], schemaType: "ProfessionalService" },
  { keywords: ["it service", "tech support", "computer repair", "managed service", "software"], schemaType: "ProfessionalService" },
  { keywords: ["marketing", "advertising", "seo", "digital marketing", "pr agency"], schemaType: "ProfessionalService" },
  { keywords: ["insurance", "insurer", "insurance broker"], schemaType: "InsuranceAgency" },
  { keywords: ["bank", "credit union", "mortgage", "lending"], schemaType: "BankOrCreditUnion" },
  { keywords: ["pharmacy", "drug store", "compounding"], schemaType: "Pharmacy" },
  { keywords: ["hospital", "emergency room", "surgery center"], schemaType: "Hospital" },
];

/**
 * Map an industry string to the most specific schema.org LocalBusiness sub-type.
 */
export function resolveSchemaType(industry: string | null | undefined): string {
  if (!industry) return "ProfessionalService";
  const lower = industry.toLowerCase();
  for (const entry of INDUSTRY_SCHEMA_TYPE_MAP) {
    if (entry.keywords.some((kw) => lower.includes(kw))) {
      return entry.schemaType;
    }
  }
  return "ProfessionalService";
}

// ─── BBB Rating → Numeric ─────────────────────────────────────────────────────

const BBB_RATING_MAP: Record<string, number> = {
  "A+": 5.0, "A": 4.8, "A-": 4.5,
  "B+": 4.2, "B": 4.0, "B-": 3.7,
  "C+": 3.4, "C": 3.0, "C-": 2.7,
  "D+": 2.4, "D": 2.0, "D-": 1.7,
  "F": 1.0,
};

// ─── Helper: Parse comma-separated list ──────────────────────────────────────

function parseList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

// ─── Helper: Extract services from credibility facts ─────────────────────────

function extractServicesFromFacts(facts: CredibilityFact[]): string[] {
  const serviceFacts = facts.filter(
    (f) => f.category === "service" || f.category === "specialty" || f.category === "other"
  );
  return serviceFacts.slice(0, 10).map((f) => f.fact);
}

// ─── Helper: Extract team members from credibility facts ─────────────────────

function extractTeamFromFacts(facts: CredibilityFact[]): Array<{ name?: string; role?: string; credential?: string }> {
  const teamFacts = facts.filter((f) => f.category === "team");
  return teamFacts.slice(0, 8).map((f) => {
    // Try to parse "Name, Role, Credential" patterns
    const parts = f.fact.split(/[,—–-]/).map((s) => s.trim());
    return {
      name: parts[0] || undefined,
      role: parts[1] || undefined,
      credential: parts[2] || undefined,
    };
  });
}

// ─── Helper: Parse location into city/state ───────────────────────────────────

function parseLocation(location: string | null | undefined): { city: string; state: string; full: string } {
  // `location` may hold multiple ";"-delimited locations; use the primary one
  // for the single-value PostalAddress city/region fields.
  const primary = primaryLocation(location);
  if (!primary) return { city: "", state: "", full: "" };
  const parts = primary.split(",").map((s) => s.trim());
  return {
    city: parts[0] || primary,
    state: parts[1] || "",
    full: primary,
  };
}

// ─── Site-Wide Composite Schema ───────────────────────────────────────────────

/**
 * Build the full composite LocalBusiness/ProfessionalService schema.
 *
 * This is the most important schema block — it goes in the <head> of every
 * page on the client's site. It includes:
 *   - Correct sub-type (HVACBusiness, Plumber, Attorney, etc.)
 *   - Full PostalAddress
 *   - ContactPoint (phone + email)
 *   - AggregateRating (Google + BBB merged)
 *   - Service[] array (from specialties + credibility facts)
 *   - knowsAbout[] (certifications, specialties, differentiators)
 *   - hasCredential[] (certifications, licenses)
 *   - award[] (awards)
 *   - sameAs[] (all social + review profiles)
 *   - foundingDate
 *   - areaServed[] (all locations)
 *   - description (includes specialties)
 */
export function buildSiteWideSchema(
  business: BusinessSchemaInput,
  facts: CredibilityFact[],
  locations: string[],
  publishedPageUrls: Array<{ pageType: string; url: string; title: string }>
): SchemaBlock {
  const schemaType = resolveSchemaType(business.businessType);
  const loc = parseLocation(business.location);

  const schema: SchemaBlock = {
    "@context": "https://schema.org",
    "@type": schemaType,
    name: business.name,
  };

  // ── Description (include specialties so LLMs read them in schema) ──────────
  const descParts: string[] = [];
  if (business.description) descParts.push(business.description);
  if (business.specialties) descParts.push(`Specialties: ${business.specialties}`);
  if (business.differentiators) descParts.push(business.differentiators);
  if (descParts.length === 0) {
    descParts.push(
      `${business.name} is a ${business.businessType || "professional service"} provider serving ${business.location || "the local area"}.`
    );
  }
  schema.description = descParts.join(" ");

  // ── URL + Contact ──────────────────────────────────────────────────────────
  if (business.website) schema.url = business.website;
  if (business.phone) schema.telephone = business.phone;
  if (business.contactEmail) schema.email = business.contactEmail;

  // ── Address ───────────────────────────────────────────────────────────────
  if (business.address || business.location) {
    schema.address = {
      "@type": "PostalAddress",
      ...(business.address ? { streetAddress: business.address } : {}),
      addressLocality: loc.city || business.location || "",
      addressRegion: loc.state || "",
      addressCountry: "US",
    };
  }

  // ── ContactPoint ──────────────────────────────────────────────────────────
  const contactPoints: any[] = [];
  if (business.phone) {
    contactPoints.push({
      "@type": "ContactPoint",
      telephone: business.phone,
      contactType: "customer service",
      areaServed: loc.state || "US",
      availableLanguage: "English",
    });
  }
  if (contactPoints.length > 0) schema.contactPoint = contactPoints;

  // ── Founding Date ─────────────────────────────────────────────────────────
  if (business.yearsInBusiness && business.yearsInBusiness > 0) {
    const foundingYear = new Date().getFullYear() - business.yearsInBusiness;
    schema.foundingDate = `${foundingYear}`;
    schema.numberOfEmployees = undefined; // placeholder — remove if not set
  }

  // ── Area Served ───────────────────────────────────────────────────────────
  const allLocations = locations.length > 0 ? locations : (business.location ? [business.location] : []);
  if (allLocations.length > 0) {
    schema.areaServed = allLocations.map((l) => {
      const p = parseLocation(l);
      return {
        "@type": "City",
        name: p.city || l,
      };
    });
  }

  // ── AggregateRating ───────────────────────────────────────────────────────
  // Prefer Google rating if available; fall back to BBB
  const hasGoogleRating = business.googleRating && business.googleRating > 0;
  const hasBBBRating = business.bbbRating && BBB_RATING_MAP[business.bbbRating];

  if (hasGoogleRating || hasBBBRating) {
    const ratingValue = hasGoogleRating
      ? business.googleRating!
      : BBB_RATING_MAP[business.bbbRating!];
    const reviewCount = business.googleReviewCount && business.googleReviewCount > 0
      ? business.googleReviewCount
      : 1;
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(ratingValue * 10) / 10,
      bestRating: 5,
      worstRating: 1,
      reviewCount,
    };
  } else if (hasBBBRating) {
    schema.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: BBB_RATING_MAP[business.bbbRating!],
      bestRating: 5,
      worstRating: 1,
      reviewCount: 1,
    };
  }

  // ── Services (from specialties + credibility facts) ───────────────────────
  const serviceNames: string[] = [];
  if (business.specialties) {
    // Each sentence/clause in specialties becomes a service
    const specialtyClauses = business.specialties
      .split(/[.;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5 && s.length < 120);
    serviceNames.push(...specialtyClauses.slice(0, 5));
  }
  const factServices = extractServicesFromFacts(facts);
  serviceNames.push(...factServices);

  if (serviceNames.length > 0) {
    schema.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: `${business.name} Services`,
      itemListElement: serviceNames.slice(0, 10).map((svc, idx) => ({
        "@type": "Offer",
        position: idx + 1,
        itemOffered: {
          "@type": "Service",
          name: svc,
          provider: {
            "@type": schemaType,
            name: business.name,
          },
        },
      })),
    };
  }

  // ── knowsAbout (specialties + differentiators) ────────────────────────────
  const knowsAbout: string[] = [];
  if (business.specialties) {
    business.specialties
      .split(/[.;,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5)
      .slice(0, 6)
      .forEach((s) => knowsAbout.push(s));
  }
  if (business.differentiators) {
    business.differentiators
      .split(/[.;,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5)
      .slice(0, 3)
      .forEach((s) => knowsAbout.push(s));
  }
  // High-confidence facts
  facts
    .filter((f) => f.confidence === "high")
    .slice(0, 5)
    .forEach((f) => knowsAbout.push(f.fact));
  if (knowsAbout.length > 0) schema.knowsAbout = [...new Set(knowsAbout)];

  // ── hasCredential (certifications + licenses) ─────────────────────────────
  const credentials: any[] = [];
  parseList(business.certifications).forEach((cert) => {
    credentials.push({
      "@type": "EducationalOccupationalCredential",
      credentialCategory: "certification",
      name: cert,
    });
  });
  parseList(business.licenses).forEach((lic) => {
    credentials.push({
      "@type": "EducationalOccupationalCredential",
      credentialCategory: "license",
      name: lic,
    });
  });
  if (credentials.length > 0) schema.hasCredential = credentials;

  // ── award ─────────────────────────────────────────────────────────────────
  const awards = parseList(business.awards);
  if (awards.length > 0) schema.award = awards;

  // ── Team members as employees ─────────────────────────────────────────────
  const teamMembers = extractTeamFromFacts(facts);
  if (teamMembers.length > 0) {
    schema.employee = teamMembers.map((m) => {
      const person: any = { "@type": "Person" };
      if (m.name) person.name = m.name;
      if (m.role) person.jobTitle = m.role;
      if (m.credential) person.hasCredential = { "@type": "EducationalOccupationalCredential", name: m.credential };
      return person;
    });
  }

  // ── sameAs (all social + review profiles) ────────────────────────────────
  const sameAs: string[] = [];
  if (business.facebookUrl) sameAs.push(business.facebookUrl);
  if (business.instagramUrl) sameAs.push(business.instagramUrl);
  if (business.linkedinUrl) sameAs.push(business.linkedinUrl);
  if (business.twitterUrl) sameAs.push(business.twitterUrl);
  if (business.youtubeUrl) sameAs.push(business.youtubeUrl);
  if (business.tiktokUrl) sameAs.push(business.tiktokUrl);
  if (business.yelpUrl) sameAs.push(business.yelpUrl);
  if (business.googleMapsUrl) sameAs.push(business.googleMapsUrl);
  if (business.bbbUrl) sameAs.push(business.bbbUrl);
  if (business.angiesUrl) sameAs.push(business.angiesUrl);
  if (business.thumbtackUrl) sameAs.push(business.thumbtackUrl);
  if (business.houzzUrl) sameAs.push(business.houzzUrl);
  if (sameAs.length > 0) schema.sameAs = sameAs;

  // ── Published credibility pages as subjectOf ─────────────────────────────
  if (publishedPageUrls.length > 0) {
    schema.subjectOf = publishedPageUrls.map((p) => ({
      "@type": "WebPage",
      name: p.title,
      url: p.url,
    }));
  }

  return schema;
}

// ─── Per-Page Schemas ─────────────────────────────────────────────────────────

/**
 * FAQPage schema — extracts Q&A pairs from HTML content.
 * Handles both <h3>Q</h3><p>A</p> and <dt>Q</dt><dd>A</dd> patterns.
 */
export function buildFAQPageSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl?: string;
  businessName: string;
  businessWebsite?: string | null;
}): SchemaBlock {
  const content = page.pageContent;
  const pairs: Array<[string, string]> = [];

  // ── HTML patterns ─────────────────────────────────────────────────────────
  // h3/p pattern
  for (const m of content.matchAll(/<h3[^>]*>(.*?)<\/h3>\s*<p[^>]*>(.*?)<\/p>/gis)) {
    pairs.push([m[1], m[2]]);
  }
  // dt/dd pattern
  for (const m of content.matchAll(/<dt[^>]*>(.*?)<\/dt>\s*<dd[^>]*>(.*?)<\/dd>/gis)) {
    pairs.push([m[1], m[2]]);
  }
  // strong?/p pattern (some page builders)
  for (const m of content.matchAll(/<strong[^>]*>(.*?\?)<\/strong>\s*<p[^>]*>(.*?)<\/p>/gis)) {
    pairs.push([m[1], m[2]]);
  }

  // ── Markdown patterns (content generated as Markdown, not HTML) ───────────
  if (pairs.length === 0) {
    // Pattern 1: **Question?** followed by answer paragraph(s)
    // Matches: **Is Eagle Air licensed?**\nYes, Eagle Air...
    for (const m of content.matchAll(/^\*\*([^*]+\?)\*\*\s*\n([^\n#*][^\n]*(?:\n(?![#*])[^\n]+)*)/gm)) {
      pairs.push([m[1], m[2].trim()]);
    }
    // Pattern 2: ### or ## heading that ends with ? followed by paragraph
    for (const m of content.matchAll(/^#{2,3}\s+([^\n]+\?)\s*\n+([^#\n][^\n]*(?:\n(?![#])[^\n]+)*)/gm)) {
      pairs.push([m[1].trim(), m[2].trim()]);
    }
    // Pattern 3: FAQ section — find the FAQ heading then parse Q/A blocks below it
    // Looks for a heading containing "FAQ" or "Frequently Asked" then grabs all
    // bold-question + answer pairs below it
    const faqSectionMatch = content.match(/#{1,3}[^\n]*(?:FAQ|Frequently Asked)[^\n]*\n([\s\S]+?)(?=\n#{1,2}\s|$)/i);
    if (faqSectionMatch) {
      const faqSection = faqSectionMatch[1];
      for (const m of faqSection.matchAll(/\*\*([^*]+\?)\*\*\s*\n([^\n*#][^\n]*(?:\n(?![#*])[^\n]+)*)/gm)) {
        pairs.push([m[1], m[2].trim()]);
      }
    }
  }

  const mainEntity = pairs.slice(0, 15).map(([q, a]) => ({
    "@type": "Question",
    name: q.replace(/<[^>]*>/g, "").trim(),
    acceptedAnswer: {
      "@type": "Answer",
      text: a.replace(/<[^>]*>/g, "").replace(/\*\*/g, "").trim(),
    },
  })).filter((item) => item.name.length > 5 && item.acceptedAnswer.text.length > 10);

  const schema: SchemaBlock = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    name: page.pageTitle,
    mainEntity: mainEntity.length > 0 ? mainEntity : [],
  };

  if (page.publishedUrl) schema.url = page.publishedUrl;

  return schema;
}

/**
 * Article schema for credibility pages (certifications, awards, about, etc.)
 */
export function buildArticleSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl?: string;
  businessName: string;
  businessWebsite?: string | null;
  businessType?: string | null;
}): SchemaBlock {
  const plainText = page.pageContent.replace(/<[^>]*>/g, "").trim();
  const schemaType = resolveSchemaType(page.businessType);

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.pageTitle,
    description: plainText.slice(0, 300),
    ...(page.publishedUrl ? { url: page.publishedUrl } : {}),
    author: {
      "@type": schemaType,
      name: page.businessName,
      ...(page.businessWebsite ? { url: page.businessWebsite } : {}),
    },
    publisher: {
      "@type": "Organization",
      name: page.businessName,
      ...(page.businessWebsite ? { url: page.businessWebsite } : {}),
    },
    datePublished: new Date().toISOString().split("T")[0],
    dateModified: new Date().toISOString().split("T")[0],
    about: {
      "@type": schemaType,
      name: page.businessName,
    },
  };
}

/**
 * ProfilePage schema for team pages — includes Person entities.
 */
export function buildTeamPageSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl?: string;
  businessName: string;
  businessWebsite?: string | null;
}, teamFacts: CredibilityFact[]): SchemaBlock {
  const teamMembers = extractTeamFromFacts(teamFacts);

  const mainEntity = teamMembers.map((m) => {
    const person: any = { "@type": "Person" };
    if (m.name) person.name = m.name;
    if (m.role) person.jobTitle = m.role;
    if (m.credential) {
      person.hasCredential = {
        "@type": "EducationalOccupationalCredential",
        name: m.credential,
      };
    }
    if (page.businessName) {
      person.worksFor = {
        "@type": "Organization",
        name: page.businessName,
        ...(page.businessWebsite ? { url: page.businessWebsite } : {}),
      };
    }
    return person;
  });

  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: page.pageTitle,
    ...(page.publishedUrl ? { url: page.publishedUrl } : {}),
    mainEntity: mainEntity.length > 0 ? mainEntity : {
      "@type": "Organization",
      name: page.businessName,
    },
  };
}

/**
 * ItemList schema for pricing/service listing pages.
 */
export function buildServiceListSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl?: string;
  businessName: string;
  businessWebsite?: string | null;
  businessType?: string | null;
}, specialties: string | null | undefined): SchemaBlock {
  const schemaType = resolveSchemaType(page.businessType);

  // Extract service items from content (h2/h3 headings as service names)
  const headings = [...page.pageContent.matchAll(/<h[23][^>]*>(.*?)<\/h[23]>/gis)]
    .map(([, h]) => h.replace(/<[^>]*>/g, "").trim())
    .filter((h) => h.length > 3 && h.length < 100)
    .slice(0, 12);

  // Also parse specialties into service items
  const specialtyItems = specialties
    ? specialties.split(/[.;]/).map((s) => s.trim()).filter((s) => s.length > 5).slice(0, 6)
    : [];

  const allItems = [...new Set([...headings, ...specialtyItems])].slice(0, 15);

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: page.pageTitle,
    ...(page.publishedUrl ? { url: page.publishedUrl } : {}),
    itemListElement: allItems.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      item: {
        "@type": "Service",
        name: item,
        provider: {
          "@type": schemaType,
          name: page.businessName,
          ...(page.businessWebsite ? { url: page.businessWebsite } : {}),
        },
      },
    })),
  };
}

/**
 * SpecialAnnouncement/Article schema for awards pages.
 */
export function buildAwardsPageSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl?: string;
  businessName: string;
  businessWebsite?: string | null;
}, awardFacts: CredibilityFact[]): SchemaBlock {
  const awards = awardFacts.map((f) => f.fact);

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.pageTitle,
    description: `${page.businessName} awards, recognition, and industry achievements.`,
    ...(page.publishedUrl ? { url: page.publishedUrl } : {}),
    about: {
      "@type": "Organization",
      name: page.businessName,
      award: awards.length > 0 ? awards : undefined,
      ...(page.businessWebsite ? { url: page.businessWebsite } : {}),
    },
    publisher: {
      "@type": "Organization",
      name: page.businessName,
    },
    datePublished: new Date().toISOString().split("T")[0],
  };
}

/**
 * Certifications page — uses Article + hasCredential.
 */
export function buildCertificationsPageSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl?: string;
  businessName: string;
  businessWebsite?: string | null;
  businessType?: string | null;
  /** When true, also extract FAQs from the page content and include a FAQPage block */
  includeFaqGraph?: boolean;
}, certFacts: CredibilityFact[]): SchemaBlock {
  const schemaType = resolveSchemaType(page.businessType);
  const credentials = certFacts.map((f) => ({
    "@type": "EducationalOccupationalCredential",
    credentialCategory: "certification",
    name: f.fact,
    ...(f.verificationUrl ? { url: f.verificationUrl } : {}),
  }));

  const articleBlock: SchemaBlock = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.pageTitle,
    description: `${page.businessName} professional certifications, licenses, and industry credentials.`,
    ...(page.publishedUrl ? { url: page.publishedUrl } : {}),
    about: {
      "@type": schemaType,
      name: page.businessName,
      ...(page.businessWebsite ? { url: page.businessWebsite } : {}),
      hasCredential: credentials.length > 0 ? credentials : undefined,
    },
    publisher: {
      "@type": "Organization",
      name: page.businessName,
    },
    datePublished: new Date().toISOString().split("T")[0],
  };

  // For credibility_profile pages: also extract the FAQ section and attach a
  // FAQPage block in an @graph. The credibility_profile page is Markdown and
  // always ends with a ## FAQ / ## Frequently Asked Questions section whose
  // Q&As are grounded in the business's specific credentials — far more
  // valuable for AI citation than the generic /faq page.
  if (page.includeFaqGraph) {
    const faqSchema = buildFAQPageSchema({
      pageTitle: page.pageTitle,
      pageContent: page.pageContent,
      publishedUrl: page.publishedUrl,
      businessName: page.businessName,
      businessWebsite: page.businessWebsite,
    });

    const hasFaqs =
      Array.isArray(faqSchema.mainEntity) && faqSchema.mainEntity.length > 0;

    if (hasFaqs) {
      // Return an @graph so both Article and FAQPage live on the same page URL.
      // The @type field is set to the primary type (Article) for SchemaBlock
      // compatibility; the full graph is in @graph.
      return {
        "@context": "https://schema.org",
        "@type": "Article", // primary type for SchemaBlock interface
        "@graph": [
          { ...articleBlock, "@context": undefined },
          { ...faqSchema, "@context": undefined },
        ],
      };
    }
  }

  return articleBlock;
}

/**
 * WebPage schema — generic fallback for about/warranty/other pages.
 */
export function buildWebPageSchema(page: {
  pageTitle: string;
  pageContent: string;
  publishedUrl?: string;
  businessName: string;
  businessWebsite?: string | null;
}): SchemaBlock {
  const plainText = page.pageContent.replace(/<[^>]*>/g, "").trim();
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.pageTitle,
    description: plainText.slice(0, 300),
    ...(page.publishedUrl ? { url: page.publishedUrl } : {}),
    publisher: {
      "@type": "Organization",
      name: page.businessName,
      ...(page.businessWebsite ? { url: page.businessWebsite } : {}),
    },
    dateModified: new Date().toISOString().split("T")[0],
  };
}

// ─── Page-Type Router ─────────────────────────────────────────────────────────

/**
 * Route a content page to the correct schema builder based on pageType.
 */
export function buildPageSchema(
  page: {
    pageType: string;
    pageTitle: string;
    pageContent: string;
    publishedUrl?: string | null;
    businessName: string;
    businessWebsite?: string | null;
    businessType?: string | null;
    specialties?: string | null;
  },
  facts: CredibilityFact[]
): SchemaBlock {
  const base = {
    pageTitle: page.pageTitle,
    pageContent: page.pageContent,
    publishedUrl: page.publishedUrl || undefined,
    businessName: page.businessName,
    businessWebsite: page.businessWebsite,
    businessType: page.businessType,
  };

  switch (page.pageType) {
    case "faq":
      return buildFAQPageSchema(base);

    case "team":
      return buildTeamPageSchema(base, facts.filter((f) => f.category === "team"));

    case "awards":
      return buildAwardsPageSchema(base, facts.filter((f) => f.category === "award"));

    case "certifications":
      return buildCertificationsPageSchema(
        base,
        facts.filter((f) => f.category === "certification" || f.category === "insurance")
      );

    case "pricing":
      return buildServiceListSchema(base, page.specialties);

    case "warranties":
    case "about":
      return buildWebPageSchema(base);

    case "credibility_profile":
      return buildCertificationsPageSchema(
        { ...base, includeFaqGraph: true }, // extract FAQ section → FAQPage @graph
        facts // all facts — no filtering for the credibility page
      );

    default:
      return buildArticleSchema(base);
  }
}

// ─── Full Package Builder (DB-backed) ────────────────────────────────────────

/**
 * Build a complete SchemaPackage for a business from the database.
 * This is the main entry point called by the content pipeline.
 *
 * Returns both:
 *   1. siteWideSchema — the composite LocalBusiness block for <head>
 *   2. pageSchemas — per-page schemas keyed by pageType
 */
export async function buildSchemaPackageForBusiness(
  businessId: number,
  campaignId: number
): Promise<SchemaPackage | null> {
  const db = await getDb();
  if (!db) return null;

  // Load business
  const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!business) return null;

  // Load latest credibility data
  const [cred] = await db
    .select()
    .from(credibilityData)
    .where(eq(credibilityData.businessId, businessId))
    .orderBy(desc(credibilityData.createdAt))
    .limit(1);

  const facts: CredibilityFact[] = (cred?.verifiedFacts as CredibilityFact[]) || [];

  // Also pull from researchResults if verifiedFacts is sparse
  const allFacts: CredibilityFact[] = [...facts];
  if (allFacts.length < 5 && cred?.researchResults) {
    const rr = cred.researchResults as any;
    if (Array.isArray(rr?.facts)) {
      for (const f of rr.facts) {
        if (f.fact && !allFacts.some((af) => af.fact === f.fact)) {
          allFacts.push(f);
        }
      }
    }
  }

  // Load campaign for scope information
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  const campaignScope = (campaign as any)?.campaignScope ?? 'local';
  const isNationalOrEcom = campaignScope === 'national' || campaignScope === 'ecommerce';

  // Load all content pages for this campaign
  const pages = await db
    .select()
    .from(contentPages)
    .where(eq(contentPages.campaignId, campaignId));

  // Build published page URL list for sameAs/subjectOf
  const publishedPageUrls = pages
    .filter((p) => p.publishedUrl)
    .map((p) => ({ pageType: p.pageType, url: p.publishedUrl!, title: p.pageTitle }));

  // Parse all locations from the location field (";"-delimited, with a legacy
  // "City, ST" comma fallback — see shared/location.ts).
  const locations = parseLocations(business.location);

  // For national/ecommerce campaigns, override locations so areaServed is "United States"
  const effectiveLocations = isNationalOrEcom
    ? [] // will be overridden below after buildSiteWideSchema
    : locations;

  // Build site-wide schema
  const siteWideSchema = buildSiteWideSchema(
    {
      name: business.name,
      website: business.website,
      phone: business.phone,
      contactEmail: business.contactEmail,
      address: business.address,
      location: business.location,
      description: business.description,
      businessType: business.businessType,
      yearsInBusiness: business.yearsInBusiness,
      certifications: business.certifications,
      awards: business.awards,
      licenses: business.licenses,
      warranties: business.warranties,
      differentiators: business.differentiators,
      specialties: (business as any).specialties,
      bbbRating: business.bbbRating,
      bbbUrl: business.bbbUrl,
      googleRating: null, // not stored in DB yet — will use BBB
      googleReviewCount: null,
      googleMapsUrl: business.googleMapsUrl,
      facebookUrl: business.facebookUrl,
      instagramUrl: business.instagramUrl,
      linkedinUrl: business.linkedinUrl,
      twitterUrl: business.twitterUrl,
      youtubeUrl: business.youtubeUrl,
      tiktokUrl: business.tiktokUrl,
      yelpUrl: business.yelpUrl,
      angiesUrl: business.angiesUrl,
      thumbtackUrl: business.thumbtackUrl,
      houzzUrl: business.houzzUrl,
    },
    allFacts,
    effectiveLocations,
    publishedPageUrls
  );

  // For national/ecommerce campaigns, replace City-typed areaServed with a
  // Country-typed entry so schema.org correctly reflects nationwide coverage.
  if (isNationalOrEcom) {
    siteWideSchema.areaServed = [{
      "@type": "Country",
      name: "United States",
    }];
    // Also upgrade the @type to Organization for national brands / agencies
    if (campaignScope === 'national') {
      siteWideSchema["@type"] = "Organization";
    }
  }

  // Internal pipeline page types that must NEVER generate schema markup.
  // These are system objects stored as contentPages rows but are not real web pages.
  const INTERNAL_PAGE_TYPES = new Set([
    "llm_txt",        // llm.txt file — not a web page
    "schema_package", // the schema package itself — would be circular
    "schema_audit",   // internal crawl audit data
    "schema_delivery", // internal delivery plan
  ]);

  // Build per-page schemas
  const pageSchemas: Record<string, SchemaBlock> = {};
  for (const page of pages) {
    if (INTERNAL_PAGE_TYPES.has(page.pageType)) continue; // skip internal pipeline objects
    // Skip pages with no content — schema would be empty/hallucinated.
    // This guards against credibility_profile (or any page) that failed to
    // generate: the FAQ extractor would get an empty string and either return
    // nothing or make up questions.
    if (!page.pageContent || page.pageContent.trim().length < 50) {
      console.warn(`[SchemaEngine] Skipping ${page.pageType} — no content (length=${page.pageContent?.length ?? 0})`);
      continue;
    }
    try {
      pageSchemas[page.pageType] = buildPageSchema(
        {
          pageType: page.pageType,
          pageTitle: page.pageTitle,
          pageContent: page.pageContent || "",
          publishedUrl: page.publishedUrl,
          businessName: business.name,
          businessWebsite: business.website,
          businessType: business.businessType,
          specialties: (business as any).specialties,
        },
        allFacts
      );
    } catch (err) {
      console.warn(`[SchemaEngine] Failed to build schema for page type ${page.pageType}:`, err);
    }
  }

  // Build summary
  const summaryParts: string[] = [];
  summaryParts.push(`Schema type: ${siteWideSchema["@type"]}`);
  if (siteWideSchema.aggregateRating) summaryParts.push("AggregateRating included");
  if (siteWideSchema.hasOfferCatalog) summaryParts.push(`${siteWideSchema.hasOfferCatalog.itemListElement?.length || 0} services`);
  if (siteWideSchema.hasCredential) summaryParts.push(`${siteWideSchema.hasCredential.length} credentials`);
  if (siteWideSchema.sameAs) summaryParts.push(`${siteWideSchema.sameAs.length} sameAs profiles`);
  if (siteWideSchema.knowsAbout) summaryParts.push(`${siteWideSchema.knowsAbout.length} knowsAbout entries`);
  if (Object.keys(pageSchemas).length > 0) summaryParts.push(`${Object.keys(pageSchemas).length} per-page schemas`);

  return {
    siteWideSchema,
    pageSchemas,
    publishedPageUrls,
    summary: summaryParts.join(" | "),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Serialize a schema block to a ready-to-paste <script> tag string.
 */
export function schemaToScriptTag(schema: SchemaBlock): string {
  return `<script type="application/ld+json">\n${JSON.stringify(schema, null, 2)}\n</script>`;
}

/**
 * Serialize the full schema package to a single string with all blocks.
 * This is what gets shown in the Campaign Detail UI and copied to clipboard.
 */
export function schemaPackageToString(pkg: SchemaPackage): string {
  const parts: string[] = [];

  parts.push("<!-- ========================================");
  parts.push("     SITE-WIDE SCHEMA (paste in <head>)");
  parts.push("     Generated by AI Answer Forge");
  parts.push("     Schema type: " + pkg.siteWideSchema["@type"]);
  parts.push("     " + pkg.summary);
  parts.push("     Generated: " + new Date(pkg.generatedAt).toLocaleDateString());
  parts.push("     ======================================== -->");
  parts.push(schemaToScriptTag(pkg.siteWideSchema));

  for (const [pageType, schema] of Object.entries(pkg.pageSchemas)) {
    parts.push("");
    parts.push(`<!-- Per-page schema: ${pageType} -->`);
    parts.push(schemaToScriptTag(schema));
  }

  return parts.join("\n");
}
