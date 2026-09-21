# CTR Removal and Browser Runtime Migration Plan

**Prepared:** September 21, 2026
**Repository:** `Rogue1192/ai_training_platform`
**Audited revision:** `4538062` on `main`
**Implementation status:** **CTR executable code was removed locally on September 21, 2026. No database records, migrations, production deployment, or account/browser session was changed.** The Camofox evaluation remains an isolated proof of concept, not a cutover.

## Completed scope and remaining decisions

The owner has abandoned the CTR module and wants it removed while retaining the browser-account capabilities necessary for AI Answerforge. The correct implementation is a two-part change:

1. Remove CTR pages, routes, workers, scheduler hooks, and related application code.
2. Extract the remaining AI browser-account and manual-login capabilities from the CTR-named settings implementation into a standalone browser-profile feature.

**Do not delete any database tables or stored credentials in the first code-removal change.** The current AI profile tables have foreign-key references to `ctr_credentials`; dropping CTR tables immediately could destroy saved browser account or proxy records. A separate, explicitly approved data-cleanup migration should happen only after a backup and a live-schema review.

The owner also asked whether `jo-inc/camofox-browser` can replace CloakBrowser. It can be evaluated as a separate browser runtime, but it is **not a drop-in package replacement** for the current worker. Camofox is a standalone Camoufox/Firefox service with REST operations, persistent storage-state profiles, and an optional noVNC plugin. The existing code directly imports CloakBrowser and calls its Playwright-like `launchPersistentContext()` API. A production replacement therefore requires a browser-runtime adapter and a staged compatibility test. [1] [2]

## Current-state findings

### CTR code to remove

The CTR subsystem is isolated enough to remove without changing the core AI Answerforge campaign, content, indexing, audit, or standard API-provider flows. The affected source is listed below.

| Area | Current files / locations | Required action |
|---|---|---|
| CTR API | `server/ctrRouter.ts`; registrations in `server/_core/index.ts` and `server/routers.ts` | Remove router imports and `ctr` registration. Delete the CTR router file after callers are removed. |
| CTR execution | `server/ctrSessionWorker.ts`; CTR functions and timers in `server/scheduler.ts` | Remove the worker, `dispatchPendingCtrSessions`, `planDriveSessions`, and both startup intervals. |
| CTR startup DDL | `ensureCtrDriveRampColumns()` in `server/db.ts`; invocation in `server/_core/index.ts` | Remove the function and startup invocation. It is CTR-only ad-hoc schema work. |
| CTR UI | `client/src/pages/ctr/*`; `client/src/components/ctr/NewCtrCampaignModal.tsx`; `client/src/lib/ctrGeo.ts` | Delete pages/components/helpers after app routes are removed. |
| CTR navigation | `client/src/App.tsx`; `client/src/components/ModuleSwitcher.tsx` | Remove `/ctr` routes, CTR navigation data, unused Lucide imports, and the CTR module-switcher entry. |
| Historical CTR source docs | `docs/gbp-ctr-module-spec.md` | Remove or move outside the runtime repository only if the owner wants no historical CTR material retained. |
| Historical CTR migrations | `drizzle/0028_ctr_module.sql`, `0029_ctr_radius_targeting.sql`, `0030_ctr_settings.sql` | Do **not** delete during the first code change. Migration history must remain intact until the live database has been inventoried and credential/profile tables have been safely migrated. |

The current scheduler is especially important to remove. It attempts to start CTR work during application startup and at recurring intervals. Its current raw SQL does not match the committed CTR migration schema, so removing it is both a scope-cleanup change and a runtime-stability improvement.

### AI browser/profile code to retain and repair

The browser-account functionality needed by AI Answerforge is split across three different implementations. It should be consolidated rather than copied.

