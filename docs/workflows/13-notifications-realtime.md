# 13 — Notifications & real-time

## 1. The promise

**Every admin phone rings within 10 seconds of a new paid booking — app open, in the background, or closed — with a distinct sound, like a WhatsApp message.** If the app is open, a full-screen "New booking" card appears with the same sound. If a push is ever lost, polling, email and a repeat alert make sure the booking is still seen. Drivers get the same treatment for job offers.

Layers (all four always on):
1. **Push** (Expo Push → Apple APNs) — time-sensitive, custom sound, works when the app is closed.
2. **In-app pop-up** — foreground notification handler + feed polling every 20 s as a fallback.
3. **Email** — `admin-new-booking` to the alerts list.
4. **Repeat until seen** (optional setting) — re-sends the push every 5 minutes, up to 3 times, until any admin opens the booking.

## 2. Event matrix (outbox event → every channel)

The `event-matrix.test.ts` asserts each row: given the event, the expected email jobs, push messages, and `Notification` rows are created — no more, no less.

| Outbox event | Customer email | Admin push (category · sound) | Admin email | Admin in-app | Driver push |
|---|---|---|---|---|---|
| `booking.confirmed` | booking-confirmed | `NEW_BOOKING` · new-job.wav · time-sensitive | admin-new-booking | ✓ | — |
| `booking.checkout_abandoned` | — | — | — | ✓ (Leads) | — |
| `manual_quote.requested` | manual-quote-received | `QUOTE_REQUEST` · new-job.wav · time-sensitive | admin-manual-quote | ✓ | — |
| `manual_quote.priced` / `.declined` | manual-quote-ready / -declined | — | — | ✓ | — |
| `booking.offered` | — | — | — | ✓ | `JOB_OFFER` · job-offer.wav · time-sensitive (offered drivers) |
| `booking.assigned` (direct) | — | — | — | ✓ | `JOB_ASSIGNED` · job-offer.wav |
| `booking.driver_accepted` | driver-assigned | — | — | ✓ | — |
| `booking.driver_declined` / `booking.offer_expired` | — | `DISPATCH` · default | — | ✓ | — |
| `booking.rescheduled` | rescheduled | `CHANGE` · default (only if the move is within 48 h) | — | ✓ | `JOB_WITHDRAWN` to the previous driver |
| `booking.cancelled` | cancelled | `CHANGE` · default (only if within 48 h) | — | ✓ | `JOB_CANCELLED` to the assigned driver |
| `booking.updated` (addresses, access, items, notes) | — | — | — | ✓ | `JOB_CHANGED` to the assigned driver |
| `job.stage_changed` → EN_ROUTE_TO_PICKUP | on-the-way | — | — | ✓ (activity feed) | — |
| `job.issue_reported` | — | `JOB_ISSUE` · default · time-sensitive | — | ✓ | — |
| `extra_charge.requested` (driver) | — | `EXTRA_REQUEST` · default · time-sensitive | — | ✓ | — |
| `extra_charge.awaiting_payment` | extra-charge-request | — | — | ✓ | — |
| `booking.extra_paid` | payment-received | — | — | ✓ | `EXTRA_PAID` (driver can proceed) |
| `booking.completed` | move-completed | — | — | ✓ | — |
| `payment.refund.created` (not from cancellation) | refund-issued | — | — | ✓ | — |
| `payment.dispute.created` | — | `DISPUTE` · default · time-sensitive | admin-dispute | ✓ | — |
| `review.submitted` | — | — | — | ✓ | — |
| `contact.received` | contact-received | — | — | ✓ | — |
| cron `reminders` (17:00 London) | reminder-day-before | — | — | — | `TOMORROW` "Tomorrow: 2 jobs, first at 8am" |
| cron `daily-summary` (07:00 London) | — | — | admin-daily-summary | — | — |
| cron `document-expiry` (30/14/7/1 days) | — | `FLEET` · default (once per threshold) | — | ✓ | licence expiry to the driver |
| `system.alert` | — | `SYSTEM` · default (OWNER) | admin-system-alert | ✓ | — |
| `payout.recorded` | — | — | — | — | `PAYOUT` |

