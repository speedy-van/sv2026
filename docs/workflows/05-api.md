# 05 — API (contracts, endpoints, roles)

All endpoints live in `apps/web/src/app/api/v1/**/route.ts`. Every request and response type is a zod schema in `packages/contracts/src/api/*.ts`; the web client, `@sv/api-client` (apps) and route handlers import the same schemas.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base | `/api/v1`. Breaking changes → `/api/v2` route alongside; apps declare the version they use. |
| Format | JSON (`application/json`), except the quote stream (`application/x-ndjson`) and file upload (multipart). Dates `YYYY-MM-DD`, timestamps ISO-8601 UTC, money integer pence (`…Pence`). |
| Errors | `{ "error": { "code": "SLOT_UNAVAILABLE", "message": "That slot has just been taken.", "details": {…}, "requestId": "req_…" } }` with the HTTP status in §2. `message` is safe to show users. |
| Request ID | Every response has `x-request-id`; logs and Sentry events carry it. |
| Auth | Staff: `Authorization: Bearer <access JWT>`. Customer self-service: HTTP-only cookie `sv_manage` set from a magic link, or a signed token in the path for tracking/pay/review links. Cron: `Authorization: Bearer ${CRON_SECRET}`. |
| App version | Apps send `x-sv-app: admin@1.4.2` / `driver@1.2.0`. Below `MIN_*_APP_VERSION` → `426 APP_UPDATE_REQUIRED`. |
| Pagination | Cursor: `?cursor=<opaque>&limit=25` (max 100) → `{ items, nextCursor }`. |
| Idempotency | Mutations that create money or bookings take `idempotencyKey` (UUID v4) in the body; repeats within 24 h return the original result. |
| Concurrency | Admin mutations on a booking send `expectedVersion`; mismatch → `409 CONFLICT`. |
| Caching | All `/api` responses `Cache-Control: no-store` except catalogue (`s-maxage=300, stale-while-revalidate=3600`) and static map images (`s-maxage=86400`). |
| Rate limits | Per 12-auth-security §5. Exceeded → `429 RATE_LIMITED` with `retry-after`. |
| Wrapper | Every handler is `withApi({ auth, rateLimit, input }, handler)` — parses input, enforces role, maps `AppError`, attaches request ID, reports unknown errors to Sentry. |

## 2. Error codes (`packages/contracts/src/errors.ts`)

| Code | HTTP | Meaning / user message source |
|---|---|---|
| `VALIDATION_ERROR` | 400 | `details.fieldErrors` from zod (flattened) |
| `UNAUTHORIZED` | 401 | missing/expired token |
| `FORBIDDEN` | 403 | wrong role or not your resource |
| `NOT_FOUND` | 404 | |
| `CONFLICT` | 409 | version mismatch |
| `PRICE_CHANGED` | 409 | `details: { newTotalPence }` |
| `QUOTE_EXPIRED` | 409 | date fell outside the new 28-day window |
| `SLOT_UNAVAILABLE` | 409 | capacity, lead time, closure |
| `OFFER_TAKEN` | 409 | another driver accepted first |
| `INVALID_TRANSITION` | 409 | booking state machine refused |
| `OUTSIDE_SERVICE_AREA` | 422 | |
| `MANUAL_QUOTE_REQUIRED` | 422 | `details: { reasons }` |
| `PAYMENT_FAILED` | 402 | Stripe decline mapped to plain words |
| `APP_UPDATE_REQUIRED` | 426 | |
| `RATE_LIMITED` | 429 | |
| `UPSTREAM_UNAVAILABLE` | 503 | Mapbox/Stripe/Resend timeout after retries |
| `INTERNAL` | 500 | generic message; details only in Sentry |

## 3. Core schemas (sketch — Codex writes full zod)

