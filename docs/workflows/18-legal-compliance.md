# 18 — Legal & compliance (UK / Scotland)

**This is a build checklist, not legal advice.** Codex drafts the legal pages from this list; a Scottish solicitor approves them before launch (`launch.legalApprovedAt`). Codex must never present a draft as final, invent liability limits, insurance amounts or claim deadlines, or remove the "Draft" banner itself.

## 1. Business disclosures (required on the website and in emails)

- Companies (Trading Disclosures) Regulations 2008 and Electronic Commerce Regulations 2002: registered company name, company number, part of the UK registered in (Scotland), registered office address, email address, and VAT number if VAT registered. → Footer legal line (07 §1) and every email footer (11 §1), from settings.
- Consumer prices are shown **including VAT** when the company is VAT registered (price display rules). Receipts show the VAT element.

## 2. Consumer contract rules

| Rule | How the build complies |
|---|---|
| Pre-contract information (Consumer Contracts Regulations 2013) | Checkout shows: who we are, the service, total price including everything mandatory, date/window, payment, cancellation policy (link + summary) before "Pay" |
| Confirmation on a durable medium | `booking-confirmed` email with all of the above + terms link |
| No pre-ticked boxes for extra payments (reg. 40) | Helpers, packing, assembly and marketing opt-in all default off |
| 14-day cancellation right | **Solicitor to decide** whether the exemption for "transport of goods … for a specific date or period of performance" (reg. 28(1)(b)) covers our removals. Setting `legal.requireExpressStartAck` (default **true**) shows a required acknowledgement when the move is within 14 days of booking. Draft wording for the solicitor: *"I want my move to take place within 14 days of booking. I understand the cancellation policy applies if I cancel, and that I can't cancel once my move has been carried out."* If the solicitor confirms the exemption applies, the owner switches the setting off |
| Consumer Rights Act 2015 | Terms in plain language; no unfair terms (no blanket exclusion of liability for negligence); services performed with reasonable care and skill |
| DMCC Act 2024 — drip pricing | The headline total includes every mandatory charge; extras are optional and priced before payment |
| DMCC Act 2024 — fake reviews | Reviews only from completed bookings; never written, bought or selectively suppressed; published review policy (`/reviews`) |
| Advertising claims (CAP Code) | "From" prices are genuinely available (07 §6); no comparative or superlative claims without evidence |
| Governing law | Scots law; Scottish courts — consumers keep the protections of where they live |

## 3. Pages Codex drafts (all with the "Draft — awaiting legal review" banner outside production until approved)

| Page | Must cover |
|---|---|
| Terms of service (`/legal/terms`) | Parties; the service; how prices work (fixed for the details given; how extra items or changed access are agreed and charged); customer responsibilities (accurate items and access, parking/permits, being present, items packed safely); items we won't carry (owner list: hazardous, illegal, perishable, valuables such as cash/jewellery/documents — owner confirms); payment; changes and reschedules (difference charged/refunded); cancellation (rules from settings); delays and events outside our control; liability and damage claims (**limits and claim deadlines left as `[SOLICITOR/OWNER TO CONFIRM]`**, insurance details only from settings); complaints process; contact; governing law |
| Cancellation policy (`/legal/cancellation`) | Plain-English table generated from `cancellation` settings, worked example, how refunds are paid and how long they take |
| Privacy policy (`/legal/privacy`) | §4 content |
| Cookie policy (`/legal/cookies`) | §5 inventory, how to change consent |
| Review policy (section of `/reviews`) | How reviews are collected, verified, moderated |
| Accessibility statement (`/accessibility`) | Target WCAG 2.2 AA, known issues, how to report a problem |
| Driver privacy notice (linked in the driver app → Me) | What's collected (location during jobs only, photos, signatures, activity times, earnings), why, retention, rights |

## 4. Data protection (UK GDPR, Data Protection Act 2018)

- **Controller:** the company. Owner pays the ICO data protection fee; number in settings.
- **Lawful bases:** booking and job data → contract; abandoned-checkout follow-up, fraud prevention, job tracking and photos → legitimate interests (write a short legitimate-interests assessment); accounting records → legal obligation; marketing email, analytics and advertising cookies → consent.
- **Processors** (list in the privacy policy, with data processing agreements in place): Vercel (hosting), Neon (database, London region), Stripe (payments — also acts as a controller for some payment data), Mapbox (address search and routing), Resend (email), Expo (push notifications for staff), Apple (push delivery), Sentry (error monitoring with PII scrubbing), Upstash (rate limiting with hashed IPs), Google (analytics/ads, only with consent). International transfers covered by the providers' UK transfer mechanisms (UK IDTA or Addendum) — confirm each.
- **Rights:** access/portability (Admin → Customer → Export data), rectification (edit), erasure (Admin → Anonymise — keeps the accounting minimum: amounts, dates, reference), objection to marketing (opt-out). Respond within one month.
- **Retention:** 03-database §9, stated in the privacy policy.
- **Driver location:** systematic tracking of workers → owner completes a short data protection impact assessment (DPIA); tracking only during active jobs, visible indicator on the phone, 30-day retention.
- **Breaches:** procedure in `docs/INCIDENTS.md`; notify the ICO within 72 hours when required.

## 5. Cookies and similar technologies (PECR)

| Cookie / storage | Purpose | Category | Set when |
|---|---|---|---|
| `sv_consent` | remembers cookie choices (version + timestamp) | strictly necessary | on choice |
| `sv_manage` | customer's manage-booking session | strictly necessary | after opening a manage link |
| `__stripe_mid`, `__stripe_sid` | Stripe fraud prevention | strictly necessary | only on payment pages (Stripe.js loads only there) |
| `sessionStorage sv-booking-draft-v1` | keeps the booking form while you fill it in | strictly necessary | booking flow |
| Google Analytics (`_ga`, `_ga_*`) | statistics | analytics — **consent** | after "Accept" |
| Google Ads (`_gcl_*` and Google domains) | ad conversion measurement | advertising — **consent** | after "Accept" |

- **Banner:** first visit; buttons "Accept all", "Reject all" (equal prominence), "Choose" (toggles for Analytics and Advertising, both off). No cookie wall. Choice stored for 6 months, then asked again. "Cookie settings" in the footer reopens it.
- **Google tags load only after consent** (Consent Mode v2 "basic" implementation): nothing from Google loads before a choice; on consent, `gtag('consent', 'update', { analytics_storage, ad_storage, ad_user_data, ad_personalization })` with the user's choices. This is the cautious reading of PECR; the trade-off (less modelled conversion data) is accepted.
- The cookie policy table is generated from the same inventory file the banner uses, so they never disagree.

## 6. Launch gate (owner + solicitor)

- [ ] Terms, privacy, cookies, cancellation, accessibility approved; `launch.legalApprovedAt` set.
- [ ] 14-day cancellation question answered; `legal.requireExpressStartAck` set accordingly.
- [ ] Items-we-won't-carry list, liability limits and claim deadlines written by the owner/solicitor.
- [ ] Insurance facts entered only if a current policy covers them.
- [ ] ICO fee paid; DPAs accepted for every processor; legitimate-interests assessment and driver-tracking DPIA on file.
- [ ] Review policy published; no reviews imported from anywhere else.
