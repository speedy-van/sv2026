# Gaps Inventory

R0 inventory created 2026-10-13 from `docs/REPAIR.md`, `npm run stub:check`, current code on `main`, and `docs/DECISIONS.md` D26-D39. This file is intentionally critical: a checked item in `docs/PROGRESS.md` is not enough unless a real end-to-end test proves it.

## Summary

| Phase | Gap rows | Mechanical `stub:check` hits | Repair step |
|---|---:|---:|---|
| Phase 5 | 1 | 0 | R1 |
| Phase 8 | 1 | 0 | R2 |
| Phase 10 | 2 | 210 | R1 |
| Phase 12 | 3 | 87 | R3, R4, R5 |
| Phase 13 | 3 | 31 | R6, R7, R8 |
| Phase 14 | 4 | 17 | R2, R9 |
| Phase 15 | 1 | 0 | R10 |
| Phase 16 | 2 | 0 | R10 |
| Staging / Phase 17 | 1 | 0 | S, Phase 17 v2 |
| Total | 18 | 345 raw categorized references | R1-R10, S, Phase 17 v2 |

`npm run stub:check` currently reports 328 findings: 210 fallback locations, 87 canned admin routes, 18 fixture imports, 6 empty handlers, 4 descriptive UI strings, 2 app fixture modules and 1 empty upload payload. The summary table counts cross-cutting Phase 13/14 fixture findings by repair phase, so the categorized reference total is higher than the de-duplicated raw finding count.

## Inventory

