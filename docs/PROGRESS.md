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
- [ ] Prisma 7 + Neon adapter · [ ] schema + first migration + raw SQL · [ ] client singleton · [ ] advisory-lock helpers · [ ] outbox enqueue · [ ] idempotent seed (all 10 steps) · [ ] concurrency test (10 → 1)

## Phase 5 — Web foundation
_Plan:_
- [ ] Next.js 16 app · [ ] Chakra system + recipes · [ ] fonts · [ ] header (desktop panels, mobile sheet) · [ ] footer + legal line · [ ] mobile sticky bar · [ ] site banner · [ ] consent banner + Consent Mode · [ ] error/404/loading pages · [ ] security headers · [ ] Sentry + Speed Insights · [ ] motion primitives · [ ] `/styleguide` (every component, every state)

## Phase 6 — Quote API
_Plan:_
- [ ] Mapbox suggest/retrieve/postcode · [ ] Directions + ferry detection + cache · [ ] static map proxy · [ ] service-area rules · [ ] availability overlay (all 5 reasons, job size) · [ ] quote service · [ ] NDJSON stream + JSON mode · [ ] `GET /quotes/:id` · [ ] catalogue endpoint · [ ] rate limits · [ ] Mapbox mock

## Phase 7 — Booking, payments, outbox, emails
_Plan:_
- [ ] `POST /bookings` (all 8 steps) · [ ] status endpoint · [ ] Stripe webhook (all events) · [ ] late-payment handling · [ ] hold-expiry cron · [ ] refunds via outbox · [ ] outbox processor + cron · [ ] notification matrix · [ ] `.ics` · [ ] email templates: booking-confirmed, manage-link, driver-assigned, reminder, on-the-way, completed, rescheduled, cancelled, refund-issued, payment-received, manual-quote ×3, extra-charge, payment-link, after-expiry-refund, contact-received, staff ×7

## Phase 8 — Booking flow UI
_Plan:_
- [ ] Hero booking card · [ ] AddressField (search, postcode-only, manual, errors) · [ ] flat-notation chip · [ ] Step 1 variants + access cards + "Anything tricky?" · [ ] Step 2 presets, search, categories, rows, own item, extras, summary bar · [ ] Step 3 reveal (3 stages, slow/error paths) · [ ] hero price · [ ] calendar (mobile strip, desktop grid) · [ ] day/slot states · [ ] flexibility hint · [ ] breakdown · [ ] expired-quote refresh · [ ] Step 4 summary · [ ] details · [ ] agreements · [ ] Payment Element · [ ] submit sequence + dialogs · [ ] confirmation (polling, success, pending, failed) · [ ] manual quote form · [ ] out-of-area card · [ ] draft persistence + `/quote/:id` · [ ] analytics + Ads conversion · [ ] 11 E2E scenarios

## Phase 9 — Landing & marketing pages
_Plan:_
- [ ] S1 hero + route map · [ ] S2 what you get · [ ] S3 how it works · [ ] S4 services list · [ ] S5 price explainer · [ ] S6 areas · [ ] S7 example prices · [ ] S8 reviews (hidden < 3) · [ ] S9 FAQs · [ ] S10 final card · [ ] 10 service pages + index · [ ] pricing · [ ] how it works · [ ] about · [ ] contact + form · [ ] reviews page · [ ] help · [ ] guides index + template + 6 drafts · [ ] drive with us · [ ] legal drafts · [ ] "from" prices job · [ ] Lighthouse budgets

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
