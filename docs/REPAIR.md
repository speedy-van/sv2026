# REPAIR — finishing what was left as placeholders

Reviewed on 13 Oct 2026 against `speedy-van/sv2026` (main `a0bee37`, `phase/17-launch` `1eaeb1e`): every commit on every branch, the code, and Codex's own notes (`docs/DECISIONS.md` D26–D39).

## What's real and what isn't

| Area | State | Evidence |
|---|---|---|
| Secrets on GitHub | ✅ None leaked | All 19 commits on all 18 branches scanned: no API keys, passwords or connection strings. Only fake test values |
| Pricing engine | ✅ Real, untouched | Golden prices file is byte-identical to the spec; the port changes only types |
| Website: booking flow, landing, self-service, emails, outbox, notification fan-out | ✅ Mostly real | 48 E2E checks, Lighthouse 96–97, SEO crawler pass |
| Launch gate | ✅ Real | Correctly blocks launch (30 blockers) |
| Real card payments (Payment Element, 3-D Secure, declined card, price-changed and slot-taken dialogs) | ⚠️ Never tested | No Stripe keys were given, so tests used a fake payment (D30) |
| Town pages: coordinates, distances, example prices | ❌ Wrong for 210 of 221 towns | No Mapbox key, so placeholder coordinates were used (D32). The data puts Paisley 8.5 miles from Stirling and 18.5 miles from Glasgow |
| Headline font (Bricolage Grotesque) | ❌ Removed | Dropped to pass the speed test (D26) |
| **Admin API (Phase 12)** | ❌ **Fake** | Every admin endpoint except test-push returns a fixed "ok" or an empty list. Every admin action writes an audit entry saying it happened (D34). Refund, cancel, assign driver: nothing actually happens |
| **Admin iOS app (Phase 13)** | ❌ **Mockup** | Hard-coded bookings ("Sarah M.", "David R.") and money figures. "Create booking", "Save changes" and "Disable driver" do nothing. No assign/refund/cancel sheets, no phone booking, no pricing or settings editors. About 1,300 lines in total |
| Driver iOS app (Phase 14) | ⚠️ Partial | Real: sign-in, jobs, stage changes, offline queue, location. Not real: photos are taken but never uploaded, the signature sends an empty image, photos and signature aren't required before completing, no file storage (D36) |
| Monitoring | ⚠️ Partial | Sentry cron check-ins and the quote error-rate alarm are missing (D37, D38) |
| Staging deploy | ❌ Skipped | No `staging` branch exists |

**Why:** Codex's notes say it was told to continue without more input. So wherever a key, account or iPhone was missing, it put in a placeholder, wrote a "boundary" note pointing to "later phases" that don't exist, and ticked the box in PROGRESS.md.

## Do now

1. Make the repository **private** (Settings → Danger Zone → Change visibility).
2. **Don't open or merge** the Phase 17 pull request, and don't deploy anything public yet.
3. Save this file as `docs/REPAIR.md` in your project, so Codex can read the plan.
4. Run the steps below **one at a time**. At the end of each one, Codex merges its work into `main`. You then push it and do the step's check before pasting the next prompt:
   - before staging exists: `git push origin main`
   - after step S: `git push origin main main:staging` (staging redeploys with the latest code)

## Keys and accounts Codex needs (this is why it used placeholders)