| Phase | Gap | Spec requires | Current state | Needed | Fix step |
|---|---|---|---|---|---|
| 5 | Display font | `02-design-system.md` specifies Bricolage Grotesque for display text/prices. | D26 records it was dropped for Lighthouse; Manrope is the only loaded font. | Restore Bricolage with a measured performance strategy and keep Lighthouse >=95. | R1 |
| 8 | Real Stripe Payment Element and card scenarios | `06-booking-flow.md` and `10-payments-stripe.md` require Payment Element, 3-D Secure, decline/retry, price-changed and slot-taken dialogs. | D30 records local fake payment mode; E2E covers mock-paid booking, not Stripe test mode. | Stripe test keys, Stripe CLI webhook forwarding, Playwright coverage for success, 3DS, decline/retry, PRICE_CHANGED and SLOT_UNAVAILABLE. | R2 |
| 10 | Real geocodes for every town | `08-seo-scotland.md` requires real Mapbox geocoding, manual review and no fallback coordinates. | `stub:check` reports 210 `"confidence": "fallback"` entries in `apps/web/src/content/locations/locations.generated.json`; D32 records placeholder coordinates. | `MAPBOX_SECRET_TOKEN`, regenerate all 221 locations, hold low-confidence matches in `docs/QUESTIONS.md`, update overrides only with owner confirmation. | R1 |
| 10 | Real route distances and example prices | SEO pages require plausible road distances and engine-derived example prices. | D32 records local/generated distance boundary; current data includes implausible distances. | Mapbox Directions regeneration, ferry detection, plausibility tests for named Scottish routes and bounding-box validation. | R1 |
| 12 | Admin operations and money endpoints | `05-api.md` §7 requires real booking, dispatch, lead, re-price, reschedule, cancel, refund, extra-charge and offline-payment behavior. | `apps/web/src/server/admin/routes.ts` has route definitions but all non-test-push actions return generic list/detail/ok responses; audit rows claim actions happened. `stub:check` flags these canned routes. | Real services, DB mutations, outbox events, Stripe actions through outbox, expectedVersion conflicts, audit before/after values and endpoint tests. | R3 |
| 12 | Admin schedule, people and reports endpoints | `05-api.md` §7 requires real schedule, capacity, drivers, fleet, payouts, customers, team, notifications, audit and reports. | Same generic canned admin response path as above; no real data changes. | Real services and tests for every endpoint, owner-only gates and London-time reports. | R4 |
| 12 | Admin pricing, content and settings endpoints | Pricing/content/settings endpoints must validate, publish, approve, revalidate public pages and mutate settings safely. | Same generic canned admin response path as above. | Real handlers for pricing versions/drafts/simulate/publish/approve, catalogue, content, reviews, contact messages and settings; delete generic response. | R5 |
| 13 | Admin app data source | `14-admin-app.md` requires real API data through `@sv/api-client` and React Query. | `apps/admin/src/data/admin.ts` contains fixture jobs/customers and screens import `@/data/admin`; `stub:check` flags the fixture module/imports. | Delete fixtures and wire every screen to real admin API hooks. | R6-R8 |
| 13 | Admin core actions | Booking detail sheets, new phone booking, assignment, refund/cancel/reprice/reschedule and sensitive actions must work end to end. | Several screens contain empty handlers or descriptive UI text; actions do not call real endpoints. | Real sheets with Face ID where required, expectedVersion conflict handling and request-level tests. | R6 |
| 13 | Admin operations/config surfaces | Schedule, capacity, drivers, customers, fleet, payouts, team, pricing, content, reports and settings must be full app surfaces. | More/menu screens describe API surfaces instead of implementing them. | Build the real screens and action tests, then clear all admin app `stub:check` findings. | R7-R8 |
| 14 | Driver evidence file storage | Driver photos/signatures must upload real re-encoded binary evidence to private storage and be served through an authenticated file route. | D36 records metadata-only storage boundary; no Vercel Blob token is available. | `BLOB_READ_WRITE_TOKEN`, Blob storage integration, random keys, access-checked `/api/v1/files/:id`. | R2 |
| 14 | Driver signature payload | Completion needs a real signature image or documented skip. | `apps/driver/app/(app)/jobs/[id]/signature.tsx` sends `pngBase64: ''`; `stub:check` flags the empty upload. | Real signature capture and PNG upload with tests. | R9 |
| 14 | Driver app data and offline workflow | `15-driver-app.md` requires real API data, offline queue, evidence retries, rejected-event handling, problem/extra item reports, earnings and availability. | Driver screens import `@/data/driver`; fixture module is present. Some offline helpers exist, but screens are not fully wired to live endpoints. | Replace fixture data with API client/React Query, enforce evidence requirements server and app side, add offline flight-mode tests. | R9 |
| 14 | Physical-device acceptance | Driver and admin apps require camera, push, location and flight-mode acceptance on iPhone. | D35/D36 record this was not run in Windows without Apple/EAS/iPhone access. | Apple Developer/EAS setup and owner iPhone acceptance run against staging. | R6, R9 |
| 15 | Sentry cron monitors | `13-notifications-realtime.md` §10 requires cron monitoring. | D37 records no code check-ins because typed SDK support was not found; production monitor setup remains absent. | Check installed Sentry SDK exports and implement typed check-ins or documented monitor setup. | R10 |
| 16 | Quote error-rate alarm | `16-testing-observability.md` §6 requires a business alarm for quote error rate. | D38 records no persisted quote success/failure metrics; only other alarms exist. | Persist quote success/failure counts and alarm on error rate. | R10 |
| 16 | Release gate against staging | Phase 16 release gate should include staging/load evidence with real backing services. | Local load test intentionally avoided persisted quote writes under `E2E=1`; no staging branch/deploy exists. | Run release gate against staging with `LOAD_BASE_URL`, real Stripe E2E and service credentials. | S, R10 |
| Staging / 17 | Staging and production launch readiness | `17-deployment-launch.md` requires staging project, production cutover checklist, live smoke test and launch gate. | No `staging` branch/deploy exists; old `phase/17-launch` correctly blocks production but is unmerged and based on unrepaired code. | Staging branch/project, staging env/docs, repaired launch gate on `phase/17-launch-v2`, owner-controlled production facts/secrets and live smoke. | S, Phase 17 v2 |
