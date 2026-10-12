# RUNBOOK — phase by phase

Codex builds one phase per prompt and stops. You check, then paste the next prompt. Phases are ordered so that every phase builds on verified work.

## The prompt (same for every phase — change the number and name)

```
Execute Phase <N> — <Name> from docs/RUNBOOK.md.
Before writing any code, read AGENTS.md, the Phase <N> section of docs/RUNBOOK.md, and every document that section lists, in full.
Follow them exactly. Add your plan to docs/PROGRESS.md, implement, then run every Verify command until all pass.
Update docs/PROGRESS.md, commit, and stop. Report: what you built, verify results, any deviations (also recorded in docs/DECISIONS.md), and open questions (in docs/QUESTIONS.md).
Do not start Phase <N+1>.
```

If Codex runs out of context mid-phase, paste: `Continue Phase <N>. Re-read AGENTS.md and the Phase <N> docs, check docs/PROGRESS.md for what is done, and finish the remaining items.`

If something is wrong: `Phase <N> issue: <what you saw>. Find the root cause, fix it, add a test that would have caught it, re-run Verify, and report.`

---

## Phase 0 — Owner setup (you, not Codex)

Do these before Phase 1. Takes an afternoon. Keep every key in a password manager; you'll paste them into `.env.local` and Vercel.

| # | Task | Notes |
|---|---|---|
| 0.1 | New GitHub repository `speedyvan` (private). Put this folder in it as the first commit. | Enable branch protection on `main` after Phase 1. |
| 0.2 | **Vercel Pro** account (Hobby forbids commercial use). New project linked to the repo — don't deploy yet. | Region: London (`lhr1`). |
| 0.3 | **Neon** project, region **AWS eu-west-2 (London)**. Branches: `main` (production) and `dev`. | Copy pooled + direct connection strings for each. |
| 0.4 | **Stripe** account in test mode. Copy publishable + secret keys. | Live keys only at Phase 17. |
| 0.5 | **Mapbox** account. Create a secret token with Search Box, Directions, Static Images scopes. | Server-side only — never in the browser. |
| 0.6 | **Resend** account. Add domain `speedyvan.uk`; add the DNS records it gives you (SPF, DKIM, DMARC) at your DNS provider. | **Only add records — do not change existing MX records.** |
| 0.7 | **Upstash** Redis database via Vercel Marketplace (region London/eu-west). | |
| 0.8 | **Sentry** organisation; projects `web`, `admin`, `driver`. | |
| 0.9 | **Apple Developer Program** membership (paid annual) in the company name. | Needed before Phase 13. Takes days for company verification — start now. |
| 0.10 | **Expo** account; create organisation `speedyvan`. | |
| 0.11 | Fill in **`docs/FACTS.md`** completely. | Blocks Phase 4 seeding of real values. |
| 0.12 | List every upcoming paid booking from the old system somewhere safe. | You'll re-enter them in the Admin app (Phase 13) as offline-paid phone bookings. |

---

## Phase 1 — Monorepo foundation
**Read:** AGENTS.md, `01-architecture.md`, `16-testing-observability.md` §1–3, `DECISIONS.md`
**Build:** npm workspaces + Turborepo; `packages/config` (tsconfig/eslint/prettier presets); empty package shells for pricing, contracts, db, tokens, emails, api-client with build/test/typecheck scripts; root scripts from AGENTS.md §6; `.nvmrc`, `.editorconfig`, `.gitignore`, `.env.example` (every variable from 01-architecture §6, documented); GitHub Actions CI (verify on PR); Dependabot; `scripts/launch-check.ts` skeleton; `docs/DECISIONS.md` updated with exact pinned versions.
**Verify:** `npm ci && npm run verify` (green on empty packages) · CI workflow lints with `actionlint` if available.
**You check:** Repo structure matches 01-architecture §3. Turn on branch protection requiring the CI check.

## Phase 2 — Pricing engine package
**Read:** `04-pricing-engine.md` (all), `docs/reference/pricing/*`
**Build:** `packages/pricing` ported from the reference (extensionless imports), Vitest suite = reference tests + golden vectors + property tests (fast-check) + 100% line/branch coverage gate; `formatPriceBreakdownLines()` helper for UI.
**Verify:** `npm run test:pricing` (all vectors pass, coverage 100%) · `npm run verify`
**You check:** Read the worked examples in 04 §6 — those are your prices.

## Phase 3 — Contracts & tokens
**Read:** `05-api.md` (all), `02-design-system.md` §2–6, `03-database.md` §5, `12-auth-security.md` §2
**Build:** `packages/contracts`: every zod schema in 05-api, error codes + envelope, booking state machine, time helpers (London), money helpers, settings schemas, address/postcode utilities (Scottish postcode areas, Glasgow/Edinburgh flat-notation parser). `packages/tokens`: colours, typography, spacing, radii, shadows, motion — exported for Chakra and React Native.
**Verify:** `npm run verify` · contract unit tests (state machine exhaustive transition table, postcode + flat parser cases from 06-booking-flow §4.3).

