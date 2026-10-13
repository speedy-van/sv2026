# INCIDENTS — Speedy Van

Operational runbook for production incidents. Keep secrets in the password manager and provider dashboards; do not paste them into this file.

## Contacts And Accounts

- Owner: use the active OWNER user in Admin → Team.
- Hosting: Vercel project for `speedyvan.uk`.
- Database: Neon project, production branch `main`, development branch `dev`.
- Payments: Stripe account for Speedy Van.
- Email: Resend account and `speedyvan.uk` sending domain.
- Maps: Mapbox account with server-side token.
- Push: Expo organisation `speedyvan`.
- Monitoring: Sentry organisation with projects `web`, `admin`, `driver`.

## Pause Online Booking

1. Open Admin → More → Settings → Operations.
2. Enable `operations.bookingPaused`.
3. Confirm the website shows the paused-booking banner and disables instant booking CTAs.
4. Leave customer self-service available unless the incident affects booking data integrity.
5. Add a `system.alert` note in Admin with the reason and expected next update time.

## Revoke Every Staff Session

Use this for lost devices, suspected refresh-token theft, or staff account compromise.

1. Open Admin → Team.
2. For one affected user, use Revoke sessions.
3. For all staff, run the OWNER-only session revocation action for every active user from Admin, or execute a database transaction that sets `Session.revokedAt` and `Session.revokedReason = 'incident-response'`.
4. Disable affected `PushDevice` rows.
5. Ask staff to sign in again with OTP and verify their device list.

## Rotate Secrets

Rotate one secret at a time and verify the dependent flow after each rotation.

- `JWT_ACCESS_SECRET`: deploy with dual verification support before changing active signing, then revoke staff sessions.
- `CUSTOMER_LINK_SECRET`: deploy with dual verification support, then resend active customer links.
- `OTP_PEPPER`: invalidate unused `AuthOtp` rows after rotation.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`: update Vercel env, redeploy, verify webhook signature rejection and a test webhook.
- `MAPBOX_SECRET_TOKEN`: update Vercel env, redeploy, run quote smoke with `MAPBOX_MODE=live`.
- `RESEND_API_KEY`: update Vercel env, redeploy, send a test email from Admin.
- `EXPO_ACCESS_TOKEN`: update Vercel env, redeploy, send Admin test push.
- `UPSTASH_REDIS_REST_TOKEN`: update Vercel env, redeploy, run public mutation rate-limit smoke.
- `CRON_SECRET`: update Vercel env and Vercel cron authorization together.

## Restore Database To A Point In Time

1. Pause online booking.
2. Record the target restore timestamp in UTC and Europe/London civil time.
3. In Neon, create a restore branch from production at that timestamp.
4. Run `npm run db:deploy` against the restore branch.
5. Run read-only smoke checks: health endpoint, recent bookings, payments, outbox backlog.
6. Promote the restored branch only after the owner confirms the data window.
7. Replay Stripe webhooks and outbox events needed to catch up after the restore point.

## Replay Failed Outbox Events

1. Open Admin → System → Outbox.
2. Inspect failed events and their `lastError`.
3. Fix the upstream cause first: Stripe, Resend, Expo, or data issue.
4. Retry individual events from Admin, or set selected `FAILED` events back to `PENDING` with `nextAttemptAt = now()`.
5. Run `/api/cron/outbox` with `CRON_SECRET` or wait for the next scheduled minute.
6. Confirm `OutboxEvent.status = DONE` and no duplicate customer-facing action occurred.

## Customer Messages

Use plain, factual language. Do not speculate.

### We're Having A Problem

Subject: We're checking your Speedy Van booking

Body:

We are investigating a technical problem that may affect booking updates. Your booking reference is `[REFERENCE]`.

We have paused online booking while we check the system. We will update you again by `[TIME]`.

If your move is today or tomorrow, reply to this email or call the number on your booking email.

### Your Booking Is Safe

Subject: Your Speedy Van booking is safe

Body:

We have checked your booking `[REFERENCE]`. Your move date, time window and payment record are safe.

No action is needed from you. If anything changes, we will contact you directly.

## Post-Incident Checklist

- Confirm booking, payment, email, push and driver job paths are working.
- Confirm `/api/v1/health` is 200 and outbox backlog is below 5 minutes.
- Confirm Sentry has no new unresolved booking/payment/webhook/outbox issues.
- Export relevant audit logs and provider logs.
- Write the incident timeline, root cause, customer impact and prevention actions.
- Close customer updates only after the owner approves the wording.
- Remove temporary access, test credentials and emergency env changes.