```ts
ServiceKeySchema = z.enum(SERVICE_KEYS)                       // from @sv/pricing
SlotSchema       = z.enum(['MORNING','AFTERNOON','EVENING'])
IsoDateSchema    = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate)
PenceSchema      = z.number().int().nonnegative()
UkPostcodeSchema = z.string().transform(normalisePostcode).refine(isValidUkPostcode)

AddressSchema = z.object({
  line1: z.string().trim().min(1).max(120),
  line2: z.string().trim().max(120).optional(),
  flat:  z.string().trim().max(40).optional(),          // "2/1", "3F2", "Flat 4"
  town:  z.string().trim().min(1).max(80),
  postcode: UkPostcodeSchema,
  lat: z.number().min(49.8).max(60.9), lng: z.number().min(-8.7).max(1.8),
  label: z.string().max(240),                           // one-line display
  source: z.enum(['MAPBOX','MANUAL']), mapboxId: z.string().max(200).optional(),
})

AccessDetailSchema = z.object({
  floorChoice: z.enum(['BASEMENT','GROUND','FLOOR']), floorNumber: z.number().int().min(1).max(30).optional(),
  hasLift: z.boolean(), carryMetres: z.number().int().min(0).max(500),
  narrowAccess: z.boolean(), permitZone: z.boolean(), notes: z.string().max(300).optional(),
})

ItemLineInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalogue'), itemSlug: z.string(), quantity: z.number().int().min(1).max(500) }),
  z.object({ kind: z.literal('custom'), name: z.string().trim().min(2).max(60), size: z.enum(['S','M','L','XL']), quantity: z.number().int().min(1).max(50) }),
])

QuoteRequestSchema = z.object({
  service: ServiceKeySchema, variant: z.string().max(40),
  pickup: AddressSchema, dropoff: AddressSchema.nullable(),
  pickupAccess: AccessDetailSchema, dropoffAccess: AccessDetailSchema.nullable(),
  items: z.array(ItemLineInputSchema).max(200),
  addons: z.object({ helpers: z.number().int().min(0).max(3), packing: z.boolean(), assembly: z.boolean() }),
  attribution: AttributionSchema.optional(),            // utm_*, gclid, landingPath, referrer (truncated)
}).superRefine(dropoffRulesPerService)

SlotOfferSchema = z.object({
  slot: SlotSchema, windowLabel: z.string(), pricePence: PenceSchema,
  available: z.boolean(),
  reason: z.enum(['FULL','PAST_CUTOFF','CLOSED','SAME_DAY_ONLY']).optional(),
  lastOne: z.boolean(),                                 // true when this job would take the last capacity in its start slot
})
QuoteDtoSchema = z.object({
  publicId, expiresAt, service, variant, distanceMiles, durationMinutes,
  pickup: AddressSummary, dropoff: AddressSummary.nullable(),
  breakdownLines: z.array(z.object({ key, label, detail: z.string().optional(), pence: PenceSchema })),
  staticSubtotalPence, calendar: z.array(z.object({ date, weekday, slots: z.array(SlotOfferSchema) })),
  cheapest: z.object({ date, slot, pricePence }).nullable(),
  staticMapPath: z.string(),                             // /api/v1/maps/static?quote=…
})
```

`breakdownLines` come from `formatPriceBreakdownLines()` in `@sv/pricing` so web and apps show identical wording, e.g. `Distance — 7.4 miles after the first 5 free — £11.10`.

## 4. Public endpoints (no login)

