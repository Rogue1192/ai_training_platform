import { describe, expect, it } from "vitest";
import {
  buildServiceSeeds,
  expandToBuyerIntentQueries,
  seedStemVocab,
  isRelevantKeyword,
} from "./dataforseoService";

// Titan Cleaning Company's real specialties prose (mixed service list + marketing copy).
const TITAN_SPECIALTIES =
  "Deep cleaning, move-in/move-out cleaning, and post-construction cleanup for homes and businesses, " +
  "plus recurring residential house cleaning, commercial/office janitorial service, and carpet cleaning " +
  "across Cullman County and the western half of Morgan County, AL (20-25 mile radius of Cullman). " +
  "Uses professional-grade products that are tough on dirt yet safe for kids, pets, and people with allergies.";

describe("keyword seeding — buildServiceSeeds", () => {
  it("derives on-topic cleaning seeds from businessType + specialties", () => {
    const seeds = buildServiceSeeds("Cleaning Services", TITAN_SPECIALTIES);
    // businessType is always the floor
    expect(seeds).toContain("cleaning services");
    // service fragments that share vocabulary with the businessType survive
    expect(seeds).toContain("deep cleaning");
    expect(seeds).toContain("carpet cleaning");
    // every seed is cleaning-related
    expect(seeds.every((s) => /clean|janitorial/.test(s))).toBe(true);
  });

  it("drops geography and marketing filler, never emits generic junk", () => {
    const seeds = buildServiceSeeds("Cleaning Services", TITAN_SPECIALTIES);
    const joined = seeds.join(" | ");
    expect(joined).not.toContain("cullman county");
    expect(joined).not.toContain("homes");
    expect(joined).not.toContain("businesses");
    expect(joined).not.toContain("products");
    expect(joined).not.toContain("allergies");
  });

  it("caps seed count and returns [] when there is no signal", () => {
    expect(buildServiceSeeds(null, null)).toEqual([]);
    expect(buildServiceSeeds("", "")).toEqual([]);
    expect(buildServiceSeeds("Cleaning Services", TITAN_SPECIALTIES).length).toBeLessThanOrEqual(8);
  });

  it("still produces a relevant floor from businessType alone (sparse specialties)", () => {
    const seeds = buildServiceSeeds("HVAC", null);
    expect(seeds).toContain("hvac");
  });
});

describe("keyword seeding — expandToBuyerIntentQueries", () => {
  it("expands seeds into deduped buyer-intent queries", () => {
    const queries = expandToBuyerIntentQueries(["cleaning services", "carpet cleaning"], 5);
    expect(queries).toContain("cleaning services near me");
    expect(queries).toContain("best carpet cleaning");
    // no duplicates
    expect(new Set(queries).size).toBe(queries.length);
    // pool is bounded
    expect(queries.length).toBeLessThanOrEqual(Math.max(5 * 3, 15));
  });

  it("returns [] for no seeds", () => {
    expect(expandToBuyerIntentQueries([], 5)).toEqual([]);
  });
});

describe("keyword seeding — relevance filter", () => {
  const vocab = seedStemVocab(buildServiceSeeds("Cleaning Services", TITAN_SPECIALTIES));

  it("rejects generic high-volume queries unrelated to the business", () => {
    expect(isRelevantKeyword("banks near me", vocab)).toBe(false);
    expect(isRelevantKeyword("bars near me", vocab)).toBe(false);
    expect(isRelevantKeyword("gym near me", vocab)).toBe(false);
    expect(isRelevantKeyword("storage in near me", vocab)).toBe(false);
  });

  it("accepts on-topic cleaning queries", () => {
    expect(isRelevantKeyword("house cleaning near me", vocab)).toBe(true);
    expect(isRelevantKeyword("deep cleaning service", vocab)).toBe(true);
    expect(isRelevantKeyword("carpet cleaners", vocab)).toBe(true);
  });

  it("does not filter when there is no vocabulary (backward-compatible)", () => {
    const empty = seedStemVocab([]);
    expect(isRelevantKeyword("banks near me", empty)).toBe(true);
  });
});

describe("keyword seeding — cross-vertical specialties (service head-words)", () => {
  it("keeps plumbing services whose vocabulary differs from the businessType", () => {
    const seeds = buildServiceSeeds(
      "Plumbing",
      "drain cleaning, pipe repair, water heater installation, water damage restoration"
    );
    expect(seeds).toContain("plumbing");
    expect(seeds).toContain("drain cleaning");
    expect(seeds).toContain("pipe repair");
    expect(seeds).toContain("water heater installation");
  });

  it("keeps HVAC specialty services", () => {
    const seeds = buildServiceSeeds("HVAC", "ac repair, furnace installation, duct cleaning");
    expect(seeds).toContain("pipe repair".replace("pipe", "ac")); // "ac repair"
    expect(seeds).toContain("furnace installation");
    expect(seeds).toContain("duct cleaning");
  });
});

describe("keyword seeding — no false stem collisions", () => {
  it("does not treat 'serving' as relevant to a 'server' business", () => {
    const vocab = seedStemVocab(buildServiceSeeds("server hosting", null));
    // Regression: a blunt 4-char stem made 'serving' collide with 'server'.
    expect(isRelevantKeyword("serving food near me", vocab)).toBe(false);
  });

  it("still matches plural/singular of a real seed word", () => {
    const vocab = seedStemVocab(buildServiceSeeds("Cleaning Services", "carpet cleaning"));
    expect(isRelevantKeyword("carpet cleaners near me", vocab)).toBe(true); // via "carpet"
  });
});
