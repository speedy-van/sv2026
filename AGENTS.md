# AGENTS.md — Speedy Van (speedyvan.uk)

Standing orders for Codex in this repository. Loaded automatically every session. Keep this file under 32 KiB; detail lives in `docs/`.

---

## 1. Mission

Build **Speedy Van**: a removals and man-and-van booking platform covering all of Scotland. Three products, one backend:

- **Web** — `apps/web` — Next.js on Vercel. Marketing site, instant-price booking with a 28-day × 3-slot price calendar, Stripe checkout, customer self-service, SEO pages for every city and town. **Hosts the entire API** (`/api/v1/*`) used by all three products.
- **Admin iOS app** — `apps/admin` — Expo/React Native. Runs the whole business. Every new paid job triggers a loud push notification (works when the app is closed) and a full-screen in-app pop-up.
- **Driver iOS app** — `apps/driver` — Expo/React Native. Jobs, navigation hand-off, step-by-step job flow, photos, signature, live location, earnings. Must work offline.

**Start state:** this folder holds only `AGENTS.md`, `README.md` and `docs/`. You build everything else, phase by phase, per `docs/RUNBOOK.md`.

**No legacy.** There is no previous codebase to consult. Never look for, ask for, or imitate any earlier Speedy Van project, site or URL structure. The pricing algorithm in `docs/workflows/04-pricing-engine.md` is the owner's specification and the only thing carried forward.

Real people use this to move their homes. A glitch costs a family their moving day and costs the owner money. Build accordingly.

---

## 2. How you work

1. The owner gives you **one phase at a time** ("Execute Phase N"). Read that phase in `docs/RUNBOOK.md`, then **every** document it lists, fully, before writing code.
2. Add a short plan (5–15 bullets) under the phase in `docs/PROGRESS.md`, then implement.
3. Run the phase's **Verify** commands. All must pass. Fix failures; never skip or weaken them.
4. Tick the phase's items in `docs/PROGRESS.md`. Commit (§9).
5. **Stop at the end of the phase.** Report: what you built, verify output (summarised), deviations, and anything in `docs/QUESTIONS.md`. Never start the next phase on your own.

**When blocked:** write the question in `docs/QUESTIONS.md` using its template, finish everything that is not blocked, then stop and report. Never guess about money, prices, legal text, business facts or security. For anything else, choose the option that best matches these documents, record it in `docs/DECISIONS.md`, and continue.

**When docs conflict:** this file wins, then `docs/workflows/04-pricing-engine.md`, then the more specific workflow doc. Record the conflict in `docs/QUESTIONS.md`.

---

## 3. Non-negotiable rules

**R1 — Pricing parity.** `packages/pricing` is a port of `docs/reference/pricing/*` and must pass every golden vector in `docs/reference/pricing/vectors.json` to the penny. Never change arithmetic, rounding, or multiplication order. Never regenerate vectors to make a test pass. The engine is the **only** place prices are computed — web, API, admin simulator and admin re-pricing all import it. No second implementation anywhere.

**R2 — Server is the price authority.** The client never sends a price that is trusted. Booking creation re-prices from the stored quote inputs and rejects any mismatch with `409 PRICE_CHANGED`. Stripe is charged the server price only.

**R3 — No invented facts.** Business facts (phone, email, address, company number, VAT, insurance, years trading, fleet size, reviews, ratings, customer counts, awards, guarantees) come only from `docs/FACTS.md` → seeded into the `Setting` table. If a fact is missing, the UI omits it and you add a `TODO(owner)` note to `docs/QUESTIONS.md`. Never write testimonials, review counts, star ratings, "trusted by X", or comparative claims about competitors. Legal pages are drafts marked for solicitor review.

**R4 — Money is integer pence** everywhere outside the pricing engine's internals: DB, API, Stripe, emails, UI props. Format only at the edge with `formatGBP(pence)` from `packages/contracts`. No floats for money, no `toFixed` on money.

**R5 — Time is Europe/London.** Move dates are civil dates (`YYYY-MM-DD`, `@db.Date`). "Today", slot cut-offs, reminders, reports and cron logic use London time via the helpers in `packages/contracts/src/time.ts`. Never call `new Date().getDay()`/`getHours()` for business logic — servers run in UTC.

