# PROGRESS — every card, screen and system

Codex ticks items as they're **done and verified** (per AGENTS.md §8), and adds its plan under each phase heading before starting. The owner reads this to see exactly where the build is.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done and verified

## Admin iOS external notifications and owner-provided sound — 2026-10-28

Owner authorizes repairing booking/chat/background notifications and using the audio from the supplied WhatsApp MP4. Diagnosis confirmed missing production `EXPO_ACCESS_TOKEN`, registered iOS devices, no chat Push producer, and daily-only outbox scheduling.

- [x] Configure a dedicated Expo push credential securely in the existing production project; production Secret presence, Expo token identity/project access, APNs signing metadata and enabled push access-token security verified. No credential values entered source or logs.
- [~] Add idempotent customer-chat Push with immediate event-scoped dispatch, privacy-safe payloads, unread/stale guards and account-aware routing.
- [~] Make test Push and provider failures report truthful outcomes; preserve successfully sent devices on retry.
- [~] Extract and validate the supplied sound, bundle it for native admin alerts and keep foreground playback consistent — full 29.929-second mono 44.1kHz/16-bit PCM, unchanged source video; both admin sounds SHA-256 `09c0374f169a701059ede07b2054de9628cc7cfbcfb60666fd86d40f77e67998`. Physical playback remains pending.
- [~] Verify isolated automated checks, builds and deployed notification boundaries without replaying historical work — admin 452 tests/38 suites, targeted backend suites, relevant lint/types, fresh iOS export and 317-page web build pass. Production deployment `dpl_6MeWA7ys26RjCDbLuW7GqZsLL7Qp` is READY at the canonical site. Production public/session/auth/validation smoke passes; health honestly reports historical backlog. No real test push or customer message was sent.
- [~] Deliver the updated native build through the existing private TestFlight route; EAS free iOS quota blocked build creation. Owner explicitly selected Codemagic; app `6ae273fee3ef3701f3d3f64b` created, existing Apple signing verified and isolated release source prepared. Build 55 remains pending.
- [x] Publish and verify compatible runtime 1.0.0 OTA for installed build 54 — production group `87a762d9-d3dd-44f7-852f-d148ff4fe5bc`, iOS update `01a1848e-dc51-7d8c-8991-1effdd9759bf`; independent CDN/protocol audit passes 20 checks with exact bundle/audio bytes. OTA does not replace the native lock-screen/background sound; that requires build 55. Physical update activation is unverified.

Delivery limits: initial events receive immediate scoped attempts, but transient retries and receipts still depend on traffic and the existing daily cron. No timely periodic retry SLA is claimed. Real phone foreground/background/closed-app acceptance remains separate from code and provider checks.

_Codemagic source-transport checkpoint:_ The isolated `release/admin-ios-55-notifications-20261028` snapshot packages the audited source for the owner's requested native build; it does not merge into main or declare repository-wide completion. Full `npm run verify` is blocked because no isolated `DATABASE_URL_TEST` is available. The attempted empty test-project creation in the existing free Neon organization was rejected because that organization is managed by Vercel; no project or database was created. No shared database test run, skipped-test flag, guard removal, paid compute or further provisioning was used. Available evidence is 452 admin tests/38 suites and admin lint/typecheck, 55 targeted backend tests/seven suites and full web lint/typecheck, plus the recorded clean exports/build. Source and staged Git content are audited separately; native IPA and physical iPhone acceptance remain pending.


## Vercel environment collection without database values — 2026-10-15

The owner stopped the reset/deployment workflow and will create the new Vercel setup personally. Current scope is local collection only; the previous deletion/deployment questions are superseded.

- [x] Stop all project deletion, creation and deployment actions — no Vercel project/deployment was deleted or deployed. Existing CLI authentication and the local `speedy-van-web` link had already been verified before the scope changed.
- [x] Collect available environment values without database connections — `Downloads/Speedyvan-Vercel-env-no-db-2026-10-15` contains separate per-project/per-target files: primary project production 50 and preview 49, plus sv production 1. Both DATABASE_URL rows were excluded. Programmatic checks also exclude database URI values and aliases equal to known database connection details, without printing values.
- [x] Verify the files and protect the collection — all 100 assignments round-trip through the installed dotenv parser with exact equality; exported files and filtered DPAPI backups are outside Git in a folder restricted to the current Windows user and SYSTEM. Each filtered encrypted backup passed decryption/equality verification. The collection contains no database values.
- [x] Record unavailable values instead of inserting placeholders — 5 opaque non-database Secret rows (QUOTE_SIGNING_SECRET and MAPBOX_TOKEN in preview/production; STRIPE_SECRET_KEY in production) appear by name/target only in missing-secrets.json and the metadata manifest. No source, project, target or secret was merged or substituted.

## Vercel project reset with environment preservation — 2026-10-15 (stopped by owner)

_Superseded by the collection-only request above. No deletion or deployment is authorized by this plan now._

_Plan:_
- [ ] Verify the signed-in team, current projects and existing terminal authentication; retain all local work.
- [ ] Inventory per-project/shared/custom environment metadata, domains and integration associations; back up exportable values directly to encrypted storage outside the repository without exposing them.
- [ ] Prove the requested environment preservation before any project deletion; resolve opaque Secret values or preserve their project.
- [ ] Prepare and link the replacement monorepo project, restore and verify its intended environment and review the exact deletion list.
- [ ] Obtain required action-time confirmation for irreversible project deletion only after concrete preservation/readiness checks; never delete provider databases or stores.
- [ ] Deploy the authorized site, verify its URL/API and report any plan, configuration or production-launch blockers honestly.

## Owner-provided new-booking notification sound — 2026-10-15

_Plan:_
- [x] Inspect the supplied MP3 and convert it to a bundled iOS-compatible alert without changing the original — Windows' built-in media transcoder produced `assets/sounds/new-job.wav`, 25.353 seconds, mono 44.1kHz/16-bit uncompressed PCM, 2,236,210 bytes. `notification-config.test.ts` verifies RIFF/PCM/non-silence/duration and config agreement. The owner's chosen full sound replaces the short generated chime; the original download was not modified.
- [~] Play that alert for a new confirmed booking in the unlocked foreground app, preserving deduplication, silent-mode choices and account privacy — implemented with decoded-asset readiness, retryable playback errors, cleanup on dismiss/lock and stable delivery-key dedupe. Sound/runtime/session tests pass; actual iPhone playback is not claimed from Jest or browser preview.
- [~] Verify background push sound payloads and add prompt bounded dispatch after confirmation, with the durable outbox cron retained — implemented and covered by 34 isolated backend tests. Verified Stripe callbacks schedule notification-only processing after the response; single-row claims and actual 10-second transport cancellation avoid an unbounded claimed batch. No real push was sent; Q7 records the APNs/device/server-token prerequisites.
- [~] Provide a real authenticated notification feed/read acknowledgement and handle notification taps after authentication and app unlock — implemented with 7 new shared-contract tests, backend user/role/isolation tests and native runtime tests. The actual local authenticated Today/Schedule preview works with foreground feed polling and real empty booking state. No fake notification or booking was inserted; positive live delivery/read acknowledgement remains pending a real eligible booking and phone test.
- [x] Create and link the dedicated admin EAS project only after explicit owner authorization — owner selected creation, then installed EAS CLI created `@ahmadawadalwakai/speedyvan-admin`, ID `0dd0709d-309d-455c-8ad8-eeeb4550adca`; `eas project:info` confirmed the link. One validated ID now drives both update URL and push config. No Apple credential or build was created.
- [~] Validate permission/token registration, asset/config agreement, failure states and native export; report missing EAS/APNs/device prerequisites without claiming live push acceptance — 309 admin tests, 34 isolated backend tests and 7 new contract tests pass, with full admin lint/typecheck, scoped web/contracts lint/typecheck, the 319-page production web build and a fresh iOS Hermes export (4,985 modules, including the actual 2.2MB WAV). Read-only EAS metadata shows no iOS signing/APNs credentials or build, and secret-presence booleans show no server EXPO_ACCESS_TOKEN. A reachable phone API and physical-device acceptance remain Q7. No booking/payment mutation, real push/email, dependency installation, commit or deployment.

## Persistent admin sessions — 2026-10-15

_Plan:_
- [~] Restore saved native sessions with a stable secure device identity, a retryable startup gate and the existing device lock — implemented; 47 AuthProvider tests include cold restoration, storage recovery, lock and stale-operation boundaries. A fresh iOS Hermes export succeeds; physical iPhone cold-start/Face ID acceptance is still required.
- [x] Persist browser authentication in a protected server cookie while keeping access tokens in memory; support explicit logout, cross-tab suppression and matching-host credentialed development CORS — actual password login, reload, fresh-tab restore, manual logout in both tabs, signed-out reload and a new successful login/reload were verified against the local API/database. `browser-session.test.ts`, provider and isolated server/CORS tests cover the guards. No token is written to JS storage.
- [~] Preserve credentials through network/timeout/server failures and make native refresh retries idempotent without weakening token-reuse, account or revocation checks — implemented; 22 shared SDK tests, 47 provider tests, browser helper tests and isolated native/browser server tests cover lost responses, structured versus malformed denials, retry receipts, storage failures and logout/new-login races. Native lost-response acceptance against a real iPhone/network is not inferred from these mocks.
- [x] Make newly issued admin sessions persist until revocation; keep short-lived access JWTs, legacy expiry boundaries and driver session policy — migration `20261015200000_persistent_admin_sessions` applied without changing existing expiry values. Actual browser session issuance/restoration works with the database; isolated server tests verify expired legacy sessions remain rejected, revocation/role checks remain enforced and driver 30/90-day boundaries remain unchanged.
- [~] Verify reload/reopen, manual logout, offline restoration, refresh races and storage failures with isolated tests and actual local browser reads; preserve business data — all 279 admin, 22 SDK and 6 driver tests pass, with isolated server auth/CORS suites, scoped lint/typechecks, the 319-page production web build and final iOS JS export. `.tmp/admin-persistent-session.png` shows the authenticated account controls after reload. Live browser acceptance is complete; physical native and live offline/lost-response acceptance remain separate. Only authentication/session state and the additive schema were changed in live verification; no booking/payment mutation, message, dependency installation, commit or deployment.

## Admin live website visitor header — 2026-10-15

_Plan:_
- [~] Add a real, anonymous first-party activity source with analytics consent, a 90-second active window, browser deduplication and strict public/admin contracts — implemented; 46 isolated website tests cover consent/expiry/withdrawal/visibility/backoff/cross-tab locking. Real public API to database to admin-header count was verified; a positive consent choice was not made in the user's browser, so that browser opt-in flow is not claimed as live acceptance.
- [x] Store only opaque presence identity and server last-seen time; rate-limit writes, protect same-origin requests and apply an additive schema migration — migration `20261015190000_website_visitor_presence` applied. An own anonymous synthetic session was issued through the actual POST, counted and removed by actual DELETE200; no booking/payment row was changed. `visitor-presence-route.test.ts` and related isolated server tests verify role/origin/input guards; the real smoke exposed and fixed Next's internal URL versus public Host distinction.
- [x] Add a persistent authenticated admin header with account-scoped foreground polling and honest loading/offline/error/stale states — real Today and Schedule reads verified at 320/390/1024px, selected date 2026-10-16 retained, viewport restored. `visitor-presence-hook.test.tsx` and `website-visitors-header.test.tsx` cover account isolation and data states; `screen-state.test.tsx` checks top safe-area inset consumption once.
- [x] Animate count changes with counting and a vertical drop, respecting reduced motion, rapid updates and screen-reader clarity — 31 isolated hook/component tests cover animation branches, initial/rapid/downward updates and reduced-motion failure. Actual admin count changed0→1→0 with live API/database activity. Browser modal focus containment, Done/Escape dismissal and focus return were inspected; physical-device motion/VoiceOver acceptance remains separate.
- [x] Verify consent/withdrawal/expiry, authentication, count changes and responsive header behavior; record the limits of live and native acceptance — all 236 admin tests, 65 isolated backend tests, 46 isolated website tests and 34 contracts tests pass, with relevant lint/typechecks, a fresh iOS Hermes export and the final 319-page web build. `.tmp/admin-live-visitors.png` shows the real synthetic-session count 1; the test session was removed and the current count returned 0. The build passed on retry after a transient sitemap prerender connection failure; no fallback or guard was weakened.

_Metric:_ The owner selected active website visitors now. Count consenting browser sessions that have reported activity within the last 90 seconds; multiple tabs share the first-party session cookie. This is an activity estimate, not a count of identified people, lifetime visits or all users who reject analytics.

_Privacy/limits:_ No names, IPs, page paths, query strings, referrers or visitor histories are stored in the presence table. HttpOnly same-site session identity is issued only after valid analytics consent. Web Locks serialize first requests where available; without that API, simultaneous first tabs can briefly overcount until the extra identifier expires. A lost first response can leave an unidentifiable row within the bounded 90-second activity window. Stale rows are physically pruned on a subsequent consented heartbeat or the existing hourly cron; no strict immediate-erasure or native-device acceptance guarantee is inferred from isolated tests. User browser consent preferences were left unchanged; the temporary website tab was closed.

## Admin booking creation timestamp — 2026-10-15

_Plan:_
- [x] Expose the persisted booking creation instant through strict shared admin summary/detail contracts and actual database reads — `admin-operations-read.test.ts` verifies exact stored ISO mapping across list/detail/dashboard/schedule/driver summaries; real authenticated list/detail display the retained booking timestamp. No migration or timestamp backfill.
- [x] Show a clearly labelled creation date/time in booking details and shared job cards using Europe/London, year and GMT/BST — actual booking SV-ZJW23E shows creation on 15 October 2026 at 11:44 BST, separately from its 19 October move date and Awaiting payment status. `booking-detail.test.tsx` and `operations-screens.test.tsx` cover that distinction and accessible card text.
- [x] Update every affected consumer fixture and verify winter/summer, midnight rollover and daylight-saving transitions — `admin-date-time.test.ts` covers 12 timestamp cases, including both autumn repeated hours, spring transition and input offsets; all required admin fixtures were updated without fallback timestamps.
- [x] Check the actual authenticated booking list/detail at mobile widths without altering any business records — 390px and 320px inspected, `.tmp/admin-booking-created-at.png` saved; viewport reset and booking details left visible. No booking/payment/notification mutation.
- [x] Record focused test, typecheck/lint and build evidence, preserving unrelated work — all 204 admin tests, 105 targeted isolated web tests, 18 contract tests, relevant lint/typechecks and the 319-page web build pass. Native-device rendering remains separate from browser and Jest verification.

## Admin manual slot closure toggle — 2026-10-15

_Plan:_
- [x] Add an accessible per-slot switch and clear manual-closure status, with date/window confirmation and a reason — real authenticated Schedule GET and switch/confirmation reviewed at 320/390/1024px; keyboard Space, safe initial focus, focus containment, Escape and Keep open cancellation verified. `slot-closure-control.test.tsx` covers 23 isolated offline/busy/error/auth/server-state cases; actual native-device acceptance remains separate.
- [~] Add separate reversible date/slot closure storage and authenticated ADMIN/OWNER mutation with shared slot locks, conflict protection and transactional audit; preserve numeric capacity rules/overrides — implemented and isolated route/service tests pass. Additive migration `20261015170000_manual_capacity_closures` is applied; table columns and zero manual closures verified by a read-only schema check. No live PUT was executed, so mutation acceptance remains unticked.
- [~] Enforce closure in both quote availability and final booking checks; reject closure while overlapping live checkout/reschedule reservations or unresolved payments must be honoured — `manual-slot-closures.test.ts` and `manual-closure-availability.test.ts` verify actual helpers with isolated persistence fakes, including multislots, positive override restoration, baseline zero, stale selections and cache invalidation. No real customer reservation/payment was used for acceptance.
- [~] Extend schedule contracts/read models with configured/effective capacity, closure identity/reason and authoritative close eligibility; refresh affected queries on acknowledgement/conflict — real read DTO verified. `slot-closure-hook.test.tsx` covers 23 isolated request/ACK/cache/conflict/actor-isolation cases; live mutation/refetch acceptance was deliberately not triggered.
- [x] Verify isolated server/UI regressions and inspect the real switch/confirmation without closing any live slot or creating a booking/payment — all **187 admin tests**, **181 targeted isolated server tests**, **12 contracts tests**, relevant lint/typechecks, the 319-page web build and fresh iOS Hermes export pass. `.tmp/admin-slot-switch.png` and `.tmp/admin-slot-closure-confirmation.png` show actual mobile UI. Browser remains on Schedule with dialog closed and viewport override reset.

