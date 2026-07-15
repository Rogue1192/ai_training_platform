# PINNED — Phase 2: Rank Tracking + Visibility Report Upgrade

## Context
After query generation is working correctly, this is the next major phase.
Based on Gemini AI Mode research and the blueprint from the home services LLM visibility tool.

---

## What Needs to Change

### 1. `checkLLMVisibilityDirect` in `dataforseoService.ts`
Currently returns: `{ mentioned: boolean, snippet: string }`

Needs to return:
- `mentioned: boolean` — does the text contain the business name? (keep)
- `citedUrl: boolean` — did the LLM cite the client's website URL as a source? (NEW)
  - Both ChatGPT (Responses API) and Gemini (grounding) return source URLs — we currently ignore this data
- `recommendationRank: number | null` — if the LLM lists multiple businesses, what position is the client? (NEW)
  - Parse numbered/bulleted lists in the response, find where the client appears
  - e.g. "1. Parris Fence... 2. Innovative Fence Solutions..." → rank 2
- `sentiment: "positive" | "neutral" | "negative" | null` — (NEW)
  - GPT-4o-mini classification call on the sentence(s) containing the brand name
  - "Highly recommended for..." → positive
  - "One option is..." → neutral
  - "Some users report..." → negative

### 2. Database Schema Migration
The `prospectAuditResults` table (and training day run results) needs new columns:
- `cited_url` BOOLEAN
- `recommendation_rank` INT NULL
- `sentiment` ENUM('positive', 'neutral', 'negative') NULL

### 3. Report UI Updates (`PublicAuditReport.tsx` + internal audit view)
- Replace binary mentioned/not-mentioned with richer display:
  - Rank badge: #1, #2, #3... or "Mentioned" (no rank) or "Not Found"
  - Sentiment chip: green/yellow/red
  - Citation indicator: link icon if URL was cited
- Share of Voice summary at the top:
  - "Mentioned in X of Y queries"
  - "Average recommendation rank: #2.3"
  - "Positive sentiment: X%, Neutral: Y%, Negative: Z%"

### 4. Training Layer Integration
- Rank and sentiment feed into training objectives:
  - If mentioned but ranked #4 → training goal is to move to #1-2
  - If mentioned with neutral sentiment → training goal is positive sentiment
  - If not mentioned → training goal is first mention

---

## Query Intent Buckets (from Gemini AI Mode research)
The fan-out prompt should generate across three buckets:
- **Transactional/Emergency (~7 queries):** "Who is the fastest emergency [service] in [city]...?"
- **Commercial/Comparison (~7 queries):** "Compare [service] companies in [city]..." / "What are the most honest..."
- **Reputation/Trust (~6 queries):** "Does [business name] in [city] have good reviews?" / "Is [business name] worth hiring?"

Formula: [Urgency Trigger] + [Service] + [Geo-Modifier] + [Constraint]

---

## Do NOT start this phase until query generation is confirmed working correctly.
