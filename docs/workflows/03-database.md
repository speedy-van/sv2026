# 03 — Database (Neon Postgres + Prisma 7)

Schema: **`docs/reference/schema.prisma`** — validated with Prisma 7.10's own schema validator (37 models, 24 enums). Copy it to `packages/db/prisma/schema.prisma` unchanged; extend only through migrations recorded in `docs/DECISIONS.md`.

## 1. Conventions

- IDs: `cuid()` strings. Human references: `Booking.reference` = `SV-` + 6 Crockford base32 chars (alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, no I/L/O/U); retry on unique collision.
- Money: `Int` pence. Engine inputs (miles, m³): `Float`, stored exactly as priced.
- Move dates: `@db.Date`, written/read as `YYYY-MM-DD` strings via `@sv/contracts/time` helpers (`toDbDate`, `fromDbDate`) — never through local `Date` math.
- Emails stored lower-cased and trimmed. Phones stored E.164 (`libphonenumber-js`, region GB).
- Every `Json` column has a zod schema in `@sv/contracts` and is parsed on read (`parseJson(Schema, value)`), never cast.
- Soft data rules live in services, hard rules in the DB (unique, FK, CHECK).

## 2. Setup (`packages/db`)

```
packages/db/
  prisma/schema.prisma
  prisma/migrations/
  prisma.config.ts            # schema path, migrations path, seed command, datasource url = DATABASE_URL_UNPOOLED
  src/client.ts               # PrismaClient with PrismaNeon adapter (pooled DATABASE_URL), singleton per runtime
  src/seed/index.ts           # idempotent seed (§8)
  src/seed/facts.ts           # parses the yaml block from docs/FACTS.md
  src/locks.ts                # advisory-lock helpers (§6)
  src/outbox.ts               # enqueue helper used inside transactions
  src/index.ts                # exports client factory + types (server-only)
```

