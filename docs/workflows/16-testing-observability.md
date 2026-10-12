# 16 — Testing, QA & observability

The old site lost money because failures were silent. Here, every money path is tested before release and watched after.

## 1. Tools

| Layer | Tool | Where |
|---|---|---|
| Unit | Vitest | `packages/*`, `apps/web/src/**` |
| Property | fast-check | `packages/pricing`, `packages/contracts` |
| Integration (API + DB) | Vitest + real Postgres (Neon branch) | `apps/web/test/integration` |
| E2E web | Playwright (Chromium, WebKit; iPhone 13, Pixel 7, desktop 1440) | `apps/web/e2e` |
| Accessibility | `@axe-core/playwright` | inside E2E |
| Performance | Lighthouse CI | CI on preview deployments |
| Load | `autocannon` script | `scripts/load/quote.ts` |
| Mobile unit | jest-expo + React Native Testing Library | `apps/admin`, `apps/driver` |
| Mobile flows (recommended) | Maestro | `apps/*/maestro/` |

## 2. Test environments and fakes

- **Database:** CI creates a Neon branch per run (Neon's GitHub Action), runs `prisma migrate deploy` + seed, runs tests, deletes the branch. Locally, `DATABASE_URL_TEST` points to a dedicated Neon `test` branch; integration suites truncate tables between files.
- **Adapters** (selected by env, never by `NODE_ENV` alone; production refuses to boot with any non-live mode):
  - `MAPBOX_MODE=mock` — deterministic fixtures: distance = rounded haversine × 1.25 between coordinates; special fixture coordinates for a ferry route (Ardrossan → Brodick) and an English postcode.
  - `EMAIL_MODE=capture` — emails stored in memory and exposed at `GET /api/test/emails` (route compiled only when `E2E=1`) so E2E can open magic links.
  - `PUSH_MODE=capture` — push messages captured the same way.
  - Stripe — real test mode in E2E; signed fixture payloads in integration tests.
- **Clock:** server services take `now` from `src/server/clock.ts`; E2E can set `x-sv-test-now` (only when `E2E=1`) to test cut-offs, end-of-month and urgency.

## 3. What must be tested

| Area | Minimum |
|---|---|
| Pricing | 04 §11 (golden vectors, properties, 100% coverage) |
| Contracts | every schema: valid sample, each invalid field; booking state machine: full transition table (allowed and refused) for each actor; flat-notation parser; postcode/service-area rules |
| Availability | each overlay reason; lead time across midnight; same-day rule; BST/GMT change days |
| Booking | idempotency; price verify (valid/expired quote); 409 paths; concurrent last-slot (10 parallel → 1 winner) |
| Payments | webhook signature, replay, amount mismatch, late payment after expiry (both outcomes), refund allocation, Dashboard refund import |
| Outbox | retry/backoff, FAILED alert, dedupe; event-matrix test (13 §2) |
| Auth | OTP brute force, refresh rotation + reuse revocation, role matrix per route, driver ownership |
| Customer links | each purpose/expiry; email-change invalidation |
| DTOs | forbidden fields absent per audience (05 §10) |
| Emails | snapshots; no unresolved placeholders |
| SEO | `seo:check` (08 §11) |
| Apps | 14 §5, 15 §7 |

## 4. E2E suites (tags)

| Tag | Covers |
|---|---|
| `@foundation` | header/menu, footer legal line, consent banner flows, 404, error page |
| `@booking` | 06 §10 (11 scenarios) |
| `@marketing` | every page type renders, facts hidden when null, links valid, FAQ JSON-LD matches visible FAQs |
| `@self-service` | 09 §10 |
| `@seo` | robots/sitemaps, canonical, noindex rules, structured data present |

Each E2E page visit runs axe (WCAG 2.2 AA tags) and fails on any violation. Run on PRs against the Vercel preview deployment (`deployment_status` workflow) and nightly against staging.

## 5. Performance and load

- Lighthouse CI budgets (mobile): Performance ≥ 95, Accessibility 100, Best Practices ≥ 95, SEO 100 on `/`, `/services/house-removals`, `/removals/paisley`, `/removals/glasgow-to-edinburgh`. Resource budgets: JS ≤ 170 KB gzip (landing), total transfer ≤ 500 KB, no render-blocking third-party scripts.
- Load (staging, Mapbox mock): `POST /quotes` at 30 req/s for 2 minutes → p95 < 800 ms, error rate 0, rate limiter returns 429 above limits; `POST /bookings` 20 concurrent on one slot → exactly capacity winners.

## 6. Observability

**Sentry** (web server + client, both apps):
- Releases tagged with git SHA; source maps uploaded in CI (web) and by EAS (apps).
- `environment`: production / staging / preview / development. PII scrubbing per 12 §7.
- **Alerts** (to the owner by email and Sentry mobile app push):
  - Any new issue in `booking`, `payment`, `webhook`, `outbox`, `quote` code paths → immediately.
  - Error rate > 2% on `/api/v1/quotes` or `/api/v1/bookings` over 10 minutes.
  - Cron monitor missed or failed (every cron in 13 §10 has a check-in).
  - Uptime monitors (Sentry Uptime): `https://www.speedyvan.uk/`, `/book`, `/api/v1/health` every minute from the UK/EU.
- Mobile: crash-free sessions target ≥ 99.5%; alert on any crash in the job stepper or NewJobModal.

**Health endpoint** `GET /api/v1/health` → `{ db: ok, outboxBacklog, oldestPendingSeconds, lastWebhookAt, version }`; 503 when the DB is unreachable or the outbox's oldest pending event is older than 5 minutes.

**Business alarms** (hourly cron → `system.alert`): quote error rate > 5%; checkout → paid conversion drops below half of its 7-day average (only when ≥ 10 checkouts in the window); webhook silence > 6 h while bookings were created; push failure rate > 10%.

**Logs:** structured JSON with `requestId`, route, status, duration, userId (staff) — searchable in Vercel; errors also in Sentry. Speed Insights for real-user Core Web Vitals.

## 7. Release gate (Phase 16, then every production release)

- [ ] `npm run verify` green; all E2E suites green on the preview deployment.
- [ ] Lighthouse budgets met; axe zero violations.
- [ ] `seo:check` clean.
- [ ] Security checklist (12 §8) unchanged or re-verified for touched areas.
- [ ] Migrations reviewed (forward-only, expand/contract) and applied to staging first.
- [ ] Staging smoke test: book with test card → admin app (preview build) rings → assign → driver app runs job → customer emails received → refund works.
- [ ] Sentry release created; alerts and uptime monitors active.
- [ ] For app releases: version bumped, `MIN_*_APP_VERSION` updated only after staff have the new build.

## 8. `docs/INCIDENTS.md` (Codex writes in Phase 16)

Sections: contacts and accounts · how to pause online booking · how to revoke every staff session · rotating each secret · restoring the database to a point in time (03 §10) · replaying failed outbox events · what to tell customers (email templates for "we're having a problem" and "your booking is safe") · post-incident checklist.
