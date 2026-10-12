# 06 — Booking flow (customer)

## 1. Targets

| Metric | Target |
|---|---|
| Landing → price shown (returning visitor knows their addresses) | < 45 s |
| Landing → paid booking | < 2 min 30 s |
| Steps after the hero card | 4 (Your move → Items → Prices → Pay) + confirmation |
| Dead ends | 0 — every error state offers a next action (retry, manual entry, call, change addresses) |
| Booking flow JS (initial, gzip) | ≤ 220 KB; Stripe.js loads only when Prices is reached |

## 2. Entry points

| Entry | Behaviour |
|---|---|
| Hero booking card (home, service pages, location pages, route pages) | Service + addresses → `/book?step=move` with state pre-filled; route chip morphs into the wizard header |
| Any "Get a price" button (header, sticky mobile bar, footer CTA) | Scrolls to the on-page booking card if present; else `/book` |
| `/book?service=piano` | Service pre-selected |
| Location page | Pickup field's search biased to that town (proximity), not pre-filled |
| `/quote/:publicId` | Resume a saved quote (§8) |

State model: one zustand store (`useBookingDraft`) persisted to `sessionStorage` key `sv-booking-draft-v1` (versioned; unknown versions are discarded). The URL carries only the step (`?step=move|items|prices|pay`) so browser Back works; each step change is a `router.push`. Opening a step whose prerequisites are missing redirects to the first incomplete step.

## 3. Wizard frame

- **Header (sticky):** back button, route chip ("Paisley to Edinburgh"; tapping opens a sheet to change addresses — changing them invalidates the quote), `ProgressSteps` (Your move, Items, Prices, Pay).
- **Body:** one column, max 640 px; desktop adds a right column (Prices and Pay) for the summary.
- **Footer bar (sticky, mobile):** primary action of the step, disabled with a reason until valid (reason shown as text, not only greyed out).
- **Help:** "Need a hand? Call {phoneDisplay}" link on every step (tel:).
- Step transition and route-chip morph per 02-design-system §7.4.

## 4. Cards and fields

### 4.1 Hero booking card (start)

| Element | Spec |
|---|---|
| Title | "Get your fixed price" (heading.md) |
| Service choice | Chips: Home move · Man and van · A few items · Student · Office · More… ("More" opens a sheet with all 10 services as `ChoiceCard`s with icon + one-line description). "A few items" = `furniture`. No default selection. |
| From | `AddressField` (pickup). Label switches to "Collection address" for single-address services. |
| To | `AddressField` (dropoff). Hidden for single-address services (rubbish). |
| Action | Primary button "See my prices" (full width). |
| Validation on submit | Missing service → inline "Choose what you're moving" and focus the chips. Missing address → inline error on that field. Both outside Scotland → inline "We move people to and from Scotland. One address needs to be in Scotland." (cross-border rule from settings). |
| Reassurance line under card | "Fixed price before you pay. No call needed." (plain text, muted) |
| States | default · validating · error per field · offline ("You're offline. Check your connection.") |
| Analytics | `booking_start` on first interaction, `address_selected` |

### 4.2 `AddressField`

- ARIA 1.2 combobox; listbox of suggestions; `aria-activedescendant`; arrow keys, Enter, Escape; live region announces "5 addresses found".
- Debounce 200 ms, min 2 chars. One Mapbox session token (UUID v4) per field focus → reused until retrieve.
- Suggestion row: primary ("12 Byres Road"), secondary ("Glasgow G11 5JY"), icon by kind (address, postcode, place).
- Selecting a **postcode-only** result opens inline inputs "Street address" (required) and "Flat or floor (optional)", town/postcode pre-filled.
- "Enter address manually" link (always visible under the list): line 1, flat, town, postcode → `GET /address/postcode/:postcode` resolves coordinates; unknown postcode → "We can't find that postcode. Check it and try again."
- Selected state: pin icon, one-line address, "Change".
- Errors: suggest/retrieve failure → "Address search isn't responding. Try again or enter the address manually." with Retry.
- Flat field appears after selection: "Flat or floor (optional)", placeholder "e.g. 2/1, 3F2, Flat 4".

### 4.3 Flat-notation helper (Scotland-specific)

Parse the flat field (and line 1) with `parseFlatNotation()` from `@sv/contracts/address` and **suggest** — never silently apply — a floor in the Your move step: chip "Looks like a 2nd-floor flat. Use 2nd floor?" [Use] [No thanks].

