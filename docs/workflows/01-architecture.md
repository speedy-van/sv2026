# 01 — Architecture & monorepo

## 1. System overview

```
                      ┌──────────────────────────── Vercel (lhr1) ────────────────────────────┐
 Customer browser ───▶│ apps/web  Next.js 16                                                   │
                      │   (marketing)  SSG/ISR pages, SEO                                       │
                      │   (booking)    /book wizard ── NDJSON quote stream                      │
                      │   (customer)   /manage /track                                           │
                      │   /api/v1/*    public · auth · admin · driver  (zod contracts)          │
 Admin iPhone  ──────▶│   /api/webhooks/stripe                                                  │
 Driver iPhone ──────▶│   /api/cron/*  (Vercel Cron, CRON_SECRET)                               │
                      └───────┬──────────┬─────────┬──────────┬──────────┬──────────┬──────────┘
                              │          │         │          │          │          │
                         Neon Postgres  Stripe   Mapbox     Resend    Expo Push   Vercel Blob
                         (eu-west-2)    (pay)   (search,    (email)   (→ APNs)    (photos,
                                                 routes)                            signatures)
                         Upstash Redis (rate limits) · Sentry (errors, crons, uptime)
```

## 2. Core flows

**Quote:** browser → `POST /api/v1/quotes` (stream) → Mapbox Directions (or route cache) → service-area + ferry checks → `@sv/pricing.computeQuote` with ACTIVE pricing config and `londonToday()` → availability overlay (capacity) → `Quote` row → stream events `route`, `availability`, `prices`, `done`.

**Booking:** browser (Payment Element already mounted) → `POST /api/v1/bookings` with `quotePublicId`, date, slot, contact, `expectedTotalPence`, `idempotencyKey` → server re-prices from stored quote inputs → capacity check + hold (transaction with advisory slot lock, 03 §6.1) → `Booking(PENDING_PAYMENT)` + `Payment` + Stripe PaymentIntent (amount = server price) → `clientSecret` → browser `stripe.confirmPayment` → Stripe webhook `payment_intent.succeeded` → `Booking(CONFIRMED)` + outbox events → emails + admin push + in-app notifications.

**Dispatch:** Admin app assigns/offers driver → outbox → driver push → driver accepts → `dispatchStatus=ACCEPTED` → customer "driver assigned" email.

**Job day:** Driver app stage transitions (offline-queued, idempotent `clientEventId`) → `JobEvent` + `jobStage` → customer tracking page polls; location points every 30 s while en route → customer sees ETA; completion → signature + photos → `COMPLETED` → earning credited → receipt + review request email.

## 3. Repository tree (target after Phase 14)