_Boundary:_ This marks a slot unavailable to new reservations; it does not fabricate a customer booking or payment, alter existing bookings, increase configured capacity, or change staff roles. The owner's explicit request makes this narrow manual-close/reopen control available to ADMIN and OWNER; general numerical capacity overrides retain their existing policy. Live close/reopen acceptance will not be claimed from mocked tests.

## Admin job cleanup — 2026-10-15

_Plan:_
- [x] Add a red, labelled trash icon to loaded booking details, with an accessible confirmation, offline/submission guards and native device authentication — real record/confirmation checked at 320/390px; default focus, keyboard trap, Escape and Keep job verified without mutation. `booking-cleanup-actions.test.tsx` covers native authentication/offline/unknown results (15 isolated tests); physical-device acceptance remains separate.
- [~] Implement validated ADMIN/OWNER soft-delete and restore operations with optimistic version checks and transactional audit; retain accounting records and block confirmed/in-progress or processing-payment jobs — implementation and isolated server/RBAC tests pass; additive migration `20261015160000_booking_list_cleanup` is applied and the real read DTO is verified. No live DELETE/restore was executed, so mutation acceptance is not ticked as end-to-end verified.
- [~] Close unpaid checkout intents safely before removing a pending job, preserving payment race protection and leaving paid/completed records intact — strict retrieve/cancel proof and conditional transaction rechecks are implemented and mocked SDK tests pass. Pending cleanup transitions to CANCELLED using the shared ADMIN transition; no live Stripe cancellation was performed.
- [~] Add a Deleted jobs filter and restore action; refresh all affected admin lists after successful server acknowledgement — real Deleted jobs GET and retained original booking verified; 15 cleanup-hook tests and list/component tests pass. Restore only returns the retained record, not an old checkout; live restore acceptance remains unexecuted.
- [x] Verify contract/server/UI regressions and inspect the real confirmation in the browser without deleting the displayed booking or sending notifications — all **140 admin tests**, **149 targeted isolated server tests**, **10 contracts tests**, lint/typechecks, the 319-page web build and a fresh iOS Hermes export pass. `.tmp/admin-job-delete-confirmation.png` records the actual confirmation. Browser is left on the unchanged booking with the dialog closed and viewport override reset.

_Safety/evidence:_ `deletedAt` is nullable; booking/payment/refund/earnings/history rows are retained. Cancellation fails closed for missing configuration, missing intent identity, Checkout Sessions, captured/processing/received funds or uncertain responses. New funds reconcile/unhide the record; terminal paid replays and stale processing/failure after confirmed cancellation cannot reopen deleted history. Initial payment receipt/reconciliation is atomic, and extra-charge/reschedule retries resume unfinished business effects. Removal cannot hide unfinished paid changes. Financial daily totals retain removed completed records, with explicit UI copy. Seven isolated server files cover these paths; actual business mutations remain an operator acceptance step, not a claimed live test.

_Boundary:_ Implement the cleanup feature, additive schema only, no hard deletion or automatic live-booking cleanup. No actual delete/restore, Stripe cancellation, email, push, payment, commit or deployment will be triggered during browser verification. Financial history is retained; restoring an expired checkout restores its record, not its old capacity/payment hold.

## Admin iOS design and usability upgrade — 2026-10-15

_Plan:_
- [x] Audit the signed-in interface and establish a consistent iOS-inspired light/dark design with accessible type, grouped surfaces and clear primary actions — real browser review; shared tokens, 34-point headings, 48-point controls, focus rings and session-only System/Light/Dark choices (`appearance.test.tsx`).
- [x] Replace the crowded navigation with five explicit destinations, safe-area-aware phone tabs and a wider-screen layout; keep detail routes out of the tab bar — five phone tabs and a sidebar from 1024px; actual browser navigation and selected-state semantics checked.
- [x] Redesign Today, bookings, schedule, drivers, account/menu, sign-in and read-only details around the tasks a person needs to perform — real booking and driver records opened from their lists; `operations-screens`, `booking-detail`, `driver-detail` and `auth-screens` tests cover navigation, failures and actual actions. Unimplemented mutations are unavailable.
- [x] Replace hard-coded operational figures and sample jobs on the redesigned screens with validated, authenticated read-only queries and truthful empty/error/loading states — six GET surfaces, shared strict contracts, real database reads, server capacity accounting and cursor pagination; `admin-operations-read.test.ts` (24 tests). Dashboard separates scheduled moves from unpaid holds; recorded payment statuses remain explicit.
- [x] Preserve password/OTP authentication, role enforcement, native device locks, pricing and all existing unrelated changes; perform no business mutations or email sends — provider/auth regressions pass; session-bound notification queues cannot cover lock/sign-out, missing alert metadata is omitted, and native permission checks wait for unlock. Native security acceptance remains separate.
- [x] Verify real navigation/search/date controls, phone/tablet/desktop bounds, light/dark presentation, accessibility and existing admin/auth regressions; inspect final screenshots — live 320/390/430/1024/1366px browser checks, real empty search and focus restoration, keyboard End selection, detail navigation and selected-day schedule handoff. Screenshots `.tmp/admin-design-phone-dark.png` and `.tmp/admin-design-tablet-light.png` inspected; temporary viewport/appearance overrides restored.

_Verification:_ All **102 admin tests**, **24 admin-read server tests**, **50 development CORS tests**, **30 password server tests** and **10 contracts tests** pass. Admin lint/typecheck, contracts typecheck, scoped server/contracts lint and whitespace checks pass. The web production build generates 319 pages successfully. A fresh native iOS Hermes export completes (4,960 modules) into ignored `apps/admin/.tmp/admin-ios-design`; this validates bundling, not a signed device build. Existing website process remains running.

_Limits:_ No physical iPhone/iPad, VoiceOver/Dynamic Type acceptance, biometric or real push delivery test was performed on this Windows host. Native cold-start notification destination restoration remains unverified. No business records were created/changed, no dependency installed, and no email/OTP/push/payment was sent; routine already-authorized staff sign-in was used to inspect real read-only screens. Browser styling/interaction verification is not claimed as native device acceptance. Formatting used the existing explicit `packages/config/prettier/index.cjs` because the root shorthand config does not resolve its directory on this host.

_Boundary:_ Design and necessary read-only data wiring only. No new dependencies, business database mutations/migrations, secrets, notifications/emails, payments, booking edits, deployment or commits. No fabricated customers, job counts, money or availability. Existing unfinished business mutations remain unavailable rather than presented as working actions.

## Admin password sign-in and account setup — 2026-10-15

_Plan:_
- [x] Add optional password-hash storage through an additive database migration; keep existing staff OTP support — migration `20261015130000_staff_password_login` applied the nullable hash column and truthful `WEB` device platform; Prisma client regenerated.
- [x] Implement salted asynchronous password hashing and a validated, rate-limited staff login endpoint using the existing session/role controls — 30 isolated server tests cover real scrypt derivation, malformed/missing hashes, account/app/status rejection, transactional session issuance, throttles and unchanged OTP-only accounts.
- [x] Add the admin password form, native secure token storage and browser memory-only sessions; guard signed-out routes without bypassing native device locks — 20 provider tests plus a real browser sign-in/logout; protected Expo stacks retain the native device lock within the authenticated group.
- [x] Permit the exact local admin preview origin in development API CORS only; preserve production restrictions — 50 isolated tests and live preflight checks, including Next's internal bind-address/original Host distinction.
- [x] Apply the additive migration and provision the owner-authorized ADMIN account with a hash only, auditing the actual change — actual database hash verification passed; successful real sign-in activated the initially INVITED account, and SYSTEM audit records the provisioning without password/hash values.
- [x] Verify hash failures, invalid/disabled/wrong-role login, shared contracts and local browser sign-in without sending email or processing outbox events — 80 focused web tests, 24 admin tests and 10 contracts tests pass. Typechecks/lint pass for admin, web, contracts and db; the web build prerenders all 319 pages.

_Boundary:_ The owner explicitly requested password login after being told the existing app supported email codes only. Never record the supplied password in source, reports, logs or plaintext storage. No email configuration changes, dependency installs, bookings/payments, outbox execution, deployment or commits. Existing unrelated changes and both running dev servers must be preserved.

_Live evidence:_ At 430 px, real browser password login returned 200/ADMIN, reached `/today`, and stored no access/refresh tokens in localStorage/sessionStorage. Sign out returned 200, the revoked token returned 401 from `/me`, and an unsigned direct `/today` visit returned to sign-in; zero browser page errors. At 1440 px, a deliberately incorrect password returned 401, showed the generic inline error, retained sign-in and enabled retry. Verification-created sessions were revoked. The original website process on port 3000 was not restarted. Expo was restarted with IPv4-first loopback resolution after its old listener/cache delayed fresh browser loads; the preview remains available on port 8081. The existing Expo unsupported-web push-listener warning remains.

_Implementation boundary:_ Native biometric acceptance was not tested on an iPhone. Fresh app launches still require sign-in; browser tokens live only in memory, so page reload ends that browser's local session. The existing admin business screens/API shells were not rebuilt by this authentication task, and no claim is made that their business workflows are complete. Local random JWT signing/IP-hash secrets were generated in the ignored server environment, without printing them. A stale pre-migration Prisma singleton caused the first live endpoint failure; the development cache now tracks the generated constructor, and the succeeding live endpoint/browser checks confirm recovery without stopping the website. A later MCP-browser navigation timed out even though independent Chrome checks passed; the final panel request uses `http://127.0.0.1:8081/sign-in`, whose final HTTP check returns 200. The final rebuild also passes all 319 pages, and the 118-file source/documentation scan finds zero matches for the supplied plaintext password.

_Preview stability repair:_ After the final website build, both Expo `/status` and `/sign-in` stalled independently of app rendering. Metro watched the entire workspace and did not exclude Next build output. The admin Metro config now preserves its default block rules and excludes generated `.next`/`.tmp` directories. After restarting only Expo, the loaded config confirms the exclusion, a temporary generated-output write leaves `/status` at 200, and a fresh 430 px Chrome session renders both sign-in fields with empty submission disabled. The temporary probe was removed, final admin lint passes, and the original port-3000 process remains running. The watcher-load explanation is supported by this sequence; no broader load-test claim is made.

## Admin localhost preview — 2026-10-15

_Plan:_
- [x] Read the admin startup/configuration instructions and preserve the existing website server on port 3000.
- [x] Start Expo on localhost:8081 and diagnose the missing Windows Lightning CSS binding; restore only `lightningcss-win32-x64-msvc@1.33.0` after explicit owner approval.
- [x] Guard native notification/update APIs during browser preview without changing authentication or native iOS behavior — `Platform.OS` guards in the root shell and permission gate avoid unavailable web notification APIs; no authentication bypass or token-storage change.
- [x] Verify the sign-in screen renders in the browser and run the existing focused admin checks — `/sign-in` shows the email field and disabled Send code button, with zero browser errors; admin typecheck, lint and all four existing Jest tests pass. The Expo library still emits its existing unsupported-web push-listener warning.
- [x] Leave the preview running and report the browser/native verification boundary — Expo at `http://localhost:8081/sign-in`; original port-3000 website process preserved. The browser-panel open request was queued by Codex.

_Boundary:_ Browser preview only on this Windows host. Do not submit sign-in forms, send OTP/email/push, modify database records, bypass authentication or claim native iPhone acceptance. Package manifests/lockfile remain unchanged; the restored optional binding lives in ignored `node_modules`.

_Known limits:_ This verifies the sign-in interface, not working browser authentication or native iOS acceptance. Existing authentication uses native SecureStore/Face ID, and the separate API origin has no browser CORS integration. No sign-in request was submitted. The optional Windows binding was restored from its matching cached npm tarball after cancelling a workspace-wide resolver attempt; no dependency manifest or lockfile changed. No website/email configuration was changed by this startup task.

## Booking confirmation email configuration — 2026-10-15

_Plan:_
- [x] Confirm the server-only Resend configuration and ignored local environment path without exposing secret values — Git ignore/tracked-file guards and Next's environment loader checked the effective web configuration using booleans only.
- [x] Save the owner-supplied key in the web app's ignored local environment file, preserving existing values — `apps/web/.env.local`; internal equality check passed, and the file remains untracked/ignored.
- [x] Review the confirmed-booking outbox mapping and existing email rendering checks without sending messages or processing queued events — verified `booking.confirmed` → `booking-confirmed` → `email.send` → Resend; `npm run test -w @sv/emails` passed both render-only tests.
- [ ] Resolve the missing verified sender address (`EMAIL_FROM`) with the owner; do not invent a sender.
- [x] Record configuration checks and clearly distinguish local setup from verified provider delivery — Q6 records the missing sender; no provider delivery, key permissions or sender-domain verification is claimed.

_Boundary:_ No email sends, outbox/cron execution, bookings, payments, database writes, dependency installs, commits or deployment. Secret values remain outside tracked files and reports.

_Activation remaining:_ `EMAIL_FROM` is absent from the effective web environment. After it is supplied, restart the existing server to replace any cached Resend client. This task did not stop the running server. The production Vercel cron processes the outbox every minute; it does not run automatically on localhost. Do not drain the shared outbox as a setup check, because it can send accumulated pending messages and execute other queued effects. Historical email jobs marked DONE while the development no-key path was active are not automatically replayed. Rendering checks prove template generation only, not provider delivery.

## Payment return and retry repair — 2026-10-15

_Plan:_
- [x] Identify why canceled/unfinished payments show a receipt and expose authoritative checkout state without payment secrets — loading and every PENDING_PAYMENT response used the receipt copy; `booking-checkout-state.test.ts` verifies the optional checkout DTO, payment/hold selection and server-calculated retry eligibility.
- [x] Render neutral loading, separate unpaid/processing/received/confirmed states, and bound confirmation polling with a usable recheck action — `confirmation-state.test.ts` (51 cases), plus production browser delayed-read, forged-success, processing/receipt, failed-read retry and 30-second clock tests.
- [x] Restore the matching draft after redirects and retry the existing checkout key/PaymentIntent only while its hold permits it; refresh prices after server-confirmed expiry/cancellation — browser failed/canceled retry cases retain the same key/token/intent binding; matched fallback normalizes its token before clearing and survives reload. Corrupt/unavailable storage and unrelated returned intents are covered. Timestamp expiry alone never creates a fresh key.
- [x] Keep success analytics and draft clearing behind server confirmation, and guard idempotent checkout against expired or terminal payments — 27 mocked booking-service cases and 19 mocked hold-expiry cases; processing/succeeded initial payments are not silently expired by cron. Existing pricing and webhook confirmation logic remain unchanged.
- [x] Verify canceled/failed/processing/success/error/expiry/missing-link paths with mocked service units and browser tests, blocking real API writes and Stripe calls — final 97 focused web units, 10 contracts tests and 30 production-build browser cases pass; web/contracts lint, typechecks and all 319 prerenders pass. Streamed-HTML assertions distinguish the neutral outer skeleton from the nested confirmation fallback; no product guard was relaxed.

_Boundary:_ Preserve pricing, webhook confirmation authority and existing unrelated changes. No secret values, dependency installs, live payment/booking creation, database fixtures or deployment.

_Verification boundary:_ The checked items describe the implemented code and isolated regression evidence. Browser status reads are fulfilled locally and mutations/Stripe calls are blocked; no real payment-provider/database booking roundtrip is claimed. The full database-writing suite and commits/deployment were not run. Pending elapsed holds retain their existing key until the server actually closes the payment; the UI offers status rechecking/contact rather than risking a second charge. Existing timestamp-based capacity policy is unchanged.

