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

_(none currently)_

## Resolved

### Q3 — Missing D1 hero reference files   (Repair D1, 2026-10-13)
**Blocking:** resolved by owner — D1 landing hero/header/map implementation can resume once the D1 branch is created and the reference files are present there.
**Context:** The D1 repair prompt requires `docs/design/hero-reference/` with `README.md`, `index.html`, `screenshots/`, `data/scotland-map.json` and `scripts/`, and says to match it exactly. That directory was absent when first checked.
**Options:** A) Add the complete `docs/design/hero-reference/` directory to this branch and tell Codex to resume D1. B) Point Codex at the branch/commit/archive that contains the reference so the exact files can be restored. Recommendation was A.
**Owner answer:** Owner says `docs/design/hero-reference/` is now in the project and instructed Codex to resume D1.
**Resolved:** 2026-10-13, D1 branch verification pending.

### Q2 — Missing Mapbox token for R1 geocoding   (Repair R1, 2026-10-13)
**Blocking:** resolved — real Mapbox geocoding and Mapbox Directions regeneration completed.
**Context:** The owner said `MAPBOX_SECRET_TOKEN` is in `.env.local`, but the local `.env.local` initially contained only the `DATABASE_URL` key, and the process environment did not contain `MAPBOX_SECRET_TOKEN`. I checked key names only and did not print any secret value. AGENTS R18 forbids substituting fallback data or fake services in a production data path.
**Options:** A) Add `MAPBOX_SECRET_TOKEN` to `c:\speedy van\speedyvan\.env.local` and rerun R1 geocoding/directions. B) Export `MAPBOX_SECRET_TOKEN` into the Codex process environment and rerun. Recommendation was A.
**Owner answer:** Owner added the token to `.env.local`.
**Resolved:** 2026-10-13, resolved by R1 data regeneration; commit pending.

### Q1 — Missing local Phase 4 env vars   (Phase 4, 2026-10-12)
**Blocking:** resolved for Phase 4 verification — local migration can derive the Neon direct hostname from the pooled Neon hostname and apply migrations through Neon HTTP; CI passes `DATABASE_URL_UNPOOLED`, `SEED_OWNER_EMAIL`, and `SEED_OWNER_NAME` explicitly.
**Context:** The `.env.local` visible to Codex still contains `DATABASE_URL` only. I checked only key names and did not print any values. To continue without owner input, local seed now skips only the OWNER row when the two seed-owner keys are absent; CI still creates it from secrets.
**Options:** A) Add the three missing keys to `.env.local` and rerun Phase 4 verification. B) Tell Codex the values through a secure local edit outside Git. Recommendation was A.
**Owner answer:** Owner said the missing keys and matching GitHub secrets were added, and instructed Codex to continue without further help.
**Resolved:** 2026-10-12, resolved in code/docs for Phase 4 continuation; commit pending.