Push copy (examples; ≤ 110 characters, no personal data on the lock screen beyond first name and town):
- `NEW_BOOKING`: title "New booking — £158.90", body "Man and van, Sat 14 Nov morning. Paisley to Edinburgh." 
- `JOB_OFFER`: title "Job offer — Sat 14 Nov, morning", body "Paisley to Edinburgh, 52 miles. Tap to accept."
- `QUOTE_REQUEST`: title "Quote request", body "Brodick to Glasgow (ferry). Price it in the app."

## 3. Outbox handlers (`src/server/outbox/handlers/`)

- `notify.ts` expands a domain event into channel jobs using the matrix (single source: `src/server/notifications/matrix.ts`).
- `email.send`, `push.send`, `notification.create` are separate idempotent handlers (dedupe keys `<event id>:<channel>:<recipient>`).
- Recipients resolved at send time: admins = ACTIVE users with role OWNER/ADMIN; drivers = the offered/assigned driver(s). Users can mute non-urgent categories per device (Settings → Notifications); `NEW_BOOKING`, `QUOTE_REQUEST`, `JOB_OFFER`, `DISPUTE` cannot be muted (only device-level iOS settings).

## 4. Push sending (server)

`src/server/integrations/expo-push.ts` with `expo-server-sdk` (`accessToken: EXPO_ACCESS_TOKEN`; enable "enhanced push security" in the Expo project):

```ts
{
  to: device.expoPushToken,
  title, body,
  sound: 'new-job.wav',            // file name bundled in the app; 'default' for normal
  priority: 'high',
  interruptionLevel: 'time-sensitive', // iOS; verify the field name in the current Expo push docs
  categoryId: 'NEW_BOOKING',       // iOS notification category with actions
  badge: unreadCountForUser,
  data: { type: 'NEW_BOOKING', bookingId, url: 'speedyvan-admin://bookings/<id>', notificationId, invalidate: ['bookings','dashboard'] },
  ttl: 3600,
}
```

- Chunk with `chunkPushNotifications`, send, store each ticket in `PushTicket`. Ticket error `DeviceNotRegistered` → disable the device immediately.
- Cron `push-receipts` (every 15 min): fetch receipts for tickets older than 15 minutes; `DeviceNotRegistered` → disable device; other errors → Sentry; if a user has **no** working device and is OWNER/ADMIN → in-app + email warning "Notifications are off on your phone".
- Repeat-until-seen (`notifications.newBookingRepeatUntilSeen`): cron `repeat-alerts` every 5 min re-sends `NEW_BOOKING` for confirmed, unassigned bookings whose admin notifications are all unread, max 3 repeats.

## 5. Apps: push setup (both apps)

1. `expo-notifications` config plugin in `app.config.ts` with `sounds: ['./assets/sounds/new-job.wav', './assets/sounds/job-offer.wav']` (admin) / `['./assets/sounds/job-offer.wav']` (driver). Sounds: original, ≤ 5 s, 16-bit PCM WAV, normalised loudness, distinct from iOS defaults (Codex generates simple tones programmatically, e.g. a rising three-note chime; owner can replace later).
2. iOS entitlement for time-sensitive notifications (`com.apple.developer.usernotifications.time-sensitive`) in `ios.entitlements`; enable the capability for the App ID via EAS credentials.
3. Permission: after first sign-in, a full-screen explainer ("Turn on notifications so your phone rings for every new booking, even when the app is closed") → `requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } })`. If denied: persistent red banner on the dashboard + "Open Settings" button (`Linking.openSettings()`).
4. Token: `getExpoPushTokenAsync({ projectId })` → `PUT /me/push-device` on every launch and when the token changes (`addPushTokenListener`). On sign-out → `DELETE /me/push-device`.
5. Categories (`setNotificationCategoryAsync`): admin `NEW_BOOKING` actions "View" (opens app) and "Assign driver" (opens app on the assign sheet); driver `JOB_OFFER` actions "View" and "Accept" (opens app and runs accept with confirmation — never accept silently from the lock screen).
6. Tapping a notification (`addNotificationResponseReceivedListener` + cold-start `getLastNotificationResponseAsync`) navigates to `data.url` via Expo Router, after the app lock.