```
.
├── AGENTS.md  README.md  package.json  turbo.json  tsconfig.base.json  .nvmrc  .env.example
├── .github/workflows/ci.yml  .github/dependabot.yml
├── scripts/  launch-check.ts  geocode-locations.ts  generate-location-prices.ts  seo-check.ts
├── apps/
│   ├── web/
│   │   ├── next.config.ts  vercel.json  sentry.*.config.ts  playwright.config.ts  vitest.config.ts
│   │   ├── public/  (favicons, og fallback, apple-touch-icon, robots handled by app/robots.ts)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── layout.tsx  providers.tsx  not-found.tsx  error.tsx  global-error.tsx
│   │       │   ├── sitemap.ts  robots.ts  manifest.ts  opengraph-image.tsx
│   │       │   ├── (marketing)/ page.tsx  services/  areas/  removals/  man-and-van/  pricing/
│   │       │   │                how-it-works/  about/  contact/  reviews/  help/  guides/  legal/  drive-with-us/
│   │       │   ├── (booking)/   book/page.tsx  book/confirmation/page.tsx  quote/[publicId]/page.tsx
│   │       │   ├── (customer)/  manage/  manage/[token]/  track/[token]/  pay/[token]/  review/[token]/
│   │       │   ├── api/v1/      (see 05-api.md)
│   │       │   ├── api/webhooks/stripe/route.ts
│   │       │   └── api/cron/    outbox/  expire-holds/  reminders/  push-receipts/  document-expiry/  quote-cleanup/
│   │       ├── server/
│   │       │   env.ts  log.ts  errors.ts  with-api.ts  request-context.ts  rate-limit.ts  prisma.ts
│   │       │   auth/        (otp, tokens, sessions, guards, customer-links)
│   │       │   integrations/ mapbox/  stripe/  resend/  expo-push/  blob/
│   │       │   services/    quote  availability  booking  payment  dispatch  job  pricing-admin
│   │       │                customer  reviews  manual-quote  settings  reports  notifications  files
│   │       │   outbox/      enqueue.ts  processor.ts  handlers/
│   │       │   repositories/
│   │       ├── components/  layout/  ui/  booking/  landing/  seo/  customer/  motion/
│   │       ├── content/     site-copy.ts  services.ts  faqs.ts  guides/  locations/
│   │       ├── lib/         query-keys.ts  analytics.ts  consent.ts  format.ts
│   │       └── theme/       system.ts  recipes/  provider.tsx
│   ├── admin/   app/ (Expo Router)  src/  assets/sounds/  app.config.ts  eas.json
│   └── driver/  app/ (Expo Router)  src/  assets/  app.config.ts  eas.json
└── packages/
    ├── pricing/      src/{types,dates,config.default,engine,format}.ts  test/
    ├── contracts/    src/{errors,money,time,address,booking-state,settings}.ts  src/api/*.ts
    ├── db/           prisma/schema.prisma  prisma/migrations/  prisma.config.ts  src/{client,seed}.ts
    ├── tokens/       src/{colors,typography,space,radii,shadows,motion,index}.ts
    ├── emails/       src/templates/*.tsx  src/components/*.tsx
    ├── api-client/   src/{client,auth,errors,hooks}.ts
    └── config/       tsconfig/  eslint/  prettier/
```

## 4. Package boundaries (enforced by ESLint `no-restricted-imports`)

| Package | May import | Must never import |
|---|---|---|
| `@sv/pricing` | nothing | anything |
| `@sv/contracts` | `zod`, `@sv/pricing` (types) | `@sv/db`, React, Node APIs |
| `@sv/tokens` | nothing | anything |
| `@sv/db` | Prisma, `@sv/contracts` | React, Next |
| `@sv/emails` | React Email, `@sv/contracts`, `@sv/tokens` | `@sv/db` |
| `@sv/api-client` | `@sv/contracts` | `@sv/db`, Node-only APIs |
| `apps/web` `src/server/**` | all packages | client components |
| `apps/web` client code | `@sv/contracts`, `@sv/pricing`, `@sv/tokens` | `@sv/db`, `src/server/**` |
| `apps/admin`, `apps/driver` | `@sv/api-client`, `@sv/contracts`, `@sv/pricing`, `@sv/tokens` | `@sv/db`, `apps/web/**` |

## 5. Environments

| Env | Web | Database | Stripe | Mapbox | Apps |
|---|---|---|---|---|---|
| Local | `npm run dev:web` | Neon `dev` branch | test mode + `stripe listen` | real (rate-limited) or `MAPBOX_MODE=mock` | Expo dev client pointing at `EXPO_PUBLIC_API_URL` |
| Preview | Vercel preview per PR | Neon branch per PR (Vercel–Neon integration) | test mode | real | — |
| Staging | `staging` branch → `staging.speedyvan.uk` | Neon `staging` branch | test mode | real | EAS `preview` channel |
| Production | `www.speedyvan.uk` | Neon `main` | live | real | EAS `production` channel |

`vercel.json` (in `apps/web`): `"regions": ["lhr1"]`, crons (see 13 §6), `maxDuration` 30 s for `/api/v1/quotes`, 60 s for crons.

## 6. Environment variables (`.env.example` must list every one with a comment)

