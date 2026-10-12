# 09 — Customer self-service (no accounts, no passwords)

Customers never create an account. Every customer page is reached through a **signed link** sent by email, or by entering their email + booking reference.

## 1. Signed links (`src/server/auth/customer-links.ts`)

JWT (HS256, `jose`) signed with `CUSTOMER_LINK_SECRET`. Claims: `sub` (entity id), `aud` (purpose), `exp`, `eh` (first 16 hex chars of sha256 of the booking's current contact email — changing the contact email invalidates old links).

| Purpose (`aud`) | Used in | Expires |
|---|---|---|
| `manage` | every booking email, find-my-booking | later of 7 days from issue or move date + 30 days |
| `status` | confirmation page polling | 2 hours |
| `track` | "on the way" and day-before emails | move date + 2 days |
| `review` | completion email | completion + 60 days; single use (a review exists → 409) |
| `pay` | manual quote, extra charge, admin phone-booking emails | manual quote: its `validUntil`; phone booking: its `holdExpiresAt`; extra charge: 14 days |
| `file` | photo URLs inside the manage page | 10 minutes (issued per page load) |

`/manage/session?token=…` verifies a `manage` token and sets cookie `sv_manage` (HttpOnly, Secure, SameSite=Lax, path `/`, 7 days, value = a fresh short `manage` token), then redirects to `/manage` so the token leaves the URL. Invalid/expired → `/manage?expired=1`.

## 2. Find my booking (`/manage` with no cookie)

| Element | Spec |
|---|---|
| Heading | "Manage your booking" |
| Fields | Email · Booking reference (format hint "SV-XXXXXX", case-insensitive, accepts without the dash) |
| Action | "Email me a link" → `POST /manage/request-link` |
| Result (always the same, whatever the inputs) | "If those details match a booking, we've emailed you a link. It can take a minute to arrive." |
| Expired banner (`?expired=1`) | "That link has expired. Enter your details to get a new one." |
| Rate limit | 5 requests / hour / IP and 3 / hour / email (12-auth-security §5) |

## 3. Manage booking page (`/manage`)

Server-rendered from `GET /manage/booking` (cookie). `noindex`, `no-store`. Cards in order:

| Card | Contents | States |
|---|---|---|
| **Status header** | Reference (copy button), status badge, date + window ("Saturday 14 November, 8am–12pm"), "In 3 days" / "Today" / "Completed on…" | confirmed · in progress · completed · cancelled · awaiting payment (rare: phone bookings) |
| **Balance alert** (only when owed) | "£35.00 to pay for extra items" + "Pay now" (pay link) | |
| **Your move** | From → To with per-address access summary (floor, lift, carry, narrow, permit), items list (collapsed after 5), extras, route map thumbnail | |
| **Notes for your driver** | Editable textarea until 24 h before the slot; then read-only with "Need to change something? Call {phone}." | saving · saved · error |
| **Your driver** | After assignment: "Your driver is {firstName}." On the move day also van registration. Before assignment: "We'll email you when your driver is confirmed." | |
| **Payments** | Total, paid, refunds (with status: "£40.00 refund on its way — usually 5–10 working days to reach your card"), extra charges, link to receipt page `/manage/receipt` (printable; VAT breakdown when VAT registered) | |
| **Actions** | Change date (if allowed, §4) · Cancel booking (if allowed, §5) · Add to calendar · Track your move (move day) · Contact us (phone, email, WhatsApp) | disabled actions show why ("You can change your date online until 48 hours before your slot. Call us for anything later.") |
| **Timeline** | Booked → Driver confirmed → On the way → Arrived → Loading → On the way to your new place → Unloading → Done (from status + `jobStage`), with times | |
| **After the move** | Photos (proof of delivery) via `/api/v1/files/:id?token=` and the signature name/time; "How did we do?" → review link | |
| **Cancelled** | Cancellation time, refund amount and status | |

## 4. Change date (reschedule)

**Allowed when:** status CONFIRMED, `jobStage` NOT_STARTED, and now ≤ slot start − `cancellation.selfServiceRescheduleHours`.

1. "Change date" opens the price calendar (same component as booking) priced by `computeQuote(booking.pricingInput, ACTIVE config, londonToday())` with live availability; the current slot is marked "Your current slot".
2. Choosing a slot → `POST /manage/booking/reschedule/preview` → shows: new price, current price, **difference** ("You'll pay £12.40 more" / "We'll refund £8.10" / "Same price").
3. Confirm → `POST /manage/booking/reschedule` with `expectedDifferencePence` and an idempotency key:
   - **Difference ≤ 0:** applied immediately (transaction with slot advisory lock on the new slot); a negative difference creates a refund on the original payment via the outbox. Result screen: "Your move is now on {date}, {window}."
   - **Difference > 0:** server creates a `SlotHold` on the new slot (expires in `paymentHoldMinutes`) + Payment (`RESCHEDULE_DIFFERENCE`) + PaymentIntent → returns `clientSecret` → inline Payment Element "Pay £12.40 to confirm the new date". The webhook applies the move; if the hold expired and the slot is gone, the payment is refunded automatically and the customer is told (10-payments §4.3).
4. If a driver was assigned, the assignment is withdrawn (driver notified) and the booking returns to UNASSIGNED with an admin alert "Rescheduled booking needs a driver".
5. Emails: customer (new date, updated `.ics`), admins; outbox events per 13 §2.

## 5. Cancel

Policy from settings (`cancellation`), using hours between now and the slot's window start:

| Hours before slot | Refund of amount paid (net of earlier refunds) |
|---|---|
| ≥ `freeCancellationHours` | 100% |
| ≥ `noRefundHours` and < `freeCancellationHours` | `lateCancellationRefundPercent`% (rounded down to the penny) |
| < `noRefundHours` | 0% |

Flow: "Cancel booking" → sheet with the policy summary and the exact refund ("You'll get £74.20 back") from `POST /manage/booking/cancel/preview` → optional reason (select + text) → "Cancel my booking" (danger) → `POST /manage/booking/cancel` with `expectedRefundPence` (mismatch → re-show the new amount). Booking → CANCELLED, capacity released, refund requested through the outbox, driver and admins notified, customer email with refund details. Not allowed once `jobStage` ≠ NOT_STARTED ("Your move has started. Call us on {phone}.").

The statutory position (whether the 14-day cancellation right applies to removals booked for a specific date) is for the solicitor — see 18-legal §2. The policy engine reads only settings, so the owner can change rules without code.

## 6. Tracking page (`/track/[token]`)

Polls `GET /track/:token` every 10 s while visible (60 s when hidden); stops at COMPLETED/CANCELLED.

| Booking state | What the customer sees |
|---|---|
| Before the move day | "Your move is on Saturday 14 November, 8am–12pm. Tracking goes live on the day." |
| Move day, not started | "Your driver will set off soon. We'll show their location here once they're on the way." + driver first name + van reg |
| EN_ROUTE_TO_PICKUP | Map (static image via our proxy, refreshed each poll) with the van and your pickup pin; "{firstName} is on the way — arriving around 9:40am" (ETA from Mapbox Directions from the latest location, cached 2 minutes per booking) |
| AT_PICKUP / LOADING | "Your driver has arrived" / "Loading your things" with time |
| EN_ROUTE_TO_DROPOFF | Map with the van and the dropoff pin; ETA to the new address |
| AT_DROPOFF / UNLOADING | "Arrived at your new place" / "Unloading" |
| COMPLETED | "Your move is complete" + time, photos, review link |
| CANCELLED | "This booking was cancelled." |

Location is shown **only** during the two en-route stages, and only the latest point (no trail). Location older than 5 minutes shows "Last updated 7 minutes ago" instead of an ETA. Contact button calls the office number, never the driver. `noindex`.

## 7. Review page (`/review/[token]`)

- Rating: radio group of 5 stars (keyboard and screen-reader friendly, labels "1 star – poor" … "5 stars – excellent").
- Comment (optional, 1,000 chars). Display name pre-filled "{First name} {Last initial}." (editable, max 40). Town pre-filled from the pickup town.
- Notice: "Your review may appear on our website with your first name, last initial and town."
- Submit → 201 → "Thank you for your review." + if a Google Business Profile URL is set: "Would you also review us on Google?" button — shown to **every** reviewer regardless of rating (no review gating).
- Already reviewed → "You've already reviewed this move. Thank you."
- New reviews are PENDING until an admin publishes them; moderation may only remove reviews that break the published review rules (abuse, personal data, spam) — never because they're negative.

## 8. Pay page (`/pay/[token]`)

One page for every "please pay" request:

| Request kind | Summary shown | On success |
|---|---|---|
| Manual quote | Route, date + window chosen by the team, what's included, price, "Price held until {validUntil}" | Booking created and confirmed (10-payments §6) |
| Extra charge | Booking reference, description ("2 extra wardrobes"), amount | Booking total + paid updated; customer and admin emailed |
| Phone booking link | Full booking summary | Booking confirmed |

Elements: summary card, agreements (terms; express-start acknowledgement when required), Payment Element, "Pay £X". States: ready · processing · paid ("Payment received — thank you") · expired ("This payment link has expired. Call {phone} and we'll send a new one.") · already paid · cancelled request.

## 9. Emails → pages (every link in every email)

| Email (11-emails) | Links to |
|---|---|
| Booking confirmed | `/manage/session?token=` (manage), `.ics` attachment |
| Driver assigned | manage |
| Day-before reminder | manage, `/track/[token]` |
| On the way | `/track/[token]` |
| Completed + receipt | manage (receipt), `/review/[token]`, Google review link (if set) |
| Rescheduled / cancelled / refund | manage |
| Manual quote ready / extra charge / phone-booking link | `/pay/[token]` |
| Find-my-booking link | manage |

## 10. Acceptance (`@self-service` E2E)

1. Find my booking with wrong details shows the same neutral message; correct details email a link (Resend test mode / captured in a mailbox stub) that opens the manage page.
2. Reschedule cheaper → refund requested; dearer → pay difference with test card → new date shown; the old slot's capacity is freed.
3. Cancel at each policy band shows the right refund and the Stripe refund is created exactly once.
4. Tracking page shows each stage as a seeded driver app event stream advances; location hidden outside en-route stages.
5. Review submits once; second attempt shows "already reviewed".
6. Expired pay link shows the expired state; paid link shows already-paid.
7. Changing a booking's contact email (admin) invalidates old manage links.
