/**
 * Agency Package Tier Configuration
 *
 * White-label pricing tiers charged to agencies per client per month.
 * Agencies provide their own OpenAI and Gemini API keys to absorb training query costs.
 * Platform absorbs: Anthropic (content), MiniMax (trainer), DataForSEO, Playwright.
 *
 * Stripe prices updated 2026-04-06:
 *   Starter  $99/mo  → price_1TJQNbCtHfUq3SHJrproNUkD
 *   Growth  $149/mo  → price_1TJQNgCtHfUq3SHJn8clZJ3o
 *   Pro     $179/mo  → price_1TJQNnCtHfUq3SHJOeYlcVHG
 *
 * Each "keyword" generates up to 8 commercial/transactional AI query variations.
 * Example: keyword "fence installation" →
 *   "best fence installation company in Dallas",
 *   "top rated fence contractor near me", etc.
 */

export interface AgencyPackage {
  slug: string;
  name: string;
  maxQueries: number;           // number of keyword topics
  maxLocations: number;         // number of target locations
  variationsPerKeyword: number; // up to 8 (commercial/transactional only)
  monthlyPrice: number;         // USD — what you charge the agency
  suggestedRetailLow: number;
  suggestedRetailHigh: number;
  stripeProductId: string;
  stripePriceId: string;        // recurring monthly price
  description: string;
}

export const AGENCY_PACKAGES: AgencyPackage[] = [
  {
    slug: "starter",
    name: "Starter",
    maxQueries: 5,
    maxLocations: 3,
    variationsPerKeyword: 8,
    monthlyPrice: 99,
    suggestedRetailLow: 197,
    suggestedRetailHigh: 297,
    stripeProductId: "prod_UHzHvtGJerqC96",
    stripePriceId: "price_1TJQNbCtHfUq3SHJrproNUkD",
    description:
      "5 keyword topics × 3 locations. Each keyword generates up to 8 commercial/transactional " +
      "AI query variations. Total: up to 120 training sessions per month.",
  },
  {
    slug: "growth",
    name: "Growth",
    maxQueries: 5,
    maxLocations: 5,
    variationsPerKeyword: 8,
    monthlyPrice: 149,
    suggestedRetailLow: 297,
    suggestedRetailHigh: 397,
    stripeProductId: "prod_UHzHIjjVlQ2Ztg",
    stripePriceId: "price_1TJQNgCtHfUq3SHJn8clZJ3o",
    description:
      "5 keyword topics × 5 locations. Each keyword generates up to 8 commercial/transactional " +
      "AI query variations. Total: up to 200 training sessions per month.",
  },
  {
    slug: "pro",
    name: "Pro",
    maxQueries: 10,
    maxLocations: 5,
    variationsPerKeyword: 8,
    monthlyPrice: 179,
    suggestedRetailLow: 397,
    suggestedRetailHigh: 497,
    stripeProductId: "prod_UHzHXq8GJRXGq6",
    stripePriceId: "price_1TJQNnCtHfUq3SHJOeYlcVHG",
    description:
      "10 keyword topics × 5 locations. Each keyword generates up to 8 commercial/transactional " +
      "AI query variations. Total: up to 400 training sessions per month.",
  },
];

export const AGENCY_SETUP_FEE = {
  amount: 397,
  stripeProductId: "prod_UHzIKMYHdPenaR",
  stripePriceId: "price_1TJPJYCtHfUq3SHJGJn6iqvh",
  paymentLinkUrl: "https://buy.stripe.com/dRm4gy1ZYfZKdNl6QY3F600",
  paymentLinkId: "plink_1TJPJdCtHfUq3SHJu4qk1thb",
};

export function getPackageBySlug(slug: string): AgencyPackage | undefined {
  return AGENCY_PACKAGES.find((p) => p.slug === slug);
}
