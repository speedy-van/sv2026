# PROGRESS — every card, screen and system

Codex ticks items as they're **done and verified** (per AGENTS.md §8), and adds its plan under each phase heading before starting. The owner reads this to see exactly where the build is.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified

## Phase 0 — Owner setup
- [ ] GitHub repo · [ ] Vercel Pro · [ ] Neon (London) · [ ] Stripe (test) · [ ] Mapbox token · [ ] Resend + DNS · [ ] Upstash · [ ] Sentry · [ ] Apple Developer · [ ] Expo org · [ ] FACTS.md complete · [ ] old upcoming bookings listed

## Phase 1 — Monorepo foundation
_Plan:_
- [x] Create the npm workspace root, Node/npm pins, Turborepo pipeline and root scripts from AGENTS.md §6.
- [x] Add `packages/config` with shared TypeScript, ESLint flat config and Prettier presets.
- [x] Add empty package shells for pricing, contracts, db, tokens, emails and api-client with lint/typecheck/test scripts.
- [x] Add strict TypeScript entrypoints and trivial Vitest tests so empty packages verify cleanly.
- [x] Add `.nvmrc`, `.editorconfig`, `.gitignore` and `.env.example` covering every variable from 01-architecture §6.
- [x] Add GitHub Actions CI for `npm ci` + `npm run verify`, plus Dependabot configuration.
- [x] Add `scripts/launch-check.ts` skeleton for later release gates.
- [x] Verify current stable versions, pin exact package versions and fill the Phase 1 version table in `docs/DECISIONS.md`.
- [x] Run `npm ci && npm run verify`, then check CI workflow syntax with `actionlint` if available.

_Verify (2026-10-12):_ `npm ci && npm run verify` passed. `actionlint` was not available locally, so workflow lint was skipped per the Phase 1 "if available" condition.

## Phase 2 — Pricing engine
_Plan:_
- [x] Port `types.ts`, `dates.ts`, `config.default.ts` and `engine.ts` from `docs/reference/pricing` with extensionless imports.
- [x] Export the pricing engine API from `packages/pricing/src/index.ts`.
- [x] Add `formatPriceBreakdownLines()` for UI-ready line items without changing arithmetic.
- [x] Port the 12 reference tests to Vitest with the same expected values.
- [x] Add golden-vector tests against all 8 vectors and all 672 slot prices from `vectors.json`.
- [x] Add fast-check property tests for non-negative prices, monotonic items/miles, slot ordering, calendar shape and `priceForSlot` parity.
- [x] Configure `npm run test:pricing` with 100% line and branch coverage for `packages/pricing`.
- [x] Run `npm run test:pricing` and `npm run verify` until green.

_Verify (2026-10-12):_ `npm run test:pricing` passed: 4 files, 26 tests, all 8 golden vectors and 672 slot prices checked, 100% statements/branches/functions/lines. `npm run verify` passed across lint, typecheck, test and build for all current packages.

## Phase 3 — Contracts & tokens
_Plan:_
- [x] Add `zod` as the shared contracts validation dependency and keep package scripts unchanged.
- [x] Build `@sv/contracts` core primitives: error codes/envelope, API success/pagination helpers, money helpers and Europe/London time/date helpers.
- [x] Build address utilities: UK postcode normalisation/validation, Scottish postcode-area detection/service-area helper and Glasgow/Edinburgh flat-notation parser.
- [x] Implement the booking state machine from `05-api.md` §12 with exhaustive transition helpers, stage paths and driver stage movement rules.
- [x] Implement settings schemas for every `Setting.key` listed in `03-database.md` §5, plus private/public settings parsing.
- [x] Implement all Phase 3 API contract schemas from `05-api.md`: core DTOs, public endpoints, booking creation, staff auth/self, admin, driver, webhooks/cron and stream events.
- [x] Build `@sv/tokens` exports for colour scales/semantic tokens, typography, spacing, breakpoints, radii, shadows and motion, with Chakra and React Native mappings.
- [x] Replace shell tests with contract unit tests for exhaustive transitions, postcode/service-area and flat parser cases from `06-booking-flow.md` §4.3, plus schema/token smoke tests.
- [x] Run `npm run verify` until green, update progress, record any deviations/questions, then commit.

