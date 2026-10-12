# 07 — Landing page and marketing pages

All copy below is a **draft** in the brand voice (02 §10). Business facts come from settings (`getPublicSettings()`); a fact that is missing hides its sentence — never a placeholder on the live site. Copy lives in `apps/web/src/content/*.ts`; the owner reviews it in Phase 9.

## 1. Global layout (every marketing page)

| Element | Spec |
|---|---|
| **Site banner** (optional) | From `siteBanner` setting; hidden when disabled. Thin bar above the header, ink background, one sentence + optional link. Dismissible per session. |
| **Header** | Height 64 px desktop / 56 px mobile; sticky; white with `border.default` bottom edge after 8 px scroll (no shadow). Left: logo (links home). Desktop nav: Services (opens a panel listing the 10 services with icons and one-liners), Areas (panel: 8 cities + "All areas"), Prices, Help, Manage booking. Right: phone number as text link (`tel:`), "Get a price" (primary, md). Mobile: logo, phone icon button, menu button → full-height sheet with the same links, phone, and "Get a price". |
| **Mobile sticky bar** | Appears when the page's booking card scrolls out of view (IntersectionObserver); hides when the card or footer is visible. "Get a price" (primary) + call icon button. Safe-area padding. Never on `/book`, `/manage`, `/track`, `/pay`. |
| **Footer** | Ink background. Columns: Services (10) · Areas (8 cities + All areas) · Company (About, How it works, Prices, Reviews, Guides, Drive with us, Contact) · Help (Manage booking, Track a move, FAQs, Cancellation policy). Contact block: phone, email, WhatsApp (if set), phone hours. **Legal line (always, required by the Companies Act trading disclosure rules):** "{legalName}, trading as Speedy Van. Registered in Scotland, company number {companyNumber}. Registered office: {registeredOffice}." + VAT number if registered. Links: Terms, Privacy, Cookies, Accessibility, "Cookie settings" (button). Payment line: "Pay by card, Apple Pay or Google Pay." Social links if set. © year. |
| **Consent banner** | 18-legal §4. |
| **Skip link** | "Skip to content" first focusable element. |

## 2. Landing page (`/`) — sections in order

### S1 · Hero (the booking-first first screen)

**Job:** start a booking within the first screen on every device.

```
Mobile (375)                         Desktop (1280)
┌───────────────────────────┐        ┌──────────────────────────────────────────────────────────┐
│ header                    │        │ header                                                   │
│ H1 (2–3 lines)            │        │ H1 (left, 2 lines)            ┌────────────────────────┐ │
│ lead (1–2 lines)          │        │ lead                          │                        │ │
│ ┌───────────────────────┐ │        │ ┌───────────────────────────┐ │  Scotland route map    │ │
│ │ Booking card          │ │        │ │ Booking card              │ │  (ink panel, radius 32)│ │
│ │ service chips         │ │        │ │                           │ │                        │ │
│ │ From / To             │ │        │ └───────────────────────────┘ │                        │ │
│ │ [ See my prices ]     │ │        │ reassurance line              └────────────────────────┘ │
│ └───────────────────────┘ │        └──────────────────────────────────────────────────────────┘
│ reassurance line          │
│ route map (below fold)    │
└───────────────────────────┘
```

- **H1** (display.xl, left-aligned): "Removals and man and van across Scotland"
- **Lead** (body.lg, muted, ≤ 2 lines): "See fixed prices for every day of the next four weeks and book online in a few minutes."
- **Booking card:** 06-booking-flow §4.1, `xl` radius, the only element on the page with the floating shadow.
- **Route map:** 02-design-system §7.2. Decorative: `aria-hidden="true"`; the booking card never waits for it (lazy-hydrated after first input or idle).
- LCP element is the H1 text (fonts preloaded, `display: swap`, no hero image).
- Acceptance: on a 360×640 viewport the "See my prices" button is visible without scrolling.

### S2 · What you get (proof by product, not adjectives)

A quiet row (desktop) / 2×2 grid (mobile) of four short statements with Lucide icons. Each must be true by construction of this system:

| Icon | Statement | Source of truth |
|---|---|---|
| receipt | "Fixed price shown before you pay" | booking flow |
| calendar-days | "Prices for every slot over four weeks — cheapest days highlighted" | calendar |
| map-pin | "Live van tracking on moving day" | tracking page |
| credit-card | "Card, Apple Pay or Google Pay, processed by Stripe" | checkout |

Conditional fifth/sixth items, only when settings provide them: "Goods in transit cover up to £{cover}" (insurance set) · "{yearsTrading} years moving Scotland" (trust set). No borders-on-every-card treatment: icons + text on the canvas, separated by whitespace.

### S3 · How it works (a real sequence, so numbered)

Three steps, horizontal on desktop, vertical on mobile, numbers in Bricolage:
1. **Tell us about your move** — "Addresses, floors and the things you're moving. Takes about a minute."
2. **Pick your price** — "Every morning, afternoon and evening for four weeks, each with a fixed price. Flexible days cost less."
3. **We move you** — "Pay online, get your confirmation straight away, and follow your van live on the day."
Link: "More about how it works" → `/how-it-works`.