| Input | Suggests | Rule |
|---|---|---|
| `2/1`, `Flat 2/1`, `2 / 1` | 2nd floor | Glasgow style: first number is the floor; `0/1` = ground |
| `0/2` | Ground | |
| `3F2`, `Flat 3F2`, `3f2` | 3rd floor | Edinburgh style `{floor}F{door}` |
| `GF1`, `GF` | Ground | |
| `PF1` | 1st floor | "principal floor" |
| `BF1`, `Basement flat` | Basement | |
| `Flat 4`, `Flat C`, `12/3` with a date-like context | no suggestion | ambiguous |

Unit tests cover every row plus negatives (`12/10/2026` is not a flat).

### 4.4 Step 1 — Your move

| Card | Spec |
|---|---|
| Size / type (`ChoiceCard` group) | Only if the service has more than one variant: Home move → Studio, 1 bedroom, 2 bedrooms, 3 bedrooms, 4+ bedrooms; Office → Up to 5 desks, 6–15 desks, 16+ desks; Piano → Digital, Upright, Baby grand, Grand; Storage → Into storage, Out of storage; Student → Halls, Shared flat or house. Variants with `manualQuote` show a note "We'll price this one individually". |
| Pickup access card | Heading "At {pickup line 1}". `FloorPicker` (Basement, Ground, 1st … 5th, 6th or higher → number 6–30). "Is there a lift you can use?" toggle (hidden for Ground). Flat-notation suggestion chip (§4.3). |
| Dropoff access card | Same for the dropoff address. |
| "Anything tricky?" disclosure (per address, collapsed by default) | **"We'll need to carry things more than 10 m"** → `CarrySlider` 10–100 m (5 m steps; label "first 10 m included"); **"Narrow stairs, tight corners or a small lift"** toggle (+£25); **"Parking permit or controlled parking zone"** toggle (+£20); "Notes for your driver" (300 chars). Price-impact labels come from the active config; if both addresses are narrow/permit, show "charged once". |
| Footer action | "Continue to items" |

The engine receives job-level access derived per 04-pricing-engine §5; both forms are kept.

### 4.5 Step 2 — Items

| Card | Spec |
|---|---|
| Quick start presets | Row of chips: Studio, 1 bedroom, 2 bedrooms, 3 bedrooms, 4+ bedrooms, Student room, Small office. If the list already has items: sheet "Replace your list or add to it?" Choosing a size in step 1 pre-selects the matching preset (house-removals `studio`/`1-bed`/`2-bed`/`3-bed`/`4-bed-plus` → preset of the same slug; student → `student-room`; office `small` → `small-office`; others → none) with a dismissible note "We've added what a typical 2-bedroom home has. Add or remove anything." |
| Search | "Search items, like sofa or wardrobe". Client-side match on name + aliases (normalise case/diacritics, token prefix match, max 8 results, keyboard navigable). No results → "Add it as your own item". |
| Categories | Tabs (scrollable): Popular, Living room, Bedroom, Dining, Kitchen & appliances, Boxes & bags, Office, Garden, Kids, Leisure, Other. |
| Item row | Name, `QuantityStepper` (0–99; long-press accelerates). Selected rows show a subtle thistle left border. |
| Your own item | Name (2–60 chars) + size `ChoiceCard`: Small (fits on a chair), Medium (about an armchair), Large (about a wardrobe), Extra large (about a corner sofa). Quantity. |
| Extras (end of step) | **Extra helpers** stepper 0–3 (+£18 each) — "Your driver loads and unloads. Add helpers for heavy or bulky moves." · **Packing help** toggle (+£35) · **Furniture assembly** toggle (+£25). Prices from active config. Descriptions are owner-reviewed content (`content/services.ts`). |
| Summary bar (sticky) | "14 items, about 6.3 m³" + "See my prices". Disabled with reason "Add at least one item" (piano service may continue with none). |

### 4.6 Step 3 — Prices (reveal → calendar)

Reveal sequence (§6), then:

| Card | Spec |
|---|---|
| Hero price | "From £158.90" (`PriceTag` hero, NumberFlow count-up) + "Saturday 24 October, afternoon" + "Prices held until 3:40pm" (`expiresAt`, London time). |
| Calendar | **Mobile:** week strip of `DayCard`s (7 visible, swipe or arrows, 4 weeks), each with weekday, date, lowest available price that day; selected day shows 3 `SlotCard`s (Morning 8am–12pm, Afternoon 12pm–4pm, Evening 4pm–8pm — windows from settings). **Desktop:** 7 × 4 month-style grid; selecting a day opens the slots in the right column. |
| Day/slot states | available · cheapest (gorse underline + text "Cheapest") · last slot (text badge, only when this job would take the last remaining capacity — real data) · fully booked · closed · too soon to book · same-day only — unavailable states are striped, disabled, with the reason as text. |
| Flexibility hint | Only when a cheaper **available** slot exists than the one selected: "Moving on Tuesday 27 October instead saves £37.40." with a button to switch. |
| Breakdown | Disclosure "How this price is worked out": `breakdownLines` + the selected slot's multipliers in words ("Saturday +15%", "Morning +5%", "Booked for tomorrow +20%", "Summer season +10%", "End of month +8%"). Totals reconcile exactly. |
| Route preview | `StaticRouteMap` (lazy, below the fold on mobile) with "52.3 miles, about 1 hr 11 min by road". |
| Sticky bar | Selected "Sat 24 Oct, afternoon" + price (NumberFlow rolls on change) + "Continue". |
| Expired quote | When `expiresAt` passes while on this step: inline alert "Prices have been updated" and the calendar silently re-quotes (shortened 600 ms reveal); if the selected slot's price changed, highlight it with old price struck through. |
| All unavailable | "Every slot in the next 4 weeks is taken. Call {phone} and we'll see what we can do." |

### 4.7 Step 4 — Details and pay

| Card | Spec |
|---|---|
| Summary | Service, date + window, from → to (static map thumbnail), items count + volume, extras, **total**. Collapsible on mobile ("Show summary"), sticky right column on desktop. "Change" links back to each step (changing anything re-quotes). |
| Your details | Full name · Email ("Your confirmation goes here") · Mobile ("Your driver will call this number on the day") · Notes for the driver (optional, 500). Under the fields, small text: "If you don't finish booking, we may contact you about this move." |
| Agreements | ☐ "I agree to the terms and cancellation policy" (required; links open in a sheet, not a new page). If `legal.requireExpressStartAck` is on and the move date is within 14 days: ☐ the express-request acknowledgement (wording from 18-legal §2, required). ☐ "Email me occasional offers" (optional, unticked). |
| Payment | Stripe Payment Element (deferred intent: `mode: 'payment'`, `amount`, `currency: 'gbp'`, `paymentMethodCreation` default), layout `accordion`, Appearance API themed with tokens (fonts via `fonts: [{ cssSrc }]`). Shows Apple Pay / Google Pay / card / Link as available. |
| Pay button | "Pay £158.90" (primary, full width). Loading label "Processing payment…". Under it: "Payments are processed securely by Stripe. Your confirmation email arrives straight away." |
| Hold notice | After the first attempt creates the booking: "We're holding this slot for you until 3:52pm." |

**Submit sequence**
1. Validate fields (focus first error, announce).
2. `elements.submit()` (surfaces Payment Element validation).
3. `POST /bookings` with the same `idempotencyKey` for every retry of this checkout (UUID created when the step mounts, kept in the draft).
4. `409 PRICE_CHANGED` → dialog: "The price for this slot is now £162.40 (prices were updated at 3:40pm). Pay £162.40 or choose another slot." Buttons: "Pay £162.40" / "Choose another slot". `SLOT_UNAVAILABLE` → dialog "That slot was just taken" → back to Prices with refreshed availability and the next-cheapest slot highlighted. `QUOTE_EXPIRED` → re-quote automatically.
5. `stripe.confirmPayment({ elements, clientSecret, confirmParams: { return_url: <origin>/book/confirmation?t=<statusToken>, payment_method_data: { billing_details: { name, email, phone } } }, redirect: 'if_required' })`.
6. Error → inline message from Stripe (`error.message` for card errors; generic for others) + keep the form. Success without redirect → navigate to confirmation.

Failure handling: Stripe.js fails to load → "The secure payment form didn't load. If you use a content blocker, pause it for this page, or call {phone} to book." Booking API 5xx → "Something went wrong on our side. Try again — you won't be charged twice." (same idempotency key).

### 4.8 Confirmation (`/book/confirmation?t=…`)