| Component | Current reality | Required outcome |
|---|---|---|
| V7 account pool | `v7Accounts`, `v7Proxies`, `v7SessionLogs` in `drizzle/schema.ts`; CRUD in `server/v7AccountRouter.ts`; UI in `client/src/pages/V7Accounts.tsx` | Retain. This is the account and proxy inventory actually used by `trainingWorkerV7.ts`. |
| V7 persistent browser state | `server/v7BrowserWorker.ts` derives a profile directory as `account_<v7Account.id>` | Retain the account-to-profile relationship, but put the profile storage path behind a browser-runtime adapter. |
| CTR settings page | `client/src/pages/ctr/CtrSettings.tsx` and `server/ctrSettingsRouter.ts` manage `cloak_config`, `ctr_credentials`, `ai_browser_profiles`, and a noVNC UI | Do **not** keep this CTR-named UI or router. Extract only the AI browser settings, credentials, and manual-login capability into a new protected feature. |

Two flaws must be corrected as part of this extraction:

1. `ai_browser_profiles` is not used by `V7BrowserWorker`; V7 derives state from its own `v7Accounts` ID. The current “AI Training Profile” UI does not actually configure the profile that V7 opens.
2. The noVNC launcher currently opens `profile_<profileId>`, while V7 uses `account_<accountId>`. Consequently, the user-facing manual login session does not reliably open the same persistent state that V7 later uses.

The retained browser-account feature should use **one account ID, one browser profile identity, one persistent storage location, and one manual-login entry point**. The manual-login mutation should accept a validated `v7Account.id`, enforce authentication/authorization, open the matching profile, and never expose browser, proxy, password, or noVNC secrets in logs or API responses.

## Camofox assessment

Camofox Browser is an MIT-licensed Node.js service built around Camoufox, a Firefox fork. Its current public documentation describes a REST/OpenAPI server, per-user session isolation, persistence of cookies and local storage, proxy support, structured logs, traces, screenshots, and a noVNC plugin for manual login. Its source includes a Railway Docker deployment path and a VNC plugin that attaches `x11vnc` and `websockify` to the Camoufox display. [1] [2] [3]

### What Camofox can provide for AI Answerforge

For a user-owned account profile, Camofox has the components AI Answerforge needs to evaluate:

- persistent session state keyed by a stable user/profile identifier;
- a documented manual noVNC login flow with post-login persistence;
- server-side REST endpoints, access-key protection, structured logs, screenshots, and optional tracing;
- a Docker/Railway deployment path; and
- browser runtime isolation from the main AI Answerforge web application.

### What it cannot replace automatically

Camofox is not a transparent substitute for the current `cloakbrowser` import. `server/v7BrowserWorker.ts` currently expects a direct Playwright-style `page` object and calls `goto`, `waitForSelector`, element selection, `fill`, `press`, and page evaluation. Camofox instead exposes its browser behavior through a REST service built around sessions, tabs, snapshots, element references, and actions. The provider uses Firefox/Camoufox rather than Chromium, so existing browser/UI behavior must be tested before any runtime cutover.

Existing CloakBrowser/Chromium profile directories also cannot be copied into Camofox as equivalent browser profiles. Camofox persists Playwright storage state, principally cookies and local storage by default. A controlled manual login must establish the Camofox profile state for each authorized account.

Camofox’s noVNC documentation explicitly warns that VNC traffic is not encrypted by default. The Camofox noVNC port must remain internal. If adopted, AI Answerforge should expose manual login through an authenticated same-origin reverse proxy or a short-lived signed path; it must not publish a raw VNC/noVNC port to the internet. [3]

### Local proof-of-concept outcome — September 21, 2026

An isolated local installation of `@askjo/camofox-browser` 1.16.0 completed, including the bundled Camoufox 152.0.4 beta.30 binary and GeoIP data. No AI Answerforge account, proxy, stored credential, or production service was used. The process loaded the persistence plugin and began creating its Xvfb display, but the bundled Camoufox binary terminated with a native segmentation fault before it bound the local service port. Installing the only missing host dependency identified from the project’s Dockerfile (`libdbus-glib-1-2`) did not change the result.

This does **not** prove that Camofox will fail in its intended Docker/Railway image. The source project supplies a container image with a controlled Debian dependency set, while this sandbox does not provide Docker. It does mean that a Camofox cutover must not proceed on the basis of documentation alone. The next POC must use the exact container image and target hosting environment, test the service health endpoint before attaching an account, and retain CloakBrowser as the fallback until the Camofox acceptance test passes.