- Follow the current Neon + Prisma 7 guide exactly (`prisma.config.ts` for the CLI, `@prisma/adapter-neon` at runtime). If the Node runtime lacks a global `WebSocket`, set the Neon driver's WebSocket constructor as that guide shows.
- Singleton: store the client on `globalThis` in development to survive hot reload.
- Generated client output: `packages/db/src/generated/prisma` (git-ignored); `postinstall` and `build` run `prisma generate`.
- Interactive transactions must work (they're required by §6) — add an integration test that runs one.

## 3. Entity map

| Area | Models | Notes |
|---|---|---|
| Staff & auth | User, AuthOtp, Session, PushDevice, PushTicket, Notification | One `User` per staff member; `DriverProfile` 1:1 for drivers |
| Fleet & drivers | DriverProfile, Van, DriverUnavailability, DriverLocation, DriverEarning, Payout | |
| Selling | Customer, PricingConfigVersion, Quote, ManualQuote, Booking, CapacityRule, CapacityOverride, SlotHold | Quote stores the full priced input; Booking copies it; SlotHold reserves a reschedule target while the customer pays the difference |
| Doing | Assignment, JobEvent, JobPhoto, Signature | JobEvent is append-only |
| Money | Payment, Refund, ExtraCharge, StripeEvent | `Payment.method = OFFLINE` for cash/bank/legacy, admin-recorded |
| Content | Item, ItemPreset, Review, LocationContent, Faq, ContactMessage | |
| Platform | Setting, OutboxEvent, AuditLog | |

`Booking.pricingInput` + `Booking.pricingVersionId` + `Booking.distanceMiles` are sufficient to recompute the original price bit-for-bit. Admin re-pricing starts from these, never from defaults or zeros.

## 4. Raw SQL in the first migration

Create the Prisma migration, then append to its `migration.sql`:

```sql
-- exactly one ACTIVE pricing version
CREATE UNIQUE INDEX "one_active_pricing_version" ON "PricingConfigVersion" ("status") WHERE "status" = 'ACTIVE';

-- money and counts can't go negative
ALTER TABLE "Booking" ADD CONSTRAINT "booking_money_nonneg" CHECK ("totalPence" >= 0 AND "paidPence" >= 0 AND "refundedPence" >= 0 AND "refundedPence" <= "paidPence");
ALTER TABLE "Payment" ADD CONSTRAINT "payment_amount_pos" CHECK ("amountPence" > 0);
ALTER TABLE "Refund" ADD CONSTRAINT "refund_amount_pos" CHECK ("amountPence" > 0);
ALTER TABLE "ExtraCharge" ADD CONSTRAINT "extra_amount_pos" CHECK ("amountPence" > 0);
ALTER TABLE "CapacityRule" ADD CONSTRAINT "capacity_rule_valid" CHECK ("weekday" BETWEEN 0 AND 6 AND "capacity" >= 0);
ALTER TABLE "CapacityOverride" ADD CONSTRAINT "capacity_override_valid" CHECK ("capacity" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT "review_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "DriverProfile" ADD CONSTRAINT "payout_percent_range" CHECK ("payoutPercent" BETWEEN 0 AND 100);
ALTER TABLE "Payment" ADD CONSTRAINT "offline_needs_reference" CHECK ("method" <> 'OFFLINE' OR ("offlineReference" IS NOT NULL AND "recordedById" IS NOT NULL));

-- case-insensitive search helpers for admin
CREATE INDEX "booking_contact_email_lower" ON "Booking" (lower("contactEmail"));
CREATE INDEX "customer_name_lower" ON "Customer" (lower("name"));
```

Migrations are forward-only. Destructive changes follow expand → backfill → contract across separate deploys.

## 5. Settings (`Setting.key` → zod schema in `@sv/contracts/settings`)

| Key | Contents | Edited in | Public? |
|---|---|---|---|
| `company` | legalName, tradingName, companyNumber, registeredIn, registeredOffice, vatRegistered, vatNumber, icoRegistrationNumber | Admin → Settings → Company | yes (footer, legal) |
| `contact` | phoneDisplay, phoneE164, whatsappE164, emailPublic, emailBookings, emailAdminAlerts[], phoneHours, showAddressPublicly | Settings → Contact | partly (no admin alert emails) |
| `web` | canonicalOrigin, googleBusinessProfileUrl, analytics IDs, socials | Settings → Website | partly |
| `operations` | slotWindows, minLeadMinutes, defaultCapacityPerSlot, serviceAreaRule, crossBorderMoves, maxInstantDistanceMiles, quoteValidityMinutes, paymentHoldMinutes, phoneBookingHoldHours (24), bookingPaused (false), jobSizeRules (`[]` — §6.1) | Settings → Operations | slot windows, bookingPaused |
| `apps` | { adminInstallUrl, driverInstallUrl } (EAS internal distribution links) | Settings → Apps | no |
| `cancellation` | freeCancellationHours, lateCancellationRefundPercent, noRefundHours, selfServiceRescheduleHours | Settings → Cancellation | yes (policy page, manage page) |
| `insurance` | goodsInTransitInsurer, goodsInTransitCoverPence, publicLiabilityCoverPence, claimsEmail | Settings → Insurance | only if filled |
| `trust` | yearsTrading, vansInFleet | Settings → Company | only if filled |
| `drivers` | defaultPayoutPercent | Settings → Drivers | no |
| `siteBanner` | { enabled, text, href?, tone } | Content → Banner | yes |
| `notifications` | { newBookingRepeatUntilSeen: boolean, driverQuietHours: { start, end } } | Settings → Notifications | no |
| `seo` | { indexTier3: boolean } (default false — 08-seo §5) | Content → SEO | affects robots meta |
| `legal` | { requireExpressStartAck: boolean } (default true until the solicitor advises — 18-legal §2) | Settings → Legal (**OWNER**) | affects checkout |
| `launch` | { legalApprovedAt, applePayDomainVerifiedAt, missingFacts: string[] } | Settings → Launch | no |

Access via `getSettings()` (server, cached per request + `unstable_cache` with tag `settings`) and `getPublicSettings()` (strips private fields). Every update: zod-validate, write, audit log, `revalidateTag('settings')`.

## 6. Concurrency patterns (use exactly these)

### 6.1 Slot capacity (booking creation, reschedule, admin booking)

Serialise per date+slot with a transaction-scoped advisory lock — no lost updates, no retry storms:

```ts
await prisma.$transaction(async (tx) => {
  const range = slotsCovered(slot, blocksSlots);              // e.g. ['MORNING','AFTERNOON']; throws SLOT_UNAVAILABLE if it runs past EVENING
  for (const s of range) await lockSlot(tx, moveDate, s);     // fixed order morning → evening: SELECT pg_advisory_xact_lock(hashtext('slot:' || $date || ':' || $s))
  for (const s of range) {
    const used = await countSlotUsage(tx, moveDate, s, now);  // Σ capacityUnits whose range covers s: CONFIRMED | IN_PROGRESS | COMPLETED,
                                                              //   PENDING_PAYMENT with holdExpiresAt > now, SlotHold with expiresAt > now
    const capacity = await capacityFor(tx, moveDate, s);      // override ?? rule ?? settings.defaultCapacityPerSlot
    if (used + capacityUnits > capacity) throw new AppError('SLOT_UNAVAILABLE', 'That slot has just been taken.');
  }
  return createBookingRows(tx, …);                            // Booking + Payment + OutboxEvent in the same tx
});
```

**Job size (optional, owner-controlled).** `operations.jobSizeRules` is a list like `[{ "minVolumeM3": 20, "capacityUnits": 1, "blocksSlots": 2 }, { "minVolumeM3": 35, "capacityUnits": 2, "blocksSlots": 3 }]` — default `[]`, which means every job uses 1 crew for 1 slot (the simple model). When rules exist, the quote's volume picks the highest matching rule and the booking stores `capacityUnits` (crews needed) and `blocksSlots` (consecutive slots the job occupies from its start slot, same day only). Usage of slot S = Σ `capacityUnits` of bookings/holds that day whose `[slot … slot + blocksSlots − 1]` range includes S. A slot is bookable for a job only if **every** slot it would occupy has room for its `capacityUnits` and the range doesn't run past the evening slot. The lock in the transaction covers every slot in the range (lock in a fixed order: morning → evening, to avoid deadlocks).

Test (Phase 4): capacity 1, fire 10 concurrent bookings for the same slot → exactly 1 succeeds, 9 get `SLOT_UNAVAILABLE`. With a rule `{minVolumeM3: 20, capacityUnits: 1, blocksSlots: 2}`, a 30 m³ morning booking makes the afternoon full for a capacity-1 day.

### 6.2 Admin edits — optimistic concurrency

Mutations send `expectedVersion`; update with `where: { id, version: expectedVersion }` and `version: { increment: 1 }`. Zero rows → `409 CONFLICT` "This booking changed while you were editing. Reload to see the latest." The apps reload and re-apply.

### 6.3 Driver offer acceptance

Conditional update: `updateMany({ where: { id: bookingId, dispatchStatus: 'OFFERED' }, data: { dispatchStatus: 'ACCEPTED', driverId } })` together with the Assignment row in one transaction. Count 0 → `409 OFFER_TAKEN`.

### 6.4 Status transitions

`assertTransition(from, to, actor)` from `@sv/contracts/booking-state` before every write; the update's `where` includes the expected current status.

## 7. Outbox

- `enqueue(tx, type, payload, dedupeKey?)` inside the same transaction as the state change. `dedupeKey` (e.g. `booking.confirmed:<bookingId>`) makes duplicates impossible.
- Processor: claims up to 25 rows with `SELECT … FOR UPDATE SKIP LOCKED` where `status = 'PENDING' AND "nextAttemptAt" <= now()`, sets `PROCESSING`, runs the handler, then `DONE` or back to `PENDING` with backoff 1 m, 5 m, 15 m, 1 h, 6 h; after 6 failures → `FAILED`, Sentry alert, owner notification.
- Triggered by Next.js `after()` right after the request commits, plus `/api/cron/outbox` every minute as the safety net. Handlers must be idempotent (they may run twice).
- Event types and their fan-out: `13-notifications-realtime.md §2`.

## 8. Seed (`npm run db:seed`, idempotent — second run changes nothing)

1. Parse `docs/FACTS.md` YAML; zod-validate. Each `TODO(owner)` becomes `null` in the setting and is listed in `launch.missingFacts` (read by launch-check). In development, `defaultCapacityPerSlot` falls back to 1 with a console warning.
2. `PricingConfigVersion` v1 = `DEFAULT_PRICING_CONFIG`, status ACTIVE, `approvedByOwner: false` (only if no version exists).
3. Items from `docs/data/items-catalogue.csv` (upsert by slug; never delete).
4. Presets from `docs/data/item-presets.json` (upsert by slug; validate every itemSlug exists).
5. `CapacityRule` for 7 weekdays × 3 slots = `defaultCapacityPerSlot` (insert missing only).
6. `CapacityOverride` capacity 0 for each `closedDates` entry × 3 slots (insert missing only).
7. Settings from facts (upsert; never overwrite a value already edited in Admin — compare `updatedById`).
8. FAQs from `apps/web/src/content/faqs.ts` seed list (insert if table empty).
9. Owner user from `SEED_OWNER_EMAIL` / `SEED_OWNER_NAME` (role OWNER, ACTIVE) if no OWNER exists.
10. `LocationContent` rows for every location slug: the 8 city drafts from 08-seo §12 with `published: false`; all others with empty notes. Insert missing only — never overwrite notes edited in Admin.

## 9. Retention (cron `quote-cleanup` and `data-retention`, daily 03:15 London)

| Data | Kept | Then |
|---|---|---|
| Quotes never booked | 13 months | deleted (funnel reports aggregate before deletion) |
| AuthOtp | 24 h | deleted |
| Sessions expired/revoked | 90 days | deleted |
| Driver locations | 30 days after the job's completion | deleted |
| Job photos & signatures | 12 months after the move date | blob + row deleted |
| OutboxEvent DONE | 30 days | deleted |
| StripeEvent | 90 days | deleted |
| Notifications | 90 days | deleted |
| AuditLog | 2 years | deleted |
| Bookings, payments, refunds | 6 years (accounting records) | customer fields anonymised on request before then (see 18-legal) |

## 10. Backups & restore

Use a Neon plan with at least 7 days point-in-time restore. Before launch, rehearse a restore: create a branch from a timestamp an hour earlier, point a preview deployment at it, confirm bookings are there, delete the branch. Write the steps in `docs/INCIDENTS.md` (created in Phase 16).