## Phase 0 — Owner setup
- [ ] GitHub repo · [ ] Vercel Pro · [ ] Neon (London) · [ ] Stripe (test) · [ ] Mapbox token · [ ] Resend + DNS · [ ] Upstash · [ ] Sentry · [ ] Apple Developer · [ ] Expo org · [ ] FACTS.md complete · [ ] old upcoming bookings listed

## Phase 1 — Monorepo foundation
_Plan:_
- [x] Create the npm workspace root, Node/npm pins, Turborepo pipeline and root scripts from AGENTS.md §6.
- [x] Add `packages/config` with shared TypeScript, ESLint flat config and Prettier presets.
- [x] Add empty package shells for pricing, contracts, db, tokens, emails and api-client with lint/typecheck/test scripts.
- [x] Add strict TypeScript entrypoints and trivial Vitest tests so empty packages verify cleanly.
- [x] Add `.nvmrc`, `.editorconfig`, `.gitignore` and `.env.example` covering every variable from 01-architecture §6.
- [x] Add GitHub Actions CI for `npm ci` + `npm run verify`, plus Dependabot configuration.
- [x] Add `scripts/launch-check.ts` skeleton for later release gates.
- [x] Verify current stable versions, pin exact package versions and fill the Phase 1 version table in `docs/DECISIONS.md`.
- [x] Run `npm ci && npm run verify`, then check CI workflow syntax with `actionlint` if available.

_Verify (2026-10-12):_ `npm ci && npm run verify` passed. `actionlint` was not available locally, so workflow lint was skipped per the Phase 1 "if available" condition.

## Phase 2 — Pricing engine
_Plan:_
- [x] Port `types.ts`, `dates.ts`, `config.default.ts` and `engine.ts` from `docs/reference/pricing` with extensionless imports.
- [x] Export the pricing engine API from `packages/pricing/src/index.ts`.
- [x] Add `formatPriceBreakdownLines()` for UI-ready line items without changing arithmetic.
- [x] Port the 12 reference tests to Vitest with the same expected values.
- [x] Add golden-vector tests against all 8 vectors and all 672 slot prices from `vectors.json`.
- [x] Add fast-check property tests for non-negative prices, monotonic items/miles, slot ordering, calendar shape and `priceForSlot` parity.
- [x] Configure `npm run test:pricing` with 100% line and branch coverage for `packages/pricing`.
- [x] Run `npm run test:pricing` and `npm run verify` until green.

_Verify (2026-10-12):_ `npm run test:pricing` passed: 4 files, 26 tests, all 8 golden vectors and 672 slot prices checked, 100% statements/branches/functions/lines. `npm run verify` passed across lint, typecheck, test and build for all current packages.

## Phase 3 — Contracts & tokens
_Plan:_
- [x] Add `zod` as the shared contracts validation dependency and keep package scripts unchanged.
- [x] Build `@sv/contracts` core primitives: error codes/envelope, API success/pagination helpers, money helpers and Europe/London time/date helpers.
- [x] Build address utilities: UK postcode normalisation/validation, Scottish postcode-area detection/service-area helper and Glasgow/Edinburgh flat-notation parser.
- [x] Implement the booking state machine from `05-api.md` §12 with exhaustive transition helpers, stage paths and driver stage movement rules.
- [x] Implement settings schemas for every `Setting.key` listed in `03-database.md` §5, plus private/public settings parsing.
- [x] Implement all Phase 3 API contract schemas from `05-api.md`: core DTOs, public endpoints, booking creation, staff auth/self, admin, driver, webhooks/cron and stream events.
- [x] Build `@sv/tokens` exports for colour scales/semantic tokens, typography, spacing, breakpoints, radii, shadows and motion, with Chakra and React Native mappings.
- [x] Replace shell tests with contract unit tests for exhaustive transitions, postcode/service-area and flat parser cases from `06-booking-flow.md` §4.3, plus schema/token smoke tests.
- [x] Run `npm run verify` until green, update progress, record any deviations/questions, then commit.

_Verify (2026-10-12):_ `npm run verify` passed across lint, typecheck, test and build. Contract unit tests passed: exhaustive booking and dispatch transition tables; `stagePathFor()` dropoff paths; JobStage rules for driver one-step moves, move-date/day-after guard, same-driver accepted-job guard, undo window, admin/owner override with reason and completion evidence; postcode/service-area helpers; every flat-notation row and negatives from `06-booking-flow.md` §4.3; core schema checks and settings validation. Token tests passed for brand colour, semantic, typography, layout and motion exports.

## Phase 4 — Database
_Plan:_
- [x] Confirm Prisma 7/D21, add Prisma Client + Neon adapter dependencies, and configure Prisma 7 with `prisma.config.ts` using `DATABASE_URL_UNPOOLED` when present.
- [x] Copy the reference schema unchanged into `packages/db/prisma/schema.prisma`, create the initial migration, and append the required raw SQL extras.
- [x] Build the pooled Neon Prisma client singleton, advisory slot-lock helpers, capacity helpers, and outbox enqueue helper.
- [x] Implement the idempotent seed: facts/settings, pricing v1, item catalogue, presets, capacity rules, closed dates, FAQs, owner user, and location content.
- [x] Update CI to create and delete a Neon branch per run, then run migrate, seed, verify against that branch.
- [x] Add the Phase 4 DB integration tests for transactions and concurrent slot booking.
- [x] Run `npm run db:migrate && npm run db:seed && npm run db:seed`, then `npm run verify` until all pass.
- [x] Update progress, decisions/questions as needed, commit, and stop before Phase 5.

_Verify (2026-10-12):_ `npm run db:migrate` passed using the committed migration SQL through the local Neon HTTP migration runner and applied `20261012120000_init` (142 statements). `npm run db:seed` passed twice; the second run completed without errors and without duplicate inserts. Local seed warned that `operations.defaultCapacityPerSlot` fell back to `1` and `SEED_OWNER_EMAIL` / `SEED_OWNER_NAME` were absent, so the local OWNER row was skipped; CI supplies those two secrets. Final `npm ci` passed. Final `npm run verify` passed across lint, typecheck, test and build. `@sv/db` integration tests passed: interactive transaction plus 10 concurrent same-slot booking attempts, with 1 success and 9 `SLOT_UNAVAILABLE` failures.

## Phase 5 — Web foundation
_Plan:_
- [x] Scaffold `apps/web` as a Next.js 16 App Router workspace with strict TS, package scripts, nested AGENTS.md and source imports from shared packages.
- [x] Add Chakra v3 system from `@sv/tokens`, global CSS, `next/font/google`, and core UI primitives with documented states.
- [x] Build global layout: skip link, optional site banner, sticky header with desktop panels/mobile sheet, footer legal line, mobile sticky CTA, placeholder home.
- [x] Build cookie consent and preferences UI with Consent Mode v2 basic wiring and shared cookie inventory content.
- [x] Add security headers/CSP in `next.config.ts`, Sentry config/tunnel and Vercel Speed Insights.
- [x] Add motion primitives and the first Scotland route map component with reduced-motion behavior.
- [x] Add loading, error, not-found pages and `/styleguide` dev-only inventory for component states.
- [x] Add Phase 5 tests/E2E foundation checks and Lighthouse script, then run every Verify command.

_Verify (2026-10-12):_ `npm run verify` passed across lint, typecheck, test and build for all packages. `npm run e2e -- --grep '@foundation'` passed: 6 Playwright checks covering header/footer/home booking card, cookie consent and 404 recovery links across desktop and mobile Chromium. `npm run lighthouse -w @sv/web` passed with `/` performance score 98. Local Playwright browser download from the CDN timed out, so the final local E2E run used installed Windows Chrome via the Phase 5 Playwright config fallback. On PowerShell, the `@foundation` grep tag must be quoted; the runner still defaults a missing `--grep` value to `@foundation` for this phase's documented command.

## Phase 6 — Quote API
_Plan:_
- [x] Add Phase 6 server dependencies and record exact versions for Upstash rate limiting.
- [x] Add server env, request IDs, API error wrapper, JSON/NDJSON helpers, and no-store/cache headers.
- [x] Add rate limiting with Upstash Redis and an in-memory fallback when Upstash is unavailable.
- [x] Build Mapbox integration with live and mock adapters for suggest, retrieve, postcode lookup, directions with ferry detection, and static images.
- [x] Build route cache helpers and service-area checks from postcode/address rules.
- [x] Build catalogue endpoint from seeded items, presets, categories, and active pricing custom sizes.
- [x] Build availability overlay from capacity rules/overrides/holds/bookings, lead time, closed dates, same-day-only, and job-size rules.
- [x] Build quote orchestration: snapshot items, derive pricing input, call `@sv/pricing`, persist quotes/manual quotes, and map to `QuoteDto`.
- [x] Add `POST /api/v1/quotes` with NDJSON streaming plus JSON mode, `GET /api/v1/quotes/:publicId`, address endpoints, and static map proxy.
- [x] Add integration tests with Mapbox mock for ferry manual quote, outside Scotland rejection, full slot unavailable, and stream event order.
- [x] Run `npm run verify` until green and update docs/commit.

_Verify (2026-10-12):_ `npm run verify` passed across lint, typecheck, test and build. `@sv/web` quote integration tests passed with Mapbox mock: ferry route returns manual quote reason `FERRY_ROUTE`; London-only route is rejected with `OUTSIDE_SERVICE_AREA`; a capacity-1 confirmed booking makes the same morning slot unavailable with reason `FULL`; `POST /api/v1/quotes` streams events in order `accepted`, `route`, `availability`, `prices`, `done`. Next build listed all Phase 6 API routes as dynamic server routes.

## Phase 7 — Booking, payments, outbox, emails
_Plan:_
- [x] Add Phase 7 dependencies for Stripe, Resend and React Email with exact pins recorded in `docs/DECISIONS.md`.
- [x] Implement booking creation from quotes: idempotency, stored/expired quote pricing checks, availability rules, slot-capacity transaction, customer upsert, booking/payment rows, deferred PaymentIntent and status token.
- [x] Add booking status polling and signed status tokens for the confirmation page.
- [x] Add Stripe integration helpers, webhook verification/replay handling, booking confirmation, money recomputation, mismatch alerts and late-payment auto-refund handling.
- [x] Add hold-expiry cron for pending booking holds and expired slot holds.
- [x] Add refund allocation plus `payment.refund` outbox execution.
- [x] Add outbox processor with `SKIP LOCKED`, retries/backoff, cron route, and notification fan-out from the Phase 7 subset of the event matrix.
- [x] Add Resend integration, admin/customer recipient resolution and stubbed push sending until Phase 15.
- [x] Implement `.ics` generation and email templates for every customer/staff template listed in `11-emails.md`.
- [x] Add tests for double booking submit, webhook replay, late payment refund path, price mismatch, ICS boundaries, email rendering, and notification matrix.
- [x] Run `npm run verify` until green, update docs, commit, merge Phase 7 fast-forward to `main`, then continue with Phase 8.

_Verify (2026-10-13):_ `npm ci` passed from the committed lockfile; it reports the known Prisma audit warnings documented in D29. Final `npm run verify` passed across lint, typecheck, tests and build for all current packages. `@sv/web` Phase 7 integration tests passed: double-submit returns the same reference/client secret and one Payment row; stale expected price returns `PRICE_CHANGED`; Stripe webhook replay is a no-op; expired hold + late payment with the slot taken keeps the booking `EXPIRED` and creates a full pending refund plus `payment.refund` outbox job; `booking.confirmed` expands to two email jobs, one admin notification and one push stub. `.ics` generation passed BST/GMT UTC conversion checks. `@sv/emails` rendered all 24 customer/staff templates without unresolved placeholders.

## Phase 8 — Booking flow UI
_Plan:_
- [x] Hero booking card · [x] AddressField (search, postcode-only, manual, errors) · [x] Step 1 variants + access cards + "Anything tricky?" · [x] Step 2 search/categories/own item/extras/summary bar · [x] Step 3 reveal states · [x] hero price · [x] calendar + day/slot states · [x] breakdown · [x] Step 4 summary · [x] details · [x] agreements · [ ] real Stripe Payment Element path (R2: current E2E uses local mock fallback; not proven with Stripe test keys/webhooks) · [x] confirmation polling/success/pending · [x] manual quote form · [x] out-of-area card · [x] draft persistence + `/quote/:id` · [x] analytics + Ads conversion helper · [ ] real-card booking E2E coverage (R2: only mock-paid booking was proven).
- [x] Add Phase 8 client dependencies from the approved stack: React Hook Form, zod resolver, React Query, Zustand, Stripe browser packages, and axe Playwright.
- [x] Add booking content/constants for service labels, variants, access defaults, item category labels and customer-facing error copy.
- [x] Build the persisted booking draft store with versioning and step-prerequisite guards.
- [x] Build `/book` wizard frame with sticky header, progress steps, summary column and loading/error/submitting states.
- [x] Build accessible `AddressField`: search, retrieve, postcode-only completion, manual entry, retry, selected state and live-region announcements.
- [x] Build Your move, Items, Prices and Pay steps with the Phase 8 components.
- [x] Build quote reveal state, calendar selection, manual quote and outside-area branches.
- [x] Wire deferred Stripe Payment Element using `POST /api/v1/bookings`, idempotency key reuse, local E2E mock payment, and confirmation navigation.
- [x] Build `/book/confirmation` polling, success/pending states, `.ics` download and draft clearing.
- [x] Add analytics event helpers that are consent-gated and no-op without IDs.
- [x] Add Playwright `@booking` E2E coverage for the documented paths using mock adapters/test hooks where local Stripe secrets are absent, plus axe checks.
- [x] Run `npm run verify`, `npm run e2e -- --grep @booking`, and axe checks until green, update docs and commit before Phase 9.

_Verify (2026-10-13):_ `npm run e2e -- --grep '@booking'` passed: Playwright checks across desktop and mobile Chromium covering mock-paid booking, manual quote ferry route, outside-area blocking, quote resume/draft reload, and axe zero violations on exercised steps. `npm run verify` passed across lint, typecheck, tests and build for all current packages. Earlier failures fixed during Phase 8: confirmation page update loop after draft clearing, production static confirmation route needing `Suspense` around `useSearchParams`, mobile footer/checkbox axe target-size failures, parallel E2E slot collision, and confirmation status no-store polling.

## Phase 9 — Landing & marketing pages
_Plan:_
- [x] Centralise Phase 9 marketing content for services, FAQs, legal drafts and guides under `apps/web/src/content`.
- [x] Add server helpers for public settings, active pricing, honest "from" prices, FAQ rendering, reviews and JSON-LD.
- [x] Replace the landing page with all required sections S1-S10 while hiding missing business facts instead of showing placeholders.
- [x] Add `/services`, the 10 service detail pages, breadcrumbs, service JSON-LD and service-specific booking-card defaults.
- [x] Add `/pricing`, `/how-it-works`, `/about`, `/contact`, `/reviews`, `/help`, `/guides`, `/drive-with-us`, legal draft pages and accessibility page.
- [x] Add a validated contact form endpoint and client form states with rate limiting and no secret or PII logging.
- [x] Add responsive marketing CSS for tables, accordions, service rows, legal banners, contact form states and guide/review empty states.
- [x] Add `@marketing` Playwright checks for facts hiding, H1/meta structure, contact form, FAQ/search, service pages and keyboard-accessible content.
- [x] Update Lighthouse verification to cover `/` and `/services/house-removals` with the Phase 9 category thresholds.
- [x] Run `npm run verify`, Lighthouse and `npm run e2e -- --grep @marketing` until green, then update docs and commit before Phase 10.

_Verify (2026-10-13):_ `npm run verify` passed across lint, typecheck, tests and build. `npm run lighthouse -w @sv/web` passed on `/` and `/services/house-removals`: performance 96/96, accessibility 100/100, best practices 96/96, SEO 100/100. `npm run e2e -- --grep '@marketing'` passed 10 Playwright checks across desktop and mobile for the landing page, service page, FAQ search, contact form states, pricing/reviews/legal stable states, and missing-fact hiding.

