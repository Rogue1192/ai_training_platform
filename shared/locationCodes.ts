/**
 * DataForSEO location codes for US states.
 * Used to get state-level search volume for small cities that don't have
 * their own DMA/metro code in DataForSEO.
 *
 * Source: https://api.dataforseo.com/v3/keywords_data/google_ads/locations
 * US national = 2840
 */
export const US_STATE_LOCATION_CODES: Record<string, number> = {
  AL: 21167, // Alabama
  AK: 21132, // Alaska
  AZ: 21136, // Arizona
  AR: 21168, // Arkansas
  CA: 21137, // California
  CO: 21138, // Colorado
  CT: 21142, // Connecticut
  DE: 21143, // Delaware
  FL: 21139, // Florida
  GA: 21144, // Georgia
  HI: 21145, // Hawaii
  ID: 21146, // Idaho
  IL: 21147, // Illinois
  IN: 21148, // Indiana
  IA: 21149, // Iowa
  KS: 21150, // Kansas
  KY: 21169, // Kentucky
  LA: 21170, // Louisiana
  ME: 21151, // Maine
  MD: 21152, // Maryland
  MA: 21153, // Massachusetts
  MI: 21154, // Michigan
  MN: 21155, // Minnesota
  MS: 21171, // Mississippi
  MO: 21156, // Missouri
  MT: 21157, // Montana
  NE: 21158, // Nebraska
  NV: 21159, // Nevada
  NH: 21160, // New Hampshire
  NJ: 21161, // New Jersey
  NM: 21162, // New Mexico
  NY: 21163, // New York
  NC: 21172, // North Carolina
  ND: 21164, // North Dakota
  OH: 21165, // Ohio
  OK: 21173, // Oklahoma
  OR: 21166, // Oregon
  PA: 21174, // Pennsylvania
  RI: 21175, // Rhode Island
  SC: 21176, // South Carolina
  SD: 21177, // South Dakota
  TN: 21178, // Tennessee
  TX: 21179, // Texas
  UT: 21180, // Utah
  VT: 21181, // Vermont
  VA: 21182, // Virginia
  WA: 21183, // Washington
  WV: 21184, // West Virginia
  WI: 21185, // Wisconsin
  WY: 21186, // Wyoming
  DC: 21141, // Washington D.C.
};

/**
 * Resolve a DataForSEO location code from a location string like "Cullman, AL"
 * or "Birmingham, Alabama".
 *
 * Returns the state-level code if found, otherwise US national (2840).
 */
export function resolveLocationCode(location: string): number {
  if (!location) return 2840;

  // Try 2-letter state abbreviation at end: "Cullman, AL" or "Cullman AL"
  const abbrMatch = location.trim().match(/,?\s+([A-Z]{2})$/);
  if (abbrMatch) {
    const code = US_STATE_LOCATION_CODES[abbrMatch[1].toUpperCase()];
    if (code) return code;
  }

  // Try full state name anywhere in string
  const lower = location.toLowerCase();
  const stateNames: Record<string, string> = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR",
    california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
    florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
    illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
    kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
    massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
    missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM",
    "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
    tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
    virginia: "VA", washington: "WA", "west virginia": "WV",
    wisconsin: "WI", wyoming: "WY",
  };
  for (const [name, abbr] of Object.entries(stateNames)) {
    if (lower.includes(name)) {
      const code = US_STATE_LOCATION_CODES[abbr];
      if (code) return code;
    }
  }

  return 2840; // US national fallback
}