- Polls `GET /bookings/status?t=` every 1.5 s for up to 30 s while `PENDING_PAYMENT`.
- **Confirmed:** success motion (02 §7.4) → "You're booked" · reference `SV-7K3Q2M` (copy button) · date + window · from → to · total paid · "What happens next" (a real sequence, so numbered): 1. Confirmation email now. 2. We assign your driver and email you their name. 3. Reminder the day before. 4. Live tracking link on the day. · Actions: "Add to calendar" (`.ics` download + Google Calendar link), "Manage your booking" (magic link), "Share details" (Web Share API; fallback copy link).
- **Still pending after 30 s but Stripe reported success** (`redirect_status=succeeded` or a confirmPayment success): "Payment received. We're confirming your booking — your email will arrive in a few minutes." Never show failure in this case.
- **Failed** (`redirect_status=failed`): "Your payment didn't go through." + "Try again" (back to Pay with the same booking if the hold is still valid, else re-quote).
- Fires `purchase` analytics once (§9), clears the draft.

### 4.9 Manual quote path

Triggered by stream event `manual_quote` (ferry, long distance, survey-only variant) or by a 422 `MANUAL_QUOTE_REQUIRED`.

| Reason | Message |
|---|---|
| `FERRY_ROUTE` | "Your route includes a ferry crossing, so our team prices it individually." |
| `LONG_DISTANCE` | "This is a long-distance move, so our team prices it individually." |
| `VARIANT_REQUIRES_SURVEY` | "Grand pianos and large offices need a quick check before we price them." |

Form: name, email, mobile, preferred date (next 60 days, optional), preferred slot (optional), details (500). Submit → "Request sent. We'll email your fixed price, and you can pay online to confirm. Questions? Call {phone}." Admin is alerted (13 §2).

### 4.10 Outside the service area

"We don't cover this route yet. We move people to and from Scotland{, and between Scotland and England or Wales if crossBorderMoves}." + "Change addresses" + phone.

## 5. Quote stream protocol (`POST /api/v1/quotes`)

Validation and rate-limit failures return normal JSON (400/429) before any stream starts. Otherwise `200`, `Content-Type: application/x-ndjson; charset=utf-8`, `Cache-Control: no-store`, one JSON object per line:

```
{"type":"accepted","requestId":"req_8f2…"}
{"type":"route","distanceMiles":52.31,"durationMinutes":71,"fromTown":"Paisley","toTown":"Edinburgh"}
{"type":"availability","slotsOpen":71,"slotsTotal":84}
{"type":"prices","cheapest":{"date":"2026-10-24","slot":"AFTERNOON","pricePence":15890}}
{"type":"done","quote":{ …QuoteDto }}
```

Alternative endings (stream then closes): `{"type":"manual_quote","quotePublicId":"…","reasons":["FERRY_ROUTE"]}` · `{"type":"error","error":{"code":"OUTSIDE_SERVICE_AREA","message":"…","requestId":"…"}}`.

Server: `export const runtime = 'nodejs'`, `dynamic = 'force-dynamic'`; `ReadableStream` enqueues each event as soon as its work is done (route → availability → prices → persist → done). Mapbox timeout 6 s with one retry; whole request budget 15 s.

JSON mode: when the request's `Accept` header is `application/json` (the iPhone apps), the handler runs the same steps and returns one JSON body instead of a stream — one service function, two response formatters.

Client: `fetch` with `AbortController` (15 s), read `res.body` with a `TextDecoder`, split on newlines, `QuoteStreamEventSchema.parse` each line, feed the reveal state machine. Unknown event types are ignored (forward compatible).

## 6. The price reveal

**Honesty rule:** every line on the reveal reflects real server work and shows real numbers from the stream. Nothing is faked; the only shaping is a minimum display time per stage so people can read it.

| Stage | Label while working | Label when its event arrives |
|---|---|---|
| 1 | "Planning your route" | "52.3 miles, about 1 hr 11 min by road" |
| 2 | "Checking our vans for the next 4 weeks" | "71 of 84 time slots available" |
| 3 | "Working out 84 fixed prices" | "Best price found" |

Timing: each stage shows for **at least 550 ms** (an event that arrives earlier waits; a later one is shown as it arrives). Then the hero price counts up (900 ms) with the gorse underline sweep, the calendar rises (220 ms, days staggered 25 ms, capped at 300 ms). Typical total: about 2.5 s. Numbers ("84") derive from `calendarDays × 3`.

