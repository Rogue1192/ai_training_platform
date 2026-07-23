# PROTECTED FILES — READ BEFORE TOUCHING

This document exists because several files have had the same bugs reintroduced multiple times
through large refactor commits that silently overwrote previous fixes.

**THE RULE:** Before making any significant edit to a file listed here, re-read it from disk
first — no exceptions. Do not write from memory or a stale mental model.

If something comes back that was already fixed, check `git log -- <file>` immediately and
revert to the last known-good commit rather than re-patching from scratch.

---

## 1. `server/prospectAuditEngine.ts`

**Recurring issue:** Query generation prompt keeps regressing to robotic, formal, urgency-heavy
queries that don't sound like real American English.

**What must never change:**
- HVAC/heating/cooling/furnace/boiler must NOT be in the `EMERGENCY_SERVICES` list.
  They belong in `MIXED_EMERGENCY_SERVICES` (at most 2 emergency queries, rest are normal).
- The system prompt must open with natural-language framing ("real Americans typing on their phone")
  and include explicit Good/Bad examples showing robotic patterns as Bad.
- Rule 7: Do NOT start every query with "Who does" or "Looking for" — vary openings.
- Rule 8: Every query must include a specific service name — never bare "repair" or "replacement".
- The urgency filter (`URGENCY_WORDS` regex) must remain active in the output parser.

**Last known-good commit:** `959ad8e` (Jul 23 2026)
**Regressed from:** `b14a8c0` (large audit refactor that rewrote the whole file and reintroduced old prompt)

---

## 2. `server/contentGenerationEngine.ts`

**Recurring issue:** `credibility_profile` (Why Choose Us) page fails to generate because
the Anthropic call is capped at too few tokens, truncating the JSON response.

**What must never change:**
- `credibility_profile` page type must use `maxTokens: 8192` (not the default 4096).
- `generateSinglePage` must use robust JSON extraction (strip code fences, find first `{...}` block)
  with auto-retry on parse failure.
- `regenerateContentPage` must use the same 8192 token limit and robust parser.

**Last known-good commit:** `b00d79a` (Jul 22 2026)

---

## 3. `server/rankTrackingEngine.ts` + `server/routers.ts` (client dashboard)

**Recurring issue:** New mentions and bonus queries hidden from the client report because
they were gated behind `sprintCompletedAt` being non-null.

**What must never change:**
- Wins (new mentions) must show whenever `recentWins.length > 0`, regardless of sprint status.
- Bonus queries must show whenever `bonusQueryResults.length > 0`, regardless of sprint status.
- Do NOT re-add `isBaselineOnly` gating to these two sections.

**Last known-good commit:** `37ad7c7` (Jul 22 2026)

---

## 4. `server/schemaMarkupEngine.ts`

**Recurring issue:** FAQPage schema generates `"mainEntity": []` (empty) because the extractor
only looked for `<h3>...<p>` adjacent patterns, missing the `itemprop="name"` / `itemprop="text"`
microdata pattern used by the FAQ content generator.

**What must never change:**
- `buildFAQPageSchema` must extract Q&A from BOTH patterns:
  1. `<h3>question</h3><p>answer</p>` (simple adjacent)
  2. `itemprop="name"` / `itemprop="acceptedAnswer"` / `itemprop="text"` microdata

**Last known-good commit:** `edd6877` (Jul 22 2026)

---

## 5. `server/credibilityResearchEngine.ts`

**Recurring issue:** Credibility research fails with truncated JSON responses.

**What must never change:**
- Anthropic calls in this engine must use `maxTokens: 8192`.
- Robust JSON extraction with auto-retry must be present.

**Last known-good commit:** `c62d75f` (Jul 22 2026)

---

## 6. `client/src/pages/ClientDashboard.tsx`

**Recurring issue:** Report display regressions — sections disappearing, wrong gating logic.

**What must never change:**
- Wins section: show when `recentWins.length > 0` (not gated on sprint completion).
- Bonus queries section: show when `bonusQueryResults.length > 0` (not gated on sprint completion).
- Query details table: must show `chatgptChange` / mention change indicators.

**Last known-good commit:** `37ad7c7` (Jul 22 2026)

---

## 7. `server/pipelineOrchestrator.ts`

**Recurring issue:** Pipeline steps silently fail to set completion timestamps, leaving campaigns
stuck in intermediate states (e.g. stuck at `publishing` because `publishingCompletedAt` never set).

**What must never change:**
- Every pipeline step must set its `*CompletedAt` timestamp on success.
- The `publishing` step must not be considered complete until all content page URLs are saved
  AND `publishingCompletedAt` is set.
- Do NOT remove the `enforceTrainingGate` check — but it must not bounce campaigns back to
  `publishing` if llm.txt/schema are already verified.

---

## 8. `server/smartScheduler.ts` / `server/scheduler.ts`

**Recurring issue:** Training scheduler skips campaigns silently due to gate checks.

**What must never change:**
- `trainingHeld = true` must prevent training (correct).
- `trainingHeld = false` must allow training to run (do not add extra gates here).
- Weekly maintenance runs must NOT re-check llm.txt/schema (gate is for initial training only).

**Last known-good commit:** `6117955`

---

## HOW TO USE THIS DOCUMENT

When a bug comes back that was already fixed:
1. Run `git log --oneline -- server/<filename>.ts | head -20`
2. Find the last known-good commit hash from this document
3. Run `git show <hash>:server/<filename>.ts > /tmp/good_version.ts` to inspect it
4. Either revert the file or cherry-pick the specific fix forward

When making a large refactor of any file listed here:
1. Re-read the current file from disk first
2. Check this document for what must not change
3. After the refactor, grep for the protected patterns to confirm they survived

---

*Last updated: Jul 23 2026*