The installed dependency audit also reported one high-severity transitive `adm-zip` advisory. Its dependency path and remediation status must be reviewed before any production deployment.

## Browser-runtime options

| Option | Result | Advantages | Tradeoffs |
|---|---|---|---|
| **A. Remove CTR; retain CloakBrowser for V7 now** | CTR disappears. Existing V7 browser worker remains temporarily. Browser settings/noVNC are extracted and repaired. | Smallest safe code change; preserves the current runtime contract while eliminating CTR. | Continues CloakBrowser license/runtime dependency until a later decision. |
| **B. Remove CTR; run a separate Camofox proof of concept, then cut over** | CTR disappears. Camofox runs as an internal service with one non-production AI account. CloakBrowser remains available until the POC passes. | Low-risk way to validate Camofox persistence, manual login, API integration, and Railway deployment before moving account profiles. | Requires a new Docker/Railway service, persistent volume, runtime adapter, and an approved test account. |
| **C. Replace CloakBrowser with Camofox in the same change** | CTR disappears and V7 immediately changes browser runtime. | Removes CloakBrowser fastest. | **Not recommended.** It combines destructive code removal, profile migration, a new browser engine, a new service, and manual login changes with no rollback-tested path. |

**Recommendation:** Approve **Option A** first. It removes the abandoned CTR feature while preserving current AI Answerforge behavior. Then approve **Option B** as a separate, reversible Camofox proof of concept. Only remove CloakBrowser after Camofox passes its acceptance test and the owner approves the cutover.

## Proposed implementation phases

### Phase 1 — Remove CTR application code, preserve data — **completed locally**

**Implemented changes.** Removed CTR routes, navigation, UI pages, component, geographic helper, CTR routers, session worker, scheduler dispatcher/planner, and CTR startup DDL. Removed obsolete noVNC proxy infrastructure and its Nix dependencies. Updated V7 account copy to remove CTR references. The historical raw SQL migration files and all database tables remain untouched.

**Runtime impact.** `/ctr` and its module switcher entry disappear. CTR scheduling and any CTR browser worker invocation stop. Existing V7 browser account and training code remains present. No external browser session should start as part of this change.

**Validation.** Run `pnpm check`, `pnpm build`, targeted route/API import checks, and a repository scan that finds no executable CTR imports or scheduled CTR functions. Verify the V7 Accounts screen still compiles and the core app routes load. This phase does not claim that noVNC or CloakBrowser works; those remain separately unverified.

**Rollback.** One Git commit. Reverting it restores the complete CTR code path without database changes.

### Phase 2 — Retain and secure the V7 account/proxy controls — **partially completed locally**

**Implemented changes.** Retired the unused CTR Settings router and UI rather than carrying its dead `ai_browser_profiles` model forward. The existing V7 Accounts page is now the retained account/proxy control surface. All V7 account, proxy, and session-log procedures now require administrator authorization. The V7 browser worker now decrypts V7 proxy connection strings with the application’s AES-GCM utility before passing them to the browser runtime.

**Deferred work.** A browser-profile UI and manual-login entry point are intentionally deferred to Phase 3. This avoids shipping a second profile model or a noVNC path before the runtime is validated.

**Runtime impact.** AI Answerforge retains one clear V7 account/proxy management surface. The previous noVNC/manual-login path is removed rather than left mismatched and publicly reachable. No CTR terms remain visible in the UI. Credentials and proxies remain redacted.

**Validation completed.** The V7 list query selects only non-secret account/proxy metadata. An AES-GCM proxy-encryption round-trip smoke test passed with a local validation key. An unauthenticated caller was blocked before it could reach V7 account data. The browser-profile identity and manual-login persistence tests remain Phase 3 work.

**Rollback.** One Git commit after Phase 1. Data remains in place; UI/router changes can be reverted.

### Phase 3 — Repair manual account login for the retained runtime

