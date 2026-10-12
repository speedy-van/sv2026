# 14 — Admin iOS app (`apps/admin`)

The admin app runs the whole business. There is no web admin. Built with Expo (Expo Router), `@sv/api-client`, React Query, `@sv/tokens`. Universal app: iPhone and iPad (split views on iPad).

## 1. App identity and configuration

| Item | Value |
|---|---|
| Name on home screen | "SV Admin" |
| Bundle identifier | `uk.speedyvan.admin` |
| URL scheme | `speedyvan-admin` |
| Icon | ink background, gorse van glyph (02 §5) |
| Orientation | portrait on iPhone; all on iPad |
| EAS build profiles | `development` (dev client, internal), `preview` (internal distribution, API `https://staging.speedyvan.uk`, Stripe test), `production` (internal distribution, API `https://www.speedyvan.uk`) |
| Updates | `expo-updates`, `runtimeVersion: { policy: 'appVersion' }`, channels `preview` / `production`; on launch check for an update, download in background, show "Restart to update" banner |
| Distribution | EAS internal distribution (ad hoc) to registered staff iPhones (DECISIONS D05); install link stored in Settings → Apps |
| Permissions | Notifications (required for alerts), Face ID. No location, camera or contacts |

## 2. Shell, gates and navigation

```
app/_layout.tsx          QueryClient, theme, fonts, Sentry, notification listeners, deep-link router
  gates (in order): update-required → signed-in → app-lock (Face ID) → notification permission explainer (first run)
app/(auth)/sign-in.tsx   email → "Send code"
app/(auth)/code.tsx      6-digit input (auto-fill from email not possible; numeric keypad, paste support)
app/(app)/_layout.tsx    Tabs: Today · Bookings · Schedule · Drivers · More
```

Global UI: offline banner (NetInfo) disables mutations ("You're offline — changes are paused"); `NewJobModal` (13 §6) mounted at the root; toasts; every screen wrapped in `ScreenState` (loading skeleton, empty, error + retry). Mutations show progress on the button that triggered them and a toast with the same verb ("Driver assigned", "Refund requested"). `409 CONFLICT` → toast "This booking changed — showing the latest" and refetch.

## 3. Screens (data source → actions)

### Today (dashboard) — `GET /admin/dashboard?date=`, `GET /admin/feed`
- Date header with previous/next day arrows and "Today" shortcut.
- Alert banners (only when true): notifications off on this device · pricing not approved (OWNER) · failed system events · open disputes · booking paused.
- Four figures (Bricolage numbers): Moves today · Need a driver (rowan when > 0, taps to filtered list) · Paid today · Paid this week.
- **New** section: unseen new bookings with inline "Assign driver".
- Jobs by slot (Morning / Afternoon / Evening): card = window, towns "Paisley → Edinburgh", service, driver name or "Needs a driver" badge, live stage dot.
- Leads strip: quote requests waiting · abandoned checkouts (24 h).
- Live drivers card (Apple Maps snapshot) → Live map.
- Pull to refresh; polling per 13 §9.

### Bookings — `GET /admin/bookings`
- Search (reference, name, phone, email, postcode) with 300 ms debounce.
- Segments: Upcoming · Today · Needs driver · Unpaid · Completed · Cancelled · All. Filter sheet: date range, service, driver, source (web/phone/manual quote).
- Row: date + slot, reference, customer name, towns, total, status + dispatch badges. Infinite scroll. iPad: list + detail side by side.
- "+" → New phone booking.

