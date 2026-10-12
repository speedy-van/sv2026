# 15 — Driver iOS app (`apps/driver`)

Built for a driver with a phone in one hand, a box in the other, and patchy signal in the Highlands. One big action per screen. Everything works offline and syncs later.

## 1. App identity and configuration

| Item | Value |
|---|---|
| Name on home screen | "SV Driver" |
| Bundle identifier | `uk.speedyvan.driver` |
| URL scheme | `speedyvan-driver` |
| Icon | gorse background, ink van glyph |
| EAS profiles / updates / distribution | same as admin (14 §1) |
| Permissions (Info.plist strings — honest and specific) | Notifications ("so your phone rings for new jobs"); Location when in use + always ("Your location is shared with the office and your customer only while you're on a job, so they can see when you'll arrive. It stops when the job is complete."); Camera ("to photograph items before and after a move") |
| Background modes | `location` |
| `LSApplicationQueriesSchemes` | `comgooglemaps`, `waze` |
| Config plugins | expo-notifications (sound `job-offer.wav`), expo-location (`isIosBackgroundLocationEnabled: true`), expo-camera, expo-sqlite, expo-secure-store, expo-local-authentication |
| Extra libraries (allowed by this doc) | `react-native-signature-canvas` (+ `react-native-webview`), `@react-native-community/netinfo` |

## 2. Navigation

```
gates: update-required → signed-in → app-lock → permissions explainer (notifications, then location, first run)
Tabs: Today · Jobs · Earnings · Me
Stacks: jobs/[id] (detail) → jobs/[id]/run (job stepper, full screen) · offers/[id] · jobs/[id]/report · jobs/[id]/extra · jobs/[id]/camera · jobs/[id]/signature
```

Persistent header strip on every screen when relevant: "Offline — 3 updates waiting" (amber) or "Location sharing is off" (rowan, opens Settings).

## 3. Screens

### Today
- **Next job card** (large): window ("8am–12pm"), towns "Paisley → Edinburgh", service, items "14 items, 6.3 m³", extras icons (helpers/packing/assembly), customer first name, primary button matching the stage ("Start trip to pickup", "Continue job").
- Offers banner: "2 job offers waiting" → Jobs › Offers.
- Rest of today's jobs (compact cards). Empty: "No jobs today. New jobs and offers will make your phone ring."

### Jobs
- Segments: **Offers** (countdown to expiry; Accept / Decline) · **Upcoming** · **Past**.
- **Offer detail:** date + window, route map (Apple Maps), miles + drive time, items/volume, access summary per address, extras, **your earning** for this job (customer price is never shown). Accept (confirmation sheet) → `409 OFFER_TAKEN` shows "Another driver took this job." Decline → reason (Not available, Too far, Vehicle too small, Other).

### Job detail
- Header: reference, date + window, status.
- Customer: name and **Call** (phone visible from acceptance until 24 h after the job).
- Pickup and dropoff cards: address + flat, floor/lift, carry distance, narrow access, permit zone, notes; **Navigate** → action sheet: Apple Maps / Google Maps / Waze (only installed ones), using coordinates.
- Items checklist (tick while loading — local only), extras, customer notes, photos taken, signature status, extra-charge requests and their status, your earning.
- "Report a problem" (always available).

### Job stepper (`jobs/[id]/run`) — the core
One screen per stage, one full-width primary button at the bottom, the address and a Navigate button at the top, "Report a problem" and "Call customer" secondary actions.

| Current stage | Primary button | On press |
|---|---|---|
| NOT_STARTED | "Start trip to pickup" | → EN_ROUTE_TO_PICKUP; start background location; customer gets "on the way" email |
| EN_ROUTE_TO_PICKUP | "I've arrived" | → AT_PICKUP (button highlights automatically within 150 m of the pickup) |
| AT_PICKUP | "Take before photos" → then "Start loading" | ≥ 1 BEFORE photo (skip requires a reason → issue note); → LOADING |
| LOADING | "Loaded — head to dropoff" (single-address jobs: "Loaded — finish job") | → EN_ROUTE_TO_DROPOFF (or straight to completion steps) |
| EN_ROUTE_TO_DROPOFF | "I've arrived" | → AT_DROPOFF |
| AT_DROPOFF | "Start unloading" | → UNLOADING |
| UNLOADING | "Take after photos" → "Get signature" → "Complete job" | ≥ 1 AFTER photo; signature + printed name ("I confirm my items were moved"); → COMPLETED; stop location |

