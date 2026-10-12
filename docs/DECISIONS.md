# DECISIONS — architecture decision record

Every decision that shapes the build, with the reason. Codex appends new entries (same format) when a doc leaves something open, and fills in the version table at Phase 1.

---

## D01 — One monorepo, three apps, shared packages
**Decision:** npm workspaces + Turborepo: `apps/web`, `apps/admin`, `apps/driver`, shared `packages/*`.
**Why:** The pricing engine, API contracts and brand tokens must be identical across web and both iPhone apps. Separate repos guarantee drift; drift caused price mismatches in the past.

## D02 — Next.js 16, not 14
**Decision:** Next.js 16.x (latest patch).
**Why:** Next.js 14 reached end-of-life on 26 Oct 2025 and gets no security fixes. Next.js 15 leaves support on 21 Oct 2026. Next 16 is the Active LTS line and runs React 19.2 — the same React the current Expo SDK uses, which a single monorepo requires (React Native needs one exact React version). Your preferred stack said 14; this is the one place it changes, for security and compatibility.

## D03 — Chakra UI v3 for the web
**Decision:** Chakra v3 with a custom system built from `packages/tokens`.
**Why:** Your standard stack; Chakra documents support for Next.js 15 and 16. Known issue: Emotion hydration under Turbopack — follow Chakra's current guide (may require webpack mode for dev/build).

## D04 — iPhone apps with Expo (React Native), not native Swift
**Decision:** Expo SDK (latest stable), Expo Router, EAS Build/Update.
**Why:** One language (TypeScript) across the platform; the apps import the same pricing engine and API contracts as the website. Push notifications with custom sounds, background location, camera, Face ID and offline storage are all first-class in Expo. EAS Update ships bug fixes to staff phones in minutes without an App Store review. Android later costs little.

## D05 — Staff apps distributed privately, not on the public App Store
**Decision:** EAS internal distribution (ad hoc) to registered staff iPhones.
**Why:** No App Store review, installs from a link, push works normally. Limit: up to 100 iPhones per year per device type, and the build must be re-signed yearly. If the team outgrows that, move to Apple's unlisted/custom app distribution.

