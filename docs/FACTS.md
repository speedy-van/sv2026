# FACTS.md — business facts (owner fills this in)

This is the **only** source of business facts for the whole platform. Codex seeds these into the database (`Setting` table); after launch you change them in the Admin app → Settings.

**Rules**
- Replace every `TODO(owner)` with the real value. Leave `null` where something doesn't apply — the site hides it.
- Never put something here that isn't true today. "Fully insured", "5-star", "10 years experience" are legal claims (Consumer Protection from Unfair Trading Regulations / DMCC Act 2024).
- `npm run verify:launch` refuses to launch while any `TODO(owner)` remains.
- Keep the YAML block valid: text after `#` is a comment; strings with `:` need quotes.

```yaml
company:
  legalName: TODO(owner)                # registered company name exactly as at Companies House
  tradingName: Speedy Van
  companyNumber: TODO(owner)            # e.g. "SC123456"
  registeredIn: Scotland
  registeredOffice: TODO(owner)         # full postal address, one line
  vatRegistered: TODO(owner)            # true or false
  vatNumber: null                       # "GB123456789" if VAT registered, else null
  icoRegistrationNumber: TODO(owner)    # data protection fee registration number (ico.org.uk)

contact:
  phoneDisplay: TODO(owner)             # as shown on the site, e.g. "0141 000 0000"
  phoneE164: TODO(owner)                # same number in international format, e.g. "+441410000000"
  whatsappE164: null                    # "+447..." to show a WhatsApp button, or null
  emailPublic: TODO(owner)              # shown on the site, e.g. "hello@speedyvan.uk"
  emailBookings: TODO(owner)            # sender/reply-to for booking emails, e.g. "bookings@speedyvan.uk"
  emailAdminAlerts: TODO(owner)         # who gets new-booking alert emails, comma-separated
  phoneHours: TODO(owner)               # e.g. "Every day 07:00–21:00"
  showAddressPublicly: false            # true only if customers may visit the address

web:
  canonicalOrigin: "https://www.speedyvan.uk"   # keep the host Google already indexes; www is Vercel's recommended primary
  googleBusinessProfileUrl: null
  ga4MeasurementId: null                # "G-XXXXXXXXXX"
  googleAdsConversionId: null           # "AW-XXXXXXXXX"
  googleAdsPurchaseLabel: null          # conversion label for completed bookings
  socials:
    facebook: null
    instagram: null
    tiktok: null
    x: null
    linkedin: null
    youtube: null

operations:
  slotWindows:                          # arrival windows shown to customers (24h clock, London time)
    MORNING: "08:00-12:00"
    AFTERNOON: "12:00-16:00"
    EVENING: "16:00-20:00"
  minLeadMinutes: 120                   # a slot can't be booked less than this before its window starts
  defaultCapacityPerSlot: TODO(owner)   # jobs you can run at the same time in one slot (= crews available)
  closedDates: ["2026-12-25", "2027-01-01"]   # whole-day closures; edit in Admin later
  serviceAreaRule: PICKUP_OR_DROPOFF_IN_SCOTLAND   # or BOTH_IN_SCOTLAND
  crossBorderMoves: TODO(owner)         # true = accept moves between Scotland and England/Wales
  maxInstantDistanceMiles: 400          # longer routes go to a manual quote
  quoteValidityMinutes: 60              # how long a shown price is guaranteed
  paymentHoldMinutes: 30                # slot is held this long while the customer pays
  phoneBookingHoldHours: 24             # slot held this long for a phone booking awaiting its payment link
  jobSizeRules: []                      # optional: big jobs use more crews/slots, e.g.
                                        # [{ minVolumeM3: 20, capacityUnits: 1, blocksSlots: 2 }]

cancellation:                           # customer self-service rules; also written into the T&Cs (solicitor to confirm)
  freeCancellationHours: TODO(owner)    # full refund if cancelled at least this many hours before the slot starts (e.g. 48)
  lateCancellationRefundPercent: TODO(owner)   # refund % between noRefundHours and freeCancellationHours (e.g. 50)
  noRefundHours: TODO(owner)            # no refund inside this many hours (e.g. 24)
  selfServiceRescheduleHours: TODO(owner)      # customers can move their date online until this many hours before (e.g. 48)

insurance:                              # shown on the site ONLY if filled in
  goodsInTransitInsurer: null
  goodsInTransitCoverPence: null        # per job, in pence: 1000000 = £10,000
  publicLiabilityCoverPence: null
  claimsEmail: null

trust:                                  # shown ONLY if filled in — never estimated
  yearsTrading: null
  vansInFleet: null

drivers:
  defaultPayoutPercent: TODO(owner)     # % of a booking's total credited to the driver who completes it

brand:
  logoProvided: false                   # true if you put your own SVG logo in docs/brand/logo.svg
```

## Pricing decisions (answer in the Admin app before launch)

The pricing engine implements your spec exactly. Six details weren't specified, so they ship with neutral defaults that change no prices. Review them in Admin → Pricing → *Approve pricing* (launch is blocked until you approve). Full detail in `docs/workflows/04-pricing-engine.md §7`.

| # | Question | Default shipped |
|---|---|---|
| P1 | Price multipliers per variant (e.g. studio vs 4-bed house, digital vs upright piano) | All 1.0 |
| P2 | Different per-mile rates for large loads? | No — same as standard |
| P3 | Carry distance / narrow access / permit asked per address — how combined? | Longest carry; narrow or permit at either address charged once |
| P4 | Rubbish removal: single address, no distance charge | Yes |
| P5 | Same-day service: only today's remaining slots bookable | Yes |
| P6 | Basement counts as one floor of stairs | Yes |