| Method & path | Purpose | Request → Response |
|---|---|---|
| `POST /address/suggest` | Address autocomplete (Mapbox Search Box, GB, proximity Scotland centre, types address,postcode,poi) | `{ q (2–100), sessionToken (uuid), proximity? }` → `{ suggestions: [{ id, primary, secondary, kind }] }` |
| `POST /address/retrieve` | Resolve a suggestion | `{ id, sessionToken }` → `{ address: AddressSchema }` (postcode required — if Mapbox lacks one, return `needsPostcode: true`) |
| `GET /address/postcode/:postcode` | Manual entry: geocode a postcode | → `{ town, lat, lng, postcode }` |
| `GET /maps/static?quote=:publicId&w=&h=&dpr=` | Route image (proxied Mapbox Static with route polyline, brand colours) | PNG, cached 1 day |
| `GET /catalogue` | Items + presets + custom sizes | `{ items, presets, customSizes, categories }` |
| `POST /quotes` | **Stream** a quote (06-booking-flow §5); with `Accept: application/json` (used by the apps) the same work returns one JSON body | `QuoteRequest` → NDJSON events, or `{ quote } \| { manualQuote: { quotePublicId, reasons } }` |
| `GET /quotes/:publicId` | Resume a quote; availability recomputed live | → `{ quote: QuoteDto, expired: boolean }` |
| `POST /quotes/:publicId/manual-request` | Ask for a manual quote | `{ contact, preferredDate?, preferredSlot?, details? }` → `{ reference }` |
| `POST /bookings` | Create booking + PaymentIntent | §5 |
| `GET /bookings/status?token=` | Confirmation page polling | → `{ status, reference, summary, manageUrl? }` |
| `POST /contact` | Contact form | `{ name, email, phone?, message, company (honeypot, must be empty) }` → 202 |
| `POST /manage/request-link` | Email a magic link | `{ email, reference }` → 202 always (no enumeration) |
| `GET /manage/session?token=` | Exchange magic-link token for `sv_manage` cookie, then redirect to `/manage` | 302 |
| `GET /manage/booking` | Booking for the cookie holder | → `ManageBookingDto` |
| `POST /manage/booking/reschedule/preview` | Price + rules for a new slot | `{ date, slot }` → `{ allowed, reason?, newTotalPence, differencePence }` |
| `POST /manage/booking/reschedule` | Apply | `{ date, slot, expectedDifferencePence, idempotencyKey }` → `{ result: 'DONE' } \| { result: 'PAYMENT_REQUIRED', clientSecret }` |
| `POST /manage/booking/cancel/preview` | Refund under policy | → `{ allowed, refundPence, policySummary }` |
| `POST /manage/booking/cancel` | Cancel | `{ expectedRefundPence, reason? }` → `{ refundPence }` |
| `PATCH /manage/booking/notes` | Notes for the driver (until 24 h before) | `{ customerNotes }` |
| `GET /track/:token` | Live tracking | → `TrackingDto` |
| `POST /reviews` | Submit review (one per booking) | `{ token, rating 1–5, comment? ≤ 1000, displayName }` → 201 |
| `GET /pay/:token` | Payment page data (manual quote, extra charge, phone-booking link) | → `PaymentRequestDto` |
| `POST /pay/:token/intent` | Create/reuse PaymentIntent for that request | → `{ clientSecret, amountPence }` |
| `GET /files/:id?token=` | Proof-of-move photos for the customer's own booking | image stream |

## 5. Booking creation (`POST /bookings`)

```ts
BookingCreateSchema = z.object({
  quotePublicId: z.string(), date: IsoDateSchema, slot: SlotSchema,
  expectedTotalPence: PenceSchema,
  idempotencyKey: z.string().uuid(),
  contact: z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email().max(160), phone: UkPhoneSchema }),
  customerNotes: z.string().trim().max(500).optional(),
  marketingOptIn: z.boolean(),
  termsAccepted: z.literal(true),
  startWithinCancellationPeriodAck: z.boolean(),        // must be true when legal.requireExpressStartAck is on and the move is < 14 days away (18-legal §2)
})
→ 201 { reference, statusToken, clientSecret, totalPence, holdExpiresAt }
```

