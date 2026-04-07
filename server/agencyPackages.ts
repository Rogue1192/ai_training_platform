/**
 * Agency Package Tier Configuration
 * 
 * These are the white-label pricing tiers charged to agencies per client per month.
 * Stripe products and prices were created in live mode on 2026-04-06.
 * 
 * Each "keyword" generates 8 AI query variations.
 * Example: keyword "AC repair" → "best AC repair in Dallas", "top rated AC repair in Dallas", etc.
 */

export interface AgencyPackage {
  slug: string;
  name: string;
  maxQueries: number;       // number of keyword topics
  maxLocations: number;     // number of target locations
  variationsPerKeyword: number; // always 8
  monthlyPrice: number;     // in dollars (what you charge the agency)
  suggestedRetailLow: number;
  suggestedRetailHigh: number;
  stripeProductId: string;
  stripePriceId: string;    // recurring monthly price
  description: string;
}

export const AGENCY_PACKAGES: AgencyPackage[] = [
  {
    slug: "starter",
    name: "Starter",
    maxQueries: 5,
    maxLocations: 3,
    variationsPerKeyword: 8,
    monthlyPrice: 179,
    suggestedRetailLow: 297,
    suggestedRetailHigh: 347,
    stripeProductId: "prod_UHzHvtGJerqC96",
    stripePriceId: "price_1TJPImCtHfUq3SHJDZtEZCPQ",
    description:
      "5 keyword topics × 3 locations. Each keyword generates 8 AI query variations " +
      "(e.g., 'best AC repair in Dallas', 'top rated AC repair in Dallas'). " +
      "Total: 120 training sessions per month.",
  },
  {
    slug: "growth",
    name: "Growth",
    maxQueries: 5,
    maxLocations: 5,
    variationsPerKeyword: 8,
    monthlyPrice: 249,
    suggestedRetailLow: 497,
    suggestedRetailHigh: 497,
    stripeProductId: "prod_UHzHIjjVlQ2Ztg",
    stripePriceId: "price_1TJPIzCtHfUq3SHJwArk7mDI",
    description:
      "5 keyword topics × 5 locations. Each keyword generates 8 AI query variations. " +
      "Total: 200 training sessions per month.",
  },
  {
    slug: "pro",
    name: "Pro",
    maxQueries: 10,
    maxLocations: 5,
    variationsPerKeyword: 8,
    monthlyPrice: 399,
    suggestedRetailLow: 797,
    suggestedRetailHigh: 797,
    stripeProductId: "prod_UHzHXq8GJRXGq6",
    stripePriceId: "price_1TJPJHCtHfUq3SHJwsv8l8Mf",
    description:
      "10 keyword topics × 5 locations. Each keyword generates 8 AI query variations. " +
      "Total: 400 training sessions per month.",
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
