# 11 — Emails (Resend + React Email)

## 1. Setup

- `packages/emails`: React Email templates (`src/templates/*.tsx`) + shared components (`src/components/`): `Layout` (logo header, white card on mist, footer), `Heading`, `Text`, `Button` (gorse, ink text, 48 px tall), `SummaryTable`, `AddressBlock`, `PriceLines`, `Divider`, `FooterLegal` (company legal line from settings, contact, "You're getting this email because you booked a move with Speedy Van.").
- `npm run email:dev` runs the React Email preview server with fixtures for **every** template (all states, long names, single-address jobs, VAT on/off).
- Sending happens **only** in outbox handlers (`email.send`) via `src/server/integrations/resend`: `from: EMAIL_FROM`, `replyTo: contact.emailBookings`, `subject`, `react`, plain-text alternative rendered from the same template, `tags: [{ name: 'template', value }]`, `headers: { 'X-Entity-Ref-ID': outboxEventId }`. Use Resend's idempotency key option keyed by the outbox event id if the SDK supports it; otherwise the outbox's DONE status is the guard.
- DNS (owner, Phase 0): Resend's SPF/DKIM records for `speedyvan.uk` (or the `send.` subdomain Resend specifies), plus `_dmarc` TXT `v=DMARC1; p=none; rua=mailto:<owner mailbox>` — move to `p=quarantine` after 4 clean weeks. **Never change existing MX records.**
- Resend webhook `POST /api/webhooks/resend` (signature verified per Resend docs): `email.bounced` / `email.complained` → admin notification "Email to {customer} bounced — call them on {phone}" + booking audit entry.

## 2. Rules

- Subject ≤ 60 characters; preheader set; sentence case; brand voice (02 §10).
- Every email states the booking reference and has exactly one primary button.
- Times and dates in London time, written out ("Saturday 14 November, 8am–12pm").
- Money from `formatGBP`. VAT lines only when `company.vatRegistered` (price shown is VAT-inclusive; VAT = total ÷ 6, rounded to the penny — consumer prices include VAT).
- No tracking pixels. Links carry `?utm_source=email&utm_medium=transactional&utm_campaign={template}`.
- Light theme only; contrast per 02 §2.4; images have alt text; layout works with images off.

## 3. Templates

### Customer

| Template | Trigger (outbox event) | Subject | Must include |
|---|---|---|---|
| `booking-confirmed` | `booking.confirmed` | "You're booked: {Sat 14 Nov}, {8am–12pm} ({ref})" | Summary (service, date/window, from → to, items count, extras), amount paid + VAT line, "What happens next" (numbered), Manage button, `.ics` attachment, contact block |
| `manage-link` | find-my-booking | "Your Speedy Van booking link" | Manage button, "Didn't ask for this? You can ignore this email." |
| `driver-assigned` | `booking.driver_accepted` | "{FirstName} will be your driver on {Sat 14 Nov}" | Driver first name, date/window, Manage button |
| `reminder-day-before` | cron `reminders` (17:00 London, day before) | "Tomorrow: your move, {8am–12pm}" | Window, addresses, notes for driver, tracking link (live tomorrow), "Before we arrive" checklist (owner content), contact |
| `on-the-way` | stage `EN_ROUTE_TO_PICKUP` | "{FirstName} is on the way" | Track button, ETA if known |
| `move-completed` | `booking.completed` | "Your move is complete ({ref})" | Completion time, receipt (all payments/refunds), proof-of-move link, Review button + "Review us on Google" link (all customers) |
| `rescheduled` | `booking.rescheduled` | "Your move is now on {Tue 17 Nov}" | Old → new date, price difference paid/refunded, updated `.ics` (same UID, SEQUENCE+1) |
| `cancelled` | `booking.cancelled` | "Your booking {ref} is cancelled" | Who cancelled, refund amount + timing, contact |
| `refund-issued` | `payment.refund.created` (not part of a cancellation) | "Refund of £{x} on its way" | Amount, reason, timing |
| `payment-received` | extra charge / reschedule difference paid | "Payment received: £{x}" | What it was for, new totals |
| `manual-quote-received` | `manual_quote.requested` | "We're pricing your move" | What they asked for, "We'll email your fixed price", contact |
| `manual-quote-ready` | `manual_quote.priced` | "Your fixed price: £{x}" | Date/window, what's included, admin message, Pay button, valid until |
| `manual-quote-declined` | `manual_quote.declined` | "About your moving request" | Admin message, contact |
| `extra-charge-request` | `extra_charge.awaiting_payment` | "Payment needed for your move ({ref})" | Description, amount, Pay button |
| `payment-link` | phone booking created with LINK | "Confirm your move: pay £{x}" | Booking summary, Pay button, hold expiry |
| `payment-after-expiry-refunded` | 10-payments §4.3 | "We've refunded your payment" | Apology, full refund, phone |
| `contact-received` | contact form | "We've got your message" | Copy of message, reply-time expectation only if the owner sets one |

### Staff

| Template | Trigger | Subject | Recipients |
|---|---|---|---|
| `staff-login-code` | OTP request | "Your Speedy Van sign-in code: {123 456}" (code also in body, large) | the user |
| `staff-invite` | team/driver invite | "You've been invited to Speedy Van {Admin\|Driver}" | invitee — app install link (from Settings → Apps), sign-in steps |
| `admin-new-booking` | `booking.confirmed` | "New booking {ref}: {service}, {Sat 14 Nov} {morning}, £{x}" | `contact.emailAdminAlerts` (backup to push) |
| `admin-manual-quote` | `manual_quote.requested` | "Quote request: {from} to {to}" | alerts list |
| `admin-dispute` | `charge.dispute.created` | "Payment dispute on {ref}" | OWNER + ADMIN users |
| `admin-daily-summary` | cron 07:00 London | "Today: {n} moves, {u} need a driver" | OWNER + ADMIN users (per-user opt-out in app settings) |
| `admin-system-alert` | outbox FAILED, webhook failures, push failure spike | "Action needed: {issue}" | OWNER |

## 4. Calendar file (`.ics`)

Generated by `src/server/ics.ts` (no dependency): `VCALENDAR` / `VEVENT` with `UID:{bookingId}@speedyvan.uk`, `SEQUENCE` (0, +1 per reschedule), `DTSTART`/`DTEND` as UTC (converted from the London slot window), `SUMMARY:Speedy Van move ({ref})`, `LOCATION:{pickup label}`, `DESCRIPTION:Manage your booking: {link}`, CRLF line endings and 75-octet folding. Unit-tested across a BST/GMT boundary.

## 5. Tests

- Snapshot test per template (HTML + text) with fixtures.
- Outbox → email mapping covered by the event-matrix test (13 §2).
- Rendering check: no unresolved `{placeholders}`, no "null"/"undefined", all links absolute with the canonical origin.