## Phase 10 — SEO
_Plan:_
- [ ] Add Phase 10 location data pipeline scripts for geocoding, nearest-location graph, route distances and reports. R0: scripts exist, but generated data still contains fallback coordinates and must be rerun with real Mapbox in R1.
- [ ] Commit generated location and distance JSON used by the website, with manual-review notes. R0: current generated JSON is not real enough; `stub:check` reports fallback locations and D32 records the boundary.
- [x] Add shared SEO content/data helpers for locations, regions, routes, indexability, prices, metadata and JSON-LD.
- [x] Build `/areas`, 12 region hubs, 221 town pages, 8 city man-and-van pages and 26 route pages.
- [x] Add sitemap/robots generation, canonical metadata, breadcrumbs, structured data and internal linking.
- [x] Add `npm run seo:check` to crawl public SEO URLs and validate title, description, H1, canonical, JSON-LD and links.
- [x] Cover sample town, route, region and city pages through the sitemap-wide `seo:check` crawler instead of a redundant Playwright SEO suite.
- [x] Record the Mapbox/local-generation and Rich Results boundaries in `docs/DECISIONS.md`.
- [x] Run `npm run verify`, `npm run seo:check`, and record Rich Results sample status before committing.

_Verify (2026-10-13):_ `npm run seo:check` passed after building the app: 126 sitemap URLs checked for status, title, meta description, H1, canonical, JSON-LD and internal links; 268 internal links checked with no broken links. `npm run verify` passed across lint, typecheck, tests and build. Rich Results sample status: local JSON-LD parsing passed for every crawled sitemap URL including sample town (`/removals/glasgow`), route (`/removals/glasgow-to-edinburgh`), region (`/areas/glasgow-and-clyde`) and city (`/man-and-van/glasgow`); Google's Rich Results Test was not run against localhost because the local build is not publicly reachable, recorded in D32.

## Phase 11 — Customer self-service
_Plan:_
- [x] Add `jose` and implement customer signed-link helpers for manage, status, track, review, pay and file purposes with email-hash invalidation.
- [x] Build find-my-booking request-link flow with neutral response, IP/email rate limiting and outbox email delivery.
- [x] Add manage session cookie route and server-rendered `/manage`, receipt, notes, reschedule preview/apply and cancellation preview/apply services.
- [x] Reuse the pricing engine, live availability, advisory slot locks, Stripe PaymentIntent helper and refund allocation for self-service reschedule/cancel flows.
- [x] Build tracking token route/page with polling-safe DTOs, driver/location visibility rules and noindex/no-store behavior.
- [x] Build review token route/page with pending review creation, duplicate handling and optional Google review CTA.
- [x] Build `/pay/[token]` for manual quote, extra charge and phone booking payment requests with idempotent PaymentIntent reuse.
- [x] Update email/outbox links to use the new customer link purposes and implemented routes.
- [x] Add `@self-service` Playwright coverage for neutral find-my-booking, manage, reschedule, cancel, tracking, review and pay states using deterministic local fixtures.
- [x] Run `npm run verify` and `npm run e2e -- --grep @self-service`, then update docs and commit.

_Verify (2026-10-13):_ `npm run e2e -- --grep '@self-service'` passed: 14 Playwright checks across desktop and mobile for neutral find-my-booking, manage session, notes, contact-email link invalidation, cheaper/dearer reschedule, all cancellation policy bands, tracking location visibility, review single-use behavior, and expired/paid/active pay links. `npm run verify` passed across lint, typecheck, tests and build for all packages.

## Phase 12 — Staff auth & Admin API
_Plan:_
- [x] Extend server env validation for staff auth secrets and app minimum versions without printing values.
- [x] Implement staff OTP request/verify with hashed one-time codes, expiry, attempt limits, brute-force lockout and outbox email delivery.
- [x] Implement staff access JWTs, refresh-token rotation, reuse detection, device-bound sessions and session revocation.
- [x] Add RBAC and app-version enforcement to the shared API wrapper while keeping public endpoints explicit.
- [x] Implement `/api/v1/auth/*`, `/api/v1/me/*` and `/api/v1/notifications` routes from `05-api.md` §6.
- [ ] Add `/api/v1/admin/*` route coverage for every `05-api.md` §7 endpoint with OWNER/ADMIN role checks, OWNER-only gates and audit logging on mutations. R0: auth/audit surface exists, but admin endpoints return canned responses except test-push; R3-R5 replace them with real handlers.
- [x] Build `@sv/api-client` with typed requests, app-version headers, token storage hooks, single-flight refresh and retry-once behavior.
- [x] Add API tests for anonymous and DRIVER rejection across every admin route, refresh-token reuse revocation and OTP brute-force lockout.
- [x] Update decisions/questions as needed, run `npm run verify`, then commit Phase 12.

_Verify (2026-10-13):_ `npm run verify` passed across lint, typecheck, tests and build. Phase 12 API tests passed: every documented admin route rejects anonymous callers and DRIVER tokens; an admin mutation writes an `AuditLog` row; refresh-token reuse revokes the session and disables devices; OTP verification locks after 10 failures per email/hour. `@sv/api-client` test passed for single-flight refresh and retry-once behavior.

## Phase 13 — Admin iOS app
_Plan:_
- [x] Scaffold `apps/admin` as an Expo SDK 57 / Expo Router workspace with nested AGENTS.md, EAS profiles, app config, sounds/assets and strict TS scripts.
- [x] Build the app theme from `@sv/tokens` with light/dark palettes, Bricolage/Manrope font loading and reusable primitives (`ScreenState`, buttons, cards, badges, sheets).
- [x] Implement auth/update/app-lock/notification-permission gates, OTP sign-in/code screens, secure token storage and API client wiring.
- [x] Implement the tab shell: Today, Bookings, Schedule, Drivers and More, with iPhone and iPad-responsive layouts.
- [ ] Build every documented Admin screen/menu surface from `14-admin-app.md` with loading, empty, error, success and disabled/submitting states. R0: several screens are fixture-driven or describe future surfaces; R6-R8 replace them.
- [ ] Build booking detail actions and sheets: assign/offer, unassign, edit, re-price, reschedule, cancel, refund, extra charge, offline payment and resend email. R0: current app has placeholders/empty handlers and canned API underneath; R6 implements core sheets after R3.
- [ ] Build new phone booking wizard using the quote/catalogue endpoints and payment-mode branch. R0: current wizard is a UI shell using fixture/static step data; R6 wires the real endpoints.
- [x] Implement push registration, notification categories, deep-link routing, foreground `NewJobModal`, sounds/haptics and feed polling fallback.
- [x] Add React Query polling/invalidation rules, offline banner behavior and permission/role gating.
- [x] Add jest-expo tests for api-client integration, `ScreenState`, permission gates, deep-link routing and `NewJobModal` stacking/dedupe.
- [x] Run `npm run -w apps/admin typecheck`, `npm run -w apps/admin test`, `npx expo-doctor` in `apps/admin`, then root `npm run verify`, update docs and commit.

_Verify (2026-10-13):_ `npm run -w apps/admin typecheck` passed. `npm run -w apps/admin test` passed: 4 jest-expo suites covering `ScreenState`, notification permission gate, notification deep-link routing and `NewJobModal` stacking/dedupe. `npx expo-doctor` in `apps/admin` passed all 21 checks. Final `npm run verify` passed across lint, typecheck, tests and build for all packages. A local iPhone development build/closed-app push acceptance run was not possible in this Windows workspace without an interactive Expo/Apple Developer login and registered device; recorded in D35.

## Phase 14 — Driver API & Driver iOS app
_Plan:_
- [x] Implement `/api/v1/driver/*` catch-all routes for every `05-api.md` §8 endpoint with DRIVER auth, ownership checks, idempotent sync, stage validation and location-write guards.
- [x] Add driver API tests proving a driver cannot read or act on another driver's job, sync idempotency and rejected transitions.
- [x] Scaffold `apps/driver` as an Expo SDK 57 / Expo Router workspace with nested AGENTS.md, app config, icon/sound, EAS profiles and strict scripts.
- [x] Align driver dependencies with the Phase 13 Expo SDK stack and add allowed driver libraries: location, task manager, camera, image manipulator, SQLite, maps, signature canvas and WebView.
- [x] Build shared driver app primitives/theme from `@sv/tokens`, branded fonts, app gates, notification/location permission banners and app-lock behavior.
- [ ] Implement tabs and screens: Today, Jobs/offers/upcoming/history, job detail, run stepper, report problem, extra items, camera, signature, Earnings and Me/availability. R0: driver screens still import fixture data and signature upload is empty; R9 finishes the app.
- [ ] Implement offline SQLite queue/cache helpers, ordered sync handling, photo/signature local records, and location task registration with background buffering. R0: helpers exist, but full offline evidence upload/flight-mode end-to-end proof is missing; R9 covers it.
- [x] Add jest-expo tests for queue ordering/dedupe, sync result handling, stage path/undo rules, photo compression call, location task writes and earnings formatting.
- [x] Run driver app typecheck/tests, `npx expo-doctor` in `apps/driver`, driver API tests, root `npm run verify`, then update docs and commit.

_Verify (2026-10-13):_ `npm run -w apps/driver lint`, `npm run -w apps/driver typecheck`, `npm run -w apps/driver test` passed (6 jest-expo tests). `npx expo-doctor` in `apps/driver` passed all 21 checks after pinning `react-native-webview` and `react-native-maps` to Expo SDK 57-compatible versions. `npm run -w apps/web lint`, `npm run -w apps/web typecheck`, and `npm run -w apps/web test -- test/driver-api.test.ts` passed (3 API tests). Final `npm ci` passed from the updated lockfile and reported the known audit-warning boundary documented in D36. Final `npm run verify` passed across lint, typecheck, tests and build for all packages.

## Phase 15 — Notifications & real-time
_Plan:_
- [x] Add `expo-server-sdk` to `apps/web` with an exact pinned version and update the lockfile.
- [x] Expand `src/server/notifications/matrix.ts` to cover every `13-notifications-realtime.md` §2 domain-event row.
- [x] Implement Expo push sending with chunking, stored `PushTicket` rows, capture-mode support, immediate dead-token cleanup and receipt polling.
- [x] Wire `push.send` outbox handling, admin/driver recipient resolution, quiet-hours delaying and admin test-push.
- [x] Add repeat-until-seen alerts, push receipts, hourly, data-retention and integrity cron routes and register every cron in `apps/web/vercel.json`.
- [ ] Add Sentry cron monitor check-ins for every cron. R0: D37 records this is not emitted in code yet; R10 implements it.
- [x] Add app-side Expo push token registration for Admin and Driver.
- [x] Add end-to-end event-matrix tests proving email, push and in-app fan-out rows are exact for documented domain events.
- [x] Run `npm run verify`, fix failures, update docs, commit, merge Phase 15 to `main`, then continue to Phase 16.

_Verify (2026-10-13):_ `npm run verify` passed across lint, typecheck, tests and build. `@sv/web` tests now run file-sequentially against the shared Neon test branch; 6 files / 20 tests passed. Phase 15 event-matrix test passed and asserted every documented domain event row produces the expected email templates, push categories/apps, in-app notification rows and captured push tickets under `PUSH_MODE=capture`.

## Phase 16 — QA hardening
_Plan:_
- [x] Make `npm run e2e` run the full Phase 16 web suite by default, across foundation, booking, marketing, self-service and SEO page-type checks.
- [x] Ensure every E2E page-type visit runs axe WCAG 2.2 AA checks and add any missing route/page-type coverage.
- [x] Extend Lighthouse to the documented Phase 16 URL set and enforce category/resource budgets locally and in CI.
- [x] Add the quote endpoint load-test script from `16-testing-observability.md` §5, with a documented command and thresholds.
- [x] Add `GET /api/v1/health` with DB, outbox backlog/age, last webhook and version reporting, including 503 rules.
- [ ] Add hourly business alarms including quote error rate. R0: webhook silence, checkout conversion drop and push failure rate exist, but D38 records quote success/failure metrics and quote error-rate alarm are missing; R10 implements them.
- [x] Add Phase 16 security gate tests/check scripts for route auth declarations, cron secrets, CSP/headers, public mutation rate limits and bundle secret scanning.
- [x] Review upload, DTO, Stripe replay/signature and staff-auth tests against the `12-auth-security.md` §8 checklist and fill remaining gaps.
- [x] Add `docs/INCIDENTS.md` with incident contacts, pausing booking, revoking staff sessions, secret rotation, DB restore, outbox replay, customer messaging and post-incident checklist.
- [x] Update CI to run database-backed verify, full E2E, Lighthouse budgets, SEO check and security/load gate commands without printing secrets.
- [x] Run the full Phase 16 release gate commands until green, then update progress/decisions/questions and commit.
- [ ] Run the full release gate against staging with real backing services. R0: local gates passed, but staging was skipped and real Stripe/load evidence is deferred to S/R10.

_Verify (2026-10-13):_ `npm ci` passed after adding Phase 16 dependencies, with only the known audit-warning boundary recorded in D38. Final `npm run verify` passed across lint, typecheck, tests and build. `npm run e2e` passed 48 Playwright checks across desktop and mobile for booking, foundation, marketing, self-service and SEO, with axe checks on exercised page types. `npm run lighthouse` passed the Phase 16 URL set: `/` performance/accessibility/best-practices/SEO 96/100/96/100, JS transfer 157245 bytes and total transfer 249703 bytes; `/services/house-removals` 96/100/96/100 and 243547 bytes; `/removals/paisley` 97/100/96/100 and 243047 bytes; `/removals/glasgow-to-edinburgh` 97/100/96/100 and 242336 bytes. `npm run seo:check` passed for 126 sitemap URLs and 269 internal links. `npm run security:check` passed explicit API auth, cron secret, public mutation rate-limit, CSP/header, bundle secret-scan, GitHub SHA pin and reviewed audit-exception gates. `npm run load:quote` passed with 3585 requests in 120.25s, 30 req/s average and p95 30.608ms.

## Phase 17 — Launch
- [ ] Owner checklist (17 §4) · [ ] `verify:launch` green · [ ] cutover steps · [ ] live smoke test · [ ] Search Console sitemap · [ ] 14-day watch started

## Repair R1 — Website corrections
_Plan:_
- [x] Create `repair/R1-website-corrections` from `main` and read the required R1 docs before code changes.
- [x] Fix `stub:check` so real API-backed data modules are not flagged by folder name, and add tests for fixture and API-module cases. Verified with `npm run test -w @sv/config` and `npm run stub:check` dropping from 328 to 316 with driver data/import findings gone.
- [x] Accept `MAPBOX_SECRET_TOKEN` values that start with `pk.` or `sk.`, include the actual token value in client-bundle secret scans, and record the decision in D39.
- [x] Run real Mapbox geocoding for all 221 locations, with zero fallback coordinates and any low-confidence results recorded in `docs/QUESTIONS.md`. Verified with `npm exec -- tsx scripts/geocode-locations.ts`: 221 locations, 218 `place/locality`, 3 Mapbox named-feature matches, 0 manual overrides and 0 fallback coordinates.
- [x] Recompute the location graph and Mapbox Directions route distances with ferry detection. Verified with `npm exec -- tsx scripts/compute-location-graph.ts` and `npm exec -- tsx scripts/compute-route-distances.ts`.
- [x] Add data-plausibility tests for named Scottish road distances, Scotland bounds and council-area matches in the geocode report. The new test intentionally fails against the old fallback data until Q2 is resolved and data is regenerated.
- [x] Restore Bricolage Grotesque for display text and prices using the measured loading strategy in D40. Verified with `npm run lighthouse`: `/` 95, service/location/route pages 96.
- [x] Rebuild, run `npm run seo:check`, `npm run lighthouse`, `npm run verify`, and `npm run stub:check`; record results, commit, and fast-forward merge to `main`.

_Verify (2026-10-13):_ `npm run verify` passed across lint, typecheck, tests and build. `npm run seo:check` passed for 126 sitemap URLs and 269 internal links. `npm run lighthouse` passed with performance scores `/` 96, `/services/house-removals` 97, `/removals/paisley` 97 and `/removals/glasgow-to-edinburgh` 97; `/` JS transfer was 156780 bytes. `npm run stub:check` reports 106 issues, down from 316: admin-canned-route 87, descriptive-ui-text 4, empty-handler 6, empty-upload-payload 1, fixture-import 7, fixture-module 1.

## Mobile speed and local content quality — 2026-10-15