### Booking detail — `GET /admin/bookings/:id`
- Header: reference (copy), status + dispatch badges, date + window (tap → Reschedule), total / paid / balance.
- Action bar: **Assign driver** · **Call** (tel:) · **Message** (sheet: WhatsApp, SMS, email) · **More** (Edit details, Re-price, Reschedule, Cancel, Refund, Extra charge, Record offline payment [OWNER], Resend email, Copy payment link, Audit).
- Sections: Customer (contact, previous bookings → customer) · Route (Apple Maps with both pins and the route polyline from `routeGeometry`; miles/time; "Open in Maps") · Pickup and dropoff (address, flat, floor, lift, carry, narrow, permit, notes) · Items (qty, volume) and extras · Notes (customer notes read-only; admin notes inline-editable) · Price breakdown (lines + multipliers) · Payments, refunds, extra charges (driver requests show Approve / Reject) · Driver and van (assignment history with offer/accept times) · Job progress (stage timeline with times and map points) · Photos and signature · Activity (audit, collapsed).
- While IN_PROGRESS: live driver position on the route map (15 s).

### Sheets on a booking (all use `expectedVersion`; sensitive ones ask for Face ID)

| Sheet | Fields | Endpoint |
|---|---|---|
| Assign driver | Drivers for that date/slot grouped: Free · Has another job in this slot (warning) · Unavailable (disabled, reason). Mode: "Assign" (no acceptance needed) or "Offer" (single or several drivers, expiry 15/30/60 min, first to accept wins). Van (defaults to driver's van). | `/assign`, `/offer` |
| Unassign | Reason | `/unassign` |
| Edit details | Contact name/phone/email (warning: changing email invalidates the customer's links), van, admin notes | `PATCH` |
| Re-price | Edit items, per-address access, extras, variant → side-by-side old/new breakdown → settle: "Send payment link for £X" / "Refund £X" / "No change" + reason | `/reprice-preview`, `/reprice-apply` |
| Reschedule | Calendar for this booking (`GET /admin/bookings/:id/calendar` — prices from the booking's inputs with ACTIVE config + availability) · keep price / new price · settle difference · override capacity (OWNER) · notify customer (default on) · reason | `/reschedule-preview`, `/reschedule` |
| Cancel | Refund: Policy (shows amount) / Full / Custom / None · reason (required) · notify customer · Face ID | `/cancel` |
| Refund | Amount (≤ refundable, prefilled), reason · Face ID | `/refunds` |
| Extra charge | Description, amount → link emailed; "Share link" (share sheet) | `/extra-charges` |
| Record offline payment (OWNER) | Amount, method note, reference · Face ID | `/payments/offline` |
| Resend email | Template picker (confirmation, payment link, manage link, reminder) | `/resend-email` |

### New phone booking (wizard, 5 steps)
1. **Customer**: search existing by phone/email or enter name, email, mobile.
2. **Move**: service, variant, pickup/dropoff via `POST /address/suggest|retrieve`, access per address.
3. **Items**: native items picker (catalogue from `GET /catalogue`), presets, custom items, extras.
4. **Prices**: `POST /quotes` with `Accept: application/json` (non-streaming response for apps — the endpoint returns the final `{ quote }` or `{ manualQuote }` JSON when asked) → calendar; unavailable slots selectable only with OWNER capacity override.
5. **Payment**: "Send payment link" (email + share sheet to WhatsApp/SMS) or "Paid offline" (OWNER, reference). Creates the booking → opens its detail.

### Schedule — `GET /admin/schedule?from=&to=`
- iPhone: day list; iPad: week grid. Each slot shows a capacity bar (confirmed / held / free of capacity) and booking chips.
- Tap a slot → its bookings + "Change capacity for this slot" (override with reason).
- **Capacity** screen: default rules grid (7 days × 3 slots, steppers) `PUT /admin/capacity/rules`; overrides list; "Close dates" (date range → capacity 0 for all slots, reason).

### Drivers — `GET /admin/drivers`
- Row: name, status, today's jobs, on-job dot, licence-expiry warning.
- Detail: contact (call/message), payout %, default van, licence expiry, home postcode, notes · upcoming jobs · unavailability calendar · earnings (unpaid total, history) · performance (completed in 30 days; "arrived within window" % = AT_PICKUP time inside the slot window; offers declined) · actions: Edit, Disable, Resend invite, Revoke sessions (OWNER).
- Invite driver: name, email, mobile, payout % (default from settings), van → invite email.
- **Live map**: Apple Maps with drivers on jobs (location < 10 min old); callout = name, booking reference, stage, "updated 2 min ago" → booking.

### More (menu)

| Item | Screens |
|---|---|
| Leads | **Quote requests** (by status; detail with route map, reasons, contact, preferred date; "Price it" sheet: price, date, slot (required), message, valid for hours; shows the engine price *without* ferry costs as a reference; Decline with message) · **Abandoned checkouts** (expired web bookings, last 30 days: contact, quote summary, "Call", "Send payment link" which creates a phone booking for the same quote and slot if still free) |
| Customers | Search; detail: contact, bookings, notes, marketing opt-in; Export data (share sheet, JSON); Anonymise (OWNER, typed confirmation) |
| Pricing | Versions (Active / Drafts / Archived) · Editor (Services & variants, Distance, Large loads, Floors, Items, Access, Extras, Custom item sizes, Date & time multipliers, Calendar length) with inline validation from `validateConfig` · **Simulator** (scenario: service, variant, miles, floors/lifts, items, access, extras, "today" date → ACTIVE vs DRAFT breakdown and 28-day heat-map calendar side by side) · Publish (type PUBLISH) · **Approve pricing** (OWNER: P1–P6 list with current values + worked examples recomputed live) |
| Items | Catalogue by category: name, category, volume m³, aliases, popular, active · Presets editor |
| Reviews | Pending (Publish / Hide with rule reason), Published, Hidden |
| Content | Locations (search 221; tier and index status; local notes Markdown editor with preview, word count, publish switch) · FAQs (add, edit, reorder, hide) · Site banner (text, link, tone, preview) · SEO (index tier-3 towns switch with explanation) |
| Messages | Contact form inbox; mark handled; reply via mail |
| Fleet | Vans: registration, label, size, MOT/insurance/tax expiry with warnings |
| Payouts | Unpaid earnings per driver → Record payout (select earnings, method, reference, paid date; OWNER) · history |
| Reports | Date range · revenue (paid, refunds, net), bookings, average value, by service, by source, top towns, funnel (quotes → checkouts → paid with conversion %), cancellations · Export CSV (share sheet) |
| Team (OWNER) | Users, invite admin/owner, change role, disable, revoke sessions |
| Settings | One form per key (03 §5) with zod validation; OWNER-only sections locked for ADMIN with a note; Operations includes **Pause online booking** (confirmation; site shows a banner and disables booking); Apps (install links); Notifications (13 §7 health + per-device mutes + repeat-until-seen + driver quiet hours); Launch (missing facts, legal approval date, Apple Pay verification date) |
| Notifications | Inbox, unread first, deep links, "Mark all read" |
| System health | Outbox backlog and failed events (Retry), last Stripe webhook, cron last runs, push error rate, app versions in use |
| Audit log | Filter by booking, user, action |
| Account | Profile, my devices (revoke), app lock timeout, sign out |

## 4. Design notes

- Calm control room: white/ink surfaces, thistle for selection, gorse only for the single primary action per screen and money highlights. Status colours per 02 §9.
- Numbers in Bricolage with tabular figures; everything else Manrope. Dynamic Type supported; minimum touch target 48 pt.
- Dark mode follows the system (02 §9 palette).
- Haptics: success on assign/refund/publish; warning on destructive confirmations.

## 5. Tests and acceptance

- jest-expo unit tests: api-client refresh logic, `ScreenState`, permission gating, deep-link routing, NewJobModal stacking and dedupe.
- Maestro flows (optional, recommended): sign in → assign driver; cancel with policy refund; publish a pricing draft.
- Owner acceptance (Phase 13): with the app **closed**, a test booking on the website makes the phone play the new-job sound within 10 seconds; tapping opens the booking; assigning a driver works; test push from Settings works; iPad split view works.