**R6 — Contracts first.** Every API request/response has a zod schema in `packages/contracts`. Route handlers parse input with it; clients type responses with it. Mobile apps and web share the same schemas. Changing an endpoint means changing the contract and every consumer in the same commit (§8 consistency check).

**R7 — Every UI has every state.** Each screen/card/component that loads or submits data implements: loading (skeleton matching final layout), empty, error (human message + retry), success, and disabled/submitting. No spinners-forever, no blank screens, no unhandled promise rejections.

**R8 — Accessibility is built in:** WCAG 2.2 AA. Semantic HTML, labelled inputs, visible focus, 44×44 px touch targets, `prefers-reduced-motion` respected, colour never the only signal. Mobile: accessibility labels and Dynamic Type.

**R9 — Performance budgets** (mobile, p75): LCP < 2.0 s, INP < 200 ms, CLS < 0.05. Landing page JS ≤ 170 KB gzip first load. Map libraries never load on the landing page. Images via `next/image`.

**R10 — Security.** Secrets only in server env; nothing secret behind `NEXT_PUBLIC_`. Every admin/driver endpoint checks role and ownership server-side. Rate limit public endpoints. Verify Stripe webhook signatures. Validate uploads. No PII in logs. Details: `docs/workflows/12-auth-security.md`.

**R11 — Idempotency.** Booking creation, payments, webhooks, outbox processing, driver job events and photo uploads are idempotent (keys are specified in the docs). Assume every request can arrive twice.

**R12 — No silent failures.** Every caught error is either handled with a user-visible outcome or reported to Sentry with context. Never `catch {}`. External calls (Stripe, Mapbox, Resend, Expo) have timeouts and typed error mapping.

**R13 — Tests are part of the feature.** Pricing: 100% line coverage. Each API route: at least happy path + validation failure + auth failure. Booking flow: Playwright E2E. A phase is not done with failing or skipped tests.

**R14 — Dependencies.** Only the stack in §4 plus libraries a workflow doc names. Anything else needs an entry in `docs/DECISIONS.md` (why, alternatives, bundle impact). Pin exact versions. One library per job — no two date libraries, no two form libraries.

**R15 — Never weaken a guard to get green.** No `@ts-ignore`, `as any`, `eslint-disable`, skipped tests, or loosened zod schemas to make something pass. If a guard is wrong, fix it properly and explain in `docs/DECISIONS.md`.

**R16 — One truth per fact.** Booking status transitions only through `packages/contracts/src/booking-state.ts`. Business settings only from `Setting`. Prices only from `packages/pricing`. Copy for repeated UI text from `apps/web/src/content/`. Never duplicate a constant across apps — put it in a package.

---

## 4. Stack

Versions: at Phase 1, verify the current stable release of each (`npm view <pkg> version`), pin exact versions, and record them in `docs/DECISIONS.md`. One React version across the whole monorepo (the one required by the Expo SDK in use; it must also satisfy Next.js).

