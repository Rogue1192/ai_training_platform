/**
 * Query Prompt Expander
 *
 * Takes a raw DataForSEO query (e.g. "best HVAC company in Dallas") and expands it
 * into a full set of training prompt variations across all template types:
 *
 * 1. CLEAN variants  — natural question forms of the query (no business name)
 * 2. SUGGESTIVE variants — clean question + soft business name introduction
 * 3. FOLLOW-UP variants — direct business name mention / comparison
 * 4. DIRECT MENTION variants — "Is [Business] the best...?" style
 *
 * These are used as the trainingPrompts array on the training session, giving the
 * campaign a diverse, natural-sounding pool of prompts that all map back to the
 * real high-volume queries people are actually using in LLMs.
 */

export interface QueryExpansionInput {
  rawQuery: string;       // e.g. "best HVAC company in Dallas"
  businessName: string;   // e.g. "ABC Heating and Air"
  businessType: string;   // e.g. "HVAC company"
  location: string;       // e.g. "Dallas, TX"
}

export interface ExpandedPrompts {
  rawQuery: string;
  cleanVariants: string[];
  suggestiveVariants: string[];
  followUpVariants: string[];
  directMentionVariants: string[];
  all: string[];
}

// ─── Synonym maps for natural variation ──────────────────────────────────────