Server steps (in order; any failure returns the matching code):
1. Idempotency: if `idempotencyKey` exists → return the stored result (same `clientSecret`).
2. Load quote; ACTIVE; not converted to a different paid booking.
3. Price: valid quote → stored calendar price, re-verified with `priceForSlot` on stored inputs; expired → reprice with ACTIVE config and today (04 §8).
4. `price !== expectedTotalPence` → `409 PRICE_CHANGED { newTotalPence }`.
5. Lead-time and same-day rules for `now`.
6. Transaction with slot advisory lock (03 §6.1): capacity → upsert Customer → create Booking (PENDING_PAYMENT, `holdExpiresAt = now + paymentHoldMinutes`) → Payment (REQUIRES_PAYMENT).
7. After commit: Stripe PaymentIntent (amount = server price, `idempotencyKey` = booking id, metadata `{ bookingId, paymentId, kind: 'BOOKING' }`, `automatic_payment_methods` enabled, `receipt_email` off) → store id. If Stripe fails, mark the booking EXPIRED immediately (release capacity) and return `UPSTREAM_UNAVAILABLE`.
8. Return `clientSecret`. Confirmation happens only via webhook (10-payments §4).

## 6. Staff auth & self

| Method & path | Role | Purpose |
|---|---|---|
| `POST /auth/otp/request` | — | `{ email, app }` → 202 always; sends a 6-digit code if an ACTIVE/INVITED user with the right role exists |
| `POST /auth/otp/verify` | — | `{ email, app, code, device: { deviceId, deviceName, platform, appVersion } }` → `{ accessToken, accessExpiresAt, refreshToken, user }` |
| `POST /auth/refresh` | — | `{ refreshToken, deviceId }` → rotated pair; reuse of an old token revokes the session |
| `POST /auth/logout` | any | revoke current session + its push devices |
| `GET /me` | any | user, role, driver profile, `appConfig` (min version, slot windows, support phone, feature flags) |
| `PUT /me/push-device` | any | `{ expoPushToken, platform }` → upsert for this session |
| `DELETE /me/push-device` | any | disable this device's token |
| `GET /me/sessions` · `DELETE /me/sessions/:id` | any | list/revoke own devices |
| `GET /notifications` · `POST /notifications/read` | any | inbox; `{ ids } \| { all: true }` |

## 7. Admin endpoints (`/admin/*`, role ADMIN or OWNER unless marked **O** = OWNER only)

Every mutation writes an `AuditLog` row with before/after and enqueues the outbox events listed in 13 §2.