| Area | Choice |
|---|---|
| Monorepo | npm workspaces + Turborepo. Node LTS (record in `.nvmrc`). |
| Language | TypeScript `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| Web | **Next.js 16.x** (latest patch), App Router, React Server Components where they help. Not 14 (end-of-life Oct 2025) or 15 (support ends Oct 2026). Do not adopt a newer major until it has been out 3 months and Chakra documents support. |
| UI (web) | **Chakra UI v3** (`createSystem`, recipes, snippets via `@chakra-ui/cli`), Emotion |
| Motion (web) | `motion` (Motion for React) with `LazyMotion` + `m`; `@number-flow/react` for animated prices |
| Icons | `lucide-react` (web), `lucide-react-native` (apps) |
| Forms | `react-hook-form` + `@hookform/resolvers/zod` |
| Client data | `@tanstack/react-query` (web client components and both apps) |
| Client state | `zustand` (booking draft only) |
| Validation | `zod` |
| DB | **Neon Postgres** + **Prisma ORM 7** with `@prisma/adapter-neon`; `prisma.config.ts` |
| Payments | `stripe` (server), `@stripe/stripe-js` + `@stripe/react-stripe-js` (Payment Element, deferred intent) |
| Maps/addresses | Mapbox Search Box API, Directions API, Static Images API (server-side, secret token) |
| Email | **Resend** + `react-email` / `@react-email/components` |
| Push | **Expo Push Service** via `expo-server-sdk` (server), `expo-notifications` (apps) |
| Files | Vercel Blob (served only through authenticated proxy routes) |
| Rate limiting | Upstash Redis + `@upstash/ratelimit` |
| Auth tokens | `jose` (JWT), Node `crypto` |
| Monitoring | Sentry (`@sentry/nextjs`, `@sentry/react-native`), Vercel Speed Insights |
| Mobile | **Expo SDK — latest stable (56 or newer; verify)**, Expo Router, EAS Build, EAS Update, `expo-secure-store`, `expo-local-authentication`, `expo-location`, `expo-task-manager`, `expo-image-manipulator`, `expo-haptics`, `expo-audio`, `react-native-maps` (Apple Maps), `react-native-reanimated`, plus the libraries named in 14/15 (camera, SQLite, NetInfo, signature canvas) |
| Tests | Vitest (unit/integration), Playwright (web E2E + axe), jest-expo + React Native Testing Library (apps) |
| Lint/format | ESLint (flat config, typescript-eslint strict), Prettier |

Chakra + Turbopack: follow the current Chakra Next.js guide. If Emotion hydration mismatches appear under Turbopack, use the webpack flags that guide specifies and record it in `docs/DECISIONS.md`.

---

## 5. Repository layout

```
apps/
  web/                    Next.js — site, booking, self-service, API, cron, webhooks
    src/app/(marketing)/  landing, services, areas, guides, legal
    src/app/(booking)/    /book, /book/confirmation
    src/app/(customer)/   /manage, /track
    src/app/api/v1/       REST API (public, auth, admin, driver)
    src/app/api/webhooks/ stripe
    src/app/api/cron/     scheduled jobs (CRON_SECRET)
    src/server/           server-only: services, repositories, integrations, auth, outbox
    src/components/       UI by feature (booking/, landing/, layout/, ui/)
    src/content/          copy, FAQs seed, location content
    src/theme/            Chakra system (tokens from packages/tokens)
  admin/                  Expo app (Expo Router)
  driver/                 Expo app (Expo Router)
packages/
  pricing/                pricing engine (pure TS, zero deps)
  contracts/              zod schemas, API types, booking state machine, time + money helpers, error codes
  db/                     Prisma schema, migrations, seed, client factory (server-only)
  tokens/                 brand tokens (colours, type, spacing, motion) for web and apps
  emails/                 React Email templates
  api-client/             typed fetch client used by both apps (auth refresh, errors, app-version header)
  config/                 shared tsconfig, eslint, prettier