Slow and failed paths: at 8 s, add "Still working. Road data is taking longer than usual." At 15 s or on an `error` event: error card "We couldn't get your prices just now." + "Try again" + "Call {phone}". Retrying creates a new quote.

Motion: the "See my prices" button morphs into the progress card (layout animation). Each stage has a spinner that becomes a drawn check (200 ms). Reduced motion: no morph or count-up; stages appear as text lines; the price appears instantly.

Accessibility: the progress card is `role="status"` with `aria-live="polite"`; each completed stage is announced once; focus moves to the hero price heading when revealed.

### 6.4 Availability overlay (server, per slot)

Evaluated in this order; first match wins:
1. `CLOSED` — capacity override 0.
2. `SAME_DAY_ONLY` — service `same-day` and the date is not today (owner decision P5).
3. `PAST_CUTOFF` — now (London) is later than slot window start − `minLeadMinutes`.
4. `FULL` — the job doesn't fit: for any slot it would occupy (job size rules, 03 §6.1), used + the job's `capacityUnits` > capacity; or the job would run past the evening slot.
5. Otherwise available; `lastOne = true` when, after this job, no capacity would remain in its start slot.

Cheapest = lowest `pricePence` among available slots; ties → earliest date, then morning → afternoon → evening.

## 7. Payment states (customer-facing copy)

| Situation | What the customer sees |
|---|---|
| Card declined | Stripe's message (e.g. "Your card was declined.") + "Try another card or payment method." |
| 3-D Secure | Stripe's challenge sheet; on return the confirmation page takes over |
| Payment processing (bank delay) | Confirmation page "Payment received. We're confirming your booking…" |
| Hold expired before paying | "Your slot hold ran out, so we've released it." + "See prices again" |
| Paid after hold expired | Handled server-side (10-payments §4.3); the customer sees confirmed, or a clear refund email if the slot was gone |

## 8. Draft persistence and resume

- Draft fields: service, variant, addresses, access, items, extras, `quotePublicId`, selected date/slot, `idempotencyKey`, `statusToken`.
- On load with a draft: if `quotePublicId` exists → `GET /quotes/:publicId`; not expired → show Prices without the reveal; expired → re-quote with the short (600 ms) reveal.
- `/quote/:publicId` restores a quote on any device (server-rendered summary + "Continue").
- Clear the draft on confirmed booking, on "Start again", and when the service changes.

## 9. Analytics (consent-gated, no personal data)

| Event | When | Params |
|---|---|---|
| `booking_start` | first interaction with the hero card | `service?`, `page_type` |
| `quote_requested` | stream starts | `service` |
| `quote_shown` | `done` received | `service`, `distance_band` (0–5, 5–20, 20–50, 50+), `value` (cheapest £) |
| `manual_quote_shown` | | `reason` |
| `slot_selected` | | `day_offset`, `slot`, `value` |
| `begin_checkout` | Pay step mounted | `value`, `currency: 'GBP'` |
| `add_payment_info` | Pay clicked | `value` |
| `purchase` | confirmation, status CONFIRMED, once per reference | `transaction_id` (reference), `value`, `currency`, `items: [{ item_id: service, price }]` |
| `payment_failed` | | `code` |

Google Ads conversion fires alongside `purchase` with `send_to: '<GADS_ID>/<LABEL>'`, same value and `transaction_id` (Ads de-duplicates). Consent Mode v2 defaults to denied (18-legal §4).

## 10. Acceptance tests (Playwright, `@booking`)

1. Mobile (iPhone 13 viewport): home → man and van → two Glasgow addresses → floors → 3 items → prices revealed → cheapest slot → details → test card → confirmed; reference shown; draft cleared.
2. Desktop: house removal with preset 2 bedrooms, narrow access at one address, permit at both (charged once in breakdown).
3. 3-D Secure card (`4000 0027 6000 3184`) completes.
4. Declined card (`4000 0000 0000 0002`) shows message; retry with 4242 succeeds; **one** booking exists.
5. Price changed: test hook publishes a new pricing version between quote and pay → dialog → accept → charged new price.
6. Slot taken: capacity 1, second browser books the same slot first → dialog → back to prices.
7. Ferry route (mock returns ferry step) → manual quote form → request sent.
8. Outside area (two English addresses, cross-border off) → out-of-area card.
9. Reload on every step restores state; Back button walks the steps.
10. Keyboard-only run through the whole flow; axe has zero violations on each step.
11. Reduced-motion run: no animations, flow still completes.