### S4 · Services

A two-column list (desktop) / single list (mobile) — not a grid of identical cards. Each row: icon, service name (heading.sm), one line, and "From £X" (computed, §6), whole row links to the service page. Order: Home moves, Man and van, Furniture delivery, Student moves, Office moves, Storage moves, IKEA and flat-pack, Rubbish removal, Piano moving, Same-day delivery.

### S5 · How your price is worked out

Left: short explanation "Your price is built from things you can see: distance, floors, how much you're moving, access, and the day you choose." Right: a real breakdown table for a stated example ("Example: 1-bedroom flat, 8 miles, 2nd floor with no lift, weekday afternoon") computed server-side by `@sv/pricing` with the ACTIVE config, followed by the day/time multipliers in words ("Saturdays and Sundays +15%", "Booked for today +40%" …) generated from config. Link "See every rate" → `/pricing`. Revalidates on pricing publish.

### S6 · Areas we cover

Quiet typographic block: region names (12) as links, each with "{n} towns", plus the 8 cities as larger links. Text: "Mainland Scotland is priced instantly. Island moves that need a ferry are priced by our team." Link "All areas" → `/areas`. No second animated map (the hero map is the one signature visual).

### S7 · Real example prices

Table (`<table>` with caption) of 6 routes from the generated price data (08-seo §6), e.g. "Glasgow to Edinburgh, 1-bedroom flat — from £…". Caption states the assumptions and the date computed: "Cheapest available weekday slot when this page was updated on {date}. Your price depends on your items, access and date." Revalidated daily.

### S8 · Reviews (hidden until there are at least 3 published)

Average rating (one decimal) + count from all published reviews; the 3 **most recent** published reviews (not hand-picked); each shows first name + initial, town, date, "Verified booking". Link "Read all reviews" → `/reviews`. No `AggregateRating` JSON-LD on our own business (Google ignores self-serving review markup).

### S9 · Questions

8 FAQs (category BOOKING/PRICING/PAYMENT first) from the database in an accordion; "More answers" → `/help`. `FAQPage` JSON-LD with exactly the visible questions.

### S10 · Final booking card

Heading "Ready when you are" + the same booking card component (state shared with the hero card; editing one updates the other).

## 3. Service pages (`/services/[service]`)

Slugs: `house-removals`, `man-and-van`, `furniture-delivery`, `student-moves`, `office-removals`, `storage-moves`, `ikea-delivery`, `rubbish-removal`, `piano-moving`, `same-day-delivery` (map to engine keys in `content/services.ts`).