docs/                     specification (read-only for you, except PROGRESS, QUESTIONS, DECISIONS)
scripts/                  repo scripts (launch-check, geocode-locations, etc.)
```

Workspace package names: `@sv/pricing`, `@sv/contracts`, `@sv/db`, `@sv/tokens`, `@sv/emails`, `@sv/api-client`, `@sv/config`. Packages are consumed as TypeScript source (`transpilePackages` in Next, Metro monorepo config in apps). Imports are extensionless.

After scaffolding each app, create a short nested `AGENTS.md` inside it pointing to its workflow docs.

---

## 6. Commands (root)

| Command | Does |
|---|---|
| `npm run dev:web` | Next.js dev server |
| `npm run dev:admin` / `dev:driver` | Expo dev servers |
| `npm run lint` | ESLint all workspaces |
| `npm run typecheck` | `tsc --noEmit` all workspaces |
| `npm run test` | Vitest + jest-expo all workspaces |
| `npm run test:pricing` | pricing package incl. golden vectors + coverage gate |
| `npm run e2e` | Playwright against local web (Mapbox/Stripe in test mode, see 16-testing) |
| `npm run build` | build web (and typecheck apps) |
| `npm run db:migrate` / `db:deploy` / `db:seed` / `db:studio` | Prisma |
| `npm run verify` | lint + typecheck + test + build — **must pass before every commit** |
| `npm run verify:launch` | `scripts/launch-check.ts` — blocks launch on any TODO(owner), missing env, unapproved pricing |

---

## 7. Code conventions

**Server code (`apps/web/src/server`)**
- `import 'server-only'` at the top of every server module.
- Layering: route handler → service → repository (Prisma). Handlers do parsing, auth and response mapping only. Business rules live in services.
- Env access only via `src/server/env.ts` (zod-validated at boot; build fails on missing vars).
- Errors: throw `AppError(code, message, details?)` from `@sv/contracts/errors`; `withApi()` wrapper maps to the JSON envelope `{ error: { code, message, details?, requestId } }` and HTTP status. Unknown errors → 500 `INTERNAL` + Sentry.
- Every response carries `x-request-id`. Log with the structured logger (`src/server/log.ts`), never `console.log`. Redact email, phone, address, tokens.
- DB writes that touch more than one row use `prisma.$transaction`. Capacity and status changes use exactly the patterns in `03-database.md §6` (advisory slot locks, optimistic `version`, conditional updates).
- Side effects (email, push, notifications) go through the **outbox** in the same transaction as the state change. Never send email/push inline from a request.

**Web UI**
- Server Components for data fetching and static content; client components only for interactivity. Chakra components live in client components.
- Fetch from client with React Query hooks in `src/components/<feature>/api.ts`; query keys from `src/lib/query-keys.ts`.
- All copy in `src/content/*.ts` (typed). No hard-coded business facts — read `getSiteSettings()`.
- Animations use tokens from `@sv/tokens/motion`. Respect reduced motion via `useReducedMotion()`.

**Apps**
- Expo Router file routes. Data via `@sv/api-client` + React Query. Secure storage for tokens only.
- Every screen: `ScreenState` wrapper handles loading/empty/error/offline consistently.

**Naming**: files `kebab-case.ts(x)`, components `PascalCase`, hooks `useCamelCase`, zod schemas `XxxSchema`, types `Xxx`, DB enums `UPPER_SNAKE`. API paths kebab-case plural nouns.

**Types**: no `any`, no non-null `!` except where proven by preceding check (comment why). Exported functions have explicit return types.

---

## 8. Definition of Done (every task)

- [ ] Matches the workflow doc exactly (or deviation recorded in `docs/DECISIONS.md`).
- [ ] All UI states (R7), a11y (R8), responsive 360 px → 1440 px (web), iPhone SE → Pro Max and iPad (apps).
- [ ] Input validated with contracts; errors typed and user-friendly.
- [ ] Tests written and passing; `npm run verify` green.
- [ ] **Consistency check** when an endpoint, contract, status or setting changes: search every consumer (`apps/web`, `apps/admin`, `apps/driver`, `packages/*`, emails, cron) and update all in the same commit. List them in the commit body.
- [ ] No new warnings (TS, ESLint, React, Expo doctor).
- [ ] PROGRESS.md ticked.

---

## 9. Git

- Branch per phase: `phase/NN-short-name`. Conventional commits (`feat(web): …`, `fix(pricing): …`).
- Commit when `npm run verify` passes. Small, coherent commits; never commit secrets, `.env*` (except `.env.example`), generated Prisma client, or build output.
- Never rewrite history on `main`. Never force-push.

---

## 10. Never

- Never compute a price outside `@sv/pricing`, or trust a client price.
- Never invent a business fact, review, rating, statistic, legal term, or competitor comparison.
- Never show fake urgency ("3 people are looking at this") or fake scarcity. Capacity badges must come from real capacity data.
- Never send email/push directly from a request handler — use the outbox.
- Never log or expose: secrets, full card data (we never see it), tokens, customer contact details.
- Never expose Vercel Blob URLs, Mapbox secret tokens, or Stripe secret keys to clients.
- Never use `localStorage` for auth tokens on web or plain `AsyncStorage` for tokens in apps.
- Never make the landing page depend on a client-side fetch to render its main content.
- Never delete or rename a DB column in the same deploy that stops using it (expand → migrate → contract).
- Never start the next phase without the owner's prompt.