_Verify (2026-10-12):_ `npm run verify` passed across lint, typecheck, test and build. Contract unit tests passed: exhaustive booking and dispatch transition tables; `stagePathFor()` dropoff and rubbish single-address paths; JobStage rules for driver one-step moves, move-date/day-after guard, same-driver accepted-job guard, undo window, admin/owner override with reason and completion evidence; postcode/service-area helpers; every flat-notation row and negatives from `06-booking-flow.md` §4.3; core schema checks and settings validation. Token tests passed for brand colour, semantic, typography, layout and motion exports.

## Phase 4 — Database
_Plan:_
- [x] Confirm Prisma 7/D21, add Prisma Client + Neon adapter dependencies, and configure Prisma 7 with `prisma.config.ts` using `DATABASE_URL_UNPOOLED` when present.
- [x] Copy the reference schema unchanged into `packages/db/prisma/schema.prisma`, create the initial migration, and append the required raw SQL extras.
- [x] Build the pooled Neon Prisma client singleton, advisory slot-lock helpers, capacity helpers, and outbox enqueue helper.
- [x] Implement the idempotent seed: facts/settings, pricing v1, item catalogue, presets, capacity rules, closed dates, FAQs, owner user, and location content.
- [x] Update CI to create and delete a Neon branch per run, then run migrate, seed, verify against that branch.
- [x] Add the Phase 4 DB integration tests for transactions and concurrent slot booking.
- [x] Run `npm run db:migrate && npm run db:seed && npm run db:seed`, then `npm run verify` until all pass.
- [x] Update progress, decisions/questions as needed, commit, and stop before Phase 5.

_Verify (2026-10-12):_ `npm run db:migrate` passed using the committed migration SQL through the local Neon HTTP migration runner and applied `20261012120000_init` (142 statements). `npm run db:seed` passed twice; the second run completed without errors and without duplicate inserts. Local seed warned that `operations.defaultCapacityPerSlot` fell back to `1` and `SEED_OWNER_EMAIL` / `SEED_OWNER_NAME` were absent, so the local OWNER row was skipped; CI supplies those two secrets. Final `npm ci` passed. Final `npm run verify` passed across lint, typecheck, test and build. `@sv/db` integration tests passed: interactive transaction plus 10 concurrent same-slot booking attempts, with 1 success and 9 `SLOT_UNAVAILABLE` failures.

## Phase 5 — Web foundation
_Plan:_
- [x] Scaffold `apps/web` as a Next.js 16 App Router workspace with strict TS, package scripts, nested AGENTS.md and source imports from shared packages.
- [x] Add Chakra v3 system from `@sv/tokens`, global CSS, `next/font/google`, and core UI primitives with documented states.
- [x] Build global layout: skip link, optional site banner, sticky header with desktop panels/mobile sheet, footer legal line, mobile sticky CTA, placeholder home.
- [x] Build cookie consent and preferences UI with Consent Mode v2 basic wiring and shared cookie inventory content.
- [x] Add security headers/CSP in `next.config.ts`, Sentry config/tunnel and Vercel Speed Insights.
- [x] Add motion primitives and the first Scotland route map component with reduced-motion behavior.
- [x] Add loading, error, not-found pages and `/styleguide` dev-only inventory for component states.
- [x] Add Phase 5 tests/E2E foundation checks and Lighthouse script, then run every Verify command.

_Verify (2026-10-12):_ `npm run verify` passed across lint, typecheck, test and build for all packages. `npm run e2e -- --grep '@foundation'` passed: 6 Playwright checks covering header/footer/home booking card, cookie consent and 404 recovery links across desktop and mobile Chromium. `npm run lighthouse -w @sv/web` passed with `/` performance score 98. Local Playwright browser download from the CDN timed out, so the final local E2E run used installed Windows Chrome via the Phase 5 Playwright config fallback. On PowerShell, the `@foundation` grep tag must be quoted; the runner still defaults a missing `--grep` value to `@foundation` for this phase's documented command.