_Plan:_
- [x] Establish a current production mobile baseline and isolate paint/layout/hydration costs with reversible browser-only experiments — standard CLI baseline 87 / LCP 3.485 s; preserved trace, network simulation and separate diagnostic reports under `.codex/seo-speed2-*`.
- [x] Fix the measured rendering bottleneck while preserving booking controls, the owner's artwork, glass styling, finite route animation, accessibility and responsive geometry — all 22 production `hero-route-animation`, `hero-responsive`, `header` and `logo` Playwright cases pass, including no-JS geometry and delayed-image readiness. Candidate1 home scores 93 twice, LCP 3.220/3.214 s, CLS 0.
- [ ] Meet the unchanged four-page Lighthouse budgets and repeat representative mobile measurements; retain all reports rather than selecting the best result — final CLI audits completed, but home remains 93 (target 95) and LCP remains above the 2 s project target. Service/town/route score 96/95/96; all accessibility/best-practices/SEO scores are 100, CLS 0 and resource budgets pass. The budget failure stays open.
- [x] Research authoritative council resources and identify useful location-specific planning information from the committed road/nearby graph — `.codex/local-council-research-2026-10-15.json` maps all 32 councils to official resources; original research records 29 content reads, one scripted CMS and two navigation-only destinations. The published registry's broader Perth/Kinross hub also returned 403, so it has three limited-verification links (with Glasgow 403 and East Renfrewshire 402); no inaccessible procedure is paraphrased. All 657 raw route records remain; the unchanged city-only projection has 656 and seven two-city comparisons, including Stirling's excluded non-city Falkirk row.
- [x] Improve every city/town page with accurate, differentiated local planning content and relevant official resources; preserve transport-only scope and published-note guards — `local-move-planning.test.ts` (8 cases), six production browser cases and `.codex/seo-local-planning-crawl-2026-10-15.json`: 221 town/city plus eight city man-and-van briefs, 32 councils, 673 route rows, 24 ferry rows, zero issues.
- [x] Keep staged indexing tied to the existing publication policy; record missing owner experience/photos/case studies without inventing them — all 229 page robots directives match the prior GET crawl; 59 locations initially eligible and 162 staged, 126 sitemap URLs. Published notes remain independent; Q5 records the missing owner inputs.
- [x] Validate pricing/profile parity, client navigation, reduced motion, mobile/desktop layouts and no-JavaScript content with focused units and production browser checks — 51 units in eight files; 50 production Playwright cases (28 Chromium foundation/local + 22 desktop/mobile SEO); full web ESLint, build TypeScript and all 319 prerenders pass. The first build had a transient database ErrorEvent on sitemap prerender; unchanged real-data retry passed. No database fixture/write or external payment occurred.
- [x] Re-crawl the full SEO surface and record before/after speed and locality evidence, remaining owner inputs and any unresolved budget failures — `.codex/seo-speed-local-crawl-2026-10-15.json` checks 320 URLs and 302 internal destinations with zero issue arrays; `seo:check` passes 126 sitemap URLs/296 links and booking/404 probes. `.codex/seo-local-planning-crawl-2026-10-15.json` verifies all 229 briefs and unchanged robots directives. Fresh `.codex/seo-keyword-coverage-speed-local-2026-10-15.{html,csv,json}` verifies all 1,105 local targets and 1,120 query rows with zero review issues. Arabic report: `.codex/seo-speed-local-report-2026-10-15.html`; Q5 and the failed speed gate remain explicit.

_Scope:_ The owner asked to work on mobile speed first, then local content for all cities and towns. Local research may proceed while performance is measured, but content implementation follows the speed work. No secret values, dependency installs, database fixtures/writes, pricing arithmetic changes or deployment are needed. “10/10” is treated as a quality objective, not a claim of guaranteed Google rankings or unmeasured field results.

_Final measured outcome:_ Home performance 87 → 93, with final LCP 3.210 s and an explicit repeat of 3.140 s (same score); transfer 379,051 → 326,825 bytes, JS 167,067 bytes. Fonts remain present and return 200. The remaining critical dependency is the shared 119,531-byte React/Next framework pair followed by modeled CPU; the owner artwork, glass, finite animation and immediately usable form were preserved. These are local production-build lab measurements, not deployed p75 field Core Web Vitals or a Google ranking guarantee. The full database-writing verification suite was deliberately not run and no commit/deployment was made.

## SEO keyword coverage expansion — 2026-10-15

_Plan:_
- [x] Give man and van, furniture transport, sofa transport, house removals and flat removals clear service-level content and keyword ownership (`seo-keywords.test.ts`, five-family ownership).
- [x] Add substantive sofa/flat service hubs using existing booking services and real price profiles; retain the furniture-delivery canonical URL (`sofa-removals CTA preserves its existing pricing service and variant`; flat counterpart).
- [x] Add useful service-specific sections to the existing 221 town/city pages, preserving ferry quote handling and staged publication rules (`seo-keywords.test.ts`; Paisley/Stornoway browser checks; all 1,105 section IDs verified in rendered HTML).
- [x] Connect service coverage, nearby places and the eight city man-and-van pages with intent-specific links and descriptive anchors (`keyword service hubs link every existing location to its owned page or local anchor`).
- [x] Map the owner's near-me, nearby and place-name queries to current canonical destinations, with actual rendered metadata/indexability and no fabricated search volumes or rankings (`build-keyword-coverage.ts`, 1,120 validated rows and browser-tested report filters).
- [x] Verify content, anchors, booking defaults, canonical/social metadata and sitemap membership with focused units, production browser checks and a GET-only crawl (results below).

_Scope:_ The owner confirmed furniture/sofa removal means transport to another address only, not disposal or clearance. “Flag removal” is interpreted as “Flat removal” from the surrounding request. Existing uncommitted changes and unpublished local notes remain intact. The earlier mobile-performance budget failure remains open; keyword coverage is not proof of live rankings.

_Implemented:_ Five detailed service hubs (four additional planning sections each) now cover the requested families. `/services/sofa-removals` and `/services/flat-removals` reuse furniture/standard and house-removals/studio respectively, including the identical real example-price profiles. The base nine service/engine offerings remain intact. All 221 existing removal pages have five local sections; no service-by-town URL multiplication or near-me URL variants were introduced. Dedicated city man-and-van pages remain primary for the eight cities. Pickup/dropoff access, inventory, measurements to discuss with the team, and ferry-route review are described without inventing disposal, dismantling, local offices or real-time driver-location features.

_Verification:_ Full web lint, `npm run typecheck -w @sv/web`, the **319-page** production build and all **43** targeted units passed. All **22** production browser cases passed across Chromium/mobile: `seo-keywords.spec.ts`, `seo.spec.ts` and `seo-repairs.spec.ts`. `seo:check` passed **126** indexable sitemap URLs, **296** internal links and booking/404 probes. The expanded GET-only crawl inspected **320** URLs and **302** internal destinations: no broken links, orphan sitemap pages, noindex sitemap entries, duplicate indexable metadata, overlong metadata or missing OG/Twitter cards. All indexable pages remain within three clicks. The first typecheck/lint caught optional price-source access on a literal union; explicit `ServiceContent` callback typing fixed it without casts or weakened guards, and both full checks then passed.

_Rendered layout:_ `.codex/seo-keywords-layout-check.mjs` confirmed **1,105** unique expected section IDs across all town pages and eight overflow-free layout cases at **360/1440 px**, including expanded coverage navigation. The standalone layout check and all browser cases made zero API mutations. Screenshots for sofa/flat hubs were reviewed.

_Keyword evidence:_ `.codex/seo-keywords-crawl-2026-10-15.json` feeds `node --conditions=react-server --import tsx .codex/build-keyword-coverage.ts`. New HTML/CSV/JSON files are `.codex/seo-keyword-coverage-2026-10-15.*`, preserving the earlier audit/map. There are **1,120** primary query mappings: **1,105** local service/place targets plus **15** national generic/near-me/nearby queries, with singular/plural and “in” aliases. All local targets resolve: **1,097** section fragments and **8** dedicated city pages; zero query rows require review. The map observes **310** indexable query destinations and **810** staged query mappings across **162** noindex towns. It reports actual canonical/title/H1/directives, not Google indexing or rankings. Search volume, rankings and Google indexing fields remain unknown. Report search, aliases, filters, pagination and local preview links passed headless-browser checks with no JavaScript errors.

_Unchanged boundary:_ No dependencies installed, database content/availability mutated, draft content published, commits created or deployment made. No Lighthouse rerun is claimed for this content expansion; the earlier performance-budget failure remains open. D52 records the keyword/page ownership decision and limitations.

## SEO audit repairs — 2026-10-15

_Plan:_
- [x] Correct indexability, canonical metadata, sitemap membership and unknown-slug status codes without changing authentication (`seo-check.ts` GET-only booking/404 probes; `seo-metadata.test.ts`; `seo-preview-headers.test.ts`).
- [x] Add social metadata and connect structured data using verified settings only (`seo-metadata.test.ts`; sitemap-wide canonical/social/JSON-LD assertions).
- [x] Make all existing route pages reachable and improve city/region coverage navigation using the committed location data (`area-coverage.test.ts`; `seo-repairs.spec.ts` areas/council cases; expanded 318-URL link graph).
- [x] Correct service booking defaults, route price assumptions and ferry guidance; render only published local notes (`seo-content.test.ts`; `specialist service pages preserve the advertised service and variant in the booking wizard`).
- [x] Reduce hero image discovery delay and reserve loading-layout space while preserving the owner's artwork and mobile layout (`hero-route-animation.spec.ts`, all seven production browser cases).
- [x] Complete representative mobile lab measurement after the integrated build and passing production browser checks; record the remaining performance-budget failure without relaxing the gate.

_Verification:_ Full web lint, TypeScript, the final 317-page production build and diff checks passed. All **36** targeted unit tests passed across `area-coverage`, `seo-data`, `seo-content`, `seo-checker`, `seo-metadata` and `seo-preview-headers`. All **26** production browser checks passed: 12 SEO/repair cases across desktop/mobile, seven hero resource/alignment/motion/direct-HTML cases, four header cases and three logo cases. `marketing content renders directly in main without JavaScript` verifies home/service/town/route HTML without client scripts. Tests block API mutations; the full database-mutating repository suite was deliberately not run against the owner's development database.

_Production crawl:_ `SEO_BASE_URL=http://127.0.0.1:3101 npm run seo:check -w @sv/web` passed **124** indexable sitemap URLs, **294** internal links and booking/404 probes. The expanded GET-only audit inspected **318** URLs and **300** unique internal destinations: zero broken links, zero orphan sitemap pages, zero sitemap noindex entries, no duplicate indexable metadata and no missing OG/Twitter cards; all indexable pages are within three clicks of home. Before/after evidence remains in `.codex/seo-audit-2026-10-15.json` and `.codex/seo-audit-after-2026-10-15.json`. Inherited object names in region/legal maps and unplanned man-and-van town probes now return real 404s. Booking step queries share `/book` canonical and noindex; confirmation/quote are noindex.

_Final cache check:_ After the sitemap-only `revalidate` export, the final 317-page build, full web lint, core SEO checker and expanded crawl passed again. The prerender manifest confirms `/sitemap.xml.initialRevalidateSeconds = 86400`; both measured font assets remain unchanged and return 200 with expected byte lengths. Browser/Lighthouse runs precede only this nonvisual sitemap-cache change. Final 360/1440 screenshots preserve the artwork/glass/header and have no horizontal overflow.

_Mobile lab results:_ Serial Lighthouse reports on the frozen font/paint build (before the sitemap-only cache export) are preserved as `.codex/seo-lighthouse-{home,service,location,route}-final-2026-10-15.json`. Scores and LCP: home **86 / 3.437 s**, service **94 / 2.781 s**, Paisley **95 / 2.874 s**, route **95 / 2.789 s**. All four scored **100** for accessibility, best practices and SEO, with **CLS 0**. A single explicit repeat gave home **87 / 3.414 s** and Paisley **93 / 2.897 s**, also CLS 0; no best-run selection was used. Home total transfer fell from **499,475** to **379,010 bytes**; JS is **167,859 bytes**, below 170,000, and every page is below the 500,000-byte total budget. Both font resources returned 200. Manrope remained unchanged; Bricolage retains variable weight but omits optional optical sizing as documented in D50.

_Remaining performance failure:_ The unchanged `scripts/check-lighthouse.ts`, run against copies of all four final reports in `.codex/seo-final-budget`, fails because home performance **86** is below **95**. Service also misses 95; Paisley varies below it on repeat. The project performance gate is **not passed**, and lab LCP still exceeds the 2-second target. Home trace points to style/layout, rendering and hydration work after assets are ready; reducing the remaining main-thread/paint cost requires further work. Non-home LCP comparisons have different candidates: earlier reports sometimes measured cookie-banner helper text, whereas final reports measure actual main headings/copy. Baseline home CLS also varied from 0 to 0.408; final original/repeat home and Paisley runs are all 0. Field p75 LCP/INP and live indexing/rankings remain unverified.

_Boundaries:_ Owner-authorized repairs follow `.codex/seo-audit-report-2026-10-15.html`; no deployment, Search Console changes, database writes, dependency installs or pricing-engine arithmetic changes were made. Draft guides/unpublished local notes remain staged. Sitemap now shares town pages' 24-hour revalidation window; publication changes do not invalidate immediately. Two later 15-worker builds encountered database connection ErrorEvents on differing prerenders; bounding build workers to four retained all DB guards and the subsequent builds passed. Decisions and deviations are recorded in D49–D51. The user-facing before/after report is `.codex/seo-repairs-2026-10-15.html`, with crawl/measurement evidence in `seo-repair-results-2026-10-15.json`.

## Header enhancement — 2026-10-14
_Plan:_
- Keep the existing brand, 64/56 px sticky header and settings-backed phone links.
- Improve navigation spacing, price actions and service/area panel layouts.
- Add desktop disclosure state, keyboard opening, Escape and outside dismissal.
- Replace the mobile overlay with a native modal, close control, focus containment and scroll lock.
- Add Manage booking, verify desktop/mobile layouts and run focused navigation/accessibility tests.

_Verification:_ Complete. All four `apps/web/e2e/header.spec.ts` tests passed against the running local app: `header desktop disclosures toggle and keep only one panel open`, `header desktop keyboard opening and dismissal preserve focus`, `header mobile menu contains keyboard focus and restores it on close`, and `header mobile menu closes after navigation and when resizing to desktop`. These include header-scoped axe checks. Web typecheck, lint on the changed TypeScript/test files, production build and `git diff --check` passed. Browser checks confirmed the Areas panel fits at 1024 px and the mobile menu has a visible close control and price action. Full `npm run verify` stops at the pre-existing missing `react-hooks/exhaustive-deps` rule in `apps/web/src/components/booking-flow/booking-flow.tsx:959`; unrelated code was left untouched.

## Mobile booking card repair — 2026-10-15
_Plan:_
- Reproduce the clipped service chips and price button with long selected address labels at 430 px.
- Constrain nested booking grids to the available width instead of their text's intrinsic width.
- Keep selected address labels truncated and both Change actions fully visible.
- Add regression coverage for empty, partially selected and fully selected address states across device widths.
- Check the production build, targeted tests, TypeScript and changed-file lint.

_Reproduction:_ A 383 px card had a 595 px implicit grid column after selecting an address; sibling chips, address fields and the submit button expanded off-screen. The fix uses zero-minimum grid tracks and allows address containers to shrink. Live checks with both selected addresses now show a 383 px column and visible controls.

_Verification:_ All six `hero-responsive.spec.ts` tests passed: `hero at 430px stays bounded as addresses are selected and changed`, plus `hero controls with long selected addresses stay bounded` at 320, 360, 390, 768 and 1440 px. Empty/one/two-address states, all service chips, both Change actions and desktop columns are covered. All four `header.spec.ts` tests also passed (10 browser tests total). Production build, web typecheck, lint for the new regression test and `git diff --check` passed.

## Glass address cards — 2026-10-15
_Plan:_
- Share the glass surface between address entry and selected-address states.
- Add translucent background sampling, light rims and floating depth to address controls and suggestions.
- Track pointer reflections without React rerenders and retain clear keyboard focus.
- Preserve the mobile sizing repair and provide reduced-motion/forced-color fallbacks.
- Run responsive regressions, changed-file lint, TypeScript and production build checks.