## Phase 4 — Database, seed & settings
**Read:** `03-database.md` (all), `docs/reference/schema.prisma`, `FACTS.md`, `docs/data/*`
**Owner before:** `.env.local` with `DATABASE_URL` / `DATABASE_URL_UNPOOLED` for the Neon `dev` branch.
**Build:** `packages/db` with Prisma 7 + Neon adapter, schema, initial migration + raw SQL extras (partial unique index, CHECK constraints), idempotent seed (pricing v1, items catalogue, presets, capacity rules, closed dates, settings from FACTS.md, FAQs, owner user), repository helpers for capacity locking.
**Verify:** `npm run db:migrate && npm run db:seed && npm run db:seed` (second run changes nothing) · `npm run verify` · integration test: concurrent slot booking test from 03 §6.

## Phase 5 — Web foundation & design system
**Read:** `02-design-system.md` (all), `07-landing-and-pages.md` §1–2, `12-auth-security.md` §6 (headers), `18-legal-compliance.md` §4 (cookies)
**Build:** `apps/web` (Next.js 16), Chakra system from tokens, fonts, global layout, header, footer, mobile sticky CTA, motion primitives, error/not-found/loading pages, cookie consent + Consent Mode v2 wiring, security headers, Sentry, Speed Insights, `/styleguide` (dev-only) showing every component and state.
**Verify:** `npm run verify` · `npm run e2e -- --grep @foundation` (header/footer/consent/404) · Lighthouse on `/styleguide` excluded; on `/` placeholder ≥ 95 performance.
**You check:** Open `/styleguide` on your phone. Colours, fonts, buttons, cards.

## Phase 6 — Quote API
**Read:** `05-api.md` §3–4, `04-pricing-engine.md` §8–9, `06-booking-flow.md` §5 (stream protocol), `12-auth-security.md` §5 (rate limits)
**Owner before:** Mapbox secret token and Upstash credentials in `.env.local`.
**Build:** Mapbox integration (Search Box suggest/retrieve, Directions with ferry detection, Static Images), route cache, service-area check, availability service (capacity rules/overrides/holds, lead time, closed dates, same-day rule), quote service, `POST /api/v1/quotes` NDJSON stream, `GET /api/v1/quotes/:publicId`, address endpoints, rate limits, Mapbox mock adapter for tests.
**Verify:** `npm run verify` · integration tests with Mapbox mock (ferry → manual quote; outside Scotland → rejected; full slot → unavailable; stream event order).

## Phase 7 — Booking, payments, outbox & emails
**Read:** `10-payments-stripe.md`, `11-emails.md`, `05-api.md` §5, `13-notifications-realtime.md` §2–3, `03-database.md` §6–7
**Owner before:** Stripe test keys; `stripe` CLI installed for local webhooks; Resend API key.
**Build:** booking creation (deferred-intent PaymentIntent, slot hold, idempotency), Stripe webhook handler, hold-expiry cron, outbox + processor + cron, email templates (all in 11-emails), status polling endpoint, `.ics` generation, admin alert email, outbox event → notification fan-out (push sending stubbed until Phase 15).
**Verify:** `npm run verify` · integration: double-submit returns same booking; webhook replay is a no-op; expired hold + late payment → auto-refund path; price mismatch → 409.

## Phase 8 — Booking flow UI
**Read:** `06-booking-flow.md` (all), `02-design-system.md` §7–8 (motion), `16-testing-observability.md` §4
**Build:** `/book` wizard (every card in 06), address autocomplete, items picker, price reveal sequence, price calendar, checkout with Payment Element, confirmation page with polling, analytics events, draft persistence and resume.
**Verify:** `npm run verify` · `npm run e2e -- --grep @booking` (full booking with Stripe test card on mobile + desktop viewports; 3-D Secure card; declined card; price-changed modal; manual-quote path) · axe: zero violations on every step.
**You check:** Make three test bookings on your phone with test card `4242 4242 4242 4242`. Time how long it takes.

## Phase 9 — Landing page & marketing pages
**Read:** `07-landing-and-pages.md` (all), `02-design-system.md` §7–8, `18-legal-compliance.md` §2–3
**Build:** every landing section/card, services index + 10 service pages, pricing explainer, how it works, about, contact (form + endpoint), reviews page, help/FAQ, legal page drafts, drive-with-us.
**Verify:** `npm run verify` · Lighthouse CI on `/` and one service page (perf ≥ 95, a11y 100, SEO 100, best practices ≥ 95) · `e2e @marketing`.
**You check:** Every fact on every page is true. Legal drafts sent to your solicitor.

