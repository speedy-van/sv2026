# DECISIONS — architecture decision record

Every decision that shapes the build, with the reason. Codex appends new entries (same format) when a doc leaves something open, and fills in the version table at Phase 1.

---

## D01 — One monorepo, three apps, shared packages
**Decision:** npm workspaces + Turborepo: `apps/web`, `apps/admin`, `apps/driver`, shared `packages/*`.
**Why:** The pricing engine, API contracts and brand tokens must be identical across web and both iPhone apps. Separate repos guarantee drift; drift caused price mismatches in the past.

## D02 — Next.js 16, not 14
**Decision:** Next.js 16.x (latest patch).
**Why:** Next.js 14 reached end-of-life on 26 Oct 2025 and gets no security fixes. Next.js 15 leaves support on 21 Oct 2026. Next 16 is the Active LTS line and runs React 19.2 — the same React the current Expo SDK uses, which a single monorepo requires (React Native needs one exact React version). Your preferred stack said 14; this is the one place it changes, for security and compatibility.

## D03 — Chakra UI v3 for the web
**Decision:** Chakra v3 with a custom system built from `packages/tokens`.
**Why:** Your standard stack; Chakra documents support for Next.js 15 and 16. Known issue: Emotion hydration under Turbopack — follow Chakra's current guide (may require webpack mode for dev/build).

## D04 — iPhone apps with Expo (React Native), not native Swift
**Decision:** Expo SDK (latest stable), Expo Router, EAS Build/Update.
**Why:** One language (TypeScript) across the platform; the apps import the same pricing engine and API contracts as the website. Push notifications with custom sounds, background location, camera, Face ID and offline storage are all first-class in Expo. EAS Update ships bug fixes to staff phones in minutes without an App Store review. Android later costs little.

## D05 — Staff apps distributed privately, not on the public App Store
**Decision:** EAS internal distribution (ad hoc) to registered staff iPhones.
**Why:** No App Store review, installs from a link, push works normally. Limit: up to 100 iPhones per year per device type, and the build must be re-signed yearly. If the team outgrows that, move to Apple's unlisted/custom app distribution.