## 6. Admin in-app pop-up (`NewJobModal`)

- Foreground handler (`setNotificationHandler`): for `NEW_BOOKING` and `QUOTE_REQUEST` return `shouldShowBanner: false, shouldPlaySound: false` and show our own modal instead; other types show the normal banner.
- Modal: full-screen sheet that springs up from the bottom; ink background; gorse price in Bricolage; service, date + slot, route (from → to towns), customer first name; buttons **"Assign driver"** (primary) and **"View booking"**; "Dismiss". Plays `new-job.wav` once via `expo-audio` + success haptic. Per-device setting "Play alerts when my iPhone is on silent" (default off).
- Several arrivals stack: "3 new bookings" with paging; nothing is lost if the modal is dismissed (dashboard "New" section).
- Fallback: while foregrounded, `GET /admin/feed?since=<last seen>` every 20 s; unseen `NEW_BOOKING`/`QUOTE_REQUEST` items open the same modal (dedupe by `notificationId`).
- Opening the booking marks its notifications read (`POST /notifications/read`), which also stops repeat alerts.

## 7. Notification health (Admin → Settings → Notifications)

Shows: iOS permission status, time-sensitive allowed, this device's push token registered (server confirmed), last push received time, last test result. Button **"Send test notification"** → `POST /admin/test-push` → arrives with the new-job sound within seconds. The dashboard shows a red banner whenever this device can't receive pushes.

## 8. Driver notifications

`JOB_OFFER` / `JOB_ASSIGNED` use `job-offer.wav`, time-sensitive. Quiet hours (`notifications.driverQuietHours`, default 21:00–07:00): non-urgent pushes (`TOMORROW`, `PAYOUT`, `JOB_CHANGED` for jobs more than 48 h away) are delayed to the end of quiet hours; offers for jobs within 24 h always go through.

## 9. Keeping screens fresh (no websockets — DECISIONS D09)

| Screen | Refresh |
|---|---|
| Admin dashboard, bookings list | React Query `refetchInterval` 20 s while focused; refetch on app foreground; push `data.invalidate` keys invalidate immediately |
| Admin booking detail | 15 s while focused; after every mutation |
| Driver job list / job detail | 30 s while focused; on push; on foreground |
| Customer tracking page | 10 s visible / 60 s hidden |
| Customer confirmation page | 1.5 s for up to 30 s |

## 10. Cron schedule (`apps/web/vercel.json`, UTC; time-of-day jobs run hourly and check London time)

| Path | Schedule | Job |
|---|---|---|
| `/api/cron/outbox` | `* * * * *` | process due outbox events (safety net) |
| `/api/cron/expire-holds` | `*/5 * * * *` | 10-payments §5 |
| `/api/cron/repeat-alerts` | `*/5 * * * *` | §4 |
| `/api/cron/push-receipts` | `*/15 * * * *` | §4 |
| `/api/cron/hourly` | `0 * * * *` | if London hour = 17 → reminders; = 7 → daily summary; = 0 → revalidate `from-prices` and location pages; = 6 → document expiry |
| `/api/cron/data-retention` | `15 3 * * *` | 03 §9 |
| `/api/cron/integrity` | `30 3 * * *` | money fields vs rows, orphan holds, stuck PROCESSING outbox rows → system alert |

Every cron: requires `CRON_SECRET`, is idempotent (per-day keys such as `reminder:<bookingId>:<date>`), sends a Sentry cron check-in, finishes in < 60 s (batch and resume next run). Vercel Pro is required for sub-daily crons.