| Variable | Scope | Purpose |
|---|---|---|
| `DATABASE_URL` | server | Neon **pooled** connection string (runtime) |
| `DATABASE_URL_UNPOOLED` | server | Neon direct connection (migrations, `prisma.config.ts`) |
| `APP_ORIGIN` | server | `https://www.speedyvan.uk` (preview: Vercel URL) |
| `NEXT_PUBLIC_SITE_URL` | public | canonical origin for metadata |
| `STRIPE_SECRET_KEY` | server | |
| `STRIPE_WEBHOOK_SECRET` | server | |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public | |
| `MAPBOX_SECRET_TOKEN` | server | Search Box, Directions, Static Images |
| `MAPBOX_MODE` | server | `live` (default) or `mock` (tests/E2E) |
| `RESEND_API_KEY` | server | |
| `EMAIL_FROM` | server | e.g. `Speedy Van <bookings@speedyvan.uk>` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | server | rate limiting |
| `BLOB_READ_WRITE_TOKEN` | server | Vercel Blob |
| `EXPO_ACCESS_TOKEN` | server | Expo push (enhanced security) |
| `JWT_ACCESS_SECRET` | server | ≥ 32 random bytes, staff access tokens |
| `CUSTOMER_LINK_SECRET` | server | ≥ 32 random bytes, magic links/tracking/review tokens |
| `OTP_PEPPER` | server | ≥ 32 random bytes |
| `IP_HASH_SALT` | server | hashing IPs for abuse tracking |
| `CRON_SECRET` | server | Vercel cron auth |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` | server/public/build | |
| `MIN_ADMIN_APP_VERSION` / `MIN_DRIVER_APP_VERSION` | server | semver; older apps see "Update required" |
| `NEXT_PUBLIC_GA4_ID` / `NEXT_PUBLIC_GADS_ID` / `NEXT_PUBLIC_GADS_PURCHASE_LABEL` | public | analytics (empty = disabled) |
| `EXPO_PUBLIC_API_URL` | app | API origin per EAS profile |
| `EXPO_PUBLIC_SENTRY_DSN` | app | |

`src/server/env.ts` validates all server vars with zod at startup; missing/invalid → build fails with a list.

## 7. Phase 1 steps (exact)

1. `npm init -y`; set `"private": true`, `"workspaces": ["apps/*", "packages/*"]`, `"packageManager": "npm@<current>"`, `"engines": { "node": ">=<LTS major>" }`.
2. Add Turborepo; `turbo.json` pipelines: `lint`, `typecheck`, `test` (dependsOn `^build` none — packages are source), `build` (web only, outputs `.next/**` excluding cache), `e2e`.
3. `packages/config`: `tsconfig/base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `moduleResolution: "bundler"`, `verbatimModuleSyntax`), `tsconfig/nextjs.json`, `tsconfig/expo.json`, `tsconfig/library.json`; `eslint/` flat configs (base, next, react-native) with typescript-eslint `strictTypeChecked`, import boundaries (§4), `no-console` (error); `prettier/` config (printWidth 110, singleQuote, trailingComma all).
4. Create each package with `package.json` (`"name": "@sv/<name>"`, `"exports": { ".": "./src/index.ts" }`, scripts `lint`, `typecheck`, `test`), `tsconfig.json`, `src/index.ts` exporting nothing yet, one trivial test.
5. Root scripts exactly as AGENTS.md §6 (some will no-op until their phase).
6. `.github/workflows/ci.yml`: on PR and push to `main` → checkout, setup-node (from `.nvmrc`, npm cache), `npm ci`, `npm run verify`. Concurrency group per ref. Later phases add Playwright job.
7. `.github/dependabot.yml`: npm weekly (grouped minor/patch), GitHub Actions monthly.
8. `scripts/launch-check.ts` skeleton: checks run in later phases (FACTS TODOs, env completeness, pricing approval, legal pages approved flag, Apple Pay domain flag). Exits non-zero with a readable list.
9. Fill the version table in `docs/DECISIONS.md`.

## 8. Rendering strategy (web)

| Route | Rendering | Revalidation |
|---|---|---|
| `/`, services, pricing, how-it-works, about, help, legal | Static (RSC), data from DB at build + ISR | `revalidateTag('settings' | 'pricing' | 'faqs' | 'reviews')` on admin change |
| `/areas`, `/removals/[slug]`, `/man-and-van/[city]`, region pages, route pages | `generateStaticParams` for all slugs | tag `locations`, `pricing` |
| `/book`, `/book/confirmation` | Client-heavy page with server shell; `noindex` | — |
| `/manage/*`, `/track/*`, `/pay/*`, `/review/*` | Dynamic, `noindex`, `no-store` | — |
| `/api/*` | Node runtime route handlers | — |

Admin changes that affect public pages (pricing publish, settings, FAQs, reviews, location notes) call `revalidateTag` in the same request after commit.