## D06 — The website hosts the API
**Decision:** All endpoints live in `apps/web/src/app/api/v1`.
**Why:** One deployment, one database connection strategy, one auth system. Mobile apps call the same versioned API. `/v1` lets the apps outlive web changes (apps can't be force-updated instantly).

## D07 — Prisma 7 on Neon (London)
**Decision:** Prisma ORM 7 with `@prisma/adapter-neon`; Neon region AWS eu-west-2; Vercel functions in `lhr1`.
**Why:** Type-safe schema and migrations; Neon's serverless driver suits Vercel. Database and functions in London keeps each query in single-digit milliseconds.

## D08 — Stripe Payment Element, deferred intent, webhooks as truth
**Decision:** Payment Element (cards, Apple Pay, Google Pay, Link) mounted before a PaymentIntent exists; booking + PaymentIntent created on "Pay"; confirmation driven by webhook.
**Why:** No PaymentIntent clutter from visitors who never pay; the server sets the amount; webhooks survive closed tabs and 3-D Secure redirects.

## D09 — Real-time = push + polling (no websockets)
**Decision:** Push notifications for alerts; React Query polling for live views (admin lists 20 s, tracking page 10 s, driver location every 30 s while on a job).
**Why:** Vercel functions don't hold websockets. This is simpler, cheaper and robust on bad mobile signal. Push guarantees the alert; polling guarantees the data.

## D10 — Expo Push Service for notifications
**Decision:** Server sends via `expo-server-sdk`; Expo relays to Apple (APNs).
**Why:** Free, handles APNs credentials, gives delivery receipts so dead devices are cleaned up. Custom sound and time-sensitive interruption level make alerts behave like WhatsApp calls-to-attention.

## D11 — Maps: Mapbox server-side; Apple Maps for display in apps
**Decision:** Mapbox Search Box (addresses), Directions (miles + ferry detection), Static Images (route previews) — all through our API with a secret token. Apps display maps with `react-native-maps` (Apple Maps) and hand off navigation to Apple Maps / Google Maps / Waze.
**Why:** Keeps the Mapbox token secret and rate-limited (abuse = your bill). Apple Maps in-app needs no extra SDK or token and is battery-friendly.

## D12 — Upstash Redis for rate limiting
**Why:** Every quote costs Mapbox calls. Without rate limits a bot can run up a large bill and slow the site. Upstash is serverless, cheap, and available through Vercel Marketplace.

## D13 — Sentry for errors, crons and uptime
**Why:** The old site's glitches cost money because nobody was alerted. Sentry alerts the owner within a minute of a failing booking, webhook, cron or app crash.

## D14 — No customer accounts or passwords
**Decision:** Customers manage bookings through signed magic links emailed to them.
**Why:** Passwords add friction and support load for a service people use once or twice. Magic links are secure and simpler.

## D15 — Staff log in with email one-time codes + Face ID
**Why:** No passwords to leak or forget; Face ID protects the app on a shared or lost phone. Sessions are per device and can be revoked from the Admin app.

## D16 — Quotes are stored server-side; bookings store every pricing input
**Why:** Re-pricing (admin edits, reschedules) must reproduce the original price exactly. Every input — floors, lifts, carry distance, narrow access, permit zone, items with volumes — is persisted on the quote and booking with the pricing version used.

## D17 — Capacity is real
**Decision:** Slot capacity per weekday/slot with date overrides; holds while paying; per-slot advisory locks inside the booking transaction; optional job-size rules for big moves.
**Why:** Prevents double-booking the same crew. Lets the site honestly show "last slot" from real data.

## D18 — Islands and ferries go to manual quotes
**Why:** The pricing spec has no ferry costs. Any route Mapbox plans over a ferry (Arran, Bute, Mull, Orkney, Shetland, Western Isles, sometimes Dunoon) would be badly under-priced, so it becomes a manual quote that an admin prices in the app.

## D19 — Town pages carry real computed data
**Decision:** Every location page shows example prices computed by the real engine using real Mapbox distances, plus distances to nearby cities and links to neighbouring towns.
**Why:** Google's spam policies target near-identical "doorway" pages. Unique, accurate data per page is what makes ~220 location pages legitimate and useful.

## D20 — Brand
**Decision:** Colours *Loch Ink* `#0B1F33`, *Gorse* `#FFC93C`, *Thistle* `#6D3BD7`; fonts **Bricolage Grotesque** (headlines, prices) and **Manrope** (text, UI).
**Why:** Distinctive in a market of blue-and-orange removal sites; rooted in Scotland (loch, gorse, thistle); all text pairs pass WCAG AA. Full rationale in `02-design-system.md`.

---

## Pinned versions (Codex fills at Phase 1)

| Package | Version | Verified on |
|---|---|---|
| node (LTS) | 24.7.0 (`.nvmrc`: 24) | 2026-10-12 |
| next | 16.4.0 | 2026-10-12 |
| react / react-dom | 19.3.0 / 19.3.0 | 2026-10-12 |
| expo (SDK) | 57.0.28 | 2026-10-12 |
| react-native | 0.87.1 | 2026-10-12 |
| @chakra-ui/react | 3.37.0 | 2026-10-12 |
| prisma / @prisma/client / @prisma/adapter-neon | 7.10.0 / 7.10.0 / 7.10.0 | 2026-10-12 |
| stripe / @stripe/stripe-js / @stripe/react-stripe-js | 23.0.0 / 10.0.0 / 7.0.0 | 2026-10-12 |
| @upstash/ratelimit / @upstash/redis | 2.2.0 / 1.39.0 | 2026-10-12 |
| resend / react-email | 6.32.1 / 6.11.1 | 2026-10-13 |
| @react-email/components / @react-email/render | 1.0.12 / 2.1.0 | 2026-10-13 |
| react-hook-form / @hookform/resolvers | 7.90.0 / 5.9.1 | 2026-10-13 |
| @tanstack/react-query / zustand | 5.104.2 / 5.0.15 | 2026-10-13 |
| @axe-core/playwright | 4.13.0 | 2026-10-13 |
| zod | 4.6.7 | 2026-10-12 |
| typescript | 6.0.3 | 2026-10-12 |

## Entries added during the build

<!-- Codex: D21 onward. Format: ## Dxx — title / Decision / Why / Alternatives considered -->

## D21 — Phase 1 toolchain compatibility pins
**Decision:** Pin Phase 1 developer tooling to versions that install without peer-dependency overrides: ESLint `9.39.5` instead of registry latest `10.12.0`, TypeScript `6.0.3` instead of registry latest `7.0.2`, and Prisma CLI `7.10.0` instead of the `prisma` package's `latest` dist-tag `8.0.0-rc.22`.
**Why:** `eslint-plugin-react` and `typescript-eslint` did not yet declare support for ESLint 10, and `typescript-eslint` did not yet declare support for TypeScript 7. The project rules forbid `--force` / weakened guards. Prisma 8 was still an RC while the stack explicitly requires Prisma ORM 7.
**Alternatives considered:** Use npm `--force` / `--legacy-peer-deps` (rejected because it weakens dependency validation); adopt pre-release Prisma 8 (rejected because Phase 1 requires stable Prisma 7); omit the Next/React Native ESLint configs (rejected because Phase 1 requires those config presets).

## D22 — Turborepo v2 task schema
**Decision:** Use the Turborepo v2 `tasks` key in `turbo.json`, with a package-specific `@sv/web#build` output for the future Next.js app.
**Why:** The Phase 1 docs use the older "pipeline" wording, but Turbo `2.11.7` validates the current `tasks` schema. Package shells currently emit no build artifacts, so their generic build/test outputs are empty to keep verification warning-free.
**Alternatives considered:** Use the obsolete `pipeline` key (rejected because it does not match the installed Turbo schema); keep `.next/**` as the generic build output (rejected because it caused warnings for empty package builds).

## D23 — Local Git repository bootstrap
**Decision:** Initialise a local Git repository and create branch `phase/01-monorepo-foundation` before the Phase 1 commit because this workspace did not contain a `.git` directory.
**Why:** AGENTS.md §9 requires a phase branch and a commit after verification. Phase 0 expects the owner-created GitHub repository to exist, but no local repository metadata was present in this workspace.
**Alternatives considered:** Stop and ask the owner to initialise Git (rejected because Phase 1 implementation and verification were otherwise complete); skip the commit (rejected because the phase prompt explicitly requires a commit).

## D24 — Rolldown bindings for Vitest 5
**Decision:** Add explicit Rolldown support for the current test environments while keeping platform-native packages optional: `@rolldown/binding-wasm32-wasi` stays a dev dependency, and `@rolldown/binding-win32-x64-msvc` / `@rolldown/binding-linux-x64-gnu` are `optionalDependencies`. The lockfile must not list either native binding under root `dependencies`; it must include both native packages with `optional: true`.
**Why:** `vitest run --coverage` failed locally when Rolldown's transitive optional native binding was missing. The WASM fallback also failed to resolve from this workspace path, which contains a space. Native bindings are OS/CPU-specific, so listing one as a normal dependency would make `npm ci` fail on the other platform. Optional dependencies let Windows development and Linux CI/Vercel installs share one lockfile without weakening coverage requirements.
**Alternatives considered:** Downgrade Vitest (rejected because Phase 1 pinned current stable Vitest 5); remove coverage or lower thresholds (rejected because Phase 2 requires 100% line/branch coverage); rely on npm to install transitive optional dependencies (rejected because it already failed in this workspace); make native bindings normal dependencies (rejected because Windows and Linux installs would break each other).

## D25 — Phase 4 seed nullability and migration generation
**Decision:** Settings schemas accept `null` for owner facts that can legitimately remain `TODO(owner)` before launch, while the seed uses the documented development fallback of `1` for `operations.defaultCapacityPerSlot`. The first migration was generated from the reference Prisma schema and then edited to add the required raw SQL extras; timestamp columns use `TIMESTAMPTZ(3)` to match the database workflow's timestamp convention. CI creates its per-run Neon branch with `parent_branch: dev` explicitly set, never from the primary/main branch, and the cleanup step runs with `if: ${{ always() }}` against the deterministic CI branch name so failed runs still attempt deletion. If local `DATABASE_URL_UNPOOLED` is missing but `DATABASE_URL` is a Neon pooled hostname, config derives the direct hostname without writing or printing the secret. Local `db:migrate` applies committed Prisma migration SQL through Neon HTTP and records `_prisma_migrations`; CI `db:deploy` remains Prisma `migrate deploy`. If local `SEED_OWNER_EMAIL` / `SEED_OWNER_NAME` are missing, seed skips only the OWNER row with a warning, while CI still seeds it from GitHub secrets.
**Why:** `03-database.md` §8 requires every `TODO(owner)` from `FACTS.md` to become `null` and be listed in `launch.missingFacts`, but some Phase 3 schemas had made those owner facts non-nullable. Prisma 7.10's local `migrate diff --from-empty --to-schema ... --script` produced no SQL, and `migrate dev --create-only` failed locally with a schema engine error against the provided Neon URL, so the migration SQL was produced from the schema structure and kept forward-only with the raw SQL from §4 appended. Main is reserved for production data, so test branches must inherit from the Neon `dev` branch; cleanup must run even after earlier CI failures to avoid abandoned test branches. The local `.env.local` available to Codex still only exposed `DATABASE_URL`, and this Windows environment cannot reach Neon's direct TCP port 5432 even though Neon HTTP works on 443; using an HTTP migration runner lets `npm run db:migrate` verify the committed SQL locally, while CI/Linux still confirms Prisma's official migration path. Skipping a local OWNER row avoids inventing private owner identity facts.
**Alternatives considered:** Seed placeholder owner/legal/business values (rejected because the docs forbid inventing business facts); leave FAQ rows empty until Phase 5 (rejected because Phase 4 explicitly seeds FAQs); block on Prisma local migration generation (rejected because the schema is already validated by Prisma and the migration can still be applied by `migrate deploy` in CI/Linux with the committed SQL); rely on Neon's default parent branch (rejected because it could use main/production); condition cleanup on a create-step output (rejected because the owner required `if: always()` cleanup); write a derived unpooled URL back into `.env.local` (rejected to avoid editing secrets on disk unnecessarily); make CI use the HTTP migration runner (rejected because GitHub Actions should exercise Prisma `migrate deploy` directly).

## D26 — Phase 5 web foundation runtime and local browser verification
**Decision:** Implement the Chakra v3 system from `@sv/tokens` but do not mount `ChakraProvider` globally on the public placeholder pages until Chakra components are introduced. Keep the public web foundation CSS-rendered for Phase 5, mount Vercel Speed Insights directly, and keep motion primitives available without wrapping the root layout in Motion. Use Manrope as the single loaded `next/font` family for now and set letter spacing to `0` in web CSS/token text styles. Configure Playwright to use desktop/mobile Chromium projects, with a Windows system-Chrome channel fallback when Playwright browser downloads are unavailable. Replace `start-server-and-test` with small local TypeScript runners for E2E and Lighthouse; the E2E runner defaults a missing `--grep` value to `@foundation` for the Phase 5 command, and PowerShell users should quote grep tags such as `npm run e2e -- --grep '@foundation'`.
**Why:** The Phase 5 verify gate requires Lighthouse performance at or above 95 on `/`. Mounting the full Chakra runtime and unused Motion provider on the static placeholder page dropped local Lighthouse to 85; removing unused global client runtime raised it to 93. Loading Bricolage Grotesque as a second `next/font` family kept the LCP heading around 3.0s; using the already-loaded UI font for display text raised Lighthouse to 98. The local Playwright CDN download repeatedly timed out, but Chrome was installed on Windows, so the fallback lets verification run without weakening the E2E assertions. `start-server-and-test` consumed forwarded arguments incorrectly, and unquoted PowerShell `@tag` arguments are treated as splatting expressions; the custom runners make the documented Phase 5 verification reliable locally.
**Alternatives considered:** Keep global Chakra/Motion wrappers despite the Lighthouse failure (rejected because Phase 5 explicitly requires the performance gate); lower the Lighthouse threshold (rejected because the runbook sets it); keep Bricolage loaded and record a failing verify (rejected because a passing Phase 5 is required); require WebKit for the mobile project locally (rejected because the browser download was blocked by repeated network timeouts, while mobile viewport behavior is still covered through Chromium device emulation); keep `start-server-and-test` (rejected because it consumed forwarded arguments incorrectly under Turbo/npm on Windows).

## D27 — Phase 6 quote API runtime choices
**Decision:** Pin `@upstash/ratelimit` `2.2.0` and `@upstash/redis` `1.39.0` in `apps/web`. The public limiter uses Upstash sliding windows when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` exist, reports Upstash failures to Sentry, and falls back to the same per-instance in-memory limits. Mapbox route caching lives inside the server Mapbox adapter with in-memory cache plus optional Redis 24-hour cache keyed by rounded coordinates. Availability is evaluated from one batched read of capacity overrides, rules, bookings and holds for the quote calendar, then computed in memory. Vitest aliases `server-only` to a no-op test stub only inside `apps/web/vitest.config.ts` so route-handler integration tests can import server modules outside Next.
**Why:** The docs require rate limits to protect billable Mapbox calls while never failing customer requests because the limiter is down. A batched availability read keeps quote tests and production quote generation from doing one database round trip per slot. Keeping the route cache inside the adapter preserves the documented behavior without exposing cache internals to route handlers. Next provides `server-only` at runtime/build time, but Vitest does not, so the test alias is required to exercise the same route-handler code locally.
**Alternatives considered:** Fail closed when Upstash is unreachable (rejected because `12-auth-security.md` §5 requires fallback); query capacity per slot (rejected because it was too slow and timed out tests); put route caching in a separate service file (rejected as extra indirection with no current caller benefit); remove `server-only` imports for tests (rejected because they protect server modules in the real app).

## D28 — Phase 7 payment and email integration modes
**Decision:** Pin Phase 7 mail dependencies to `resend` `6.32.1`, `react-email` `6.11.1`, `@react-email/components` `1.0.12`, and `@react-email/render` `2.1.0`. Stripe remains on the Phase 1 pin `23.0.0`. Stripe and Resend helpers use live SDK clients when their secrets are present; when secrets are absent outside production, they use deterministic local no-network behavior for tests and development. In production, missing Stripe, webhook, Resend or email sender secrets fail closed. Booking status tokens use the existing `CUSTOMER_LINK_SECRET` rather than adding a new secret. Email sending renders HTML and text from the same React Email template registry before calling Resend.
**Why:** The local workspace does not expose Stripe or Resend secrets, and unit/integration tests must not call external payment or email services. Deterministic mock PaymentIntent IDs let idempotency and webhook tests verify database behavior without weakening production safety. `CUSTOMER_LINK_SECRET` is already the documented customer-token secret in `.env.example`, so a separate status-token secret would add avoidable setup drift. Rendering before Resend gives us snapshot-testable HTML/text and keeps the outbox job idempotency as the delivery guard. npm marks the current `@react-email/components` package as deprecated, but it is still the documented React Email component bundle and the latest registry version available during Phase 7.
**Alternatives considered:** Block Phase 7 on local Stripe/Resend secrets (rejected because the owner asked Codex to continue without more input); add a new `STATUS_TOKEN_SECRET` (rejected because `CUSTOMER_LINK_SECRET` already covers customer links); send mail inline from booking/webhook handlers (rejected by AGENTS.md); use Stripe Checkout Sessions (rejected by `10-payments-stripe.md`); call Resend with only HTML and no plain-text rendering (rejected by `11-emails.md`).

## D29 — Prisma audit advisory handling
**Decision:** Do not run `npm audit fix --force` for the current Prisma-related high advisories. Keep Prisma CLI/client/adapter on `7.10.0` until a Prisma 7-compatible patched release is available.
**Why:** `npm audit --omit=dev` reports high advisories through Prisma's transitive `deepmerge-ts` and `mysql2` dependencies, but npm's available fix is `prisma@6.19.3`, a major downgrade from the required Prisma 7 stack. Downgrading would break D07/D21 and the Phase 4 Prisma 7 `prisma-client` generator / `prisma.config.ts` setup. The application uses Postgres/Neon, not MySQL, so the `mysql2` advisory is in an unused Prisma CLI transitive path.
**Alternatives considered:** Force-downgrade Prisma to 6.19.3 (rejected because Phase 4 explicitly required Prisma 7 and verify is green on Prisma 7); ignore the audit output without documenting it (rejected because `npm ci` surfaces the warning every run).

## D30 — Phase 8 local booking-flow verification mode
**Decision:** Pin the Phase 8 browser/client packages exactly and support two payment modes in the booking UI: the documented deferred Stripe Payment Element when `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` exists, and a deterministic local mock payment mode when Stripe browser keys are absent. The mock mode is enabled for production-built local E2E only when `E2E=1`; production without Stripe secrets still fails closed. Booking analytics are implemented as consent-gated no-ops unless the public GA4/Google Ads IDs are present and the relevant consent is granted.
**Why:** The local workspace does not expose Stripe browser or secret keys, so true card, 3-D Secure and decline flows cannot be exercised locally without external Stripe credentials. The Phase 8 E2E suite still needs to verify the customer booking path end-to-end through the real booking API, webhook-equivalent confirmation handling, polling, draft clearing and accessibility. The mock payment hook lets local and CI-like production builds prove the application path without calling Stripe, while the real Stripe Element path remains wired for environments with Stripe test keys.
**Deviation recorded:** The local `@booking` E2E run covers the main paid booking, manual-quote ferry path, rubbish single-address path, outside-area blocking, draft reload and quote resume across desktop and mobile, with axe checks on exercised steps. It does not locally exercise Stripe's real 3-D Secure challenge, real declined-card retry, or the exact price-changed/slot-taken modal flows from `06-booking-flow.md` §10 because those require live Stripe test keys and additional mutation hooks. Server-side Phase 7 tests already cover stale price and late-payment/slot-taken money safety; Phase 16 should add full live-Stripe E2E once test credentials are available in the target CI/Vercel environment.
**Alternatives considered:** Block Phase 8 on Stripe test secrets (rejected because the owner asked Codex to continue without more help); put fake card fields in the production UI (rejected because the real UI must use Stripe Payment Element); skip payment E2E entirely (rejected because the booking confirmation path is core revenue behavior).

## D31 — Phase 9 marketing delivery boundaries
**Decision:** Implement the contact form write endpoint at `POST /api/v1/contact` using the shared `ContactRequestSchema`, and have the `/contact` page submit to it. Keep `/contact` as the marketing page. Publish starter guide drafts as `noindex` draft pages with visible draft text rather than linking them as approved guides. Recompute "from" prices from the active pricing config and current capacity in server rendering with one-day page revalidation; a dedicated cron/tag revalidation job remains for the later SEO/content hardening phases.
**Why:** Next App Router cannot cleanly serve both a marketing page and a route handler at the exact `/contact` segment without route conflict, while every API request still needs a contracts-first schema. The guide copy is explicitly draft owner-review content, so `noindex` prevents search exposure before approval while keeping Phase 9 pages inspectable. The pricing helper uses the real engine and capacity overlay now; cron-based revalidation belongs with the broader SEO/indexing automation.
**Deviation recorded:** `07-landing-and-pages.md` says `POST /contact`; the built endpoint is `POST /api/v1/contact` and the form is wired to that. The Phase 9 "from prices job" is implemented as server-rendered/revalidated computation, not a scheduled job yet. Starter guides are reachable but marked draft and `noindex` until owner approval.
**Alternatives considered:** Replace the `/contact` page with a route handler (rejected because the marketing page is required); create an untyped server action only (rejected because API writes must be contracts-first); publish draft guides as normal indexed articles (rejected because owner review is not complete).