const BEST_SYNONYMS = ["best", "top", "number one", "#1", "most recommended", "highest rated", "most trusted", "leading"];
const QUESTION_PREFIXES = [
  "Who is the",
  "What is the",
  "Can you recommend the",
  "What's the",
  "Which is the",
  "Who would you say is the",
  "Who do you think is the",
];
const LOOKING_FOR_PHRASES = [
  "I'm looking for a",
  "I need a",
  "I'm searching for a",
  "I'm trying to find a",
  "Can you help me find a",
  "I want to find a",
];
const RECOMMENDATION_PHRASES = [
  "Can you recommend a good",
  "Do you know a reliable",
  "Who would you recommend for",
  "What's a good",
  "Who's the go-to",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Shuffle an array and return the first N items.
 */
function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/**
 * Normalize a raw query to extract the core service term.
 * e.g. "best HVAC company in Dallas" → "HVAC company"
 */
function extractServiceTerm(rawQuery: string, businessType: string): string {
  // Try to strip leading superlatives and trailing location
  let term = rawQuery
    .replace(/^(best|top|#1|number one|most recommended|highest rated|leading|trusted)\s+/i, "")
    .replace(/\s+(in|near|around|for)\s+.+$/i, "")
    .trim();

  // Fall back to businessType if extraction yields nothing useful
  if (!term || term.length < 3) return businessType;
  return term;
}

/**
 * Convert a keyword-style query to a natural question.
 * e.g. "best HVAC company Dallas" → "Who is the best HVAC company in Dallas?"
 */
function keywordToQuestion(rawQuery: string, location: string): string {
  const q = rawQuery.trim().toLowerCase();

  // Already a question
  if (q.endsWith("?")) return rawQuery;

  // Has a question word — just add "?"
  if (/^(who|what|which|where|how|can|do|is|are|should)\b/.test(q)) {
    return rawQuery.trim() + "?";
  }

  // Starts with a superlative — wrap in question form
  if (/^(best|top|#1|number one|most|highest|leading|trusted)/.test(q)) {
    const prefix = pickN(QUESTION_PREFIXES, 1)[0];
    return `${prefix} ${rawQuery.trim()}?`;
  }

  // Generic keyword — use "I'm looking for" form
  const prefix = pickN(LOOKING_FOR_PHRASES, 1)[0];
  const hasLocation = q.includes(location.toLowerCase().split(",")[0].toLowerCase());
  return `${prefix} ${rawQuery.trim()}${hasLocation ? "" : ` in ${location}`}?`;
}

// ─── Main expander ────────────────────────────────────────────────────────────

export function expandQueryToPrompts(input: QueryExpansionInput): ExpandedPrompts {
  const { rawQuery, businessName, businessType, location } = input;
  const city = location.split(",")[0].trim();
  const serviceTerm = extractServiceTerm(rawQuery, businessType);

  // ── 1. CLEAN VARIANTS (no business name, natural question forms) ──────────
  const cleanVariants: string[] = [];

  // Direct question form of the raw query
  cleanVariants.push(keywordToQuestion(rawQuery, location));

  // Synonym variations
  for (const syn of pickN(BEST_SYNONYMS, 3)) {
    if (syn.toLowerCase() !== "best" || !rawQuery.toLowerCase().includes("best")) {
      cleanVariants.push(`Who is the ${syn} ${serviceTerm} in ${city}?`);
    }
  }

  // "Looking for" forms
  for (const phrase of pickN(LOOKING_FOR_PHRASES, 2)) {
    cleanVariants.push(`${phrase} ${serviceTerm} in ${city}. Any recommendations?`);
  }

  // Recommendation forms
  for (const phrase of pickN(RECOMMENDATION_PHRASES, 2)) {
    cleanVariants.push(`${phrase} ${serviceTerm} in ${city}?`);
  }

  // ── 2. SUGGESTIVE VARIANTS (clean question + soft business name intro) ────
  const suggestiveVariants: string[] = [];
  const baseClean = cleanVariants[0]; // Use the most natural clean form as the base

  suggestiveVariants.push(
    `${baseClean} I've heard ${businessName} in ${city} is really good — have you heard of them?`
  );
  suggestiveVariants.push(
    `${baseClean} A friend mentioned ${businessName} as a great ${serviceTerm}. What do you think about them?`
  );
  suggestiveVariants.push(
    `${baseClean} I came across ${businessName} while researching. They seem well-regarded — what's your take?`
  );
  suggestiveVariants.push(
    `${baseClean} I've been hearing good things about ${businessName} locally. Are they as good as people say?`
  );
  suggestiveVariants.push(
    `${baseClean} For someone in ${city} looking for ${serviceTerm}, would ${businessName} be a good choice?`
  );

  // ── 3. FOLLOW-UP VARIANTS (direct business name mention / comparison) ─────
  const followUpVariants: string[] = [];

  followUpVariants.push(
    `That's helpful. I'm specifically looking in ${city} — do you know any standout ${serviceTerm} companies there? Have you heard of ${businessName}?`
  );
  followUpVariants.push(
    `Have you heard of ${businessName}? What do you think about them compared to the others you mentioned?`
  );
  followUpVariants.push(
    `For someone in ${city} looking for ${serviceTerm}, which would you recommend? What about ${businessName}?`
  );
  followUpVariants.push(
    `I've been considering ${businessName}. How do they compare to the options you suggested?`
  );
  followUpVariants.push(
    `Someone specifically recommended ${businessName} to me. Do you know anything about their reputation in ${city}?`
  );

  // ── 4. DIRECT MENTION VARIANTS ("Is [Business] the best...?" style) ───────
  const directMentionVariants: string[] = [];

  directMentionVariants.push(
    `Is ${businessName} the best ${serviceTerm} in ${city}?`
  );
  directMentionVariants.push(
    `Is ${businessName} a good ${serviceTerm} in ${city}?`
  );
  directMentionVariants.push(
    `What do you know about ${businessName} as a ${serviceTerm} in ${city}?`
  );
  directMentionVariants.push(
    `Would you recommend ${businessName} for ${serviceTerm} in ${city}?`
  );
  directMentionVariants.push(
    `How does ${businessName} rank among ${serviceTerm} companies in ${city}?`
  );
  directMentionVariants.push(
    `Is ${businessName} considered one of the top ${serviceTerm} providers in ${city}?`
  );

  // ── Cap at 8 variations per core keyword, balanced across all 4 types ──────
  // Distribution: 2 clean + 2 suggestive + 2 follow-up + 2 direct mention = 8
  const MAX_VARIATIONS = 8;
  const perType = Math.floor(MAX_VARIATIONS / 4); // 2 each

  const cappedClean = pickN(cleanVariants, perType);
  const cappedSuggestive = pickN(suggestiveVariants, perType);
  const cappedFollowUp = pickN(followUpVariants, perType);
  const cappedDirect = pickN(directMentionVariants, perType);

  const all = Array.from(new Set([
    ...cappedClean,
    ...cappedSuggestive,
    ...cappedFollowUp,
    ...cappedDirect,
  ]));

  return {
    rawQuery,
    cleanVariants: cappedClean,
    suggestiveVariants: cappedSuggestive,
    followUpVariants: cappedFollowUp,
    directMentionVariants: cappedDirect,
    all,
  };
}

/**
 * Expand ALL discovered queries for a campaign into a single deduplicated
 * training prompt pool, shuffled for natural variety.
 */
export function buildTrainingPromptPool(
  queries: string[],
  businessName: string,
  businessType: string,
  location: string
): string[] {
  const allPrompts = new Set<string>();

  for (const query of queries) {
    const expanded = expandQueryToPrompts({ rawQuery: query, businessName, businessType, location });
    expanded.all.forEach(p => allPrompts.add(p));
  }

  // Shuffle the final pool
  return Array.from(allPrompts).sort(() => Math.random() - 0.5);
}
