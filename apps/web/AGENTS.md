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