| Section | Spec |
|---|---|
| Hero | H1 "{Service} in Scotland" + lead + booking card with the service pre-selected |
| What's included | 4–6 bullets from `content/services.ts` (owner-reviewed, `reviewedByOwner` flag shown in `/styleguide` list) |
| Price for this service | Base price, which factors apply, a computed example, "From £X" |
| Options | Variants explained (e.g. piano types and which need a survey) |
| Good to know | Service-specific tips (e.g. rubbish: what we can't take — owner content) |
| Areas | Links to the 8 city pages for this service where they exist, plus "All areas" |
| FAQs | 4–6 service-specific |
| Related services | 3 links |
| JSON-LD | `Service` (provider = the organisation, `areaServed` = Scotland), `BreadcrumbList`, `FAQPage` |

`/services` index: H1 "Our services", the S4 list, and a short paragraph per service.

## 4. Other pages

| Page | Contents | Notes |
|---|---|---|
| `/pricing` — "How our prices work" | Every factor with live numbers from the ACTIVE config (base prices table, distance rule, floors, items, large loads, access, extras, date/time multipliers), a full worked example, "Why weekends cost more", FAQ, booking card | Revalidate on pricing publish |
| `/how-it-works` | The 3 steps in depth; what happens after booking (assignment, reminder, tracking, completion); manage/reschedule/cancel; booking card | |
| `/about` | Who we are (from settings: legal name, registered in Scotland), how we work (system features), team/van photos when the owner uploads them, contact | No invented history or numbers |
| `/contact` | Phone, email, WhatsApp, hours, contact form (`POST /contact`: name, email, phone optional, message, honeypot), "Already booked? Manage your booking", registered office | Form states: idle, submitting, sent ("Thanks — we'll reply by email"), error |
| `/reviews` | All published reviews, newest first, 20 per page; average + distribution; "How we collect reviews: every review comes from a customer who completed a booking. We publish all reviews except ones that break our rules (abuse, personal details)." | |
| `/help` | FAQs by category with client-side search; contact block | `FAQPage` JSON-LD |
| `/guides`, `/guides/[slug]` | Article index + template (title, updated date, reading time, body, related, booking card). Six starter drafts, unpublished until approved: tenement moves (Glasgow 2/1 and Edinburgh 3F2 notation explained), estimating how much you have, student move checklist, parking for removal vans (general; check your council), packing timeline, planning a Glasgow–Edinburgh move | No statistics or legal advice; `Article` JSON-LD |
| `/drive-with-us` | What drivers do, what they need (owner content), apply by email | |
| `/legal/terms`, `/legal/privacy`, `/legal/cookies`, `/legal/cancellation`, `/accessibility` | 18-legal; banner "Draft — awaiting legal review" visible only in non-production until `launch.legalApprovedAt` is set | |
| `/manage`, `/track/[token]`, `/pay/[token]`, `/review/[token]` | 09-customer-self-service | `noindex` |
| 404 | "We can't find that page." + booking card + links to Services, Areas, Help | Status 404 |
| Error (500) | "Something went wrong on our side." + "Try again" + phone | Reported to Sentry |

## 5. FAQ seed (`content/faqs.ts`; owner reviews before launch)

| Category | Question | Draft answer (values in braces come from settings/config) |
|---|---|---|
| BOOKING | How do I get a price? | Choose what you're moving, add both addresses, floors and your items. You'll see a fixed price for every morning, afternoon and evening slot over the next four weeks. |
| PRICING | Is the price fixed? | Yes, for the details you give us. If there's more to move or harder access on the day than you told us, we'll agree the extra cost with you before doing the extra work. |
| PRICING | Why does the price change by day and time? | Demand isn't even. Weekends add {weekend}%, summer months add {peak}%, the last {n} days of the month add {eom}%, and booking for today or the next two days costs more. Afternoons are the cheapest time of day. |
| BOOKING | How far ahead can I book online? | Up to {calendarDays} days ahead. For later dates, call {phone}. |
| BOOKING | Can I book for today? | Yes, if a slot is still free and starts at least {minLeadHours} hours from now. |
| PAYMENT | When do I pay? | In full when you book, by card, Apple Pay or Google Pay. Your booking is confirmed as soon as the payment goes through. |
| PAYMENT | Is paying online safe? | Payments are processed by Stripe. We never see or store your card number. |
| CHANGES | Can I change my moving date? | Yes, from your booking page until {rescheduleHours} hours before your slot. If the new slot costs more you pay the difference; if it costs less we refund it. |
| CHANGES | How do I cancel? | From your booking page. Cancel {freeHours}+ hours before your slot for a full refund; between {noRefundHours} and {freeHours} hours we refund {latePercent}%; inside {noRefundHours} hours there's no refund. |
| ON_THE_DAY | Can I track my van? | Yes. On moving day you'll get a link showing your van on a map and when it will arrive. |
| ON_THE_DAY | What if I have more items than I booked? | Tell us as soon as you can. Your driver will confirm any extra cost with you before loading, and you can pay it online. |
| COVERAGE | Which areas do you cover? | All of mainland Scotland, priced instantly. Island moves that need a ferry are priced by our team — you'll get a fixed price by email. |
| COVERAGE | Do you move to and from England? | {crossBorderMoves ? "Yes — at least one address needs to be in Scotland." : "Not at the moment. We cover moves within Scotland."} |
| ITEMS | Do I need to pack everything myself? | You can, or add packing help when you book. |
| ITEMS | Is there anything you can't move? | Owner to write: hazardous materials, gas bottles, fuel, etc. |
| PAYMENT | Will I get a receipt? | Yes, by email when you pay and again when your move is complete. |

## 6. "From" prices (honest by construction)

For each service, a fixed profile is priced by the real engine over the real next-28-day calendar; the "from" value is the **cheapest slot that is actually available**, rounded up to the next whole pound. Recomputed daily at 00:10 London (cron revalidates tag `from-prices`) and on pricing publish.

| Service | Profile (distance ≤ 5 miles, ground floors, no access charges, no extras unless noted) |
|---|---|
| Home move | "Studio" preset, variant studio |
| Man and van | 1 armchair |
| Furniture delivery | 1 three-seater sofa |
| Student moves | "Student room" preset, variant halls |
| Office moves | "Small office" preset, variant small |
| Storage moves | 5 medium boxes, variant to-storage |
| IKEA and flat-pack | 3 small flat-pack boxes |
| Rubbish removal | 5 black bags |
| Piano moving | upright, no other items |
| Same-day delivery | 1 medium box, today's slots only (if none available, show "Today: fully booked" instead of a price) |

Every "From £X" links to a tooltip/sheet stating the profile.

## 7. Acceptance (Phase 9)

- Lighthouse (mobile, throttled) on `/` and `/services/house-removals`: Performance ≥ 95, Accessibility 100, Best Practices ≥ 95, SEO 100.
- LCP < 2.0 s on a Moto G Power profile; CLS < 0.05; no layout shift when fonts load (size-adjusted fallbacks via `next/font`).
- No missing-fact placeholders anywhere: the `@marketing` E2E suite seeds settings with nulls and asserts hidden sentences, not "null"/"undefined"/"TODO".
- Every page has exactly one H1, unique title and description, canonical, and correct breadcrumbs.
- Keyboard and screen-reader pass on header menus, accordions, booking card.
