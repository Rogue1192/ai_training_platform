# GBP CTR Module — Build Spec

## Overview
A CloakBrowser-based CTR simulation module that strengthens Google Business Profile rankings by engineering realistic search and engagement behavior. Built as a self-contained module within the AI training platform, sharing the V7 account pool, proxy infrastructure, and browser worker.

---

## Infrastructure (Shared with V7)
- **CloakBrowser** — antidetect browser with C++ source-level fingerprint spoofing. Passes reCAPTCHA v3 at 0.9 (human-level). NOT headless — undetectable by Google.
- **Residential proxies** — geo-matched to business location (city/state). BrightData pay-as-you-go.
- **Mobile device emulation** — iPhone 14, Pixel 7, Samsung Galaxy S23 profiles rotated. Majority of local searches are mobile.
- **Account pool** — shared with V7 account manager. Google accounts with real search history (warmed 5–7 days before CTR sessions).

---

## Business Type Flag
Campaign setup asks: **"Does this business have a physical address customers visit?"**
- **Yes (storefront)** → Full signal stack including driving directions simulation
- **No (SAB — Service Area Business)** → SAB signal stack only (no directions)

---

## Signal Stack

### Storefront Businesses
1. Driving directions simulation (strongest signal)
2. Click to call
3. Website visit with engagement
4. GBP click + dwell

### SAB Businesses
1. Click to call (strongest available)
2. Website visit with engagement
3. GBP click + dwell
*(No directions — Google knows SABs don't receive customer visits; simulating directions would look anomalous)*

---

## Session Types & Mix Ratios

### ~40% — Brand Search Sessions
- Search business name → view GBP → directions (storefront) OR call (SAB) → website visit
- Purpose: brand awareness signal, entity reinforcement

### ~40% — Keyword Search with Pogo Stick
- Search keyword → view map pack → **click competitor listing** → short dwell (8–15 sec) → back to results → click client GBP → longer dwell → directions/call/website
- Purpose: competitive displacement (degrades competitor CTR quality score) + client lift (positive engagement signal)
- Vary which competitor is pogged across sessions

### ~20% — Keyword Search Direct to Client
- Search keyword → view map pack → click client GBP → full engagement session
- Purpose: direct keyword-to-client association

---

## Driving Directions Simulation (Storefront Only)
- Generate realistic origin point within service area (vary across city — not always same start)
- Plot real road route using actual street network to business address
- Simulate GPS movement via `navigator.geolocation` spoofing in CloakBrowser:
  - Residential streets: 20–30 mph
  - Arterials: 35–45 mph
  - Natural variance: acceleration, deceleration, brief stops at intersections
  - Vary trip duration naturally based on distance
- "Arrive" at destination and end session

---

## Website Visit Behavior
- Entry page varies: homepage, service page, about page (not always homepage)
- Natural scroll speed — not instant
- Pause on sections (simulate reading time proportional to word count)
- Click to second page in ~30% of sessions (service → contact, service → about)
- Session duration: 45 sec minimum, 2–3 min for engaged sessions
- Mix of short and long sessions — no two sessions identical duration

---

## Session Variation Rules (Anti-Pattern Detection)
- No two sessions identical: vary entry page, dwell time, scroll depth, action taken
- Vary competitor pogged in pogo sessions
- Vary origin point for directions sessions
- Vary device profile per session
- Vary time of day (weight toward business hours, some evening)
- Vary session duration with natural distribution (not uniform)

---

## Search Console Integration
- OAuth connection to client's Google Search Console account
- Pull query-level CTR baseline: impressions, clicks, CTR per keyword per week
- **Ramp calculator**: current clicks × 1.03–1.07 = target for next week
- Self-regulating: stays inside normal variance band to avoid anomaly detection
- **Cold-start logic**: for new GBPs with near-zero baseline, start at 5–10 clicks/week absolute and build before ramp logic activates
- Dashboard shows: current baseline, this week's target, ramp rate, projected 90-day trajectory

---

## Onboarding Data (Captured at Campaign Setup)
Most of this is already collected in the standard onboarding flow:
- Business name
- Business address (or SAB flag)
- Service area cities/states
- Primary keywords
- Competitor GBP names/URLs (for pogo sessions)
- Google Search Console OAuth connection
- Business phone number (for call simulation validation)
- Website URL

---

## Competitor Weakening Logic
- Pogo stick sessions from competitor listings signal to Google: "user visited this listing and left unsatisfied"
- Over time at volume: competitor CTR quality score degrades, ranking weakens
- Prioritize pogging the top 2–3 competitors in the map pack for the primary keywords
- Never pogo the same competitor 100% of the time — rotate naturally

---

## What We're Improving Over Existing Tools
- Existing tools use **headless browsers** — detectable by Google
- We use **CloakBrowser** — real Chromium binary with C++ fingerprint spoofing, undetectable
- Existing tools typically lack driving directions simulation
- We add **GPS movement simulation** for storefront businesses
- Existing tools typically lack Search Console integration for safe ramp management
- We add **self-regulating ramp calculator** tied to real baseline data
- Heavy **mobile device emulation** — matches real search behavior distribution

---

## Module Boundary
Lives in `/server/gbpCTR/` — self-contained, never bleeds into AI training logic. Shares:
- `v7AccountManager` — account pool and rotation
- `v7BrowserWorker` — CloakBrowser session launcher
- `v7Proxies` table — proxy pool

---

## Status
- [ ] Review existing CTR software (login pending)
- [ ] Build campaign setup wizard (leverages existing onboarding data)
- [ ] Build session workers (brand search, keyword+pogo, directions)
- [ ] Build Search Console OAuth integration and ramp calculator
- [ ] Build CTR dashboard (baseline, targets, trajectory, session logs)
- [ ] Wire into shared V7 account/proxy infrastructure