## Phase 10 — SEO: locations, routes, sitemaps, structured data
**Read:** `08-seo-scotland.md` (all), `docs/data/scotland-locations.csv`, `docs/data/routes.csv`
**Build:** geocode script (Mapbox) → committed `locations.generated.json` with manual-review report; example-price generator (engine + real distances) → `location-prices.generated.json`; `/areas`, region pages, town pages, city man-and-van pages, route pages; metadata, OG images, JSON-LD, sitemaps, robots, internal linking, redirects policy.
**Verify:** `npm run verify` · `npm run seo:check` (every page: unique title/description/H1, canonical, valid JSON-LD, ≥ N internal links, no orphan pages) · Rich Results Test on 3 sample pages (paste results).
**You check:** Read 5 random town pages. Anything false or repetitive → tell Codex.

## Phase 11 — Customer self-service
**Read:** `09-customer-self-service.md` (all), `10-payments-stripe.md` §6–7
**Build:** find-my-booking + magic links, manage booking page, reschedule (price difference pay/refund), cancel (policy-driven refund), tracking page with live driver position, review submission, manual quote request + priced-quote payment page, extra-charge payment page.
**Verify:** `npm run verify` · `e2e @self-service`.

## Phase 12 — Staff auth & Admin API
**Read:** `12-auth-security.md` (all), `05-api.md` §6–7, `14-admin-app.md` §3 (data needs per screen)
**Build:** email OTP login, JWT access + rotating refresh with reuse detection, device sessions, push-token registration, RBAC middleware, every admin endpoint in 05-api §6 with audit logging, app min-version gate, `@sv/api-client`.
**Verify:** `npm run verify` · API tests: every admin route rejects DRIVER and anonymous; refresh reuse revokes session; OTP brute-force locked out.

## Phase 13 — Admin iOS app
**Read:** `14-admin-app.md` (all), `13-notifications-realtime.md` (all), `02-design-system.md` §9 (apps)
**Owner before:** Apple Developer membership active; Expo account; run `eas login` when Codex asks.
**Build:** every screen in 14-admin-app, push registration, notification categories + custom sound, new-job pop-up, polling fallback, Face ID unlock, iPad layouts, EAS config (development, preview, production profiles), EAS Update channels.
**Verify:** `npm run -w apps/admin typecheck && npm run -w apps/admin test` · `npx expo-doctor` (in apps/admin) clean · development build runs on your iPhone.
**You check:** Install the dev build. Make a test booking on the website with the app closed — your phone must ring within 10 seconds.

## Phase 14 — Driver API & Driver iOS app
**Read:** `15-driver-app.md` (all), `05-api.md` §8, `13-notifications-realtime.md` §4–5
**Build:** driver endpoints, offline action queue + sync, background location during active jobs, job stepper, photo capture/compression/upload, signature capture, earnings, availability, EAS config.
**Verify:** app typecheck/tests · `expo-doctor` · API tests (ownership: a driver can never read another driver's job).
**You check:** Assign a test job to yourself in Admin, run it end-to-end in the Driver app with flight mode on for part of it.

## Phase 15 — Notifications & real-time hardening
**Read:** `13-notifications-realtime.md` (all), `11-emails.md` §4
**Build:** Expo push sending with chunking, receipts cron, dead-token cleanup, quiet-hours logic, all crons registered in `vercel.json`, admin test-push, notification inbox, end-to-end event matrix verified.
**Verify:** `npm run verify` · event-matrix test (13 §2) asserts every event produces the right email/push/in-app rows.

## Phase 16 — QA hardening
**Read:** `16-testing-observability.md` (all), `12-auth-security.md` §8 (checklist), `18-legal-compliance.md`
**Build:** full E2E suite, axe on every page type, Lighthouse CI budgets in CI, load test of quote endpoint, security checklist pass, Sentry alerts, uptime monitors, runbook for incidents.
**Verify:** everything in 16 §7 "Release gate".

## Phase 17 — Launch & cutover
**Read:** `17-deployment-launch.md` (all)
**Owner before:** solicitor-approved legal pages; FACTS complete; pricing approved in Admin; Stripe live keys; Apple devices registered.
**Build/Do:** production env, live Stripe webhook, Apple Pay domain, Resend production, EAS production builds + internal distribution, DNS cutover, Search Console + sitemap, monitoring, smoke tests, 14-day watch list.
**Verify:** `npm run verify:launch` green · live smoke test checklist in 17 §6 completed, including one real booking on your own card, refunded from the Admin app (Stripe keeps its processing fee — that's the cost of a real test).
