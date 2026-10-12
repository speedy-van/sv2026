# 12 — Authentication & security

## 1. What we protect

Customer personal data (names, addresses, phones), payments and refunds, admin control of the business, price integrity, and the Mapbox/Stripe/Resend accounts (abuse costs money). Attackers to assume: bots hammering public endpoints, someone with a stolen staff phone, a curious driver, a customer guessing other booking references.

## 2. Staff sign-in (admin and driver apps)

**Email one-time code**
1. `POST /auth/otp/request { email, app }` → always 202. If an INVITED/ACTIVE user exists with a role valid for that app (admin app: OWNER/ADMIN; driver app: DRIVER), generate a 6-digit code with `crypto.randomInt(0, 1_000_000)` (zero-padded), store `sha256(email + ':' + code + ':' + OTP_PEPPER)`, expiry 10 minutes, and enqueue `staff-login-code`. Previous unused codes for that email+app are invalidated.
2. `POST /auth/otp/verify` → compare hashes with `crypto.timingSafeEqual`; max 5 attempts per code; after 10 failures per email per hour → locked for 15 minutes (same generic error). Success: consume code, INVITED → ACTIVE, create `Session`, return tokens.

**Tokens**
- Access token: JWT HS256 (`jose`), 15 minutes, claims `{ sub, role, sid, app, ver: 1 }`. Verified on every request; the session (`sid`) must not be revoked (cached 60 s per instance).
- Refresh token: 32 random bytes, base64url; stored only as sha256 in `Session.refreshTokenHash`; 30-day sliding expiry, 90-day absolute maximum.
- Rotation: every `/auth/refresh` issues a new pair; the old hash moves to `previousRefreshTokenHash`. Presenting a previous token again = theft → revoke the session and its push devices, alert the user by push/email.
- Device binding: refresh requires the same `deviceId` the session was created with.
- `@sv/api-client` refreshes once on 401 (single in-flight refresh shared by concurrent requests), then retries; a second 401 signs out.

