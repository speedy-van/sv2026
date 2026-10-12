# Speedy Van — build pack for Codex

This folder is the complete specification for the new Speedy Van platform. It contains **no code** yet. Codex builds everything from these documents, one phase at a time, while you check each phase before it moves on.

Nothing in here comes from the old project. The pricing engine follows the specification you wrote; everything else is new.

## What gets built

| Product | What it is | Where it runs |
|---|---|---|
| Website + booking | Landing page, instant fixed prices, 28-day price calendar, Stripe checkout, customer self-service, SEO pages for every Scottish city and ~210 towns | Next.js on Vercel (`apps/web`) |
| API | One backend for all three products | Inside `apps/web` (`/api/v1/...`) |
| Admin iOS app | Runs the whole business: bookings, dispatch, pricing, drivers, content, reports. Loud push alert + full-screen pop-up for every new job | Expo / React Native (`apps/admin`) |
| Driver iOS app | Jobs, navigation, step-by-step job flow, photos, signature, live tracking, earnings. Works offline in the Highlands | Expo / React Native (`apps/driver`) |

Services: **Vercel** (hosting), **Neon** (Postgres), **Stripe** (payments), **Mapbox** (addresses, distances), **Resend** (email), plus four you'll need that weren't on your list: **Expo EAS** (builds the iPhone apps and delivers push notifications), **Apple Developer Program** (required for any iPhone app), **Sentry** (error alerts), **Upstash Redis** (rate limiting so nobody can run up your Mapbox bill). Reasons are in `docs/DECISIONS.md`.

## How to run it

1. **Do the owner checklist** in `docs/RUNBOOK.md` → *Phase 0*. Accounts, API keys, and `docs/FACTS.md` (your phone, email, company number, insurance details). Codex is not allowed to invent any of these.
2. **Open this folder in Codex** and give it the prompt for Phase 1 from `docs/RUNBOOK.md`. Copy it exactly.
3. When Codex finishes a phase, it stops and reports. Check the "You check" list for that phase, then paste the next prompt.
4. Keep going until Phase 17 (launch).

Codex needs internet access to install packages. If installs fail with network errors, enable network access for Codex's sandbox in its settings, or approve the commands when it asks.

## Files

```
AGENTS.md                 Codex's standing orders (loaded automatically every session)
docs/RUNBOOK.md           The phases, and the exact prompt to paste for each one
docs/FACTS.md             Your business facts — fill this in before Phase 4
docs/DECISIONS.md         Every technical decision and why
docs/PROGRESS.md          Checklist Codex ticks as it works (your progress view)
docs/QUESTIONS.md         Where Codex writes questions it needs you to answer
docs/workflows/01–18      The full specification, by area
docs/reference/           Tested pricing engine, validated database schema
docs/data/                Scotland locations, items catalogue, room presets
```

## Three things to do before anything else

1. **Upcoming bookings on the old system.** Every customer who has already paid for a future move must still be moved. Nothing carries over automatically, so list them and handle them by hand (or re-enter them through the new Admin app once it exists, using *New phone booking*).
2. **Don't delete the old site until the new one has run cleanly for two weeks.** Keep it paused, not deleted, so you have a fallback.
3. **Fill in `docs/FACTS.md`.** The site cannot launch with blanks; the launch check will refuse.

## What nobody can promise you

No developer can guarantee position one on Google. What this build does guarantee is everything Google measures that is in our control: very fast pages, correct structured data, genuinely useful pages for every town (with real computed prices and distances, not copy-pasted text), clean redirects, and zero booking glitches. The rest comes from your Google Business Profile, real customer reviews, and time. `docs/workflows/08-seo-scotland.md` has your part of that work.