**Files changed.** Replace the arbitrary `profileId` noVNC launch API with an authorized `v7AccountId` path. Launch the same profile directory used by the V7 browser worker. Move noVNC proxy access behind authorization and avoid publishing raw display-port details to the client.

**Runtime impact.** The owner can manually complete 2FA for an authorized account in a browser profile that the V7 browser worker subsequently reuses.

**Validation.** With an owner-approved non-production account only: open a manual session, confirm the expected account profile is visible, close/reopen it, and confirm the storage state persists. Capture sanitized health/log evidence. Do not run any broader browser automation as part of this test.

**Rollback.** One Git commit. Existing profile directories are not deleted.

### Phase 4 — Camofox proof of concept in an isolated service

**Deployment shape.** Deploy Camofox as a separate, internal Railway service using its Docker deployment path. Give it a persistent volume for Camofox profile state and protect it with access keys. The main AI Answerforge service should reach it through an internal URL; the public app remains the only owner-facing interface.

**Required service configuration.** Use a persistent profile directory, a server access key, a separate sensitive-operation key, disabled telemetry unless the owner deliberately enables it, and internal-only noVNC. The exact key names, values, and Railway service topology must be reviewed before deployment. Do not place browser storage-state files, passwords, proxies, or API keys in Git.

**Adapter boundary.** Create a `BrowserRuntime` interface with a narrow contract for session lifecycle, navigation, input, result extraction, screenshots, and shutdown. Keep runtime-specific calls inside `CloakBrowserRuntime` and `CamofoxRuntime` implementations. Do not scatter Camofox REST calls throughout training code.

**Validation.** Use one owner-approved non-production V7 account. Verify service health, authenticated main-app-to-Camofox calls, manual noVNC login, profile persistence after restart, a screenshot/trace retrieval test, and a clean shutdown. Test the existing approved AI Answerforge browser workflow only after those foundations work and the owner separately approves it.

**Rollback.** Keep `CloakBrowserRuntime` selected by a server-side runtime configuration until Camofox passes. Disable the Camofox service or change the selected runtime to roll back; do not delete its profile volume until explicitly approved.

### Phase 5 — Browser-runtime cutover and legacy data cleanup

This phase requires a separate approval after Camofox has passed Phase 4. It removes the `cloakbrowser` package, CloakBrowser-specific configuration, and any remaining Xvfb/noVNC code that is superseded by the Camofox service. Only then should the team decide whether to migrate `ctr_credentials` to a neutral table name and, after verified backup and retention decision, drop CTR-only tables.

## Database cleanup decision

There are two possible database scopes. The owner must choose explicitly before any migration runs.

| Scope | What happens | Data-risk level |
|---|---|---|
| **Preserve first (recommended)** | Remove executable CTR code and UI. Leave historical `ctr_*` tables and migration files untouched. Extract/repoint AI profile settings later. | Low; no records are deleted. |
| **Full database purge** | Back up, migrate/retain the AI credentials and profile data needed by V7, then drop every CTR-only table and index. | High; destructive and requires a live-schema inventory plus a tested backup/restore plan. |

The saved proxy credential may exist in CTR-named storage. It must not be deleted or exposed accidentally. It should be retained only through a secure migration that proves its decryptability under the final AES-GCM credential model.

## Remaining approval boundaries

The completed removal has no database or deployment side effects. Two later changes remain deliberately separated from it.

1. **Phase 3** creates a replacement manual browser-profile login feature. It must be tested with an owner-approved account and a confirmed profile-persistence workflow.
2. **Phase 4** deploys a separate Camofox service. It must use the vendor’s Docker image, an internal network route, a persistent volume, access keys, no public noVNC port, and a dependency-advisory review before any account is connected.

Dropping the retained CTR-named database tables remains a destructive, separate database approval after a backup and live-schema review.

## References

[1]: https://github.com/jo-inc/camofox-browser "jo-inc/camofox-browser repository and README"
[2]: https://raw.githubusercontent.com/jo-inc/camofox-browser/master/openapi.json "Camofox Browser OpenAPI specification"
[3]: https://github.com/jo-inc/camofox-browser/tree/master/plugins/vnc "Camofox Browser VNC plugin documentation and source"