**On the phone**
- Tokens in `expo-secure-store` (`keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Never AsyncStorage, never logs.
- App lock: Face ID / passcode (`expo-local-authentication`) on launch and after 5 minutes in background. Sensitive admin actions (refunds, offline payments, pricing publish/approve, team changes, anonymise) prompt Face ID again before sending.
- Sessions screen lists devices; any session can be revoked; OWNER can revoke any user's sessions (lost phone).
- Minimum app version gate (`426 APP_UPDATE_REQUIRED` → full-screen "Update required" with the install link).

## 3. Roles and permissions

| Capability | OWNER | ADMIN | DRIVER |
|---|---|---|---|
| View/search all bookings, customers | ✓ | ✓ | — |
| Own assigned jobs | ✓ | ✓ | ✓ |
| Phone bookings with payment link | ✓ | ✓ | — |
| Record offline payment | ✓ | — | — |
| Refunds, cancellations, re-pricing, reschedules | ✓ | ✓ | — |
| Override capacity | ✓ | — | — |
| Pricing drafts, simulator, publish | ✓ | ✓ | — |
| Approve pricing | ✓ | — | — |
| Settings: company, cancellation, drivers, legal, launch | ✓ | — | — |
| Other settings, content, FAQs, reviews, items | ✓ | ✓ | — |
| Drivers and vans | ✓ | ✓ | — |
| Record payouts | ✓ | — | — |
| Team (invite, roles, revoke) | ✓ | — | — |
| Anonymise customer | ✓ | — | — |
| Reports, exports, audit log | ✓ | ✓ | — |

Enforced server-side by `withApi({ auth: { roles: [...] } })` plus ownership checks in services (a driver can only touch bookings where `driverId = sub`, or offers addressed to them). The apps hide what a role can't do, but the server is the authority. Tests: every admin route × {anonymous, DRIVER} → 401/403; every driver route with another driver's job → 404.

## 4. Customer links

Signed, purpose-bound, expiring tokens (09-customer-self-service §1). Booking references are not secrets — knowing one never grants access without the matching email link. Lookups by reference + email always return the same response.

## 5. Rate limits (Upstash sliding windows; key = hashed IP via `ipAddress()` from `@vercel/functions`, or user/email where stated)

| Endpoint | Limit |
|---|---|
| `POST /address/suggest` | 60/min and 600/hour per IP |
| `POST /address/retrieve`, `GET /address/postcode/*` | 30/min per IP |
| `POST /quotes` | 10/min and 60/hour per IP |
| `GET /maps/static` | 60/min per IP |
| `POST /bookings` | 10/min per IP |
| `POST /quotes/:id/manual-request`, `POST /contact` | 5/hour per IP |
| `POST /manage/request-link` | 5/hour per IP and 3/hour per email |
| `POST /reviews` | 10/hour per IP |
| `POST /auth/otp/request` | 10/hour per IP and 5/hour per email |
| `POST /auth/otp/verify` | 10/hour per email (then 15-min lock) |
| `POST /auth/refresh` | 60/hour per session |
| `POST /driver/location` | 240/hour per user |
| Other staff endpoints | 300/min per user |

If Upstash is unreachable: fall back to a per-instance in-memory limiter (same limits), report to Sentry, never fail the request because of the limiter.

## 6. HTTP headers

All responses (via `next.config.ts` `headers()`):
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (add `preload` only after confirming every subdomain serves HTTPS)
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")`
- Content-Security-Policy (static pages; no nonce so pages stay static): `default-src 'self'; script-src 'self' 'unsafe-inline' https://js.stripe.com https://www.googletagmanager.com; frame-src https://js.stripe.com https://hooks.stripe.com; connect-src 'self' https://api.stripe.com https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com; img-src 'self' data: blob: https://*.stripe.com https://www.googletagmanager.com https://*.google-analytics.com; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`. Add Google Ads hosts only when the Ads ID is configured. Verify every directive against current Stripe and Google tag documentation and test the payment flow and consent flow with the CSP enabled.
- Dynamic customer pages (`/manage`, `/pay`, `/track`, `/review`): stricter nonce-based CSP set in middleware (these pages are dynamic anyway).
- Sentry uses its Next.js `tunnelRoute` so error reports go through our domain.

## 7. Data handling

- **Validation:** zod at every boundary; reject unknown keys on mutations (`.strict()`).
- **Output:** React escapes by default. Admin-written Markdown (local notes, FAQs, guides) renders with a renderer that disallows raw HTML; links get `rel="nofollow noopener"` when external.
- **Uploads:** photos ≤ 4 MB, signatures ≤ 300 KB; verify type by magic bytes (JPEG/PNG only); re-encode server-side with `sharp` to strip metadata (the apps also strip EXIF before upload — GPS must never leak); random storage keys; served only through `/api/v1/files/:id` after an access check.
- **Logs:** structured JSON; redact email, phone, address lines, tokens, `Authorization`, cookies; never log request bodies for `/bookings`, `/manage`, `/auth`, `/pay`. Sentry `beforeSend` scrubs the same fields; `sendDefaultPii: false`.
- **Secrets:** Vercel encrypted env per environment; apps contain no secrets (`EXPO_PUBLIC_*` only for public values); rotate `JWT_ACCESS_SECRET`, `CUSTOMER_LINK_SECRET`, `OTP_PEPPER` yearly with a dual-key verification window.
- **IPs:** stored only as `sha256(ip + IP_HASH_SALT)`.

## 8. Security checklist (Phase 16 gate — every item verified, evidence in PR)

- [ ] Every route has an explicit `auth` setting in `withApi`; a test lists all routes and fails if any lacks one.
- [ ] Role/ownership tests pass for all admin and driver routes.
- [ ] Rate limits active on every public mutation (integration test hits each limit).
- [ ] Stripe webhook rejects unsigned/forged payloads; replay is a no-op.
- [ ] Cron routes reject requests without `CRON_SECRET`.
- [ ] No secret in client bundles (`next build` output scanned for key prefixes `sk_`, `rk_`, `whsec_`, Mapbox `sk.`).
- [ ] Headers/CSP present (test with `curl -I` on home, `/book`, `/manage`).
- [ ] Uploads reject non-images and oversize files; EXIF stripped (test fixture with GPS EXIF).
- [ ] `npm audit --omit=dev` has no high/critical issues; Dependabot enabled; GitHub Actions pinned to commit SHAs.
- [ ] OTP brute-force lockout and refresh-token reuse revocation tested.
- [ ] Customer DTOs never include admin-only fields (tests per 05-api §10).
- [ ] Preview deployments are `noindex` and use test Stripe keys.

## 9. Incidents

Phase 16 creates `docs/INCIDENTS.md`: who to call, how to revoke all staff sessions, rotate secrets, pause bookings (Settings → Operations → "Pause online booking" = `operations.bookingPaused`: shows a banner and disables "See my prices"), restore the database (03 §10), and contact Stripe/Resend/Mapbox support.
