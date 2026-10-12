# 10 — Payments (Stripe)

## 1. Owner setup (Phase 0 and Phase 17)

- Stripe account in the company name; business details complete; bank account for payouts.
- Statement descriptor: `SPEEDYVAN` (Settings → Public details). PaymentIntents set `statement_descriptor_suffix` to the booking reference without the dash (e.g. `SV7K3Q2M`) so customers recognise the charge.
- Payment methods (Settings → Payment methods): cards, Apple Pay, Google Pay, Link. Nothing that settles slowly (no bank debits) unless added deliberately later.
- Apple Pay: register `www.speedyvan.uk` (and the apex) under **Payment method domains**. If Stripe asks for a domain-association file, Codex serves it from `apps/web/public/.well-known/` with Stripe's exact contents. Set `launch.applePayDomainVerifiedAt` in Admin once verified.
- Radar: default rules on. Email receipts from Stripe: **off** (we send our own).
- Webhook endpoint (Phase 17 for live; `stripe listen` locally): `https://www.speedyvan.uk/api/webhooks/stripe`, events in §4.

## 2. Money model (per booking)

| Field | Meaning | Changes when |
|---|---|---|
| `totalPence` | What the customer has agreed to pay in total (move price + approved extras + reschedule differences) | booking created; extra charge approved; reschedule applied; admin re-price applied |
| `paidPence` | Sum of SUCCEEDED payments (Stripe and offline) | `payment_intent.succeeded`; offline payment recorded |
| `refundedPence` | Sum of SUCCEEDED refunds | refund succeeded |
| **Balance** | `totalPence − (paidPence − refundedPence)` | > 0 = customer owes (show "Pay now"); < 0 = credit due (admin sees "Refund £X due") |

All four are recomputed from `Payment`/`Refund` rows inside the same transaction that changes them (never incremented blindly), and a nightly integrity check reports any booking whose stored values disagree with its rows.

## 3. Creating PaymentIntents (one helper for every kind)

All payments use PaymentIntents with the Payment Element on our own pages. Stripe Checkout Sessions are not used (`Payment.stripeCheckoutSessionId` stays null; it exists only for a possible future use).

`createPaymentIntent(payment: Payment)` in `src/server/integrations/stripe/payment-intents.ts`:

```ts
stripe.paymentIntents.create({
  amount: payment.amountPence,
  currency: 'gbp',
  automatic_payment_methods: { enabled: true },
  statement_descriptor_suffix: referenceWithoutDash,
  receipt_email: undefined,                      // our own emails
  metadata: { paymentId: payment.id, bookingId: payment.bookingId, kind: payment.kind },
  description: `Speedy Van ${reference} — ${kindLabel}`,
}, { idempotencyKey: `pi_${payment.id}` })
```

- Store `stripePaymentIntentId` immediately. Reuse an existing PaymentIntent for the same `Payment` (never create two).
- Timeout 10 s, 2 retries with backoff for network errors only. Map Stripe errors to `PAYMENT_FAILED` / `UPSTREAM_UNAVAILABLE`.

| Kind | Created by | Amount |
|---|---|---|
| `BOOKING` | `POST /bookings` | server price for the slot |
| `RESCHEDULE_DIFFERENCE` | `POST /manage/booking/reschedule` (difference > 0) | new price − current total |
| `MANUAL_QUOTE` | `POST /pay/:token/intent` | admin-set price |
| `EXTRA_CHARGE` | `POST /pay/:token/intent` | approved extra |
| `ADMIN_BOOKING` | `POST /pay/:token/intent` for a phone booking | booking total |

## 4. Webhook (`POST /api/webhooks/stripe`)

1. Read the **raw body** (`await req.text()`), verify with `stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)`. Invalid → 400.
2. Insert `StripeEvent { id }`; if it already exists and `processedAt` is set → 200 (replay). 
3. Handle the event in a transaction; set `processedAt`. On error: record `error`, report to Sentry, return 500 so Stripe retries.
4. Respond within 10 s. Heavy work (emails, push) goes to the outbox.

| Event | Handling |
|---|---|
| `payment_intent.succeeded` | Find `Payment` by PI id (fallback `metadata.paymentId`). Already SUCCEEDED → no-op. Verify `amount_received === amountPence` and currency `gbp` (mismatch → Sentry critical + admin alert, do not confirm). Payment → SUCCEEDED, store `latest_charge`. Then by kind (§4.1–4.3). |
| `payment_intent.processing` | Payment → PROCESSING |
| `payment_intent.payment_failed` | Record `failureCode`/`failureMessage`; Payment stays REQUIRES_PAYMENT (the customer can retry on the same intent until the hold expires) |
| `payment_intent.canceled` | Payment → CANCELED |
| `charge.refunded`, `refund.updated` | Upsert `Refund` rows by `stripeRefundId` and update status. A refund made directly in the Stripe Dashboard creates a Refund row ("Created in Stripe Dashboard") and an admin notification. Recompute `refundedPence`. |
| `charge.dispute.created` | Urgent admin push + email "Payment dispute on SV-…" with an evidence checklist (signature, photos, timestamps, GPS trail, emails); booking audit entry |
| `charge.dispute.closed` | Record the outcome; notify admins |