_Verification:_ The six `hero-responsive.spec.ts` tests passed at 320, 360, 390, 430, 768 and 1440 px. Changed-file lint, web typecheck and the final production build passed. Browser checks confirmed `blur(20px) saturate(1.85) contrast(1.02)`, pointer-controlled light coordinates and visible gold keyboard focus; the cards remain 383 px wide inside the 430 px viewport. Standard backdrop-filter declarations survive CSS compilation, and the hero booking panel releases its opacity backdrop boundary after entry. Implementation decisions are recorded in D43.

## Selected price visibility — 2026-10-15

- [x] Give the selected date and time window a solid Gorse fill, dark text and an inset selection marker; retain separate availability badges and visible keyboard focus.

_Verification:_ Live browser checks on the existing Prices draft confirmed selected date/time backgrounds are `rgb(255, 201, 60)`, distinct from pale-yellow limited-availability rows and white unselected time windows. The selected Best Price amount remains dark and its green badge stays visible. At 360 px, all date rows fit without horizontal overflow; the keyboard focus outline remains inside the date list. The normal 920 px viewport was restored after checking. Scoped `git diff --check` passed. CSS-only change; no quote, booking or payment API actions were performed.

## Booking availability repair — 2026-10-15

_Plan:_ Revalidate saved quotes before checkout; wait for draft hydration before route correction; remove scarcity messages requested by the owner; release verified synthetic occupancy with a backup; prevent self-service fixture seeding in the ordinary development database; verify loading, retry, expiry and genuine unavailability through mocked browser regressions.

_Data repair:_ Released capacity for 1009 exact self-service fixtures, 17 mock-paid test bookings and two unfunded Stripe test bookings. The two Stripe intents were retrieved read-only and both had `livemode: false` and `requires_payment_method`. Booking records and payments were preserved; 1028 audit entries record the status changes. Removed 15 capacity overrides explicitly marked `E2E self-service fixture`. Before-state backup: `.codex/availability-release-backup-2026-10-14T23-54-17-727Z.json`. A real existing-quote availability overlay now reports 84/84 periods open and zero Full periods. The guarded self-service fixture endpoint returns HTTP 403 on the normal dev server, with zero active bookings remaining in the calendar window.

_Verification:_ Complete. All five `prices-availability.spec.ts` regressions passed on Chromium at 430 px using `E2E_BASE_URL=http://localhost:3000`: pending GET gating and stale Full-to-open restoration, persisted Prices reload, unavailable-selection replacement, failed GET/retry, server-authoritative expiry, and genuine fully booked dates. Open responses deliberately have `lastOne: true` while the UI omits scarcity messages. Every test API request is intercepted and unexpected mutations are blocked. Full web lint, web typecheck, the final production build and scoped `git diff --check` passed. Live browser checks confirmed all three time windows enabled, no Full/scarcity messages, and Continue enabled only after the refreshed quote arrived. Production CSP was checked in the build manifest and excludes `unsafe-eval`. The local headless `127.0.0.1` dev origin stalled hydration; the same server at `localhost` passed without relaxing test readiness. Decisions are recorded in D44.

- [x] Current server availability, restored quote behavior and requested message removal verified against the checks above.

## Development test-booking deletion — 2026-10-15

- [x] On the owner's explicit deletion request, classify and permanently remove accumulated test bookings, back up their full related records, preserve shared business entities and audit history, then verify database counts and availability.

_Result:_ Deleted 1571 verified test bookings (including the 1028 cancelled in the earlier capacity repair), 1611 linked payment records, 36 refund records, 23 test reviews, 342 extra-charge records, 171 booking-specific driver locations and 265 derived outbox events. The two processing test events were removed while the local development server was stopped; the server was restarted after the transaction. Customers, quotes, staff, vans, pricing/settings, Stripe-event replay history and existing audit logs were preserved. Added 1571 deletion audit entries. No Stripe mutations or external notifications were initiated.

_Backup:_ Complete before-state stored outside the repository as a Windows CurrentUser DPAPI-encrypted backup: `C:/Users/Administrator/.codex/backups/speedyvan/test-bookings-2026-10-15T00-14-05-977Z.dpapi`. Encryption/decryption round-trip was verified before deletion. The operational script defaults to a read-only dry run and checks test markers, payment mode, linked-record integrity and concurrent changes before applying.

_Verification:_ Database queries confirm zero remaining bookings, zero booking payments and zero capacity holds; a real existing-quote overlay reports 84/84 periods available. The restarted checkout returns HTTP 200. No application source changes or dependency installs were needed for this deletion.

## Booking progress header — 2026-10-15

_Plan:_ Redesign the five existing steps as a connected sequence; distinguish completed, current and upcoming states; show step count and route context; preserve guarded navigation; fix stacking below the site header; verify small-screen layout, keyboard focus and mocked navigation without database writes.

- [x] Implement and verify the responsive progress header, including all five labels, completed checks, the current step, disabled upcoming steps and Back navigation (`booking-progress.spec.ts`).

_Verification:_ Four Chromium regressions passed at 360 and 1440 px, checking visible label bounds, 44 px targets, long-route overflow, current/completed states, keyboard and browser Back navigation, and a scoped axe accessibility scan. Every API request was intercepted and mutation counts stayed zero. Changed-source lint, web typecheck, production build and scoped diff checks passed. Live mobile scrolling confirmed the wizard sits at 57 px below the 56.8 px site header. Decisions are recorded in D45.

## Owner-provided animated badge — 2026-10-15

_Plan:_ Extract the supplied metallic badge onto real alpha transparency using the built-in image tool; preserve a full-resolution PNG and optimize a small web asset; update the shared web logo with finite shine/interaction motion and a static reduced-motion path; preserve readable wordmark, header dimensions and home-link accessibility; verify responsive rendering without database mutations.

- [x] Extract, integrate and verify the owner's badge, shared finite logo animation, standalone SVG export and browser/home-screen icons (`logo.spec.ts`).

_Verification:_ PNG alpha inspection confirmed clear corner pixels and 549,563 fully transparent pixels; WebP retains alpha at 256 x 256 and 24,620 bytes. Three mocked Chromium tests passed for loaded header/footer/menu images, wordmark/home-link accessibility, 44 px targets, 360/1440 px layouts, finite animation and motion disabled under reduced-motion settings including hover/focus. No API mutations occurred. Changed-source/test lint, web typecheck, production build (including both icon routes) and scoped diff checks passed. Live browser checks confirmed the unchanged 56.8 px site-header height, new icon metadata, and a standalone SVG width of 360 px without overflow at a 360 px viewport. Decisions are recorded in D46.

## Animated hero map routes — 2026-10-15

_Plan:_ Trace the existing illustration's road lines with a decorative SVG layer, match both background sizing modes without changing the image or booking layout, add a finite light journey, pause off-screen/hidden-tab motion and provide static reduced-motion rendering, then verify alignment and booking interactions at mobile and desktop sizes.

- [x] Implement and verify the responsive animated map layer (`hero-route-animation.spec.ts`).

_Verification:_ Four mocked Chromium tests passed: exact mobile/desktop sizing and 360-to-1440-to-360 resize alignment, clipped artwork/no document overflow, foreground service-chip/address-field/CTA hit targets, finite animation timings and completion, static reduced-motion rendering, and off-screen pause/resume retaining animation progress. All API requests were intercepted and mutation lists stayed empty. Changed-source/test lint, web typecheck, production build and scoped diff checks passed. Live browser checks confirmed the traced routes sit over the painted map, preserve city pins, and keep the booking form readable and usable. Decisions are recorded in D47.

## Replace the hero vehicle with the owner's van — 2026-10-15

_Plan:_ Use the provided Renault Luton photo to replace the foreground vehicle with the built-in image editor, preserve the existing landscape/map framing, export versioned WebP assets at both existing sizes, switch the three background URLs, and verify artwork alignment and responsive layout.

- [x] Replace the hero vehicle and verify the existing map animation against the versioned assets (`hero-route-animation.spec.ts`).

_Verification:_ Six original/edited map landmarks matched without translation; both WebPs retain the exact previous canvas sizes. The four existing mocked Chromium tests passed unchanged with no API mutations. Live checks confirmed the replacement truck at desktop/mobile sizes, no overflow and the correct image switch at 1023/1024 px. Production build and scoped diff checks passed. Only three runtime CSS image URLs changed; source/reference images and previous hero assets remain available. Decision D48 records the edit and saved prompt/master.

## New Vercel account deployment — 2026-10-15

_Plan:_ Authenticate the terminal to the new account; inspect the supplied Neon database and migrate only if needed; configure the current app's preview environment and monorepo build; publish the protected preview selected by the owner; verify site, booking screens and read-only APIs; record the deferred production blockers.

- [x] Publish the owner-selected protected preview and complete read-only checks (Vercel deployment `dpl_8A9yNpZ4oBD96zd6wkzaJq2pg949`, READY/preview; authenticated HTTP and browser checks below).

_Result:_ https://speedy-van-2yrchgt7m-speedy-van.vercel.app is open in the browser. New team `speedy-van`, project `speedy-van-web`, Node 24, root `apps/web`, workspace files included, explicit root npm ci/direct web build, functions in lhr1. Ten current-app environment variables were set for preview only. Source upload/snapshot checks excluded actual env files, private backup contents and generated dependencies. Fixed 25 missing lock metadata records without changing existing package versions or manifests. The source snapshot changes only the copied web cron config to the preview blueprint; the working tree's production schedules remain byte-identical.

_Verification:_ Cloud strict npm ci, Next build and TypeScript succeeded. Authenticated GETs returned HTTP 200 for `/`, `/book`, `/man-and-van/glasgow` and `/api/v1/catalogue`; catalogue exposes the expected items/presets/customSizes/categories. Browser navigation shows the five-step booking form; home and booking fit the 905px viewport without horizontal overflow, visible eager images load, and no errors originate from the preview host. Home response has `X-Robots-Tag: noindex, nofollow`; Vercel authentication remains enabled; deployment metadata confirms `crons: []`. Screenshot: `.tmp/vercel-preview.png`.

_Limits:_ `/api/v1/health` honestly returns HTTP 503 with `db: ok` and 73 pending events. Read-only Repeatable Read review found 75 active events total (73 PENDING, two stale PROCESSING): 59 with reserved test-address evidence, 15 notifications for missing users and one failure alert. No migration, seed, database mutation, worker execution, live send, checkout/payment operation, custom-domain move, production activation, commit or push. Stripe remains test-only. Dependency audit findings and the production requirements are recorded in Q8; production remains deferred as the owner requested.

## Booking action duplication — 2026-10-15

_Plan:_ Keep the wizard's step action, hide global start-booking links during booking/quote/payment journeys, reset the marketing sticky observer on route changes and retain independent card/footer visibility. Verify client navigation and mobile/desktop controls using mocked APIs, run scoped lint/typecheck/build checks and publish the updated protected preview without database or provider mutations.

- [x] Correct duplicate booking-entry actions and verify the updated preview (`booking-progress.spec.ts`, `header.spec.ts`, live browser DOM and deployment `dpl_HB8oB2otjbvkZWderymEwBMoYh1j`).

_Verification:_ Seven booking-progress regressions and four existing header interaction/accessibility checks pass at 360/390/1440px. The Items cases retain exactly one enabled See my prices action and no global Get a price links, including the mobile menu. The marketing navigation case verifies home → book → home and independent visibility for both cards and the footer; all its API requests are mocked and mutation count stays zero. Scoped lint, web TypeScript, diff checks and the Vercel production build pass. Updated protected preview: https://speedy-van-37lnx8wvg-speedy-van.vercel.app/book. Live browser checks on this deployment find zero global Get a price anchors and zero sticky marketing bars inside `/book`, with the wizard action intact and no horizontal overflow at 905px. Screenshot `.tmp/booking-cta-preview.png`. Vercel metadata is READY/preview with `crons: []`; production configuration and the old preview/user draft are preserved. No booking, quote, payment, email, push or other database mutation was performed. Decision D66 records the route/observer change.

## Floating WhatsApp and call actions — 2026-10-15

_Plan:_ Record the owner's phone/WhatsApp facts and narrowly merge the contact setting with validation and an audit entry; add accessible floating contact links with friendly visible/pre-filled copy; avoid booking actions, the mobile price bar and consent UI; verify responsive links, keyboard access and collision behavior without opening WhatsApp or making a call; publish and inspect the protected preview.

- [x] Owner contact settings, floating actions and updated preview verified (`floating-contact.spec.ts`, `booking-progress.spec.ts`, `header.spec.ts`, browser DOM and deployment `dpl_AiyUUN5eeoWXhxP8CURnE1vfvdF1`).

_Verification:_ Validated/transactional contact merge readback confirms all three owner phone fields, preservation of other contact fields and no unrelated setting changes; previous contact row is backed up privately and a SYSTEM audit entry records the owner request. All 14 browser checks pass, including keyboard/scoped axe, 56px targets, destinations and prefill, menu/consent hiding, collision avoidance and prior booking/header regressions. Scoped ESLint, web TypeScript and diff checks pass; the Vercel build succeeds. Live browser verification on https://speedy-van-b6dyhrsji-speedy-van.vercel.app/book shows both correct native links and the greeting after dismissing cookie preferences. Screenshot `.tmp/floating-contact-preview.png`. Deployment is READY/preview in lhr1 with `crons: []`, preview authentication and noindex/nofollow retained. Production web config is unchanged; production activation remains deferred. No WhatsApp message, phone call, booking, payment, email, push or queue operation was executed. D67 records the implementation.

## Replacement owner logo — 2026-10-15

_Plan:_ Inspect the supplied 18:46 WhatsApp image, prepare a transparent badge while preserving its artwork, replace the shared website badge and matching browser/Apple icons, keep the existing accessible home link and motion preferences, verify mobile/desktop/logo regression coverage and publish the protected preview under D65.

- [x] New owner logo loaded consistently and verified in the updated preview (`logo.spec.ts`, `header.spec.ts`, `seo-metadata.test.ts`, browser DOM and deployment `dpl_31EUumviV3yMMQhMmpmpTmXYjnJy`).

_Verification:_ Seven browser regressions pass at 360/390/1440px for shared header/footer/mobile-menu loading, overflow, keyboard interaction, scoped axe and reduced-motion behavior; six metadata tests pass. Scoped ESLint, web TypeScript and diff checks pass. Source derivatives have real alpha transparency with transparent corners and expected 512/256/64/180px dimensions; the UI WebP is 25,502 bytes. Local favicon GET returns 307 to the new icon; icon and Apple PNG GETs return 200. The Vercel build succeeds, and https://speedy-van-k9uj1z9rf-speedy-van.vercel.app/ is READY/preview with `crons: []` and authentication/noindex retained. Live browser checks show the loaded silver badge, new shared OG URL and new hashed browser/Apple icon URLs. Screenshot `.tmp/silver-logo-preview.png`. Built-in image editing prompt and asset provenance are recorded in D68. Production configuration, admin/driver apps and all business/database records remain unchanged; no live communications, commit or push occurred.

## Website and admin live chat — 2026-10-15

_Plan:_
- Add strict shared chat contracts and additive conversation/message/session tables, with no changes to existing booking data.
- Authenticate visitors with an opaque HttpOnly necessary cookie created on their first message; isolate every conversation and enforce rate limits, same-origin writes and message idempotency.
- Provide bounded, authenticated admin inbox/message/read endpoints and customer endpoints without sending external notifications.
- Add an inbox, unread indicator and keyboard-safe conversation screen to the existing admin app.
- Lazy-load an accessible website chat panel, preserve failed drafts/retries, and refresh visible conversations without websockets or a new vendor.
- Unify chat, WhatsApp and call controls with consistent touch targets, safe areas, focus treatment and placement clear of booking actions.
- Document the necessary service cookie, run security/data/UI tests and check multiple browser engines and responsive sizes.
- Review/apply only the additive chat migration, verify an isolated real conversation and publish the protected preview under D65; keep production activation deferred.

