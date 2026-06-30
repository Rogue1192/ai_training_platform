// ─── Target Location parsing / serialization ─────────────────────────────────
//
// `businesses.location` is a single varchar that can hold MULTIPLE target
// locations. Historically these were joined with "," — but each location is
// itself "City, ST", so a comma also appears *inside* a single location. That
// collision made "Cullman, AL" parse as two locations ["Cullman", "AL"].
//
// Fix: locations are now separated by ";" (which never appears inside a
// "City, ST"). To stay correct for un-migrated rows, the parser falls back to
// pairing City + 2-letter-state tokens when no ";" is present.

const STATE_CODE = /^[A-Za-z]{2}$/;

// Full US state / territory names (lowercased) so "Riverside, California" is
// recognized as ONE location, not split into ["Riverside", "California"].
const STATE_NAMES = new Set(
  [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
    "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
    "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
    "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
    "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
    "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
    "Washington", "West Virginia", "Wisconsin", "Wyoming",
    "District of Columbia", "Puerto Rico",
  ].map((s) => s.toLowerCase())
);

/** True if a comma-delimited token is a US state (2-letter code or full name). */
function isStateToken(token: string): boolean {
  return STATE_CODE.test(token) || STATE_NAMES.has(token.toLowerCase());
}

/**
 * Parse a stored `businesses.location` string into individual "City, ST"
 * locations.
 *
 * - New format: ";"-delimited (e.g. "Cullman, AL; Decatur, AL").
 * - Legacy format: ","-delimited everything. We rebuild locations by attaching
 *   a trailing 2-letter state token to its preceding city token, so
 *   "Cullman, AL, Decatur, AL" → ["Cullman, AL", "Decatur, AL"] and a single
 *   "Cullman, AL" → ["Cullman, AL"].
 */
export function parseLocations(raw?: string | null): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // New, unambiguous format.
  if (trimmed.includes(";")) {
    return trimmed
      .split(";")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  // Legacy comma format — pair "City" + "ST" tokens back together.
  const tokens = trimmed
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const next = tokens[i + 1];
    if (next !== undefined && isStateToken(next)) {
      // 2-letter codes are normalized to uppercase; full names kept as written.
      const state = STATE_CODE.test(next) ? next.toUpperCase() : next;
      out.push(`${tokens[i]}, ${state}`);
      i++; // consumed the state token
    } else {
      out.push(tokens[i]);
    }
  }
  return out;
}

/**
 * Serialize individual target locations back into the stored string. Uses ";"
 * so a "City, ST" location is never re-split on its internal comma.
 */
export function serializeLocations(locations: Array<string | null | undefined>): string {
  return locations
    .map((l) => (l ?? "").trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * The primary (first) target location — used by single-location schema fields
 * such as PostalAddress city/region.
 */
export function primaryLocation(raw?: string | null): string {
  return parseLocations(raw)[0] ?? "";
}