### 4.1 Booking-type payments (`BOOKING`, `ADMIN_BOOKING`, `MANUAL_QUOTE`)

Booking `PENDING_PAYMENT` → `CONFIRMED`, clear `holdExpiresAt`, recompute money fields, outbox `booking.confirmed` (dedupe key `booking.confirmed:<id>`), mark the Quote CONVERTED, ManualQuote ACCEPTED where relevant.

### 4.2 `RESCHEDULE_DIFFERENCE` and `EXTRA_CHARGE`

Reschedule: inside the slot lock, apply the `SlotHold` (move date/slot, add the difference to `totalPence`), delete the hold, withdraw any driver assignment, outbox `booking.rescheduled`. Extra charge: ExtraCharge → PAID, outbox `booking.extra_paid`.

### 4.3 Paid after the hold expired (rare, must be handled)

The hold-expiry cron cancels PaymentIntents before expiring bookings, so this only happens if payment completed in the same seconds. Handler: take the slot lock; if capacity still allows → confirm normally (audit note "confirmed after hold expiry"); otherwise refund in full via the outbox, keep the booking EXPIRED, email the customer ("We're sorry — that slot filled while your payment was processing. We've refunded you in full; call us and we'll find you another slot.") and alert admins. Same logic for an expired `SlotHold`.

## 5. Hold expiry (`/api/cron/expire-holds`, every 5 minutes)

For each `PENDING_PAYMENT` booking with `holdExpiresAt < now` and each expired `SlotHold`:
1. `stripe.paymentIntents.cancel(pi)`; if Stripe reports the intent already succeeded or is processing → skip (the webhook will confirm).
2. Booking → EXPIRED (capacity released), Payment → CANCELED; outbox `booking.checkout_abandoned` (no push; appears in Admin → Leads → Abandoned checkouts with contact details).
3. Phone bookings use `operations.phoneBookingHoldHours` (default 24) instead of `paymentHoldMinutes`; their expiry notifies the admin who created them.

## 6. Payment requests (`/pay/[token]`)

- **Manual quote:** `POST /pay/:token/intent` → transaction: slot lock, capacity check for the quote's date/slot, create Booking (source MANUAL_QUOTE, PENDING_PAYMENT, hold `paymentHoldMinutes`, `pricingInput` from the quote, `priceBreakdown = { manual: true, pricePence }`), Payment, link `ManualQuote.bookingId` → PaymentIntent. Slot gone → "This slot is no longer available. Call {phone}." + admin alert.
- **Extra charge:** ExtraCharge AWAITING_PAYMENT → Payment `EXTRA_CHARGE` → PaymentIntent.
- **Phone booking:** booking already exists (PENDING_PAYMENT) → reuse its Payment/PaymentIntent.
- Re-opening the page reuses the same PaymentIntent.

## 7. Refunds

- Created only through `requestRefund(bookingId, amountPence, reason, actor)`: allocates the amount across the booking's SUCCEEDED payments, newest first, never more than each payment's unrefunded amount; creates `Refund` rows (PENDING); outbox action `payment.refund` per row (calls Stripe). When Stripe accepts it, the handler enqueues the notification event `payment.refund.created` (13 §2) unless the refund is part of a cancellation (the cancellation email already covers it).
- Outbox handler calls `stripe.refunds.create({ payment_intent, amount, reason: 'requested_by_customer', metadata: { refundId, bookingId } }, { idempotencyKey: \`re_${refund.id}\` })`, stores `stripeRefundId` and status. Final status arrives by webhook.
- OFFLINE payments can't be refunded through Stripe: the Refund is created with an admin task "Refund £X by bank transfer"; the admin marks it done with a reference (audited).
- Customer copy: "Your refund of £74.20 is on its way. It usually reaches your card within 5–10 working days."

## 8. Offline payments (OWNER only)

Admin → Booking → "Record offline payment": amount, method note, reference (required). Creates `Payment { method: OFFLINE, status: SUCCEEDED, offlineReference, recordedById }`, recomputes money, audits, and confirms the booking if it was awaiting payment. Used for phone customers paying by bank transfer and for re-entering moves already paid on the old system.

## 9. Testing

- Local: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`; use the printed signing secret.
- Integration tests use Stripe test mode with fixtures for webhook payloads (signed with a test secret) — no network in unit tests.
- E2E cards: `4242 4242 4242 4242` (success), `4000 0027 6000 3184` (3-D Secure), `4000 0000 0000 0002` (decline), `4000 0000 0000 9995` (insufficient funds).
- Required tests: webhook replay is a no-op · amount mismatch never confirms · double `POST /bookings` → one PaymentIntent · payment after hold expiry with slot free → confirmed; with slot taken → refunded · refund allocation across two payments · Dashboard-created refund appears in admin.

## 10. Going live (Phase 17)

Switch keys in Vercel production env, create the live webhook endpoint with the §4 events, put its secret in `STRIPE_WEBHOOK_SECRET`, verify Apple Pay domain, make one real booking and refund it from the Admin app, confirm the refund webhook updates the booking.
