# Launch Runbook

Operational checklist for Phase 17. Keep secrets in Vercel, Stripe, Resend, Expo, Sentry and Neon; do not paste them into docs or commits.

## Production Configuration

- Vercel production branch: `main`.
- Production domain: `https://www.speedyvan.uk`; apex `https://speedyvan.uk` redirects to `www`.
- Neon production branch: `main`; CI/test branches must continue to use `dev` as parent.
- Vercel region: `lhr1`; Node version follows `.nvmrc`.
- Required production env is enforced by `npm run verify:launch`.

## External Accounts

- Stripe live mode: live secret key, live publishable key, live webhook endpoint at `/api/webhooks/stripe`, Apple Pay domain verified, statement descriptor configured.
- Resend: `speedyvan.uk` domain verified with SPF, DKIM and DMARC records in DNS.
- Mapbox: secret token with Search Box, Directions and Static Images scopes.
- Upstash: production Redis REST URL/token.
- Sentry: production projects and alert routing for web, admin and driver; uptime and cron monitors configured.
- Expo/EAS: production Admin and Driver builds distributed internally to registered iPhones.
- Search Console: production property verified and `/sitemap.xml` submitted after DNS cutover.

## Cutover Checklist

- `npm run verify` passes on `main`.
- `npm run verify:launch` passes against production env and production API.
- Owner has completed the `17-deployment-launch.md` §4 checklist.
- Legal settings show solicitor approval and no unresolved `TODO(owner)` facts.
- Active pricing is owner-approved in Admin.
- At least one OWNER/ADMIN has an enabled push device and has received a test push.
- Old upcoming bookings are re-entered as offline-paid phone bookings.
- DNS TTL lowered before cutover and only Vercel web records changed; MX/TXT mail records are left intact.

## Live Smoke Test

- Phone loads home quickly; booking card is visible.
- Make one real booking on the owner's own card for the cheapest slot.
- Confirmation page, booking email, admin push, admin assignment, driver job, completion email and refund from Admin all work.
- Stripe shows payment and refund; webhook updates the booking.
- Contact form arrives.
- Manage link, reschedule preview and cancel preview work.
- `/robots.txt` and `/sitemap.xml` are correct; submit sitemap in Search Console.

## First 14 Days

Daily: check Sentry, system health, pending outbox age, webhook recency, cron runs, push errors, quote/booking funnel, Search Console coverage/404s, Speed Insights/Core Web Vitals, bounced email and driver sync errors.