- [x] Secure customer/admin conversation and persistence verified.
- [x] Website contact controls and chat verified across responsive layouts/browser engines.
- [x] Admin inbox, reply/read/unread states verified.
- [x] Additive migration and protected preview verified without affecting existing records.

_Data and server verification:_ Eight shared-contract tests and 46 server/regression tests pass, including ownership, cursor/read isolation, UUID retries, rate limits and expiry boundaries. Reviewed migration `20261015230000_live_customer_chat` was the only pending migration applied; existing booking, payment, user, Setting and outbox counts remained unchanged. Real repository/constraint acceptance ran in an intentionally rolled-back transaction, leaving zero persistent test messages, staff accounts/sessions or outbox events. The full admin suite passes 330 tests in 26 suites; scoped lint, TypeScript and the cloud build pass.

_Browser verification:_ All 36 final case outcomes pass: 27 Chrome/Edge/Firefox cases from the frozen-product matrix and nine WebKit reruns after test-only saved-consent hydration synchronization. Six chat scenarios and three contact scenarios per engine cover sends/replies, unread/read state, duplicate/retry handling, history, interleaved ordering, expiry reset, ordinary Tab/Escape/focus return, scoped axe, reduced motion, consent/menu suppression and responsive collision avoidance. The initial matrix's single remaining failure was a test click racing the already-saved consent banner's hydration; synchronization preserves the actual reject/reopen and keyboard assertions. No diagnostic keyboard workarounds or temporary comparators remain. Twenty root consent/foundation/security-policy unit tests also pass; unit totals overlap the verification agent's 13-test consent/foundation run and are not added twice. Browser E2E uses intercepted APIs and performs no real writes or communications.

_Preview verification:_ https://speedy-van-1r74p0ec2-speedy-van.vercel.app/book is READY/preview (`dpl_HDUrXZcx4fvTNtJiDyWbZFky575t`, lhr1). Actual browser opening displays the unified contact dock and loaded chat composer; the existing signed-in admin app displays the genuine empty inbox at More → Live chat. Screenshots: `.tmp/live-chat-preview.png`, `.tmp/live-chat-contact-dock-preview.png`, `.tmp/live-chat-admin-inbox.png`. No real chat message, staff reply, call, WhatsApp message, booking, payment, email, push or queue work was sent/executed. Preview authentication and noindex/nofollow remain enabled; `crons: []` and working-tree production schedules remain unchanged. Thirty-day expiry is enforced immediately, while scheduled physical deletion awaits production cron activation under D65.

## Admin-created driver password accounts — 2026-10-15

_Plan:_
- Replace driver invitation entry with Add driver and the owner's requested email, password and phone fields.
- Validate a strict shared contract, create an ACTIVE DRIVER and profile transactionally, hash the exact password and reject existing emails without overwriting accounts.
- Follow the owner's clarification: new accounts have no payout percentage because pay is negotiated by phone; allow null without a zero/default fallback, preserve existing numeric records and record a redacted account-creation audit.
- Add usable driver email/password sign-in through the existing authenticated API, secure native storage and app gates; retain the email-code alternative.
- Verify admin form states, role/validation/password boundaries and real database persistence in a rolled-back test; inspect the local UI without creating a live staff account.

- [x] Admin Add driver form and list refresh verified (`add-driver-screen.test.tsx`, `add-driver-hook.test.tsx`, full admin suite: 355 tests / 28 suites).
- [x] Secure driver creation, duplicate handling and password login verified (`driver-account-create.test.ts`, `driver-account-route.test.ts`, existing staff-password tests, 14 contract tests and rollback-only real DB acceptance).
- [x] Driver sign-in experience and local visual review verified (32 driver tests / six suites, root navigator/cache/recovery review, real local Drivers → Add driver browser navigation).

_Owner clarification:_ No payout percentage is set for new drivers; pay is negotiated by phone. The form contains exactly Email, Password and Phone number. Driver detail and unknown earning estimates show "Agreed by phone", without inventing a zero or percentage. Existing configured rates, recorded earnings and payouts are preserved.

_Implementation and verification:_ The admin header opens `/drivers/add`, validates the shared contract, supports password reveal, offline/error/retry/submission/success states and invalidates the initiating admin's directory. Credentials never enter React Query's mutation cache or persistent storage and clear on leaving, locking, account change or success. `POST /api/v1/admin/drivers` creates an ACTIVE DRIVER and profile with the exact password's scrypt hash in the same transaction as a redacted audit. Existing or concurrently duplicated email returns 409 without overwriting credentials. Driver password sign-in uses the existing role/device/rate-limit API, preserves OTP, stores native credentials securely and uses memory only in browser previews. Native lock/permission gates keep the root navigator mounted. Each accepted/cleared driver session receives its own query cache, including isolation from late previous-session requests. Invalid saved credentials recover to sign-in; temporary storage/network errors remain retryable. Independent review rechecked all three recovery/cache/navigation findings after correction.

_Data evidence:_ Applied only `20261015233000_driver_payout_by_agreement`: drop the payout column's NOT NULL and implicit zero DEFAULT, with no row updates. Pre/post business counts and a fingerprint of existing per-driver rates match. A real DB transaction exercised account/profile/audit persistence, normalized contact, exact password verification, wrong/trimmed rejection, nullable rate and duplicate conflict; deliberate rollback left zero test accounts/audits/sessions/outbox events and all business counts unchanged. Initial read-only connection attempts had transient Neon connection failures; retried checks completed successfully. Existing Setting remains unchanged.

_Checks and local result:_ 106 focused backend regressions, 14 shared contract tests, 355 admin tests and 32 driver tests pass. Web, db, contracts, admin and driver TypeScript and relevant ESLint/diff checks pass. Actual signed-in local browser navigation shows the empty three-field Add driver form at http://127.0.0.1:8081/drivers/add with a secure new-password input, disabled incomplete submission and no horizontal overflow at 920px; screenshot `.tmp/admin-add-driver.png`. No real staff account, sign-in session, invitation, email, push, booking, payment or queue operation was created/executed. No new native build, deployment, commit or push in this task.

## Incoming live-chat sound — 2026-10-15

_Plan:_
- Validate and copy the owner's supplied WAV unchanged to web/admin assets with a shared filename.
- Play only new incoming messages, with initial/history/own-message/read/poll/reopen deduplication.
- Provide accessible enable/test/mute and visible browser-blocked/retry states without forcing autoplay or requesting unrelated permissions.
- Keep customer chat/audio lazy, refresh initiated closed conversations read-only while foregrounded, and integrate admin alerts globally behind authentication/lock/visibility gates.
- Add bounded staff inbox incoming-message watermarks to handle a later admin reply and clock skew without exposing customer credentials.
- Verify native playback integration, mocked-media cross-browser behavior, real read-only asset serving and rollback-only inbox SQL; preserve booking sounds and all business records.

- [x] Customer incoming sound, lifecycle and browser controls verified (`chat-sound-arrivals.test.ts`, `live-chat-sound.spec.ts`, actual browser Enable sound → Sound on).
- [x] Admin incoming sound, global deduplication and controls verified (`chat-sound-{tracker,provider,player,player-web}` tests, `chat-hooks.test.tsx`, actual Test sound → enabled switch).
- [x] Shared asset, staff watermarks and final local checks verified (42 chat server/retention tests, nine chat contract tests, rollback-only SQL acceptance, HTTP asset hash checks).

_Asset:_ The owner's `mixkit-software-interface-start-2574.wav` is copied byte-for-byte to web public, admin public and native sound assets under shared `CHAT_NOTIFICATION_SOUND_FILENAME`. All three SHA-256 hashes match the original (`7323c6ced9605a9b8a406cd088550d06d1a39dc8d37c9abfe52b536482468ad5`): 414,076 bytes, 2.3471 seconds, stereo 44.1 kHz 16-bit PCM. Both local servers return HTTP 200 audio/wav with identical bytes. Existing booking/offer sounds are untouched.

_Behavior:_ Customer audio remains inside the lazy chat bundle. New ADMIN replies ring once while foregrounded, including the first reply to a new chat and an initiated conversation with its panel closed (15-second read-only poll). History/pagination, own sends, read/refetch/reopen and hidden-tab catch-up do not ring. Enable/preview/mute and visible blocked/retry states handle browser play restrictions; the original clip successfully played from the actual control. Admin has one authenticated/unlocked foreground runtime across screens: native Expo Audio and direct browser Audio, controls in inbox/thread, exact received-CUSTOMER deduplication, silent baseline/resume catch-up, bounded test timeout and error/retry. Actor/preference/delivery resets preserve root navigator identity and prevent previous-account playback. Native playback respects phone silent mode. Background/closed-app chat Push is not implemented or claimed by this foreground sound task; adding a bundled notification sound alone does not send a Push.

_Inbox and verification:_ Additive optional staff-only lastCustomerMessage/sequence and global latestCustomerSequence fields prevent a later ADMIN reply or clock-skewed timestamp from hiding an arrival. Public customer DTOs remain unchanged. Per-page latest incoming and unread counts use bounded parameterized batched SQL: four DB round trips for a 100-row global poll instead of one count per row. Both SQL helpers worked against the actual database in an intentionally rolled-back acceptance transaction, leaving no test rows, staff sessions or outbox events. 42 server/retention, nine chat contracts, six customer arrival tests and the complete admin suite (383 tests / 32 suites) pass. Relevant TypeScript/ESLint/diff checks pass. Independent browser results: 12 sound cases plus 36 existing chat/dock cases pass across Chrome, Edge, Firefox and WebKit. All engines load the actual WAV's native Audio metadata; the test initially used unavailable OfflineAudioContext in Windows WebKit, then used the same HTMLAudio metadata probe across all engines without weakening product assertions. Browser tests intercept messages/media playback and create no real messages.

_Local inspection:_ Manual Enable/Test controls played the real file for customer and admin and show enabled states; screenshots `.tmp/customer-chat-sound-control.png` and `.tmp/admin-chat-sound-control.png` intentionally omit customer-message contents. The existing Expo preview had stopped responding; restarted only its verified process, then cleared corrupt generated Metro cache using Expo's --clear. Fresh bundling completed and /chat/asset checks succeeded. Existing Expo Go/CLI environment warnings are unchanged; no dependency update/install, migration, real chat send, account, booking, payment, email, Push, native build, deployment, commit or push was performed in this task.

## Production deployment on the existing Vercel Hobby account (2026-10-15)

Owner explicitly requests production now with `vercel --prod`, using the existing signed-in team and without activating Pro or moving hosting. This supersedes the earlier preview-only instruction.

- [x] Configure only current-application production environment values securely; preserve authentication secrets and the owner-selected Neon database. Production API import succeeded; matched owner-provided Live Stripe keys and dedicated canonical-domain webhook configured, with no actual payment or historical email sent. Local environment files remain excluded; E2E absent.
- [x] Keep supported daily outbox/retention/integrity schedules; scope request-triggered delivery to the newly verified event and require the fixed activation cutoff in production. Independent runtime/manage review reran 47 passing tests; historical claims and integrity resets are excluded.
- [x] Identify Stripe mode honestly in checkout, payment links and confirmation; preserve retryable payment states (43 unit tests, 30 confirmation browser checks, three responsive disclosure checks). Production now uses the subsequently supplied Live pair; test notices remain conditional for preview/local.
- [x] Complete relevant tests and deploy the exact current source using the correct account and production target (`dpl_Hcz7A527p2VUiUWE6RVyWpm8A1WS`, Vercel API READY/production/lhr1). All ten workspace lint and TypeScript tasks pass; targeted runtime/delivery checks and 30 browser payment regressions pass.
- [x] Verify public HTTPS domains, redirects, core pages, API boundaries, indexing and sound asset (real public HTTP checks plus actual browser Home/Book/chat opening, no messages or bookings submitted). Remaining limits are recorded below and Q8 stays open for business acceptance.

_Release:_ Executed the explicit `vercel deploy --prod --yes --no-wait` using the existing current-account authentication, team `speedy-van` and project `speedy-van-web`. The first upload hit a transient fetch failure; retrying the same immutable 656-file snapshot succeeded. Cloud npm ci was slow (dependency deprecation warnings, no install failure) and the subsequent Next build completed. API status confirms READY/production with functions in lhr1, all three daily schedules and aliases `www.speedyvan.uk`, `speedyvan.uk`, `speedy-van-web-psi.vercel.app`. Private source manifest and literal-secret scan exclude actual environment/private files. Public deployment URL: `https://speedy-van-fxz2iov69-speedy-van.vercel.app`; canonical public site: `https://www.speedyvan.uk/`. The Vercel team API still reports active Hobby; no trial, Pro upgrade or billing mutation occurred.

_Live Stripe:_ The subsequently supplied matched Live pair is configured only in Production; Preview retains its test pair. Provider reads verify a Live, enabled canonical-domain webhook with all eight required handled events; the temporary test endpoint created earlier in this task was reversibly disabled. Registered both canonical and apex domains with the Live Stripe account: provider reports Apple Pay and Google Pay active. This is configuration evidence, not a physical-device wallet or successful-charge acceptance test, and no approval Setting was fabricated. The actual served booking scripts contain the expected Live publishable key and no configured secret key. No actual PaymentIntent, charge, refund or provider email was created by verification.

_Public verification:_ Home, Book, Glasgow man-and-van, furniture-delivery, catalogue, robots, sitemap, chat session and the exact incoming-sound WAV return HTTP 200. Apex permanently redirects 308 to www. Public marketing pages are indexable with canonical www URLs; booking metadata remains noindex. Sitemap contains 126 published URLs. Admin bookings/chat reject unsigned access with 401; Stripe rejects an unsigned empty request with 400. Chat opens through its real lazy module into the expected empty first-conversation state, with sound controls and WhatsApp/call links, without starting a conversation or sending content. Home screenshot: `.tmp/production-live-home.png`; detailed HTTP results: `.tmp/production-http-verification.json`. A new own-session cookie choice retained analytics/advertising disabled for this inspection.

_Known operational status:_ `/api/v1/health` truthfully returns 503 with database ok and 73 historical PENDING events; read-only SQL confirms those, two historical PROCESSING and one FAILED row remain unchanged, and all eight migrations are complete. The fixed activation cutoff excludes these records from new scheduled claims/resets rather than deleting or falsely delivering them. New foreground-triggered delivery is immediate when successful; durable automatic retries use the daily safety net. Frequent reminders/repeat alerts, push receipt polling and abandoned-intent cancellation still need scheduling. Native Apple Push and real-money/email/device acceptance and business legal/pricing/fact approvals remain open; publication alone does not prove them. No commit, push, provider payment, test booking, historical queue send or role/data approval was performed.

## Signed iOS admin build through Expo EAS (2026-10-15)

Owner requests the admin iOS app built through Expo, with the current project logo as the app/build icon. Following Apple sign-in, the owner asked for the work to continue without further routine help. Use the existing App Store Connect app for private TestFlight distribution; no public App Store release or billing upgrade is implied.