## D06 — The website hosts the API
**Decision:** All endpoints live in `apps/web/src/app/api/v1`.
**Why:** One deployment, one database connection strategy, one auth system. Mobile apps call the same versioned API. `/v1` lets the apps outlive web changes (apps can't be force-updated instantly).

## D07 — Prisma 7 on Neon (London)
**Decision:** Prisma ORM 7 with `@prisma/adapter-neon`; Neon region AWS eu-west-2; Vercel functions in `lhr1`.
**Why:** Type-safe schema and migrations; Neon's serverless driver suits Vercel. Database and functions in London keeps each query in single-digit milliseconds.

## D08 — Stripe Payment Element, deferred intent, webhooks as truth
**Decision:** Payment Element (cards, Apple Pay, Google Pay, Link) mounted before a PaymentIntent exists; booking + PaymentIntent created on "Pay"; confirmation driven by webhook.
**Why:** No PaymentIntent clutter from visitors who never pay; the server sets the amount; webhooks survive closed tabs and 3-D Secure redirects.

## D09 — Real-time = push + polling (no websockets)
**Decision:** Push notifications for alerts; React Query polling for live views (admin lists 20 s, tracking page 10 s, driver location every 30 s while on a job).
**Why:** Vercel functions don't hold websockets. This is simpler, cheaper and robust on bad mobile signal. Push guarantees the alert; polling guarantees the data.

## D10 — Expo Push Service for notifications
**Decision:** Server sends via `expo-server-sdk`; Expo relays to Apple (APNs).
**Why:** Free, handles APNs credentials, gives delivery receipts so dead devices are cleaned up. Custom sound and time-sensitive interruption level make alerts behave like WhatsApp calls-to-attention.

## D11 — Maps: Mapbox server-side; Apple Maps for display in apps
**Decision:** Mapbox Search Box (addresses), Directions (miles + ferry detection), Static Images (route previews) — all through our API with a secret token. Apps display maps with `react-native-maps` (Apple Maps) and hand off navigation to Apple Maps / Google Maps / Waze.
**Why:** Keeps the Mapbox token secret and rate-limited (abuse = your bill). Apple Maps in-app needs no extra SDK or token and is battery-friendly.

## D12 — Upstash Redis for rate limiting
**Why:** Every quote costs Mapbox calls. Without rate limits a bot can run up a large bill and slow the site. Upstash is serverless, cheap, and available through Vercel Marketplace.

## D13 — Sentry for errors, crons and uptime
**Why:** The old site's glitches cost money because nobody was alerted. Sentry alerts the owner within a minute of a failing booking, webhook, cron or app crash.

## D14 — No customer accounts or passwords
**Decision:** Customers manage bookings through signed magic links emailed to them.
**Why:** Passwords add friction and support load for a service people use once or twice. Magic links are secure and simpler.

## D15 — Staff log in with email one-time codes + Face ID
**Why:** No passwords to leak or forget; Face ID protects the app on a shared or lost phone. Sessions are per device and can be revoked from the Admin app.

## D16 — Quotes are stored server-side; bookings store every pricing input
**Why:** Re-pricing (admin edits, reschedules) must reproduce the original price exactly. Every input — floors, lifts, carry distance, narrow access, permit zone, items with volumes — is persisted on the quote and booking with the pricing version used.

## D17 — Capacity is real
**Decision:** Slot capacity per weekday/slot with date overrides; holds while paying; per-slot advisory locks inside the booking transaction; optional job-size rules for big moves.
**Why:** Prevents double-booking the same crew. Lets the site honestly show "last slot" from real data.

## D18 — Islands and ferries go to manual quotes
**Why:** The pricing spec has no ferry costs. Any route Mapbox plans over a ferry (Arran, Bute, Mull, Orkney, Shetland, Western Isles, sometimes Dunoon) would be badly under-priced, so it becomes a manual quote that an admin prices in the app.

## D19 — Town pages carry real computed data
**Decision:** Every location page shows example prices computed by the real engine using real Mapbox distances, plus distances to nearby cities and links to neighbouring towns.
**Why:** Google's spam policies target near-identical "doorway" pages. Unique, accurate data per page is what makes ~220 location pages legitimate and useful.

## D20 — Brand
**Decision:** Colours *Loch Ink* `#0B1F33`, *Gorse* `#FFC93C`, *Thistle* `#6D3BD7`; fonts **Bricolage Grotesque** (headlines, prices) and **Manrope** (text, UI).
**Why:** Distinctive in a market of blue-and-orange removal sites; rooted in Scotland (loch, gorse, thistle); all text pairs pass WCAG AA. Full rationale in `02-design-system.md`.

---

## Pinned versions (Codex fills at Phase 1)

| Package | Version | Verified on |
|---|---|---|
| node (LTS) | 24.7.0 (`.nvmrc`: 24) | 2026-10-12 |
| next | 16.4.0 | 2026-10-12 |
| react / react-dom | 19.3.0 / 19.3.0 | 2026-10-12 |
| expo (SDK) | 57.0.28 | 2026-10-12 |
| react-native | 0.87.1 | 2026-10-12 |
| @chakra-ui/react | 3.37.0 | 2026-10-12 |
| prisma / @prisma/client / @prisma/adapter-neon | 7.10.0 / 7.10.0 / 7.10.0 | 2026-10-12 |
| stripe / @stripe/stripe-js / @stripe/react-stripe-js | 23.0.0 / 10.0.0 / 7.0.0 | 2026-10-12 |
| zod | 4.6.7 | 2026-10-12 |
| typescript | 6.0.3 | 2026-10-12 |

## Entries added during the build

<!-- Codex: D21 onward. Format: ## Dxx — title / Decision / Why / Alternatives considered -->

## D21 — Phase 1 toolchain compatibility pins
**Decision:** Pin Phase 1 developer tooling to versions that install without peer-dependency overrides: ESLint `9.39.5` instead of registry latest `10.12.0`, TypeScript `6.0.3` instead of registry latest `7.0.2`, and Prisma CLI `7.10.0` instead of the `prisma` package's `latest` dist-tag `8.0.0-rc.22`.
**Why:** `eslint-plugin-react` and `typescript-eslint` did not yet declare support for ESLint 10, and `typescript-eslint` did not yet declare support for TypeScript 7. The project rules forbid `--force` / weakened guards. Prisma 8 was still an RC while the stack explicitly requires Prisma ORM 7.
**Alternatives considered:** Use npm `--force` / `--legacy-peer-deps` (rejected because it weakens dependency validation); adopt pre-release Prisma 8 (rejected because Phase 1 requires stable Prisma 7); omit the Next/React Native ESLint configs (rejected because Phase 1 requires those config presets).

## D22 — Turborepo v2 task schema
**Decision:** Use the Turborepo v2 `tasks` key in `turbo.json`, with a package-specific `@sv/web#build` output for the future Next.js app.
**Why:** The Phase 1 docs use the older "pipeline" wording, but Turbo `2.11.7` validates the current `tasks` schema. Package shells currently emit no build artifacts, so their generic build/test outputs are empty to keep verification warning-free.
**Alternatives considered:** Use the obsolete `pipeline` key (rejected because it does not match the installed Turbo schema); keep `.next/**` as the generic build output (rejected because it caused warnings for empty package builds).

## D23 — Local Git repository bootstrap
**Decision:** Initialise a local Git repository and create branch `phase/01-monorepo-foundation` before the Phase 1 commit because this workspace did not contain a `.git` directory.
**Why:** AGENTS.md §9 requires a phase branch and a commit after verification. Phase 0 expects the owner-created GitHub repository to exist, but no local repository metadata was present in this workspace.
**Alternatives considered:** Stop and ask the owner to initialise Git (rejected because Phase 1 implementation and verification were otherwise complete); skip the commit (rejected because the phase prompt explicitly requires a commit).
