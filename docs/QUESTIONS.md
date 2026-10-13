# QUESTIONS — things Codex needs the owner to decide

Codex adds a question here instead of guessing about money, prices, legal text, business facts or security, then carries on with unblocked work. The owner answers inline; Codex applies the answer and marks it resolved.

## Template

```
### Q<number> — <short title>   (Phase <N>, <date>)
**Blocking:** yes/no — what is blocked
**Context:** what Codex found and why it matters
**Options:** A) … B) … (with Codex's recommendation and why)
**Owner answer:**
**Resolved:** <date, commit>
```

## Open

### Q2 — Production launch prerequisites   (Phase 17, 2026-10-13)
**Blocking:** yes — production launch, `npm run verify:launch` green status, live smoke test, DNS/Search Console cutover, and 14-day watch start are blocked by external owner-controlled production setup.
**Context:** Phase 17 requires production live secrets, solicitor approval, complete owner facts, approved active pricing, at least one active OWNER, at least one enabled OWNER/ADMIN push device, Resend/Stripe/Mapbox/Upstash/Sentry/Vercel production configuration, and a live booking/refund smoke test on the owner's own card. This workspace only has a dev database connection and no production live credentials or physical iPhones.
**Options:** A) Owner completes the Phase 17 checklist in `docs/LAUNCH.md` / `docs/workflows/17-deployment-launch.md`, pulls production env into a temporary local file or runs `npm run verify:launch` in Vercel/CI, then shares the pass/fail summary. B) Keep the project pre-launch with the new launch gate committed and rerun after production setup. Recommendation: A when ready to cut over.
**Owner answer:**
**Resolved:**

## Resolved

### Q1 — Missing local Phase 4 env vars   (Phase 4, 2026-10-12)
**Blocking:** resolved for Phase 4 verification — local migration can derive the Neon direct hostname from the pooled Neon hostname and apply migrations through Neon HTTP; CI passes `DATABASE_URL_UNPOOLED`, `SEED_OWNER_EMAIL`, and `SEED_OWNER_NAME` explicitly.
**Context:** The `.env.local` visible to Codex still contains `DATABASE_URL` only. I checked only key names and did not print any values. To continue without owner input, local seed now skips only the OWNER row when the two seed-owner keys are absent; CI still creates it from secrets.
**Options:** A) Add the three missing keys to `.env.local` and rerun Phase 4 verification. B) Tell Codex the values through a secure local edit outside Git. Recommendation was A.
**Owner answer:** Owner said the missing keys and matching GitHub secrets were added, and instructed Codex to continue without further help.
**Resolved:** 2026-10-12, resolved in code/docs for Phase 4 continuation; commit pending.