## Phase 6 — Quote API
_Plan:_
- [x] Add Phase 6 server dependencies and record exact versions for Upstash rate limiting.
- [x] Add server env, request IDs, API error wrapper, JSON/NDJSON helpers, and no-store/cache headers.
- [x] Add rate limiting with Upstash Redis and an in-memory fallback when Upstash is unavailable.
- [x] Build Mapbox integration with live and mock adapters for suggest, retrieve, postcode lookup, directions with ferry detection, and static images.
- [x] Build route cache helpers and service-area checks from postcode/address rules.
- [x] Build catalogue endpoint from seeded items, presets, categories, and active pricing custom sizes.
- [x] Build availability overlay from capacity rules/overrides/holds/bookings, lead time, closed dates, same-day-only, and job-size rules.
- [x] Build quote orchestration: snapshot items, derive pricing input, call `@sv/pricing`, persist quotes/manual quotes, and map to `QuoteDto`.
- [x] Add `POST /api/v1/quotes` with NDJSON streaming plus JSON mode, `GET /api/v1/quotes/:publicId`, address endpoints, and static map proxy.
- [x] Add integration tests with Mapbox mock for ferry manual quote, outside Scotland rejection, full slot unavailable, and stream event order.
- [x] Run `npm run verify` until green and update docs/commit.

_Verify (2026-10-12):_ `npm run verify` passed across lint, typecheck, test and build. `@sv/web` quote integration tests passed with Mapbox mock: ferry route returns manual quote reason `FERRY_ROUTE`; London-only route is rejected with `OUTSIDE_SERVICE_AREA`; a capacity-1 confirmed booking makes the same morning slot unavailable with reason `FULL`; `POST /api/v1/quotes` streams events in order `accepted`, `route`, `availability`, `prices`, `done`. Next build listed all Phase 6 API routes as dynamic server routes.

## Phase 7 — Booking, payments, outbox, emails
_Plan:_
- [x] Add Phase 7 dependencies for Stripe, Resend and React Email with exact pins recorded in `docs/DECISIONS.md`.
- [x] Implement booking creation from quotes: idempotency, stored/expired quote pricing checks, availability rules, slot-capacity transaction, customer upsert, booking/payment rows, deferred PaymentIntent and status token.
- [x] Add booking status polling and signed status tokens for the confirmation page.
- [x] Add Stripe integration helpers, webhook verification/replay handling, booking confirmation, money recomputation, mismatch alerts and late-payment auto-refund handling.
- [x] Add hold-expiry cron for pending booking holds and expired slot holds.
- [x] Add refund allocation plus `payment.refund` outbox execution.
- [x] Add outbox processor with `SKIP LOCKED`, retries/backoff, cron route, and notification fan-out from the Phase 7 subset of the event matrix.
- [x] Add Resend integration, admin/customer recipient resolution and stubbed push sending until Phase 15.
- [x] Implement `.ics` generation and email templates for every customer/staff template listed in `11-emails.md`.
- [x] Add tests for double booking submit, webhook replay, late payment refund path, price mismatch, ICS boundaries, email rendering, and notification matrix.
- [x] Run `npm run verify` until green, update docs, commit, merge Phase 7 fast-forward to `main`, then continue with Phase 8.

_Verify (2026-10-13):_ `npm ci` passed from the committed lockfile; it reports the known Prisma audit warnings documented in D29. Final `npm run verify` passed across lint, typecheck, tests and build for all current packages. `@sv/web` Phase 7 integration tests passed: double-submit returns the same reference/client secret and one Payment row; stale expected price returns `PRICE_CHANGED`; Stripe webhook replay is a no-op; expired hold + late payment with the slot taken keeps the booking `EXPIRED` and creates a full pending refund plus `payment.refund` outbox job; `booking.confirmed` expands to two email jobs, one admin notification and one push stub. `.ics` generation passed BST/GMT UTC conversion checks. `@sv/emails` rendered all 24 customer/staff templates without unresolved placeholders.

