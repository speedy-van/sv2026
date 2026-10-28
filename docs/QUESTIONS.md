# QUESTIONS — things Codex needs the owner to decide

Codex adds a question here instead of guessing about money, prices, legal text, business facts or security, then carries on with unblocked work. The owner answers inline; Codex applies the answer and marks it resolved.

## Template

```
### Q<number> — <short title>   (Phase <N>, <date>)
**Blocking:** yes/no — what is blocked
**Context:** what Codex found and why it matters
**Options:** A) … B) … (with Codex's recommendation and why)
**Owner answer:**
**Resolved:** <date, commit>
```

## Open

### Q8 — Production activation after the new-account preview   (Deployment, 2026-10-15)
**Blocking:** no for the owner's explicitly requested production deployment on the existing Hobby account; yes for claiming verified real-money checkout, native Push and all scheduled operations.
**Context:** The new Vercel team `speedy-van` is on Hobby, while seven configured jobs include every-minute processing. The supplied Neon connection matches the current development database. Read-only queue review found 59 events with reserved test-address evidence, 15 orphaned notifications and one failure alert (73 PENDING, two stale PROCESSING); no events were processed, deleted or marked delivered. Current Stripe keys are test keys. Pricing approval remains false in the stored active configuration; live payment/email/push and business readiness remain unverified. The full-workspace cloud install reports 78 dependency audit findings (18 moderate, 60 high); these include development/mobile dependencies and need scope/advisory review before production, rather than an automatic force update.
**Options:** Before production, choose a plan/scheduler supporting the specified jobs, preserve and explicitly quarantine verified obsolete events, review the failure alert, securely configure live providers and validate the existing launch requirements. Do not bypass the launch checker or claim test payments are real payments.
**Owner answer:** Initially publish a preview and complete production later, using the current database after queue review. Subsequently explicitly instructed production now via `vercel --prod` on the signed-in Vercel Hobby team, without activating Pro, moving hosting or changing billing.
**Resolved:** Deployment authorization updated 2026-10-15. Preserve historical queue records and scope new-event processing. The owner subsequently supplied a matched Live Stripe pair and explicitly requested adding it to Vercel and deploying immediately. Production has that matched pair plus a dedicated signed webhook on the canonical domain; preview/local test keys remain separate. Configuration and deployment are not evidence of a successful real-money transaction, Apple Push, legal/pricing approval or complete business readiness. Those acceptance items remain open and must not be fabricated.

### Q7 — Native admin booking notification acceptance   (Owner sound, 2026-10-15)
**Blocking:** no for repaired build `54` startup, which the owner confirms now works on the physical iPhone; yes for claiming complete physical sign-in/session/lock/deep-link acceptance, the subsequent five-issue repair acceptance, or actual foreground/background/closed-app notification delivery.
**Context:** Existing App Store Connect app `6812268357`, bundle `co.uk.speedy-van.admin`, uses the linked EAS project and production API `https://www.speedyvan.uk`. Build `53` failed root launch before D74's explicit-index repair; the owner confirms audited embedded [build `54`](https://appstoreconnect.apple.com/apps/6812268357/testflight/ios/2600799d-43ca-4ca1-a0fd-9fcfdbe3676f) now works on the physical iPhone. D75 repairs five later reports: visitor count, historical checkout deletion, keyboard coverage, navigation speed and chat refresh. Full admin verification passes 443 tests / 38 suites with lint/types; API-client tests 24, database-test guard tests five, targeted web tests 210 / nine suites and the 317-page local build pass. Final production deployment `dpl_3x31mDGveLt8gw1euxmboD27p92u` is READY and authenticated presence (all five final requests 200, 0 → 1 → 0), pictured-job deletion and incremental customer/admin chat acceptance pass. Task-owned smoke fixtures were reviewed/removed; this is not owner-phone acceptance. Final compatible runtime `1.0.0` OTA group `0f2cfc2f-93fc-4643-a3a0-46a5300fe56d` / iOS update `01a141c1-b21a-7dbc-b0ab-f90cb79cf06b` is published; independent protocol/CDN/compiled-feature verification passes with exact 10,060,400-byte agreement (`.tmp/admin-five-issues-final-ota-audit/report.json`). Provider delivery checks are complete. Physical five-issue update activation/acceptance, required backend Push configuration and foreground/background/closed-app notification delivery remain unverified. No new testers, groups or invitations were changed.
**Options:** Activate the verified D75 OTA on the physical iPhone, then check consent-aware visitor updates, Deleted jobs visibility, keyboard-visible Send reply, navigation latency and customer-message arrival. Separately verify sign-in/session restoration/lock/deep links and required backend Expo Push configuration before one authorized notification check with the app open, backgrounded and closed. Keep credentials out of chat and repository documentation; no public App Store release is automatic.
**Owner answer:** Dedicated EAS project creation and the iOS build are authorized; Apple sign-in completed. Continue using the existing app's private TestFlight route, with the current project logo and production API. After build `54`, the owner reports: “Perfect it’s works perfectly”; startup is accepted. The five later defects are separately requested for repair.
**Resolved:** D74 delivery and owner-confirmed physical startup, plus D75 production/provider delivery verification, are complete. Q7 stays open for D75 physical update activation/device acceptance, complete physical session/lock/deep-link checks, backend Push configuration and notification acceptance. Automated/static checks do not establish those remaining phone outcomes. No public App Store release occurred.