| Area | Endpoints |
|---|---|
| Dashboard | `GET /admin/dashboard?date=` (today's jobs by slot, unassigned count, pending manual quotes, revenue today/week/month, alerts) · `GET /admin/feed?since=` (events for the pop-up fallback) · `GET /admin/system/health` (outbox backlog, failed events, last webhook, cron last runs, push error rate) · `POST /admin/system/outbox/:id/retry` · `POST /admin/test-push` |
| Bookings | `GET /admin/bookings?status=&dispatch=&from=&to=&service=&driverId=&q=&cursor=` (q matches reference, name, email, phone, postcode) · `GET /admin/bookings/:id` (full detail incl. payments, refunds, extras, assignments, events, photos, audit) · `POST /admin/bookings` (phone booking: `{ quotePublicId, date, slot, contact, payment: { mode: 'LINK' } \| { mode: 'OFFLINE', reference } , notes }` — OFFLINE is **O**) · `PATCH /admin/bookings/:id` (contact, notes, van; `expectedVersion`) |
| Re-pricing | `POST /admin/bookings/:id/reprice-preview` (`{ changes }` → diff, new breakdown) · `POST /admin/bookings/:id/reprice-apply` (`{ expectedVersion, changes, settle: 'EXTRA_CHARGE'\|'REFUND'\|'NONE', reason }`) |
| Reschedule | `GET /admin/bookings/:id/calendar` (28-day prices from the booking's inputs with the ACTIVE config + availability) · `POST /admin/bookings/:id/reschedule-preview` · `POST /admin/bookings/:id/reschedule` (`{ expectedVersion, date, slot, priceMode: 'KEEP_PRICE'\|'NEW_PRICE', settle, reason, overrideCapacity? (**O**) }`) |
| Dispatch | `POST /admin/bookings/:id/assign` (`{ driverId, vanId?, mode: 'DIRECT'\|'OFFER', expectedVersion }`) · `POST /admin/bookings/:id/offer` (`{ driverIds[], expiresInMinutes }` first-to-accept) · `POST /admin/bookings/:id/unassign` (`{ reason }`) · `GET /admin/drivers/live` |
| Status | `POST /admin/bookings/:id/status` (`{ to, reason, expectedVersion }`, admin transitions only) · `POST /admin/bookings/:id/cancel` (`{ expectedVersion, refund: { mode: 'POLICY'\|'FULL'\|'CUSTOM'\|'NONE', amountPence? }, reason, notifyCustomer }`) |
| Money | `POST /admin/bookings/:id/refunds` (`{ paymentId, amountPence, reason }`) · `POST /admin/bookings/:id/extra-charges` (`{ description, amountPence }` → pay link emailed) · `POST /admin/extra-charges/:id/decision` (driver-requested: approve/reject, may edit amount) · `POST /admin/bookings/:id/payments/offline` (**O**) · `POST /admin/bookings/:id/resend-email` (`{ template }`) |
| Leads | `GET /admin/checkouts/abandoned?from=&to=` (EXPIRED web bookings with contact details) · `GET /admin/manual-quotes?status=` · `GET /admin/manual-quotes/:id` · `POST /admin/manual-quotes/:id/price` (`{ pricePence, date, slot, message, validForHours }` — date and slot required; the customer pays for exactly that slot) · `POST /admin/manual-quotes/:id/decline` |
| Schedule | `GET /admin/schedule?from=&to=` (per day/slot: capacity, used, held, bookings) · `GET/PUT /admin/capacity/rules` · `GET /admin/capacity/overrides?from=&to=` · `PUT /admin/capacity/overrides` · `DELETE /admin/capacity/overrides/:id` |
| Drivers | `GET /admin/drivers` · `GET /admin/drivers/:id` · `POST /admin/drivers/invite` · `PATCH /admin/drivers/:id` · `POST /admin/drivers/:id/disable` · `GET /admin/drivers/:id/unavailability` · `GET /admin/drivers/:id/unpaid-earnings` |
| Fleet | `GET/POST /admin/vans` · `PATCH /admin/vans/:id` |
| Payouts | `GET /admin/payouts?driverId=` · `POST /admin/payouts` (`{ driverId, earningIds[], method, reference?, paidAt }`, **O**) |
| Customers | `GET /admin/customers?q=` · `GET /admin/customers/:id` · `PATCH /admin/customers/:id` · `POST /admin/customers/:id/export` · `POST /admin/customers/:id/anonymise` (**O**) |
| Pricing | `GET /admin/pricing/versions` · `GET /admin/pricing/versions/:id` · `POST /admin/pricing/drafts` · `PATCH /admin/pricing/drafts/:id` · `POST /admin/pricing/simulate` · `POST /admin/pricing/drafts/:id/publish` · `POST /admin/pricing/versions/:id/approve` (**O**) |
| Catalogue | `GET/POST /admin/items` · `PATCH /admin/items/:id` · `GET/POST /admin/presets` · `PATCH /admin/presets/:id` |
| Content | `GET/PUT /admin/content/locations/:slug` · `GET/POST /admin/faqs` · `PATCH/DELETE /admin/faqs/:id` · `PUT /admin/content/banner` · `GET /admin/reviews?status=` · `PATCH /admin/reviews/:id` · `GET /admin/contact-messages` · `PATCH /admin/contact-messages/:id` |
| Settings | `GET /admin/settings` · `PUT /admin/settings/:key` (company, cancellation, drivers, launch: **O**) |
| Team | `GET /admin/team` · `POST /admin/team/invite` (**O**) · `PATCH /admin/team/:id` (**O**) · `POST /admin/team/:id/revoke-sessions` (**O**) |
| Reports | `GET /admin/reports/summary` · `GET /admin/reports/funnel` · `GET /admin/reports/areas` · `GET /admin/reports/export?type=bookings\|payments\|payouts&from=&to=` (CSV) |
| Audit | `GET /admin/audit?entityType=&entityId=&actorId=&cursor=` |

## 8. Driver endpoints (`/driver/*`, role DRIVER, only own jobs)

| Method & path | Purpose |
|---|---|
| `GET /driver/jobs?scope=today\|upcoming\|offers\|history&cursor=` | Job cards (no customer price; shows the driver's earning) |
| `GET /driver/jobs/:id` | Full job: addresses, per-address access, items, notes, customer name + phone (visible from acceptance until 24 h after the job), status, photos, signature state |
| `POST /driver/jobs/:id/accept` · `POST /driver/jobs/:id/decline` | `{ reason? }`; accept is first-wins for broadcast offers |
| `POST /driver/sync` | Batched offline events `{ events: [{ clientEventId, bookingId, type: 'STAGE', toStage, occurredAt, lat?, lng? } \| { …, type: 'NOTE', text } \| { …, type: 'ISSUE', category, text }] }` → per-event `{ clientEventId, result: 'APPLIED'\|'DUPLICATE'\|'REJECTED', error? }` |
| `POST /driver/jobs/:id/photos` | multipart `{ file ≤ 4 MB JPEG/HEIC→JPEG, kind, clientId, takenAt }` |
| `POST /driver/jobs/:id/signature` | `{ pngBase64 ≤ 300 KB, signedName, clientId }` |
| `POST /driver/jobs/:id/extra-requests` | `{ description, suggestedAmountPence?, photoIds? }` → admin approval |
| `POST /driver/location` | `{ points: [{ lat, lng, accuracyM, heading?, speedMps?, recordedAt }] ≤ 50 }` — stored only while the driver has a job in an en-route/on-site stage |
| `GET /driver/earnings?from=&to=` | Earnings list + totals + payouts |
| `GET/PUT /driver/availability` | `{ unavailable: [{ date, slot, reason? }] }` |
| `GET/PATCH /driver/profile` | name, phone, licence expiry, home postcode |

## 9. Webhooks & cron

`POST /api/webhooks/stripe` (10-payments §4). Crons under `/api/cron/*` (13 §6), all `GET` with `CRON_SECRET`, idempotent, each reporting a Sentry cron check-in.

## 10. Field visibility by audience (DTOs, not one model for all)

| Field | Customer | Driver | Admin |
|---|---|---|---|
| Price total, breakdown, payments | ✓ | ✗ (sees own earning) | ✓ |
| Customer phone/email | own | phone only, acceptance → job + 24 h | ✓ |
| Addresses + access detail | ✓ | ✓ once assigned | ✓ |
| Admin notes, audit | ✗ | ✗ | ✓ |
| Driver name | first name, from assignment | — | ✓ |
| Driver phone | ✗ (customers call the office) | — | ✓ |
| Van registration | ✓ on the move day | ✓ | ✓ |
| Live location | while en route to them | — | ✓ |
| Photos/signature | ✓ (own) | ✓ (own jobs) | ✓ |

Each audience has its own DTO mapper in `src/server/dto/*` with tests asserting forbidden fields are absent.

## 11. Consistency matrix — when X changes, update all of these in the same commit

| Change | Must also update |
|---|---|
| Any contract in `packages/contracts/src/api` | route handler, web hooks, `@sv/api-client`, admin + driver screens using it, tests, this doc |
| Booking status / dispatch / stage | state machine table, admin list filters + badges, driver job cards, customer manage + tracking timelines, emails, push copy, reports |
| Pricing config shape | `@sv/pricing` types + `validateConfig`, `PricingConfigSchema`, admin pricing editor + simulator, golden vectors (only via a new reviewed vector set), seed |
| Setting key/shape | settings schema, seed, admin settings screen, every reader (`getSettings`), public settings DTO, launch-check |
| Item catalogue fields | Item schema, catalogue endpoint, booking items picker, admin items screen, quote snapshot |
| Notification event | outbox handler, push copy, email template, in-app notification type, apps' deep-link router, event-matrix test |
| Public page data (pricing, settings, FAQs, reviews, location notes) | the `revalidateTag` call in the mutating endpoint |

## 12. Booking state machine (`packages/contracts/src/booking-state.ts`)

Single source for every status change on web, API, admin and driver apps. `assertTransition(kind, from, to, actor)` throws `INVALID_TRANSITION`; an exhaustive table test covers every (from, to, actor) combination.

**`BookingStatus`**

| From → To | Allowed actor(s) | Trigger / side effects |
|---|---|---|
| PENDING_PAYMENT → CONFIRMED | SYSTEM (payment succeeded), OWNER (offline payment) | outbox `booking.confirmed` |
| PENDING_PAYMENT → EXPIRED | SYSTEM (hold expiry) | capacity released; `booking.checkout_abandoned` |
| PENDING_PAYMENT → CANCELLED | ADMIN, OWNER (unpaid phone booking) | capacity released |
| EXPIRED → CONFIRMED | SYSTEM only (late payment and capacity still free — 10 §4.3) | as confirmed |
| CONFIRMED → IN_PROGRESS | DRIVER (first stage), ADMIN/OWNER (override + reason) | — |
| CONFIRMED → CANCELLED | CUSTOMER (within policy), ADMIN, OWNER | refund per choice; `booking.cancelled` |
| IN_PROGRESS → CONFIRMED | DRIVER (undo of the first stage within 2 min), ADMIN/OWNER (override + reason) | jobStage → NOT_STARTED |
| IN_PROGRESS → COMPLETED | DRIVER (final stage), ADMIN/OWNER (override + reason) | `completedAt`, driver earning, `booking.completed` |
| IN_PROGRESS → CANCELLED | ADMIN, OWNER (aborted job, reason required) | refund decision required |
| COMPLETED, CANCELLED | terminal | extra charges/refunds still allowed without a status change |

**`DispatchStatus`** (only while status is CONFIRMED or IN_PROGRESS)

| From → To | Actor | Notes |
|---|---|---|
| UNASSIGNED → OFFERED | ADMIN, OWNER | Assignment rows OFFERED with expiry |
| OFFERED → ACCEPTED | DRIVER (first to accept wins, 03 §6.3) | other offers → WITHDRAWN |
| OFFERED → UNASSIGNED | SYSTEM (all declined/expired), ADMIN (withdraw) | admin alert |
| UNASSIGNED → ACCEPTED | ADMIN, OWNER (direct assign) | driver push `JOB_ASSIGNED` |
| ACCEPTED → UNASSIGNED | ADMIN, OWNER (unassign), SYSTEM (reschedule) | driver push `JOB_WITHDRAWN` |

**`JobStage`** — path from `stagePathFor(service)`:
- With dropoff: NOT_STARTED → EN_ROUTE_TO_PICKUP → AT_PICKUP → LOADING → EN_ROUTE_TO_DROPOFF → AT_DROPOFF → UNLOADING → COMPLETED

Rules: DRIVER moves forward exactly one step, only on their own accepted job, only on the move date (London) or the day after (late-running jobs); may undo one step within 2 minutes. Leaving NOT_STARTED sets status IN_PROGRESS; reaching COMPLETED requires at least one AFTER photo (or a recorded skip reason) and a signature (or a recorded reason such as "customer not present"), then sets status COMPLETED. ADMIN/OWNER may set any stage with a reason (audited). Driver earning at completion = `floor(totalPence × payoutPercent / 100)`.
