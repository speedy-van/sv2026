# 08 — SEO: every city and town in Scotland

## 1. Reality check (read this, owner)

Nobody can guarantee the top of Google. Rankings for "removals Glasgow" or "man and van Edinburgh" depend on three things:

| Factor | Who | What this build does |
|---|---|---|
| Technical quality (speed, structure, crawlability, structured data) | Codex | Perfect by spec and enforced in CI (§9, §11) |
| Relevance and usefulness of each page | Codex + owner | Every location page carries real computed prices, real road distances and local guidance (§4); the owner reviews local notes |
| Trust signals (Google Business Profile, reviews, links, citations, time) | **Owner** | §10 is your checklist — this is where local rankings are mostly won |

The old site's glitches hurt because Google measures failed visits and slow pages. This build's job is zero glitches and very fast pages; your job is §10.

## 2. URL architecture (hub and spoke)

```
/                                   home (Scotland-wide)
/services/{service}                 10 service pages
/areas                              Scotland hub: every region and all 221 towns (also the HTML sitemap)
/areas/{region}                     12 region hubs (e.g. /areas/lanarkshire)
/removals/{town}                    221 town and city pages (e.g. /removals/paisley)
/man-and-van/{city}                 8 city pages for "man and van {city}" searches
/removals/{from}-to-{to}            26 route pages (docs/data/routes.csv)
/guides/{slug}                      articles
```

Rules: lower-case, hyphenated, no trailing slash, no query strings in canonicals. Primary host from `web.canonicalOrigin` (default `https://www.speedyvan.uk`); the apex redirects to it (Vercel domain setting, permanent). Every page is reachable within 3 clicks of the home page; `/areas` links every town.

**Data:** `docs/data/scotland-locations.csv` (221 locations, all 32 council areas, 12 regions; columns: slug, name, council_area, region, postcode_area, tier, island, ferry) and `docs/data/routes.csv` (26 directed routes). Tier 1 = the 8 cities; tier 2 = 51 large towns; tier 3 = 162 towns.

## 3. Data pipeline (Phase 10)

| Script | Does | Output (committed) |
|---|---|---|
| `scripts/geocode-locations.ts` | Mapbox Geocoding for `"{name}, {council_area}, Scotland"`, `country=gb`, bbox for Scotland, `types=place,locality`. Picks the best match whose context includes the council area; records confidence; **fails** on any low-confidence or out-of-bbox result and lists it for manual fix in `docs/data/location-overrides.csv` (slug, lat, lng). | `apps/web/src/content/locations/locations.generated.json` + `geocode-report.md` |
| `scripts/compute-location-graph.ts` | For each location: 8 nearest locations (haversine), nearest 3 tier-1 cities, region hub city. | merged into `locations.generated.json` |
| `scripts/compute-route-distances.ts` | Mapbox Directions (driving) for: each location → its nearest 3 cities; each route in `routes.csv`. Records miles (2 dp), minutes, and `ferry: boolean` from step modes. Retries, 5 req/s, resumable cache file. | `apps/web/src/content/locations/distances.generated.json` |

Prices are **not** baked in. Pages compute example prices at render/ISR time with `@sv/pricing`, the ACTIVE config and the committed distances, so a pricing publish updates every page (tag `pricing`) and daily revalidation keeps "cheapest available" honest.

## 4. Page templates

### 4.1 Town page `/removals/{town}`