- Every press: haptic, local state updates instantly, event queued with `clientEventId` (UUID), timestamp and GPS point.
- **Undo** chip for 2 minutes after a stage change (sends a correcting STAGE event the state machine allows only for the same driver within that window).
- Stage path by service: dropoff stages skipped when the service has no dropoff (rubbish). The path comes from `@sv/contracts/booking-state` (`stagePathFor(service)`), shared with the server and the customer timeline.
- **Report extra items** (from LOADING): description, optional suggested amount, photos → admin approval; status shown live (Requested → Awaiting customer payment → Paid). Copy: "Load extra items once the office confirms they're paid."
- **Report a problem**: Customer not there · Access problem · Damage · Vehicle problem · Running late · Other + text + optional photos → `ISSUE` event → admin push.

### Earnings — `GET /driver/earnings`
Period selector (this week / last week / this month / custom); completed jobs with earning; totals: earned, paid, unpaid; payouts history (date, amount, method, reference).

### Me
Profile (name, mobile, licence expiry — warning when < 30 days), **Availability** (calendar to mark days/slots unavailable → `PUT /driver/availability`), notifications status + test, devices/sessions, app version, sign out.

## 4. Offline-first sync

- Local database: `expo-sqlite` with tables `queue` (clientEventId PK, type, bookingId, payload JSON, createdAt, attempts, lastError), `photos` (clientId PK, bookingId, kind, fileUri, takenAt, uploaded), `locations` (id, lat, lng, accuracy, heading, speed, recordedAt), `jobs_cache` (bookingId PK, json, stage, updatedAt).
- **Order is preserved:** events for a booking sync in creation order; the stepper reads the local stage first.
- Sync triggers: after each enqueue, connectivity regained (NetInfo), app foreground, every 30 s while anything is queued.
- `POST /driver/sync` with up to 50 events → per-event result: `APPLIED`/`DUPLICATE` → delete; `REJECTED` → keep, show "1 update wasn't accepted" with the server's reason (e.g. "Job cancelled by the office" → refresh job and show a blocking notice); network/5xx → exponential backoff (5 s → 5 min).
- Photos: compressed immediately (`expo-image-manipulator`: longest side 1600 px, JPEG 0.7 — this also strips EXIF/GPS), saved to the document directory, uploaded with `clientId` (idempotent) when online, progress shown on thumbnails; deleted locally after upload + job completion.
- Signature: PNG saved locally, uploaded like a photo.
- Location: buffered in SQLite, sent in batches of ≤ 50; buffer capped at 500 points.
- A job can be completed fully offline; the customer's completion email goes out when the sync lands.

## 5. Background location

- Task defined at module top level with `TaskManager.defineTask('sv-job-location', …)` → write points to SQLite → trigger sync.
- Start on EN_ROUTE_TO_PICKUP: `Location.startLocationUpdatesAsync('sv-job-location', { accuracy: Balanced, timeInterval: 30000, distanceInterval: 100, activityType: AutomotiveNavigation, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true })`.
- Stop on COMPLETED, job cancelled/withdrawn, sign-out, or after 12 hours (safety).
- Permission flow: foreground first, then "Always" with the explainer screen. If refused, the app still works; the office sees "Location sharing off" for this driver and the customer sees no map.
- Server stores points only while the driver has a job in an active stage (05 §8).

## 6. Design notes

- 56 pt minimum targets, 18 pt minimum body text, primary action always bottom full-width (gorse, ink text).
- High contrast in sunlight; dark mode follows the system.
- Status always visible at the top of the stepper (stage name + time since started).
- Confirmations only for irreversible or costly actions (Complete job, Decline offer).

## 7. Tests and acceptance

- Unit (jest-expo): queue ordering and dedupe, sync result handling (APPLIED/DUPLICATE/REJECTED), stage path per service, undo window, photo compression call, location task writes to SQLite, earnings formatting.
- API tests (web): a driver can never read or act on another driver's job (404); sync is idempotent; rejected transitions are explained.
- Maestro (recommended): accept offer → run job with mocked location → complete with signature.
- Owner acceptance (Phase 14): run a full test job with flight mode on from loading to completion; turn flight mode off; within 30 s admin and customer views show the completed job with photos and signature.