- [x] Prepare an opaque 1024px iOS icon from the current project logo and verify Expo's resolved icon paths (RGB PNG, no alpha, native mask left to iOS; image provenance in `.tmp/admin-app-icon-20261015/manifest.json`).
- [x] Validate production identity, HTTPS API, native plugins/custom sounds and the upload archive; preserve local development behavior and exclude secrets/backups — current bundle `co.uk.speedy-van.admin`, version `1.0.0`, build `53`, production API `https://www.speedyvan.uk`. Actual EAS archive audit covers 682 files with no unsafe paths or credential-content matches; the archived icon hash matches the reviewed opaque source.
- [x] Run appropriate admin/native source checks — Expo Doctor 21/21; latest full admin 404 tests/33 suites, lint/types and a production iOS Hermes export; driver 32 tests, lint/types. `notification-config.test.ts` verifies production configuration and the encryption declaration; `api-base-url.test.ts` plus actual Expo config execution reject a release pointing at HTTP loopback. The shared typed CommonJS validator avoids persistent loader hooks across Jest environments. Metro configuration now uses `.cjs` for this ESM package; the actual EAS Metro validator passes in both the working tree and upload archive.
- [x] Select the existing private TestFlight delivery path without changing the original internal profile — App Store Connect app `6812268357` has existing build `52`; local build number `53` follows it. `cli.appVersionSource` is `local`; `production-store` extends the preserved `production` profile and changes distribution to `store`, so this path does not require collecting device UDIDs.
- [x] Enable and read back the required Apple identifier capabilities — Push Notifications enabled through Apple's API and Time Sensitive Notifications enabled through the portal. This confirms configuration persistence, not actual APNs delivery.
- [x] Complete signing preparation for the already linked EAS account/project — reused the existing distribution certificate, APNs key and App Store Connect API key. The fresh APPSTORE provisioning profile was decoded and verified against the actual team, selected bundle and certificate; it contains production APNs and Time Sensitive entitlements, no provisioned-device list and `get-task-allow: false`.
- [x] Match and verify the EAS install runtime — production pins Node 24.7.0, inherited by `production-store`, with npm 11.5.1 verified in the actual macOS worker logs. A real isolated `npm ci` completed with 1,896 packages and lifecycle scripts enabled, including Prisma generation without a database connection or environment file. The clean production Hermes export, Doctor 21/21 and frozen-lock Darwin arm64 dry run pass. The runtime fix leaves the lockfile byte-identical and changes no dependency versions.
- [x] Complete the signed iOS cloud build — [EAS build `7cedee60-d718-4dde-9eea-5f2c078a54a3`](https://expo.dev/accounts/ahmadawadalwakai/projects/speedyvan-admin/builds/7cedee60-d718-4dde-9eea-5f2c078a54a3) is `FINISHED`, producing SV Admin `1.0.0 (53)` at 22:22 Europe/London on 2026-10-15 (`2026-10-15T21:22:00Z`). Cloud install, Doctor, prebuild, CocoaPods, native compilation, code signing, archive and artifact upload passed. The earlier build `fdb05915-478e-487e-840d-59071fa6feb7` failed during `npm ci` on Node 22.23.1/npm 10.9.8; it remains a historical failed attempt.
- [x] Download and inspect the actual signed IPA — independent audit reports no failures (`.tmp/admin-ios-ipa-audit/report.json`); SHA-256 `4155f1d47acb0cc0869d51d79023ca6dd716a22f19e1832bd60a99103113b7e1`. Actual Mach-O entitlements and the embedded profile agree with the intended identity/capabilities; all three native WAVs pass byte/header/duration checks and their Expo asset copies match. The packaged 152px icon was viewed and matches the current project logo. Packaged `EXConstants.bundle/app.config` contains production API `https://www.speedyvan.uk`, the linked `0dd0709d-309d-455c-8ad8-eeeb4550adca` project and production updates/runtime `1.0.0`.
- [x] Submit the authorized build for private TestFlight — EAS submission `fd6a846e-1f77-4b52-a931-29d49c67dc11` is `FINISHED` with no error, completed at 22:25:46.874 Europe/London on 2026-10-15 (`2026-10-15T21:25:46.874Z`). The current audited build was selected explicitly; no public App Store release was requested.
- [x] Wait for App Store Connect processing and verify private tester availability — [build `53`](https://appstoreconnect.apple.com/apps/6812268357/testflight/ios/2be20571-cbb4-4ce4-848b-363841b10851), ID `2be20571-cbb4-4ce4-848b-363841b10851`, is `VALID`, `IN_BETA_TESTING` and not expired; Apple confirms `usesNonExemptEncryption: false`. Both existing internal groups, `sv` and `Team Expo`, are actually associated through their automatic-all-builds setting. No testers, groups or invitations were created or modified.
- [~] Verify the installed app on a physical iPhone — the owner installed build `53` and its cold root launch at `speedyvan-admin:///` failed with `Unmatched Route`. The route fix now passes real Router integration checks and is published as a compatible production OTA update, but phone activation/relaunch is unverified. Production sign-in and foreground/background/closed-app notification acceptance remain incomplete; D74 tracks the separate delivery and physical checks.

_Build evidence and remaining acceptance:_ The production Hermes export contained 5,002 modules and 39 assets; exported booking/chat WAV hashes matched their original sources. The signed IPA audit confirmed the packaged native sounds, current icon, production API/Expo update configuration and actual entitlements/profile. The API origin comes from `Constants.expoConfig.extra.apiBaseUrl` in the native Expo manifest, rather than a literal URL in Hermes bytecode. Apple confirmed `usesNonExemptEncryption: false`. Build `53` signing, IPA inspection, submission, Apple processing and existing internal tester-group availability completed. Its subsequent installed-phone root launch failed because the embedded route graph lacked an index. Those build/distribution checks did not establish functional startup. D74 records the published route OTA and completed/audited/submitted embedded build `54`, now valid and available to the existing internal groups; post-fix phone activation remains unverified. Physical sign-in, backend Push configuration and notification acceptance remain incomplete. No public App Store release, real customer booking/payment, tester invitation or live notification send was performed.

## Admin iOS build 53 cold-start routing incident — 2026-10-15

The owner's installed TestFlight build `53` opened `speedyvan-admin:///` into Expo Router's `Unmatched Route` screen because that build's application route graph lacked an explicit root index entry. The completed native build, signed-IPA asset/config inspection and Apple processing did not establish functional startup. The source route is now repaired and its OTA is published; the installed phone applying and successfully running that repair remains unverified.

_Repair plan:_
- [x] Record the actual installed-phone failure and its missing-root-index cause; keep functional startup acceptance incomplete (owner screenshot/report, D74).
- [x] Add an explicit `app/index` route and declare the Stack index, preserving the existing authentication/session-restore/lock gates without a sign-in bypass or navigation over an in-progress restore.
- [x] Exercise real ExpoRoot routing — before the fix, four root-launch cases failed while a direct deep link passed; after the fix, all six cases pass, including cold root/auth/restore/lock/direct-link behavior and denial of a signed-out private link. Full admin verification passes 411 tests/35 suites, lint and TypeScript. These are actual Router integration checks, not physical-device acceptance.
- [x] Check production routing/export and update compatibility — native iOS export bundles 5,003 modules into a 10,050,321-byte Hermes bundle, SHA-256 `864ce0b9198df41943defcaddf5065081ee5c5e207d3f169a639d37eabdf4638`. Independent installed-IPA and update-protocol checks confirm the existing project, production channel/runtime `1.0.0` and approved API/bundle compatibility.
- [x] Publish and verify the compatible production OTA — group `0cb2a0ee-988c-4473-bdb4-d37982fc78a0`, iOS update `01a14182-6712-7405-8281-b0bb1413d4a5`, published at 22:40:27 Europe/London on 2026-10-15 (`2026-10-15T21:40:27Z`). Actual update-protocol manifest and CDN bytes match the approved bundle/API; report `.tmp/admin-ios-published-update-audit/report.json`. Phone activation is unverified.
- [x] Build and inspect embedded build `54` — [EAS build `25c593ff-7f9c-40c4-b646-f862de0e0bdb`](https://expo.dev/accounts/ahmadawadalwakai/projects/speedyvan-admin/builds/25c593ff-7f9c-40c4-b646-f862de0e0bdb) is `FINISHED` at 22:50:57.131 Europe/London on 2026-10-15 (`2026-10-15T21:50:57.131Z`), with app version/runtime still `1.0.0`. The strict IPA audit passes all guards including the root index (`.tmp/admin-ios-ipa-audit-54/report.json`); IPA SHA-256 `e9b9aa397b9cb05e6cd5e7ba532dd0aa9144b0165fd2995c217a665e6a1ec386`. Its negative control rejects old build `53` for the missing root.
- [x] Inspect the actual embedded startup bytecode without executing the app — official `hermesc -dump-bytecode` confirms compiled `IndexRoute` restoration/authentication redirects, and `RootNavigator` declares its index Screen before two Protected groups. The app context contains 18 keys with the index exactly once; evidence `.tmp/admin-ios-ipa-audit-54/startup-bytecode-evidence.json`. Embedded Hermes SHA-256 `2a77624a457864f0a34a6bca9c69423541e299195f9d730cd45c333c9fb67def`. Static inspection is distinct from phone execution.
- [x] Submit the audited build `54` through private TestFlight — EAS submission `22cc7b1a-fae6-47db-830d-d61698bc82a2` is `FINISHED` without error at 22:54:32.369 Europe/London on 2026-10-15 (`2026-10-15T21:54:32.369Z`).
- [x] Verify build `54` Apple processing and existing internal group availability — [App Store Connect build `54`](https://appstoreconnect.apple.com/apps/6812268357/testflight/ios/2600799d-43ca-4ca1-a0fd-9fcfdbe3676f), ID `2600799d-43ca-4ca1-a0fd-9fcfdbe3676f`, is `VALID`, `IN_BETA_TESTING`, not expired and reports `usesNonExemptEncryption: false`. Independent readback confirms both existing internal groups, `sv` and `Team Expo`, are actually associated. No new testers, groups or invitations were created or modified.
- [ ] Verify root cold launch and reopen on the owner's physical iPhone after delivery, then sign-in/session restore/lock/deep-link behavior. Structural/Router integration tests and remote delivery status alone cannot mark the installed-phone repair complete.

_Final delivery checkpoint:_ Source/real-Router verification, compatible OTA publication/CDN audit, embedded build `54`, strict IPA/static startup inspection, submission, Apple `VALID`/`IN_BETA_TESTING` processing and existing internal-group availability are complete. Successful post-fix installed-phone activation/cold launch/reopen remain unverified. The observed phone failure was build `53` before the fix; no new phone outcome is inferred. Physical sign-in, backend Push configuration and foreground/background/closed-app notification acceptance remain separate and incomplete. No public App Store release occurred.

## Admin iOS production five-issue repair — 2026-10-15

Owner acceptance: build 54 now launches and works on the owner's physical iPhone (owner report). New reports cover visitor count, historical checkout deletion, keyboard coverage, navigation latency and chat freshness.

_Repair plan:_
- [x] Inspect production Vercel request/error records and establish the historical-checkout deletion failure without exposing credentials or customer messages (two DELETE 503 responses; read-only provider identity/mode/funds checks).
- [x] Correct and verify explicit-consent presence registration against final production: all five initial-count/POST/active-count/DELETE/final-count requests return HTTP 200, with fresh consent 1.5 seconds ahead and exact 0 → 1 → 0 counts. No task-created presence remains active. The admin scope label is present; the owner's other phone's consent/count acceptance remains separate.
- [x] Reconcile the pictured historical test-account checkout through production DELETE: HTTP 200, retained Deleted jobs record, payment CANCELED with zero paid funds. Paid/processing/identity/version guards remain; encrypted legacy key configured, Live keys unchanged.
- [~] Repair keyboard avoidance using the measured shell header, a shrinking message list and keyboard-aware custom navigation; automated native keyboard/real Router checks pass, physical iPhone acceptance pending.
- [~] Repair native foreground/focus subscription races and immediate cached-inbox refresh, including initial unknown-state/subscription races in visitor and booking-alert hooks. Tests pass, and real production incremental message/inbox/reply requests update without an app restart; physical iPhone arrival acceptance remains pending.
- [~] Batch Schedule capacity reads and warm actual account-isolated navigation queries with cancellation; local checks and production requests pass. Single terminal samples improve Schedule from 1,964 to 1,537 ms; rigorous latency and physical iPhone acceptance remain pending.
- [x] Run the full admin suite (443 tests / 38 suites, including three additional visitor and four booking-alert startup regressions), API-client tests (24), test-database guard tests (5), and targeted web checks (210 tests / nine suites, including the latest 29-test Stripe rerun with two additional identity regressions). The local web production build generates 317 pages; relevant TypeScript/lint checks pass. Overlapping reruns are not added twice; the full web integration suite is not claimed green.
- [x] Publish and independently verify the final compatible production iOS update: group `0f2cfc2f-93fc-4643-a3a0-46a5300fe56d`, iOS update `01a141c1-b21a-7dbc-b0ab-f90cb79cf06b`, published at 23:49:35.514 Europe/London on 2026-10-15 (`2026-10-15T22:49:35.514Z`), runtime `1.0.0`, exact export `.tmp/admin-five-issues-final-20261015`. It supersedes earlier repair group `afb506b6-45b3-47e7-90c0-878ec087aa9e`. Independent audit `.tmp/admin-five-issues-final-ota-audit/report.json` passes 13 protocol and 15 compiled-feature checks; the actual CDN bundle matches all 10,060,400 local bytes, SHA-256 `cc0efd34db71c6162ce189c34a3364d26dc0dae61e1e23ea32631bf36d433a02`. Physical activation and device behavior remain unverified.
- [x] Deploy and verify backend/web production `dpl_3x31mDGveLt8gw1euxmboD27p92u`: READY at 23:50:03.927 Europe/London on 2026-10-15 (`2026-10-15T22:50:03.927Z`), serving `www.speedyvan.uk` and `speedyvan.uk`; actual authenticated production presence/deletion/chat checks pass. Existing crons and Hobby plan remain unchanged; no public App Store release or billing/security change occurred.

_Install correction:_ Earlier deploy attempts exposed an npm lockfile consistency failure. The final repair adds 11 lockfile lines for the missing `escodegen` / `source-map` resolution, without changing existing package versions or manifests. Clean Linux npm 12.2 and 11.5 dry runs pass; the temporary install-command pin was removed. The final Vercel install/build/deployment succeeds without retaining the failed override.

_Production diagnosis and repair boundary:_ The pictured old checkout is absent from the currently configured Live Stripe account (`resource_missing`) and present in its original test account with the exact booking/payment identities, test mode and zero received/capturable funds. The optional encrypted `STRIPE_LEGACY_TEST_SECRET_KEY` is restricted to that explicitly verified cleanup path; missing/unavailable payment evidence never counts as cancellation. No Live key was changed. Presence still requires an explicit analytics opt-in: a browser/server clock-skew rejection was reproduced, but the owner's other phone's consent state is unknown. Startup-state race and keyboard regression tests demonstrate local defects; they do not establish the precise device-side cause of every reported symptom or physical latency improvement.

_Production acceptance and limits:_ An ordinary task-owned admin session authenticated successfully. After deployment, DELETE for the pictured `SV-ZJW23E` returns HTTP 200 with request ID `req_734ca792-0ace-4a0b-9ce2-af3ce068519b`; the record remains in Deleted jobs with CANCELED payment and zero paid funds. Final production presence acceptance uses fresh explicit consent 1.5 seconds ahead: all five requests return HTTP 200, with counts 0 → 1 → 0. Request IDs are POST `req_a4c1f6a0-e2ac-4bc9-afb0-429198767f16`, active-count GET `req_5ba08156-743b-47d8-a7fe-e2b35eecafcf` and DELETE `req_1e0711bf-a366-4ba0-bd17-a460455e76ae`. An earlier probe's 90-second visitor credential expired normally; no task-created presence remains active, and no count is attributed to the owner's other phone. Two task-created customer messages, incremental cursor reads, inbox reads and an admin reply all return HTTP 200 and expose new content without restarting. That exact three-message test conversation was backed up and removed with an identity guard. No real customer message was sent by this test. Production terminal GET samples are 1,537 ms for Schedule and 591–848 ms for the other sampled screens, versus the earlier single samples of 1,964 ms and 590–962 ms. These are isolated server/request observations, not a controlled benchmark or physical-phone navigation measurements. Checks used a task-owned session; owner sessions were not signed out.

_Test isolation incident:_ An accidental broad web integration run reached the shared development/production database and created limited test fixtures. The run was stopped; reviewed records were backed up, then an exact Serializable cleanup removed three fixture bookings, five fixture users, four driver profiles, one customer, three sessions, three OTPs, one JobEvent and three pending fixture email events. Review found no Setting changes and no owner bookings created during that test window. Historical tests included broad outbox cleanup, so absence of unrelated outbox deletions cannot be proven; targeted fixture cleanup does not establish that no other row was affected. `NODE_ENV=test` now requires a separate `DATABASE_URL_TEST`, with five guard tests passing. Full web integration success is not claimed, and broad integration tests were not resumed against the shared database.

_Physical acceptance:_ The owner's subsequent “works perfectly” report confirms repaired build 54 startup on the physical iPhone, superseding the earlier D74 delivery-checkpoint uncertainty. It does not confirm the new visitor/deletion/keyboard/performance/chat repairs or foreground/background/closed-app Push acceptance (Q7).