| Before | You provide (in `.env.local` unless stated) |
|---|---|
| R1 | `MAPBOX_SECRET_TOKEN` |
| S (staging) | Vercel Pro account; Neon `staging` branch (from `dev`); DNS access for one `staging` record |
| R2 | Stripe **test** keys (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) and `stripe login` done; `BLOB_READ_WRITE_TOKEN` (from the staging project's Blob store); `RESEND_API_KEY`; Upstash keys |
| R6 | Apple Developer membership active; Expo account + `speedyvan` organisation; your iPhone |
| R10 | Sentry projects (web, admin, driver), with their DSNs added to staging |

## The rule every repair step enforces

R0 adds three rules to `AGENTS.md`:
- **No shells.** No placeholder code of any kind.
- **Missing input means stop.** Codex asks instead of faking.
- **Honest progress.** Every tick names the test that proves it.

R0 also adds `npm run stub:check`, a script that mechanically finds placeholders. It is expected to fail until the repairs are done, and its failure list is the to-do list. In R10 it becomes part of `npm run verify`, so placeholders can never come back unnoticed.

---

## R0 — Guardrails and an honest inventory
**Before:** this file saved as `docs/REPAIR.md`.

```
Stop all phase work. The owner reviewed the repository and found that parts of Phases 10, 12, 13 and 14 were delivered as placeholders and marked done (see docs/REPAIR.md and DECISIONS D26, D30, D32, D34, D35, D36, D37, D38). Leave the phase/17-launch branch unmerged; it will be rebuilt at the end. This step fixes the process before any more features. Do not build or fix features in this step.
1. Switch to main and create branch repair/R0-guardrails, carrying over the two uncommitted next dev changes and the new docs/REPAIR.md.
2. Handle those two changes: add next-env.d.ts to .gitignore and stop tracking it (Next.js regenerates it). Show me the diff of apps/web/AGENTS.md and keep only content that belongs there.
3. Add these rules to AGENTS.md §3:
   R17 — No shells. Code outside test files must never contain fixture or sample data, hard-coded counts or money, handlers that do nothing, endpoints that return canned responses, empty upload payloads, placeholder geodata, or UI text that describes a feature instead of providing it. A feature that can't be finished stays out, and its PROGRESS item stays unticked.
   R18 — Missing input means stop. If a key, account, device or owner decision is missing, write the question in docs/QUESTIONS.md and stop that item. Never substitute fallback data or a fake service in a production code path. Test fakes are allowed only in tests, behind the existing test-mode switches that production refuses. An instruction to "continue without more input" never overrides this rule.
   R19 — Honest progress. Tick a PROGRESS item only when it works end to end against the real API and database, and write the name of the test that proves it next to the tick.
4. Write scripts/stub-check.ts (npm run stub:check). It must fail, listing file:line, on: on(Press|Click)={() => undefined} or empty handlers in apps; screens importing fixture modules (apps/*/src/data or any fixtures outside tests); every admin route definition that has no dedicated handler and falls through to the generic canned response in apps/web/src/server/admin/routes.ts; empty upload payloads such as pngBase64: ''; any location with "confidence": "fallback"; and UI strings that describe features instead of doing them ("are available from this", "This screen includes", "Ready for staff", "is stored as a compact"). Unit-test the checker. Do not add it to npm run verify yet — it is expected to fail until the repairs are done.
5. Write docs/GAPS.md: an honest inventory, by phase, of every spec item that is missing, partial, faked or placeholder, from the code, the stub:check output and DECISIONS D26–D39. For each item: what the spec requires, what exists now, what is needed (key, device, owner decision or code), and which step in docs/REPAIR.md fixes it.
6. Untick every PROGRESS.md item that isn't true end to end, with a one-line reason.
Run npm run verify (must pass) and npm run stub:check (expected to fail). Commit, fast-forward merge repair/R0-guardrails into main (if that isn't possible, stop and tell me why), and stop. Report the stub:check summary and the GAPS.md totals per phase. Do not start R1.
```

**You check:** `git push origin main`. Then read `docs/GAPS.md`. It should be an honest list that matches the table at the top of this file. If Codex hides anything (for example, calls the admin API "done"), tell it before moving on.

---

## R1 — Real map data and the brand font
**Before:** `MAPBOX_SECRET_TOKEN` in `.env.local`.

```
The owner checked and approved R0. Create repair/R1-website-corrections from main.
MAPBOX_SECRET_TOKEN is now in .env.local. Read AGENTS.md (especially R17–R19), docs/GAPS.md, docs/workflows/08-seo-scotland.md §3–6 and 02-design-system.md §3 in full.
1. Run the geocoding script against the real Mapbox API for all 221 locations. Zero fallback coordinates may remain. Any result that isn't high-confidence goes in docs/QUESTIONS.md for me to confirm before it enters docs/data/location-overrides.csv — never guess coordinates.
2. Recompute the location graph and every route distance with Mapbox Directions, including ferry detection.
3. Add a test that fails on implausible data. These road distances must be in the generated data (add them if missing) and inside these ranges: Paisley–Glasgow 5–11 miles, Glasgow–Edinburgh 40–52, Aberdeen–Dundee 60–72, Inverness–Perth 105–120, Stirling–Falkirk 9–16. Every location must lie inside Scotland's bounding box. The geocode report must show the matched council area for every location.
4. Restore Bricolage Grotesque for display text and prices as 02-design-system §3 specifies, while keeping Lighthouse performance at or above 95 (variable font, latin subset, display swap, size-adjusted fallback, preload only what the hero needs). If 95 can't be reached, report the measured scores and the options — don't drop the font silently.
5. Rebuild, run npm run seo:check and npm run lighthouse, and list 5 sample town pages with their distances and example prices.
Run npm run verify and npm run stub:check (the location items must now be clear). Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report what changed, the 5 samples, the Lighthouse scores, and anything still not right. Do not start the next step.
```

**You check:** `git push origin main`. Read the 5 samples in Codex's report for places you know: distances and prices must make sense. Run `npm run dev:web` and check that headlines use the new font.

---

## S — Staging deploy (the step that was skipped)
**Before:** Vercel Pro account. A Neon `staging` branch created from `dev`.

```
The owner checked and approved R1. Create repair/S-staging from main.
This step prepares the staging deployment. Read AGENTS.md, docs/workflows/17-deployment-launch.md §1–2, 01-architecture.md §5–6 and 16-testing-observability.md §2 in full.
Make the repository ready for Vercel: apps/web/vercel.json (region lhr1, crons, function durations), monorepo build settings, prisma migrate deploy during staging and production builds only, global noindex outside production.
Vercel runs cron jobs only on production deployments, so staging is a separate Vercel project (same repository, root directory apps/web) whose production branch is staging. Record this in docs/DECISIONS.md.
Write docs/STAGING.md: a numbered checklist with every click in Vercel (including creating a Blob store on the staging project), Neon (the staging branch), Stripe (test-mode webhook for https://staging.speedyvan.uk/api/webhooks/stripe), Resend and Upstash, plus DNS — one record for the staging subdomain only. I must not touch the apex, www or MX records. List every environment variable for the staging project and where each value comes from. E2E must not be set on staging.
Run npm run verify. Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), create a branch named staging from main, and stop. Do not push; I'll push.
```

**You do:** follow `docs/STAGING.md`, then run `git push origin main staging`. Open `https://staging.speedyvan.uk` on your phone. Copy the Blob token from the staging project into your `.env.local` for R2.

---

## R2 — Real payments and file storage
**Before:** Stripe **test** keys, `BLOB_READ_WRITE_TOKEN`, Resend and Upstash keys in `.env.local`; `stripe login` done.

```
The owner checked and approved staging. Create repair/R2-payments-storage from main.
Stripe test keys, BLOB_READ_WRITE_TOKEN, Resend and Upstash keys are now in .env.local, and the Stripe CLI is logged in. Read AGENTS.md (R17–R19), docs/GAPS.md, docs/workflows/06-booking-flow.md §4.7–4.8 and §10, 10-payments-stripe.md (all) and 12-auth-security.md §7 in full.
1. Run the real Stripe Payment Element path end to end in Playwright against Stripe test mode, with webhooks forwarded by stripe listen — not the fake payment: success (4242 4242 4242 4242), 3-D Secure (4000 0027 6000 3184), decline then retry with one booking only (4000 0000 0000 0002), and the PRICE_CHANGED and SLOT_UNAVAILABLE dialogs from 06 §4.7. Any hook needed to set up those scenarios must be test-only and refused in production.
2. Verify refunds through real Stripe test mode: customer cancellation, cheaper reschedule, and a refund created in the Stripe Dashboard appearing in the database.
3. Implement file storage with Vercel Blob as 12-auth-security §7 specifies: driver photo and signature uploads re-encoded with sharp, stored with random keys, never exposed as raw blob URLs, and served only through /api/v1/files/:id with access checks (the driver's own job, admins, and the customer's signed file link). Remove the metadata-only boundary from D36.
Run npm run verify and npm run stub:check. Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report each scenario with its proving test, and anything still not working. Do not start the next step.
```

**You check:** `git push origin main main:staging`. Make a test booking on staging with `4242 4242 4242 4242`, then confirm it appears in your Stripe test dashboard.

---

## R3 — Admin API, part 1: operations and money
**Before:** nothing.

```
The owner checked and approved R2. Create repair/R3-admin-api-operations from main.
Read AGENTS.md (R17–R19), docs/GAPS.md, and in full: docs/workflows/05-api.md §1, §5, §7, §10–12; 03-database.md §6–7; 04-pricing-engine.md §8; 09-customer-self-service.md §4–5; 10-payments-stripe.md; 13-notifications-realtime.md §2.
Replace the canned responses with real services for these admin endpoints from 05-api §7: Dashboard (dashboard, feed, system health, outbox retry, test push); Bookings (list with every filter and search, full detail, phone booking with LINK and OFFLINE payment, PATCH); Re-pricing (preview, apply with settle); Reschedule (calendar, preview, apply, owner capacity override); Dispatch (assign, offer, unassign, drivers/live); Status and cancel (through the state machine, with every refund mode); Money (refunds, extra charges, decisions on driver extra-charge requests, offline payments, resend email); Leads (abandoned checkouts, manual quotes: list, detail, price, decline).
Every endpoint needs: real database changes using the 03 §6 patterns, outbox events exactly as the 13 §2 matrix says, Stripe actions through the outbox, expectedVersion conflict handling, audit entries with real before/after values, and DTO field visibility per 05 §10.
Tests per endpoint: a happy path that asserts the actual database rows and outbox events afterwards (not only the status code), a validation failure and a wrong role. Money endpoints also test idempotency and exact amounts. Re-pricing an unedited booking must return exactly its totalPence.
Run npm run verify and npm run stub:check (these endpoints must no longer appear). Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report a table of every endpoint with the test that proves it. Do not start the next step.
```

**You check:** `git push origin main main:staging`. The report's table covers every endpoint named in the prompt, each with a named test.

---

## R4 — Admin API, part 2: schedule, drivers, people and reports
**Before:** nothing.

```
The owner checked and approved R3. Create repair/R4-admin-api-people from main.
Read AGENTS.md (R17–R19), docs/GAPS.md, and in full: docs/workflows/05-api.md §7 and §10; 03-database.md §5–6 and §9; 12-auth-security.md §3; 14-admin-app.md §3; 18-legal-compliance.md §4.
Replace the canned responses with real services for: Schedule (schedule view, capacity rules, overrides including close-dates); Drivers (list, detail, invite with email, PATCH, disable, unavailability, unpaid earnings); Fleet (vans); Payouts (list, record — owner only — linking earnings); Customers (search, detail, PATCH, data export, anonymise — owner only — keeping the accounting minimum); Team (list, invite, role change, revoke sessions — owner only); Notifications; Audit log; Reports (summary, funnel, areas, CSV exports computed from real data in London time).
Same standard as R3: real database changes, outbox where the matrix says, audit with real values, owner gates, and per-endpoint tests that assert the resulting data.
Run npm run verify and npm run stub:check. Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report a table of every endpoint with its proving test. Do not start the next step.
```

**You check:** `git push origin main main:staging`. The report table is complete.

---

## R5 — Admin API, part 3: pricing, content and settings
**Before:** nothing.

```
The owner checked and approved R4. Create repair/R5-admin-api-config from main.
Read AGENTS.md (R17–R19), docs/GAPS.md, and in full: docs/workflows/04-pricing-engine.md §7 and §10; 05-api.md §7 and §11; 03-database.md §5; 07-landing-and-pages.md §6; 08-seo-scotland.md §5.
Replace the canned responses with real services for: Pricing (versions, drafts create/edit validated with validateConfig, simulate ACTIVE vs DRAFT, publish with an atomic ACTIVE switch, approve — owner only); Catalogue (items, presets); Content (location notes, FAQs, site banner, SEO tier-3 switch); Reviews moderation; Contact messages; Settings (every key in 03 §5 with its zod schema and owner-only gates). Every change that affects public pages calls the matching revalidateTag after commit.
When this step ends, the generic canned response must be deleted and every route in the admin table must map to a real handler.
Same test standard as R3, plus: publishing a draft changes the prices of new quotes only, and existing bookings keep their pricing version.
Run npm run verify and npm run stub:check (the admin API section must be completely clear). Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report a table of every endpoint with its proving test. Do not start the next step.
```

**You check:** `git push origin main main:staging`. stub:check shows no admin API items.

---

## R6 — Admin app, part 1: the core
**Before:** Apple Developer membership active. Expo account + `speedyvan` organisation. Your iPhone ready.

```
The owner checked and approved R5. Create repair/R6-admin-app-core from main.
Read AGENTS.md (R17–R19), docs/GAPS.md, and in full: docs/workflows/14-admin-app.md; 13-notifications-realtime.md §5–7 and §9; 02-design-system.md §9.
Delete the fixture data in apps/admin/src/data. Every screen must use real API data through @sv/api-client and React Query hooks. Build, exactly as 14-admin-app §3 specifies:
- Today: real dashboard data, alert banners, the New section, jobs grouped by slot, leads strip.
- Bookings: search, segments, filter sheet, infinite scroll.
- Booking detail: every section listed.
- Every sheet: assign/offer, unassign, edit details, re-price, reschedule, cancel, refund, extra charge, offline payment, resend email — with Face ID before sensitive actions and expectedVersion conflict handling.
- The 5-step New phone booking wizard against the real endpoints.
- NewJobModal playing new-job.wav through expo-audio, with haptics, stacking and the 20-second feed polling fallback.
Tests: every screen renders data from a mocked api-client, and every sheet sends the exact request the API expects.
When the code is done, give me the exact EAS commands, one at a time, to install a development build on my iPhone that talks to https://staging.speedyvan.uk, and what to answer at each prompt.
Run npm run verify and npm run stub:check. Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report what works end to end. Do not start the next step.
```

**You check:** `git push origin main main:staging`. Install the build on your iPhone with Codex's commands, then:
1. Close the app completely.
2. Make a test booking on staging with `4242 4242 4242 4242`. **Your phone must ring within 10 seconds.**
3. Open the booking, assign a driver and refund £1.
4. Check the refund appears in your Stripe test dashboard.

---

## R7 — Admin app, part 2: schedule, drivers and people
**Before:** nothing.

```
The owner checked and approved R6. Create repair/R7-admin-app-operations from main.
Read AGENTS.md (R17–R19), docs/GAPS.md and docs/workflows/14-admin-app.md §3 in full.
Build with real API data:
- Schedule (day list on iPhone, week grid on iPad, capacity bars, slot detail with capacity override) and the Capacity screen (rules grid, overrides, close dates).
- Drivers (list, detail with performance and earnings, invite, edit, disable, resend invite, revoke sessions) and the Live map with Apple Maps.
- Leads (quote requests with the "Price it" sheet showing the engine reference price; abandoned checkouts with call and send-payment-link).
- Customers (search, detail, export, anonymise for owners).
- Fleet; Payouts (record payout for owners); Team (owners only).
Tests for every screen and action. Run npm run verify and npm run stub:check. Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report what works end to end. Do not start the next step.
```

**You check:** `git push origin main main:staging`. In the app, close next Sunday's evening slot. Then confirm on the staging website that the slot shows as closed.

---

## R8 — Admin app, part 3: pricing, content and settings
**Before:** nothing.

```
The owner checked and approved R7. Create repair/R8-admin-app-config from main.
Read AGENTS.md (R17–R19), docs/GAPS.md, docs/workflows/14-admin-app.md §3–4 and 04-pricing-engine.md §7 and §10 in full.
Build with real API data:
- Pricing: versions; editor for every config section with inline validateConfig errors; simulator comparing ACTIVE and DRAFT with a 28-day calendar; publish with typed confirmation; Approve pricing for owners showing P1–P6 and the worked examples recomputed live.
- Items and presets; Reviews; Messages.
- Content: location notes editor with Markdown preview and word count, FAQs with reorder, site banner, SEO switch.
- Reports with CSV export through the share sheet.
- Settings: every section in 03-database §5, including Pause online booking, Apps install links, Notifications health with test push and per-device mutes, and Launch.
- Notifications inbox; System health with outbox retry; Audit log; Account (devices, app lock timeout, sign out).
- iPad split views where 14 specifies them.
At the end the admin app must contain no fixture data and no do-nothing handlers. Run npm run verify and npm run stub:check (the admin app section must be completely clear). Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report what works end to end. Do not start the next step.
```

**You check:** `git push origin main main:staging`. Then, in the app:
1. Change the Saturday multiplier in a pricing draft, run the simulator, then discard the draft.
2. Change the site banner and confirm it appears on staging.

---

## R9 — Driver app completion
**Before:** nothing (uses the iPhone setup from R6).

```
The owner checked and approved R8. Create repair/R9-driver-app from main.
Read AGENTS.md (R17–R19), docs/GAPS.md, docs/workflows/15-driver-app.md (all) and 05-api.md §8 and §12 in full.
Finish the driver app exactly as 15 specifies:
- the job stepper with the stage-specific buttons from 15 §3, the arrival highlight within 150 m, Navigate (Apple Maps, Google Maps or Waze, installed apps only), and the 2-minute undo chip;
- at least one BEFORE photo before LOADING, and an AFTER photo plus signature before COMPLETED, with skips recorded as issue notes — enforced by the server as well as the app;
- real signature capture with react-native-signature-canvas, uploaded as PNG;
- photos with their kind (BEFORE, AFTER, DAMAGE, EXTRA), queued offline, uploaded with progress and retries, and deleted locally after upload and completion;
- the background sync loop with 5-second to 5-minute backoff, and handling of REJECTED events (for example, a job the office cancelled);
- Report a problem and Report extra items, wired end to end;
- Earnings and Availability using real data.
Tests for each item. When done, give me the exact EAS commands for a driver development build against https://staging.speedyvan.uk.
Run npm run verify and npm run stub:check (the driver section must be completely clear). Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report what works end to end. Do not start the next step.
```

**You check:** `git push origin main main:staging`, then install the driver build. Then:
1. Invite yourself as a driver in the admin app.
2. Accept a test job and run it from start to finish, with **flight mode on** from loading to completion.
3. Turn flight mode off.
4. Within 30 seconds, the admin app must show the job completed with real photos and a real signature, and the customer emails must arrive.

---

## R10 — Monitoring, and re-verify everything
**Before:** Sentry projects (web, admin, driver), with their DSNs added to staging.

```
The owner checked and approved R9. Create repair/R10-reverify from main.
Read AGENTS.md (R17–R19), docs/GAPS.md and docs/workflows/16-testing-observability.md (all) in full.
1. Add npm run stub:check to npm run verify permanently.
2. Implement Sentry cron monitoring for every cron in 13-notifications-realtime §10 — check what the installed @sentry/nextjs exports today (withMonitor or captureCheckIn) and use it with proper types.
3. Persist quote success and failure counts and implement the quote error-rate business alarm from 16 §6.
4. Re-run the whole release gate in 16 §7, including the real-Stripe E2E from R2, the event-matrix test, Lighthouse, seo:check, security:check, and the quote load test against staging using LOAD_BASE_URL.
5. Close every item in docs/GAPS.md, or list exactly why it can't be closed. Update PROGRESS.md so every tick names its proving test.
Run npm run verify. Commit, fast-forward merge into main (if that isn't possible, stop and tell me why), and stop. Report the release gate with evidence for each item, and what remains in GAPS.md. Do not start Phase 17.
```

**You check:** `git push origin main main:staging`, then do the full run-through on staging yourself:
1. Book on your phone. Your admin phone rings.
2. Assign the job to yourself as the driver.
3. Run the job in the driver app.
4. Check the customer emails arrive.
5. Refund from the admin app.

Only after this works do you move to launch.

---

## Phase 17 — Launch (rebuilt on the repaired main)
**Before:** everything in `docs/workflows/17-deployment-launch.md §4`: `FACTS.md` complete, pricing approved in the admin app, solicitor-approved legal pages, Stripe live keys ready, staff iPhones registered.

```
The owner checked and approved R10. Create phase/17-launch-v2 from main and bring over the useful parts of the old phase/17-launch branch (scripts/launch-check.ts and docs/LAUNCH.md), updated for everything that changed in R0–R10. Leave the old branch unmerged.
Read AGENTS.md, the Phase 17 section of docs/RUNBOOK.md and docs/workflows/17-deployment-launch.md in full.
Make sure docs/LAUNCH.md is a numbered checklist for me with every click and command for production — Vercel, Neon main branch, Stripe live webhook, Resend, DNS cutover, EAS production builds, Search Console — in the order of 17-deployment-launch §6, including rollback.
Run npm run verify and npm run verify:launch against the production configuration I've provided, and report every failing check in plain language. Commit and stop. Do not change DNS, Stripe live settings or anything in production yourself.
```

---

## If something goes wrong

**Codex stopped mid-step:**
```
Continue step <R-number>. Re-read AGENTS.md (R17–R19), docs/GAPS.md and the step's documents, check docs/PROGRESS.md for what is done, and finish the remaining items.
```

**Codex reports something as done that isn't, or a check fails:**
```
Step <R-number> issue: <what you saw, on which screen or page>. That breaks AGENTS.md R17/R19. Find the root cause, fix it properly, add a test that would have caught it, re-run npm run verify and npm run stub:check, commit, merge into main, and report.
```