### Q6 — Verified booking email sender   (Email configuration, 2026-10-15)
**Blocking:** yes — sending booking confirmation emails; local API-key setup and template checks can proceed.
**Context:** TODO(owner): provide the verified sender address to use for `EMAIL_FROM`. The owner supplied a Resend API key, but neither the web app nor repository local environment file contains an email sender. The existing server integration requires both the key and `EMAIL_FROM`; a contact address alone does not establish permission to send from its domain.
**Options:** A) Provide the sender address verified in the intended Resend account (recommended). B) Complete sender/domain verification in Resend first, then provide the address. No messages or queued email jobs will be sent by this setup task.
**Owner answer:**
**Resolved:**

### Q5 — Owner evidence and field data for local SEO   (SEO quality, 2026-10-15)
**Blocking:** no for code and data-derived planning improvements; yes for publishing first-hand local claims, proving field Core Web Vitals, or expanding staged town indexing on that basis.
**Context:** TODO(owner): provide approved local moving notes, actual completed-job case studies and original photos with permission to publish. The committed road graph and official council resources support practical route/access guidance but do not establish local depots, completed moves, reviews or first-hand experience. Search Console, Google Business Profile performance and production mobile field measurements are not available in this task. The existing tier-3 publication policy must remain independent of generated planning text.
**Options:** A) Supply approved evidence through the existing Admin content workflow and share Search Console/field reports for review (recommended). B) Keep the 162 tier-3 locations staged and omit unverified experience claims while gathering that evidence.
**Owner answer:**
**Resolved:**

### Q4 — D1 hero reference still absent locally   (Repair D1, 2026-10-13)
**Blocking:** yes — D1 implementation cannot start because the required reference files are not available to inspect, run in a browser, or port.
**Context:** After finishing and fast-forward merging R1 into `main`, I created `repair/D1-landing-design` from `main` and checked for `docs/design/hero-reference/`. It is still absent in this worktree. A recursive search under `c:\speedy van` did not find a `hero-reference` directory, and `git fetch origin --prune` did not expose `docs/design/hero-reference/` on `origin/main`.
**Options:** A) Add `docs/design/hero-reference/` to this branch with `README.md`, `index.html`, `screenshots/`, `data/scotland-map.json` and `scripts/`, then tell Codex to resume D1. B) Provide the branch/commit/archive path that contains those exact files so Codex can restore them. Recommendation: A, because D1 requires exact visual matching and the source reference should live in the repository.
**Owner answer:**
**Resolved:**

## Resolved

### Q3 — Missing D1 hero reference files   (Repair D1, 2026-10-13)
**Blocking:** resolved by owner — D1 landing hero/header/map implementation can resume once the D1 branch is created and the reference files are present there.
**Context:** The D1 repair prompt requires `docs/design/hero-reference/` with `README.md`, `index.html`, `screenshots/`, `data/scotland-map.json` and `scripts/`, and says to match it exactly. That directory was absent when first checked.
**Options:** A) Add the complete `docs/design/hero-reference/` directory to this branch and tell Codex to resume D1. B) Point Codex at the branch/commit/archive that contains the reference so the exact files can be restored. Recommendation was A.
**Owner answer:** Owner says `docs/design/hero-reference/` is now in the project and instructed Codex to resume D1.
**Resolved:** 2026-10-13, D1 branch verification pending.

### Q2 — Missing Mapbox token for R1 geocoding   (Repair R1, 2026-10-13)
**Blocking:** resolved — real Mapbox geocoding and Mapbox Directions regeneration completed.
**Context:** The owner said `MAPBOX_SECRET_TOKEN` is in `.env.local`, but the local `.env.local` initially contained only the `DATABASE_URL` key, and the process environment did not contain `MAPBOX_SECRET_TOKEN`. I checked key names only and did not print any secret value. AGENTS R18 forbids substituting fallback data or fake services in a production data path.
**Options:** A) Add `MAPBOX_SECRET_TOKEN` to `c:\speedy van\speedyvan\.env.local` and rerun R1 geocoding/directions. B) Export `MAPBOX_SECRET_TOKEN` into the Codex process environment and rerun. Recommendation was A.
**Owner answer:** Owner added the token to `.env.local`.
**Resolved:** 2026-10-13, resolved by R1 data regeneration; commit pending.

### Q1 — Missing local Phase 4 env vars   (Phase 4, 2026-10-12)
**Blocking:** resolved for Phase 4 verification — local migration can derive the Neon direct hostname from the pooled Neon hostname and apply migrations through Neon HTTP; CI passes `DATABASE_URL_UNPOOLED`, `SEED_OWNER_EMAIL`, and `SEED_OWNER_NAME` explicitly.
**Context:** The `.env.local` visible to Codex still contains `DATABASE_URL` only. I checked only key names and did not print any values. To continue without owner input, local seed now skips only the OWNER row when the two seed-owner keys are absent; CI still creates it from secrets.
**Options:** A) Add the three missing keys to `.env.local` and rerun Phase 4 verification. B) Tell Codex the values through a secure local edit outside Git. Recommendation was A.
**Owner answer:** Owner said the missing keys and matching GitHub secrets were added, and instructed Codex to continue without further help.
**Resolved:** 2026-10-12, resolved in code/docs for Phase 4 continuation; commit pending.
