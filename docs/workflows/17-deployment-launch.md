# 17 — Deployment, launch & cutover

## 1. Environments

| | Local | Preview | Staging | Production |
|---|---|---|---|---|
| Web | `localhost:3000` | Vercel preview per PR (Vercel Authentication on; automation bypass secret for E2E) | `staging` branch → `https://staging.speedyvan.uk` | `main` → `https://www.speedyvan.uk` |
| Database (Neon, London) | `dev` branch | per-PR branch (Vercel–Neon integration) | `staging` branch | `main` branch |
| Stripe | test | test | test (own webhook endpoint) | **live** |
| Email | capture or Resend test | capture | Resend, `EMAIL_ALLOWLIST` (only listed addresses receive mail) | Resend |
| Apps | dev client | — | EAS `preview` channel builds | EAS `production` channel builds |
| Indexing | — | `noindex` | `noindex` | indexable |

Promotion: PR → preview (tests) → merge to `staging` (owner QA, app preview builds) → merge `staging` → `main` (production). Database migrations run in the Vercel build for staging/production (`prisma migrate deploy`) only after passing on the PR's Neon branch.

## 2. Vercel project (Phase 1 config, Phase 17 production values)

- Root directory `apps/web`, include files outside the root (monorepo), install `npm ci` at repo root, build via Turborepo for `web`.
- Node version = `.nvmrc`. Region `lhr1`. Crons from `apps/web/vercel.json` (13 §10). Plan: **Pro**.
- Environment variables per environment (01 §6). Production uses live Stripe keys, production Upstash, production Sentry DSN, `MIN_*_APP_VERSION`.
- Domains: `www.speedyvan.uk` (primary), `speedyvan.uk` → permanent redirect to www, `staging.speedyvan.uk` → `staging` branch. Use the exact DNS records Vercel shows in the domain screen.

## 3. iPhone apps (EAS)

1. Apple Developer account (company). In Expo: create projects `sv-admin`, `sv-driver` under the `speedyvan` organisation; put project IDs in each `app.config.ts`.
2. `eas credentials` per app: let EAS create the distribution certificate, ad hoc provisioning profiles and the **push key**; enable capabilities on the App IDs: Push Notifications, Time Sensitive Notifications (both apps), Background Modes → Location updates (driver).
3. Register staff iPhones: `eas device:create` produces a link; each person opens it on their iPhone and installs the profile. Rebuild after adding devices.
4. Builds: `eas build -p ios --profile preview|production` → install links. Put production links in Admin → Settings → Apps (used in invite emails).
5. JS-only fixes: `eas update --channel production -m "<what changed>"`. Native changes (new permission, plugin, SDK) need a new build.
6. Yearly: ad hoc profiles and the Apple membership expire after 12 months — calendar reminder one month before; rebuild and redistribute.

## 4. Owner pre-launch checklist

- [ ] `docs/FACTS.md` complete; settings reviewed in Admin.
- [ ] Pricing reviewed and **approved** in Admin (P1–P6).
- [ ] Legal pages approved by a solicitor; `launch.legalApprovedAt` set.
- [ ] ICO data protection fee paid; number in settings.
- [ ] Stripe: live keys, webhook endpoint, Apple Pay domain verified, statement descriptor.
- [ ] Resend domain verified; DMARC in place.
- [ ] Capacity rules set to real crew numbers; closed dates entered.
- [ ] Every admin's iPhone: app installed, notifications on, test push received.
- [ ] Every driver's iPhone: app installed, location "Always", test job completed on staging.
- [ ] Upcoming bookings from the old system re-entered as offline-paid phone bookings (Admin → New phone booking → Paid offline), so drivers see them and customers get the new emails.
- [ ] Google Business Profile and Search Console ready (08 §10).
- [ ] (Optional) Search Console export of old indexed URLs given to Codex for 301s (08 §9).

## 5. `npm run verify:launch` (must be green)

Runs against production config (`vercel env pull` to a temp file, never committed) and the production API:
- No `TODO(owner)` facts (`launch.missingFacts` empty); every required setting valid.
- ACTIVE pricing version exists and `approvedByOwner` is true.
- `launch.legalApprovedAt` set (blocker); Apple Pay verified (warning).
- Keys are live (`sk_live_`, `pk_live_`); Stripe webhook endpoint exists for the production URL with every event in 10 §4.
- Resend domain verified; Mapbox token answers a test request; Upstash reachable; Sentry DSN set; `CRON_SECRET`, JWT and link secrets set and ≥ 32 bytes.
- `/api/v1/health` returns 200 on production.
- At least one OWNER and capacity rules exist; `contact.emailAdminAlerts` non-empty; **at least one OWNER/ADMIN has a working push device** (otherwise nobody hears new bookings).
- `canonicalOrigin` matches the production domain.

## 6. Cutover day

| When | Step |
|---|---|
| T−7 days | Staging feature-complete; owner acceptance on phones; release gate (16 §7) passed |
| T−2 days | Lower TTL on the `www` and apex records to 300 s (leave MX/TXT untouched) |
| T−1 day | Re-enter upcoming old bookings; final content check; keep the old project **paused, not deleted** |
| T−0 | Merge to `main` → production deploy → `verify:launch` → switch DNS to Vercel → confirm HTTPS on both hosts and the apex redirect → live webhook test (Stripe Dashboard "send test event" → 200) |
| T−0 smoke test | (1) Home on a phone loads fast, booking card visible. (2) Real booking on your own card for the cheapest slot → confirmation page → email arrives → **admin phones ring** → assign yourself → driver app shows the job → run it to completion → completion email → refund from Admin → refund email and Stripe show it. (3) Contact form arrives. (4) Manage link, reschedule preview, cancel preview work. (5) `/sitemap.xml` and `/robots.txt` correct; submit the sitemap in Search Console. |
| Rollback (first 48 h, only for a critical failure) | Re-point the domain to the old project in Vercel; pause online booking on the new site; keep the database (new bookings stay safe) |

## 7. First 14 days (daily, 10 minutes)

Sentry issues (zero unresolved in booking/payment) · Admin → System health (outbox, webhooks, crons, push errors) · bookings vs quotes funnel · Search Console coverage and 404s (add 301s for any valuable old URLs that appear) · Core Web Vitals in Speed Insights · any customer emails bouncing · driver app sync errors.

## 8. Ongoing maintenance

| Cadence | Task |
|---|---|
| Weekly | Merge Dependabot patch/minor updates after green CI; review Sentry |
| Monthly | Search Console review; check pricing performance in reports; rotate staging data |
| Quarterly | Restore drill on a Neon branch; review access (team, devices); review legal/cookie inventory |
| Twice a year | Expo SDK upgrade (one SDK at a time, staging first); Next.js minor/patch on the supported line |
| Yearly | Apple membership + ad hoc profiles; secret rotation (12 §7); re-confirm insurance facts on the site |