## Phase 8 — Booking flow UI
_Plan:_
- [x] Hero booking card · [x] AddressField (search, postcode-only, manual, errors) · [x] Step 1 variants + access cards + "Anything tricky?" · [x] Step 2 search/categories/own item/extras/summary bar · [x] Step 3 reveal states · [x] hero price · [x] calendar + day/slot states · [x] breakdown · [x] Step 4 summary · [x] details · [x] agreements · [x] deferred Payment Element path with local mock fallback · [x] confirmation polling/success/pending · [x] manual quote form · [x] out-of-area card · [x] draft persistence + `/quote/:id` · [x] analytics + Ads conversion helper · [x] booking E2E coverage; remaining live-Stripe and fine-detail deltas recorded in D30.
- [x] Add Phase 8 client dependencies from the approved stack: React Hook Form, zod resolver, React Query, Zustand, Stripe browser packages, and axe Playwright.
- [x] Add booking content/constants for service labels, variants, access defaults, item category labels and customer-facing error copy.
- [x] Build the persisted booking draft store with versioning and step-prerequisite guards.
- [x] Build `/book` wizard frame with sticky header, progress steps, summary column and loading/error/submitting states.
- [x] Build accessible `AddressField`: search, retrieve, postcode-only completion, manual entry, retry, selected state and live-region announcements.
- [x] Build Your move, Items, Prices and Pay steps with the Phase 8 components.
- [x] Build quote reveal state, calendar selection, manual quote and outside-area branches.
- [x] Wire deferred Stripe Payment Element using `POST /api/v1/bookings`, idempotency key reuse, local E2E mock payment, and confirmation navigation.
- [x] Build `/book/confirmation` polling, success/pending states, `.ics` download and draft clearing.
- [x] Add analytics event helpers that are consent-gated and no-op without IDs.
- [x] Add Playwright `@booking` E2E coverage for the documented paths using mock adapters/test hooks where local Stripe secrets are absent, plus axe checks.
- [x] Run `npm run verify`, `npm run e2e -- --grep @booking`, and axe checks until green, update docs and commit before Phase 9.

_Verify (2026-10-13):_ `npm run e2e -- --grep '@booking'` passed: 10 Playwright checks across desktop and mobile Chromium covering mock-paid booking, manual quote ferry route, rubbish single-address path, outside-area blocking, quote resume/draft reload, and axe zero violations on exercised steps. `npm run verify` passed across lint, typecheck, tests and build for all current packages. Earlier failures fixed during Phase 8: confirmation page update loop after draft clearing, production static confirmation route needing `Suspense` around `useSearchParams`, mobile footer/checkbox axe target-size failures, parallel E2E slot collision, and confirmation status no-store polling.

## Phase 9 — Landing & marketing pages
_Plan:_
- [x] Centralise Phase 9 marketing content for services, FAQs, legal drafts and guides under `apps/web/src/content`.
- [x] Add server helpers for public settings, active pricing, honest "from" prices, FAQ rendering, reviews and JSON-LD.
- [x] Replace the landing page with all required sections S1-S10 while hiding missing business facts instead of showing placeholders.
- [x] Add `/services`, the 10 service detail pages, breadcrumbs, service JSON-LD and service-specific booking-card defaults.
- [x] Add `/pricing`, `/how-it-works`, `/about`, `/contact`, `/reviews`, `/help`, `/guides`, `/drive-with-us`, legal draft pages and accessibility page.
- [x] Add a validated contact form endpoint and client form states with rate limiting and no secret or PII logging.
- [x] Add responsive marketing CSS for tables, accordions, service rows, legal banners, contact form states and guide/review empty states.
- [x] Add `@marketing` Playwright checks for facts hiding, H1/meta structure, contact form, FAQ/search, service pages and keyboard-accessible content.
- [x] Update Lighthouse verification to cover `/` and `/services/house-removals` with the Phase 9 category thresholds.
- [x] Run `npm run verify`, Lighthouse and `npm run e2e -- --grep @marketing` until green, then update docs and commit before Phase 10.

