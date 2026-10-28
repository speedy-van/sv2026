# apps/web

Build the Speedy Van website and API here.

Primary workflow docs:
- `docs/workflows/02-design-system.md`
- `docs/workflows/05-api.md`
- `docs/workflows/06-booking-flow.md`
- `docs/workflows/07-landing-and-pages.md`
- `docs/workflows/08-seo-scotland.md`
- `docs/workflows/09-customer-self-service.md`
- `docs/workflows/10-payments-stripe.md`
- `docs/workflows/12-auth-security.md`
- `docs/workflows/16-testing-observability.md`
- `docs/workflows/18-legal-compliance.md`

Rules:
- Keep public UI copy in `src/content`.
- Keep server-only code in `src/server` and import `server-only`.
- Do not compute prices in this app; call `@sv/pricing` through server services only.
- Do not expose secrets through `NEXT_PUBLIC_*`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
