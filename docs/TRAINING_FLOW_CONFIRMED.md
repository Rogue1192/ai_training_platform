# Confirmed Training Flow — Pinned Reference

**Last confirmed:** July 14, 2026

---

## Query Setup (one-time, before training begins)

1. DataForSEO pulls high-volume commercial/transactional intent phrases for the business type + location.
2. Admin reviews and locks in the base queries (15 for Starter tier).
3. AI generates 3 natural-language variations of each base query (same intent, different phrasing).
4. All variations are stored permanently — never regenerated.
5. Total training sessions per cycle: 15 phrases × 3 variations = **45 sessions** (Starter).

---

## Session Structure (per query variation)

Each session is a **multi-turn back-and-forth** between MiniMax (acting as a human user) and the target AI:

| Turn | Sender | Content |
|---|---|---|
| 1 — user | System | Initial query — the keyword variation stated naturally (no business name, no suggestive framing) |
| 1 — assistant | Target AI | Responds — may or may not mention the business |
| 2 — user | MiniMax | Suggestive reply — uses a template (natural context introduction, conversational mention, online discovery, local knowledge, or specific inquiry) to introduce the business naturally, contextually responding to what the target AI just said |
| 2 — assistant | Target AI | Responds |
| 3–21 — user | MiniMax | Credibility injection turns — MiniMax responds naturally to the target AI's last message while weaving in specific credibility facts (certifications, awards, anecdotal friend experiences, reviews, etc.). Each turn uses a different fact or angle. Contextual and natural — never robotic or list-like. **Up to 20 turns total.** |
| 3–21 — assistant | Target AI | Responds each turn |
| Final — user | System | **Clean probe** — pure keyword query, no business name, no suggestive framing |
| Final — assistant | Target AI | If business mentioned unprompted = **session win** |

**MiniMax trainer system prompt:** Instructed to act as a human user, respond contextually to the target AI's last message, weave in credibility facts naturally, use anecdotal framing (friends, personal experiences, things read online), and never be robotic or list facts directly.

**Turn limit:** 20 turns — fixed regardless of package tier. Results are the goal, not cost-cutting.

---

## Graduation Logic (within a session)

- A **session win** = target AI mentions the business on the clean probe at the end of the session.
- A **graduated phrase** = 2 consecutive session wins for the same base keyword phrase (across any 2 of its 3 variations).
- A graduated phrase is **flagged** during training but not removed until the end-of-day web search confirms it.

---

## Phase 1: Onboarding Sprint (Days 1–4)

- All 45 sessions run each day for 4 consecutive days.
- **End of each day:** Live web search (MiniMax web_search model) is run for every base keyword phrase (15 searches/day). This is a real-time search, not DataForSEO cached data.
- **Web search result logic:**
  - If the business appears in results for a phrase → phrase is **confirmed graduated** → removed from training rotation for the next day.
  - If a phrase was flagged as graduated during training but does NOT appear in the live web search → phrase goes **back into training rotation** for the next day.
- After Day 4, the final web search results establish the **post-sprint baseline**: which phrases are confirmed in results and which are not.

---

## Phase 2: Ongoing Maintenance (Weekly Cycle, post-sprint)

**Every 7 days:**

1. **Re-query web search:** Live web search run for all 15 base keyword phrases.
2. **Identify dropouts:** Any phrase that was previously confirmed in results but is no longer appearing, plus any phrase that never graduated during the sprint.
3. **One-day training run:** Only the dropout/non-graduated phrases are trained. Same session structure (up to 20 turns), same clean probe at end.
4. **End-of-day web search:** Live web search run for all phrases that were trained that day.
5. Results are tracked and ranked. 7 days pass. Repeat.

---

## Web Search Volume Per Month

| Period | Days | Searches/day | Total searches |
|---|---|---|---|
| Onboarding sprint | 4 | 15 (all phrases) | 60 |
| Weekly re-queries (3 remaining in month) | 3 | 15 (all phrases) | 45 |
| **Monthly total** | — | — | **105 web searches** |

At MiniMax web_search $0.01/request: **$1.05/month per campaign** for rank tracking.

---

## Training Volume Per Month (Post-Onboarding)

After the 4-day sprint, only dropout/non-graduated phrases are retrained once per week. Assuming ~30% dropout rate on average (conservative):

- 15 phrases × 30% = ~5 phrases need retraining per weekly cycle
- 5 phrases × 3 variations = ~15 sessions per weekly training day
- 3 weekly training days per month = ~45 sessions/month ongoing
- This is the **same volume as one sprint day** — significantly less than the 4-day onboarding sprint (180 sessions).

---

## Cost Summary (see separate cost calculation document)

- Onboarding sprint is the highest-cost period.
- Ongoing monthly cost drops significantly once phrases graduate and stay in results.
- Web search for rank tracking: $1.05/month (105 searches × $0.01).
- DataForSEO is NOT used for rank tracking — live web search only.