| Block | Content | Data |
|---|---|---|
| Title tag | "Removals & Man and Van in {Town} \| Speedy Van" (≤ 60 chars; drop "& Man and Van" if too long) | |
| Meta description | "Fixed-price removals and man and van in {Town}. See prices for the next 4 weeks and book online. {Town} to {nearest city} from £{price}." (≤ 155) | computed |
| H1 | "Removals and man and van in {Town}" | |
| Lead | "Fixed-price moves to, from and around {Town} and the rest of {Council}." | |
| Booking card | Pickup search biased to the town's coordinates | |
| Example prices | Table: (a) Small move within {Town} — man and van, 1 armchair + 5 medium boxes, 3 miles; (b) 1-bedroom flat {Town} → {nearest city} — real road distance; (c) 2-bedroom home {Town} → {second city} — real distance. Each: cheapest **available** slot in the next 28 days, ground floors, no extras. Caption with assumptions and "updated {date}". Island/ferry towns: replace with "Moves to and from {Town} include a ferry crossing, so our team prices them individually." + manual quote CTA. | engine + distances |
| Distances | "{Town} to {City}: {miles} miles, about {h} hr {m} min by road" for the nearest 3 cities | distances |
| Moving in {Town} | Published `LocationContent.localNotes` (owner/admin-written). Hidden if none. | DB |
| Practical notes (conditional, data-driven) | Ferry YES/CHECK note; tier-1 tenement guidance (from the city's notes); postcode-area line "{Town} is in the {postcode_area} postcode area" | CSV |
| Nearby | Links to the 8 nearest towns + region hub + "All areas" | graph |
| Services | Links to all 10 services | |
| FAQs (3) | "How much does a man and van cost in {Town}?" (answers with example (a) and how prices vary) · "Do you cover {Town}?" ("Yes — {Town} and all of {Council}." / island variant) · "How far is {Town} from {City}?" | computed |
| JSON-LD | `BreadcrumbList` (Home › Areas › {Region} › {Town}), `Service` (`serviceType: "Removals"`, `provider` → organisation `@id`, `areaServed`: `{ "@type": "City", "name": "{Town}", "containedInPlace": { "@type": "AdministrativeArea", "name": "{Council}" } }`), `FAQPage` | |

### 4.2 City man-and-van page `/man-and-van/{city}` (8)

H1 "Man and van in {City}". Booking card with **Man and van** pre-selected. Example prices: single sofa across the city (5 miles), studio flat move (8 miles), marketplace pickup (1 item, 3 miles) — all computed. What man and van is good for (from `content/services.ts`), city local notes, nearby towns, 4 FAQs, JSON-LD (`Service` with `serviceType: "Man and van"`). Links to `/removals/{city}` and vice versa with distinct anchor text ("House removals in {City}" / "Man and van in {City}").

### 4.3 Route page `/removals/{from}-to-{to}` (26)

H1 "{From} to {To} removals". Facts: distance and drive time (real), example prices for 3 move sizes (man and van small move, 1-bedroom flat, 3-bedroom house), "Weekday afternoons are usually the cheapest time" (true by config; generated from multipliers). **Arrival guidance is about the destination** (from the destination city's notes) — this keeps A→B and B→A pages genuinely different. Links: the reverse route, other routes from {From}, both city pages. JSON-LD: `BreadcrumbList`, `Service` with `areaServed` both cities.

### 4.4 Region hub `/areas/{region}` (12)

H1 "Removals across {Region name}". Intro naming the council areas covered. All towns in the region grouped by council area (links). Example price for a typical move between the region's two largest places. Island/ferry explanation where relevant. JSON-LD `BreadcrumbList`, `ItemList` of town pages.

Region display names: Glasgow and Clyde · Lanarkshire · Edinburgh and the Lothians · Forth Valley · Fife · Tayside · North East (Aberdeen, Aberdeenshire and Moray) · Highlands · Argyll and Bute · Ayrshire and Arran · South of Scotland (Dumfries and Galloway, Scottish Borders) · Islands (Orkney, Shetland, Western Isles).

### 4.5 Scotland hub `/areas`

H1 "Areas we cover". Short explanation (instant prices on the mainland; ferry routes quoted individually), the 8 cities prominently, then every region with all of its towns A–Z. Search box (client-side filter) for "Find your town".

## 5. Indexing policy (anti-doorway, staged)

Google's spam policies target mass-produced, near-identical location pages. Our pages are different by data, but we still roll out carefully:

| Pages | At launch | Later |
|---|---|---|
| Home, services, pricing, guides, `/areas`, regions, routes, city man-and-van | index | — |
| Tier 1 and tier 2 town pages (59) | index | — |
| Tier 3 town pages (162) | `noindex, follow` (still linked, still useful to visitors) | Owner flips `seo.indexTier3` in Admin → Content → SEO after ~4–8 weeks of healthy Search Console indexing; any tier-3 page with ≥ 120 words of published local notes is indexed immediately |

Controlled by setting `seo.indexTier3` (03-database §5; Admin → Content → SEO). Sitemaps list only indexable URLs.

## 6. Example price rules (shared by town, route, city, home S7)

- Engine: `computeQuote` with ACTIVE config, `today = londonToday()`, the committed distance, ground floors at both ends, no access charges or extras, listed profile items (catalogue volumes).
- Value shown: cheapest **available** slot (capacity-aware) → `"from £{whole pounds, rounded up}"`.
- Caption always states the profile and the update date. ISR revalidate: 24 h + tag `pricing`.
- If no slot is available in 28 days for a profile: show "Fully booked for the next 4 weeks — call us" instead of a price.

## 7. On-page rules (all pages)

- Metadata via Next.js `generateMetadata`: unique title (≤ 60 chars) and description (≤ 155), `alternates.canonical` (absolute), Open Graph + Twitter card, `robots` per §5.
- One H1; logical H2/H3; first paragraph says plainly what the page offers and where.
- Internal links: breadcrumbs on every page except home; contextual links with descriptive anchors (never "click here").
- OG images: generated per page with `next/og` (`opengraph-image.tsx` per route segment): ink background, Bricolage headline "{Town} removals", gorse van glyph, `speedyvan.uk`. 1200×630, < 100 KB.
- `html lang="en-GB"`. No hreflang needed (one language, one country).
- Images (when the owner adds photos): `next/image`, descriptive alt, AVIF/WebP, explicit sizes.

## 8. Structured data (JSON-LD, one `@graph` per page, validated in tests)

**Home and every page (in root layout):**

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "MovingCompany",
      "@id": "{origin}/#business",
      "name": "Speedy Van",
      "legalName": "{company.legalName}",
      "url": "{origin}",
      "logo": "{origin}/brand/logo-512.png",
      "telephone": "{contact.phoneE164}",
      "email": "{contact.emailPublic}",
      "address": { "@type": "PostalAddress", "streetAddress": "…", "addressLocality": "…", "postalCode": "…", "addressCountry": "GB" },
      "areaServed": { "@type": "AdministrativeArea", "name": "Scotland" },
      "sameAs": ["{socials…}", "{googleBusinessProfileUrl}"]
    },
    { "@type": "WebSite", "@id": "{origin}/#website", "url": "{origin}", "name": "Speedy Van", "publisher": { "@id": "{origin}/#business" } }
  ]
}
```

Address = registered office parsed into parts (owner confirms in Settings). Omit any property whose setting is null. Page-level graphs add `BreadcrumbList`, `Service`, `FAQPage` (only questions visible on the page), `Article` (guides), `ItemList` (hubs). **Never** `AggregateRating`/`Review` markup about ourselves, never `Offer` prices that could go stale.

## 9. Technical SEO

| Item | Spec |
|---|---|
| Rendering | All public pages static/ISR (01-architecture §8); HTML contains all content without client JS |
| Sitemaps | `app/sitemap.ts` with `generateSitemaps`: core, services, areas+regions, towns (indexable only), routes+cities, guides. A `/sitemap.xml` index route lists them (verify current Next.js behaviour; if it doesn't generate an index, add a route handler that does). `lastModified` = real content/pricing timestamps |
| robots | `app/robots.ts`: allow all; disallow `/api/`, `/book/confirmation`, `/manage`, `/track/`, `/pay/`, `/review/`, `/quote/`, `/styleguide`; list sitemaps |
| noindex | `/book/confirmation`, `/manage*`, `/track/*`, `/pay/*`, `/review/*`, `/quote/*`, previews (`VERCEL_ENV !== 'production'` → global `noindex` header) |
| Status codes | Unknown slugs → real 404 (`notFound()`); removed pages → 301 to the closest equivalent |
| Redirects | `apps/web/src/content/redirects.ts` → `next.config.ts` `redirects()` (permanent). More than 500 entries → middleware lookup from JSON |
| Performance | Budgets in AGENTS R9, enforced by Lighthouse CI on home, one service, one town, one route page |
| Headers | `x-robots-tag` for non-production; security headers (12-auth-security §6) |
| Crawl hygiene | No faceted URLs; booking steps use `?step=` but the canonical is `/book`; no infinite calendars in HTML |

**Old URLs:** this build takes nothing from the old project. If you want to keep rankings the old pages earned, export the indexed-page list from **Google Search Console → Pages** (that's Google's data about your domain, not the old code) and give it to Codex in Phase 17 to map each URL to its closest new page with a 301. Without that, old URLs return 404 and Google drops them over a few weeks.

## 10. Owner's off-site checklist (this is where local rankings are won)

- [ ] **Google Business Profile**: claim/verify; business name exactly "Speedy Van"; closest primary category for removals (e.g. "Moving company") plus relevant secondary categories; service areas (up to 20 — the 8 cities and largest regions); phone and website (`canonicalOrigin`) identical to the site; services with descriptions; real photos of vans and team; opening hours = phone hours.
- [ ] **Reviews**: every completed move gets an email with links to review on our site **and** on Google — sent to every customer, never only happy ones (review gating breaks Google's rules). Reply to every Google review.
- [ ] **Apple Business Connect** and **Bing Places**: same details.
- [ ] **Citations** with identical name/phone/website: Yell, Thomson Local, FreeIndex, Scoot, Facebook page, and any trade directories you use.
- [ ] **Local links**: letting agents, student accommodation, storage companies, estate agents in your strongest areas — partnerships, not paid links.
- [ ] **Search Console**: domain property; submit `/sitemap.xml`; check Pages report weekly for the first 8 weeks.
- [ ] **Local notes**: write 120+ honest words for each city and your busiest towns in Admin → Content → Locations.

## 11. `npm run seo:check` (CI on main, Phase 10)

Builds and starts the site, crawls every sitemap URL plus internal links, and fails on: non-200 status · missing/duplicate title or description · title > 60 or description > 155 chars (warning) · not exactly one H1 · canonical ≠ URL · invalid JSON-LD (parse + required props per type) · `noindex` on an indexable page or missing on a non-indexable one · fewer than 5 internal links · broken internal links · images without alt · page weight over budget. Writes `seo-report.md`.

## 12. Draft local notes for the 8 cities (owner verifies, then publishes in Admin)

Seeded into `LocationContent` with `published: false`.

- **Glasgow:** Much of the West End, Southside and city centre is tenement flats of three or four storeys, usually without a lift — choose the right floor so we send the right crew. Glasgow flats are numbered by floor and door: 2/1 means second floor, first door. Several central and West End areas have controlled parking, so tick the permit option if your street has restrictions.
- **Edinburgh:** The New Town, Old Town, Marchmont, Bruntsfield and Leith are full of tenement and Georgian flats with long common stairs and few lifts. Flats are often labelled by floor and door, like 3F2 (third floor, second door). Much of the central city is a controlled parking zone, and Old Town closes are narrow and steep — mention narrow access and permits so we plan the right van and crew.
- **Aberdeen:** Many city-centre homes are granite tenements with shared stairs. Controlled parking covers the city centre and some surrounding streets; tick the permit option if that's you.
- **Dundee:** Tenement flats are common in the West End and city centre, and some central streets have parking restrictions. Moves across the Tay to Fife use the road bridge, so they're priced instantly.
- **Inverness:** Moves often start or end beyond the city in the wider Highlands. Mainland routes are priced instantly; if your route needs a ferry, our team prices it individually.
- **Perth:** Older town-centre flats can have narrow shared stairs — select narrow access if furniture has tight turns to make.
- **Stirling:** The Old Town around the castle has steep, narrow streets; if you live there, select narrow access so we bring the right van.
- **Dunfermline:** Scotland's newest city (since 2022). Town-centre flats and new-build estates both feature — tell us about stairs and parking so your price is exact.