_Verify (2026-10-13):_ `npm run verify` passed across lint, typecheck, tests and build. `npm run lighthouse -w @sv/web` passed on `/` and `/services/house-removals`: performance 96/96, accessibility 100/100, best practices 96/96, SEO 100/100. `npm run e2e -- --grep '@marketing'` passed 10 Playwright checks across desktop and mobile for the landing page, service page, FAQ search, contact form states, pricing/reviews/legal stable states, and missing-fact hiding.

## Phase 10 — SEO
_Plan:_
- [ ] Geocode script + report · [ ] location graph · [ ] route distances · [ ] `/areas` · [ ] 12 region pages · [ ] 221 town pages · [ ] 8 man-and-van city pages · [ ] 26 route pages · [ ] metadata + OG images · [ ] JSON-LD graphs · [ ] sitemaps + index · [ ] robots · [ ] indexing policy (tier 3) · [ ] redirects mechanism · [ ] city note drafts seeded · [ ] `seo:check`

## Phase 11 — Customer self-service
_Plan:_
- [ ] Signed links (6 purposes) · [ ] find my booking · [ ] manage page (all cards) · [ ] notes edit · [ ] receipt page · [ ] reschedule (cheaper / dearer / same) · [ ] cancel (3 bands) · [ ] tracking page (all states) · [ ] review page · [ ] pay page (3 kinds, all states) · [ ] E2E

## Phase 12 — Staff auth & Admin API
_Plan:_
- [ ] OTP request/verify + lockout · [ ] access/refresh tokens + rotation + reuse detection · [ ] sessions + push devices · [ ] RBAC wrapper · [ ] min-version gate · [ ] every admin endpoint (05 §7) with audit · [ ] `@sv/api-client` · [ ] route × role tests

## Phase 13 — Admin iOS app
_Plan:_
- [ ] Shell + gates (update, sign-in, Face ID, permissions) · [ ] Today · [ ] Bookings list · [ ] Booking detail · [ ] sheets: assign, unassign, edit, re-price, reschedule, cancel, refund, extra charge, offline payment, resend email · [ ] New phone booking (5 steps) · [ ] Schedule + capacity · [ ] Drivers + detail + invite + live map · [ ] Leads (quote requests, abandoned) · [ ] Customers · [ ] Pricing (versions, editor, simulator, publish, approve) · [ ] Items + presets · [ ] Reviews · [ ] Content (locations, FAQs, banner, SEO) · [ ] Messages · [ ] Fleet · [ ] Payouts · [ ] Reports · [ ] Team · [ ] Settings (all sections) · [ ] Notifications inbox · [ ] System health · [ ] Audit · [ ] Account · [ ] push + sounds + categories · [ ] NewJobModal + feed fallback · [ ] iPad split views · [ ] EAS profiles + updates

## Phase 14 — Driver API & Driver iOS app
_Plan:_
- [ ] Driver endpoints (05 §8) · [ ] Today · [ ] Jobs (offers, upcoming, past) · [ ] Offer detail · [ ] Job detail + navigate · [ ] Job stepper (all stages, undo, service paths) · [ ] report problem · [ ] extra items · [ ] camera + compression · [ ] signature · [ ] offline queue + sync · [ ] background location · [ ] Earnings · [ ] Me + availability · [ ] EAS profiles

## Phase 15 — Notifications & real-time
_Plan:_
- [ ] Expo push sender + tickets · [ ] receipts cron + dead tokens · [ ] repeat-until-seen · [ ] quiet hours · [ ] all crons registered + check-ins · [ ] test push · [ ] event-matrix test

## Phase 16 — QA hardening
_Plan:_
- [ ] Full E2E suites · [ ] axe on every page type · [ ] Lighthouse CI · [ ] load tests · [ ] security checklist (12 §8) · [ ] Sentry alerts + uptime · [ ] health endpoint + business alarms · [ ] `docs/INCIDENTS.md`

## Phase 17 — Launch
- [ ] Owner checklist (17 §4) · [ ] `verify:launch` green · [ ] cutover steps · [ ] live smoke test · [ ] Search Console sitemap · [ ] 14-day watch started
