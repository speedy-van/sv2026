# 02 — Brand & design system

## 1. Design idea

**Subject:** a Scottish removals company. **Audience:** people mid-move — usually on a phone, often stressed, comparing prices. **Primary job of every screen:** get a fixed price and a booked slot with the fewest decisions possible.

**The one memorable thing:** the **route**. A live map of Scotland where the customer's own journey draws itself as they type addresses, and the moment the price is calculated. Everything else is quiet, disciplined and fast. We spend boldness in exactly two places — the hero route map and the price reveal — and nowhere else.

**Principles**
1. **Booking is the hero.** The first thing on every entry page is the booking start, not a slogan.
2. **Show the working.** Prices come with their breakdown; the calculation is visible. Trust comes from transparency, not adjectives.
3. **Calm under stress.** Generous whitespace, one primary action per view, plain words.
4. **Scottish, not tartan.** Colour and naming come from the landscape (loch, gorse, thistle, granite). No tartan patterns, saltire clip-art or "och aye" copy.
5. **Motion answers people.** Animation responds to what the user did (typed an address, asked for prices, chose a slot). No scroll-triggered fade-ins on sections.

**Explicitly avoid:** identical rounded cards for everything; soft grey drop shadows under every block; ALL-CAPS eyebrow labels above headings; meta strings joined with middle dots; "→" appended to button text; stock photos of smiling movers; gradient blobs; one-word coloured accents in headlines; numbered markers on content that isn't a real sequence.

## 2. Colour

### 2.1 Core palette

| Name | Hex | Role |
|---|---|---|
| **Loch Ink** | `#0B1F33` | Text, dark panels (hero map, footer), app chrome |
| **Mist** | `#F3F5F9` | Page background |
| **White** | `#FFFFFF` | Surfaces: booking card, sheets, inputs |
| **Thistle** | `#6D3BD7` | Brand + interaction: links, selected states, focus, route lines, progress |
| **Gorse** | `#FFC93C` | The single action colour: primary buttons, the van, the chosen price |
| **Granite** | `#4E5F78` | Secondary text, icons, borders on emphasis |

Semantic: **Moss** `#12805C` (success), **Rowan** `#C8102E` (error/destructive).

### 2.2 Scales (`packages/tokens/src/colors.ts`)

| Step | ink | thistle | gorse | moss | rowan |
|---|---|---|---|---|---|
| 50 | `#F3F5F9` | `#F5F1FF` | `#FFFBEA` | `#ECFDF5` | `#FFF1F2` |
| 100 | `#E4E9F1` | `#EBE2FF` | `#FFF3C4` | `#D1FAE5` | `#FFE0E4` |
| 200 | `#C9D2E0` | `#D7C5FF` | `#FFE68A` | `#A7F0CF` | `#FFC2CB` |
| 300 | `#A0AEC4` | `#BB9DFB` | `#FFD95E` | `#6EDDB0` | `#FF94A4` |
| 400 | `#7083A0` | `#9D74F1` | `#FFC93C` | `#34C28C` | `#F25A72` |
| 500 | `#4E5F78` | `#8455E6` | `#F5B116` | `#1A9A6C` | `#E0233F` |
| 600 | `#3B4B62` | `#6D3BD7` | `#D68F06` | `#12805C` | `#C8102E` |
| 700 | `#2B3A51` | `#5A2EB8` | `#B06B08` | `#0E6649` | `#A00D25` |
| 800 | `#1A2D45` | `#462492` | `#8F530E` | `#0B5139` | `#80101F` |
| 900 | `#0B1F33` | `#341B6B` | `#75440F` | `#08402D` | `#650F1B` |
| 950 | `#06121F` | `#211046` | `#432304` | `#04261B` | `#3B0710` |

### 2.3 Semantic tokens (use these in components, never raw scale steps)

| Token | Light value | Use |
|---|---|---|
| `bg.canvas` | ink.50 | page |
| `bg.surface` | white | cards, inputs, sheets |
| `bg.subtle` | ink.100 | wells, disabled fills |
| `bg.inverse` | ink.900 | dark panels |
| `fg.default` | ink.900 | body text |
| `fg.muted` | ink.500 | secondary text, placeholders |
| `fg.onInverse` | white | text on ink |
| `fg.onAction` | ink.900 | text on gorse |
| `border.default` | ink.100 | dividers, card outlines |
| `border.strong` | ink.200 | inputs |
| `brand.solid` / `brand.fg` / `brand.subtle` | thistle.600 / thistle.700 / thistle.50 | |
| `action.solid` / `action.hover` / `action.active` | gorse.400 / gorse.300 / gorse.500 | primary button |
| `focus.ring` | thistle.600 (on light), gorse.400 (on ink) | 3 px ring, 2 px offset |
| `success.*`, `danger.*` | moss / rowan | |
| `price.highlight` | gorse.200 underline sweep | cheapest-day marker |

Chakra v3 colour palettes (`colorPalette="thistle"` etc.) need the semantic set `solid, contrast, fg, muted, subtle, emphasized, focusRing` for each palette — define them for `thistle`, `gorse`, `ink`, `moss`, `rowan`.

### 2.4 Contrast (verified, WCAG 2.2)

| Pair | Ratio | Allowed for |
|---|---|---|
| ink.900 on white | 16.7 : 1 | all text |
| ink.500 on white / on mist | 6.5 / 5.9 : 1 | all text incl. placeholders |
| thistle.600 on white | 6.5 : 1 | links, small text |
| white on thistle.600 | 6.5 : 1 | brand buttons |
| ink.900 on gorse.400 | 10.9 : 1 | primary buttons |
| gorse.400 on ink.900 | 10.9 : 1 | accents on dark |
| thistle.300 on ink.900 | 7.4 : 1 | links on dark |
| gorse.800 on white | 6.1 : 1 | the only gorse allowed as text on light |
| moss.600 / rowan.600 on white | 4.9 / 5.9 : 1 | status text |

Never: gorse.400 as text on light backgrounds (1.6 : 1); thistle.600 on ink (2.6 : 1); ink.400 for text (3.9 : 1).

The website is **light only** (Chakra provider `forcedTheme="light"`). Dark appears as deliberate panels (`bg.inverse`). The iPhone apps follow the system light/dark setting (§9).

## 3. Typography

| Role | Typeface | Why |
|---|---|---|
| Display: headlines, prices, big numbers | **Bricolage Grotesque** (variable: wght 200–800, opsz 12–96, wdth 75–100) | Characterful grotesque with optical sizing; at large sizes it has the sturdy, slightly condensed feel of van livery |
| Text & UI: body, forms, buttons, tables | **Manrope** (variable: wght 200–800) | Clean, open, very legible on phones; geometric enough to contrast with Bricolage |

Load both with `next/font/google` (`display: 'swap'`, `subsets: ['latin']`, Bricolage with `axes: ['opsz', 'wdth']`), exposed as CSS variables `--font-display` and `--font-body`. Apps load the same fonts via `@expo-google-fonts/*` packages (fallback: bundle the OFL TTFs with `expo-font`).

### Scale (web; rem = 16 px)

| Token | Size (mobile → desktop) | Line height | Font / weight | Tracking |
|---|---|---|---|---|
| `display.xl` | 40 → 72 px (`clamp(2.5rem, 1.6rem + 3.8vw, 4.5rem)`) | 1.02 | Bricolage 800, opsz 96, wdth 88 | −0.025em |
| `display.lg` | 32 → 52 px | 1.06 | Bricolage 750, opsz 72 | −0.02em |
| `heading.lg` | 26 → 36 px | 1.12 | Bricolage 700 | −0.015em |
| `heading.md` | 21 → 26 px | 1.2 | Bricolage 700 | −0.01em |
| `heading.sm` | 18 → 20 px | 1.3 | Manrope 700 | 0 |
| `body.lg` | 18 px | 1.6 | Manrope 450 | 0 |
| `body.md` | 16 px | 1.6 | Manrope 450 | 0 |
| `body.sm` | 14 px | 1.5 | Manrope 500 | 0.005em |
| `label` | 14 px | 1.3 | Manrope 650 | 0.01em |
| `price.hero` | 56 → 80 px | 1 | Bricolage 800, `tabular-nums` | −0.03em |
| `price.md` | 20 → 24 px | 1.1 | Bricolage 750, `tabular-nums` | −0.01em |

Rules: sentence case everywhere (including buttons and nav). Body line length ≤ 72 characters (`max-width: 68ch`). Headlines left-aligned. No all-caps labels. Numbers that change (prices) use `@number-flow/react`, so digit width never jitters regardless of font features.

## 4. Space, layout, shape

- **Spacing scale (px):** 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128. Section vertical rhythm: 64 mobile / 112 desktop.
- **Breakpoints:** `sm 480`, `md 768`, `lg 1024`, `xl 1280`, `2xl 1440`. Design mobile-first at 375 and check 360.
- **Grid:** 4 columns + 16 px gutters/margins on mobile; 12 columns, 24 px gutters, max content width 1200 px on desktop.
- **Radius hierarchy (shape encodes hierarchy):** `sm 8` chips/badges · `md 12` inputs/buttons · `lg 20` cards/sheets · `xl 32` hero map panel and booking card. Never one radius for everything.
- **Elevation:** only floating things get shadows (booking card, sheets, popovers, sticky CTA): `0 1px 2px rgb(11 31 51 / 0.06), 0 16px 40px -16px rgb(11 31 51 / 0.28)`. Static content uses `border.default` 1 px or tonal surfaces, not shadows.
- **Touch targets:** ≥ 44 × 44 px web, ≥ 48 admin app, ≥ 56 driver app.

## 5. Iconography, imagery, logo

- **Icons:** Lucide, 1.75 px stroke, sizes 16/20/24. Service icons: house, sofa, warehouse, building-2, truck, graduation-cap, package, trash-2, piano, zap.
- **Imagery:** no stock photography. The site's visuals are the route map, the van glyph, and real photos the owner supplies later (team, vans) — slots exist in About and service pages, hidden until photos are uploaded.
- **Logo (Codex builds as SVG components):** wordmark "Speedy Van" in Bricolage Grotesque 800, tracking −0.03em, Loch Ink. To its left, the van glyph: a Luton-van silhouette from three rounded rectangles (box body in Gorse, cab in Loch Ink, a Thistle window), with three short horizontal speed lines trailing at decreasing lengths (100%, 70%, 45%). Variants: full colour on light; white wordmark + gorse van on ink; glyph-only (favicon, app icons). Export: `logo.svg`, `logo-inverse.svg`, `glyph.svg`, favicons (16/32/48/180/192/512), `apple-touch-icon.png`, OG fallback 1200×630. If `FACTS.brand.logoProvided` is true, use the owner's file instead.
- **App icons (1024 px):** Admin — ink background, gorse van glyph. Driver — gorse background, ink van glyph. Distinct at a glance on a home screen.

## 6. Chakra v3 implementation (`apps/web/src/theme`)

```ts
// system.ts — shape only; values come from @sv/tokens
import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';
import { colors, radii, shadows, durations, easings } from '@sv/tokens';

const config = defineConfig({
  preflight: true,
  globalCss: {
    html: { colorScheme: 'light' },
    body: { bg: 'bg.canvas', color: 'fg.default', fontFamily: 'body', WebkitFontSmoothing: 'antialiased' },
    '*:focus-visible': { outline: '3px solid {colors.focus.ring}', outlineOffset: '2px' },
  },
  theme: {
    tokens: {
      colors: toChakraColorTokens(colors),
      fonts: { heading: { value: 'var(--font-display), system-ui, sans-serif' }, body: { value: 'var(--font-body), system-ui, sans-serif' } },
      radii: toChakraTokens(radii),
      shadows: toChakraTokens(shadows),
      durations: toChakraTokens(durations),
      easings: toChakraTokens(easings),
    },
    semanticTokens: { colors: { /* §2.3 + per-palette solid/contrast/fg/muted/subtle/emphasized/focusRing */ } },
    textStyles: { /* §3 scale */ },
    recipes: { button, input, badge, link },
    slotRecipes: { choiceCard, slotCard, dayCard, priceBreakdown, sheet },
  },
});
export const system = createSystem(defaultConfig, config);
```

- Generate base snippets with `npx @chakra-ui/cli snippet add` (provider, toaster, tooltip, dialog, drawer, field, checkbox, radio-card, switch, slider, accordion, number-input, segmented-control), then restyle through recipes — never inline-override colours in components.
- `experimental.optimizePackageImports: ['@chakra-ui/react']` in `next.config.ts`.

## 7. Motion

### 7.1 Tokens (`packages/tokens/src/motion.ts`)

| Token | Value | Use |
|---|---|---|
| `duration.instant` | 80 ms | press feedback |
| `duration.fast` | 150 ms | hover, toggles |
| `duration.base` | 220 ms | step transitions, sheets |
| `duration.slow` | 360 ms | layout morphs |
| `duration.reveal` | 900 ms | price count-up |
| `ease.standard` | `cubic-bezier(0.2, 0, 0, 1)` | most transitions |
| `ease.enter` | `cubic-bezier(0, 0, 0.2, 1)` | entering elements |
| `ease.exit` | `cubic-bezier(0.4, 0, 1, 1)` | leaving elements |
| `spring.snappy` | stiffness 520, damping 38 | selection, chips |
| `spring.gentle` | stiffness 220, damping 28 | sheets, layout |
| `spring.bouncy` | stiffness 380, damping 20 | success tick only |

Rules: animate only `transform` and `opacity` (plus SVG `stroke-dashoffset`). Use `LazyMotion` + `domAnimation` features and `m.*` components. Pause off-screen loops (IntersectionObserver) and when `document.hidden`. Every animated component has a reduced-motion path (`useReducedMotion()` → instant state change or 120 ms opacity only).

### 7.2 Signature moment 1 — Hero route map (load + reacts to input)

SVG map of Scotland (outline from Natural Earth 1:10m Admin-0 map units, public domain; filter to Scotland; simplify to ≤ 18 KB; project with a fixed transverse projection; store the projection params so lat/lng → SVG x/y is exact). Lives in the right-hand ink panel on desktop, below the booking card on mobile.

| t (ms) | Event |
|---|---|
| 0–900 | Coastline draws in (stroke-dashoffset, `ease.standard`), thistle.300 at 60% opacity on ink |
| 600–1100 | 8 city dots scale 0 → 1, 50 ms stagger (Glasgow, Edinburgh, Aberdeen, Dundee, Inverness, Perth, Stirling, Dunfermline) |
| 1100–2000 | A curved route arc draws between two cities (thistle.400, 2.5 px) |
| 1300–2900 | Van glyph (gorse) travels along the arc, rotated to the path tangent |
| 2900–4100 | Hold; then route fades (300 ms) and the next city pair begins. 5 pairs, then stop on the last (no infinite loop after 30 s) |

**Reacts to the customer:** when the pickup is selected in the booking card, the loop stops and a gorse pin drops at the real coordinates (spring.snappy). When the dropoff is selected, the arc draws between the two real points and the van makes the trip once (1.4 s). Out-of-map coordinates (England) clamp to the map edge with an arrow. Reduced motion: static coastline and dots; pins appear without travel.

### 7.3 Signature moment 2 — The price reveal

Full specification in `06-booking-flow.md §6`. Visual summary: the "See my prices" button morphs (layout animation, 360 ms) into a progress card; three checks tick as real server events arrive; the cheapest price counts up with NumberFlow (900 ms) and a gorse underline sweeps beneath it; the calendar rises into place (220 ms, days staggered 25 ms, maximum 300 ms total).

### 7.4 Responsive motion (user-triggered only)

| Interaction | Motion |
|---|---|
| Button press | scale 0.97, 80 ms; release spring.snappy |
| Choice card / chip select | border → thistle.600 (150 ms); check icon draws (stroke, 200 ms) |
| Step change in wizard | outgoing: opacity 0 + x −16 px (150 ms, exit); incoming: opacity 1 from x +16 px (220 ms, enter). Back reverses direction |
| Route summary chip | `layoutId` morph from booking card to wizard header (360 ms) |
| Slot selected | card lifts (scale 1.02), sticky pay bar price rolls to new value (NumberFlow) |
| Sheet/drawer | spring.gentle from bottom (mobile), from right (desktop) |
| Toast | from bottom 16 px + fade, 220 ms; auto-dismiss 5 s (errors persist until closed) |
| Confirmation | check circle draws (500 ms) → van glyph drives out right leaving three speed lines (900 ms) |

Not allowed: parallax, scroll-jacking, scroll-triggered section entrances, auto-playing carousels, confetti, looping attention-seekers.

## 8. Component inventory (web) — every component ships every state

| Component | Variants | States to implement |
|---|---|---|
| `Button` | primary (gorse), brand (thistle), secondary (ink outline), ghost, danger; sm/md/lg/xl | default, hover, focus-visible, active, disabled, loading (spinner + verb, e.g. "Checking prices…"), full-width |
| `IconButton` | ghost, outline | + required `aria-label` |
| `TextField` / `TextArea` | | label always visible, help text, error text (`aria-describedby`), char counter where limited |
| `AddressField` | pickup, dropoff | combobox (ARIA 1.2), loading row, no-results with "Enter address manually", network error with retry, selected state (pin + formatted address + "Change") |
| `ChoiceCard` (radio card) | with icon, with price | default, hover, selected, disabled (with reason) |
| `Chip` | filter, choice | default, selected, disabled |
| `QuantityStepper` | | 0 state, min/max, long-press accelerate, announces value |
| `FloorPicker` | | Basement, Ground, 1st…10th, 11+ (number input) |
| `Toggle` (Switch) | | on/off/disabled, label + description |
| `CarrySlider` | 0–100 m, 5 m steps | value bubble, "first 10 m included" marker |
| `DayCard` | | default, cheapest (gorse underline), selected, fully booked (striped, disabled), closed |
| `SlotCard` | | price, window label, available, last slot (real), unavailable (reason), selected |
| `PriceTag` | hero, inline | animated (NumberFlow), static, struck-through (old price in reschedule) |
| `PriceBreakdown` | collapsible | lines from `formatPriceBreakdownLines()`; multipliers shown as "Saturday +15%" |
| `ProgressSteps` | wizard header | current, complete, upcoming; clickable for completed steps |
| `Sheet` / `Dialog` | bottom (mobile) / side (desktop) | focus trap, Esc, swipe to close (mobile), return focus |
| `InlineAlert` | info, success, warning, danger | with action button |
| `Toast` | success, error, info | |
| `EmptyState` / `ErrorState` | | icon, one-line cause, one action |
| `Skeleton` | text, card, calendar | matches final layout dimensions (no CLS) |
| `Breadcrumbs` | | with BreadcrumbList JSON-LD |
| `StaticRouteMap` | | Mapbox Static image via `/api/v1/maps/static?quote=…`, blurred placeholder, alt text "Route from Paisley to Edinburgh, 52 miles" |
| `ScotlandRouteMap` | hero | §7.2 |
| `Timeline` | tracking | done, current (pulsing dot — the only allowed loop), upcoming |
| `ConsentBanner` | | first visit, preferences sheet, saved |

## 9. iPhone apps

- Tokens from `@sv/tokens` mapped to a typed `theme.ts` (light + dark). Dark mode: bg ink.950, surface ink.900, text ink.50, muted ink.300, brand thistle.300, action gorse.400.
- Navigation: Expo Router tabs + native stack; detail sheets via native `formSheet` presentation with detents.
- **Admin app** feels like a calm control room: dense lists, clear status colour, numbers in Bricolage. iPad: split view (list left, detail right).
- **Driver app** is glove-friendly: 56 px minimum targets, one primary action per screen as a full-width bottom button, 18 px minimum body text, high contrast in sunlight, haptic confirmation on every stage change.
- **Status colours (shared by web, admin, driver):**

| Status | Colour | Label |
|---|---|---|
| PENDING_PAYMENT | ink.400 | Awaiting payment |
| CONFIRMED | thistle.600 | Confirmed |
| IN_PROGRESS | gorse.400 (ink text) | In progress |
| COMPLETED | moss.600 | Completed |
| CANCELLED | rowan.600 | Cancelled |
| EXPIRED | ink.300 | Expired |
| Dispatch UNASSIGNED | rowan outline | Needs a driver |
| Dispatch OFFERED | gorse outline | Offered |
| Dispatch ACCEPTED | moss outline | Driver confirmed |

## 10. Voice & copy

- Plain, direct, warm. Second person. Sentence case. No exclamation marks except the booking confirmation ("You're booked").
- Buttons say what happens and keep their name through the flow: "See my prices" → "Choose this slot" → "Pay £148.00" → toast "Payment received".
- Errors say what happened and what to do, never apologise vaguely: "We couldn't find that postcode. Check it, or enter the address manually."
- Empty states invite action: "No jobs today. New bookings will appear here and your phone will ring."
- Never: "seamless", "hassle-free", "stress-free", "cutting-edge", "unbeatable", "#1", "best in Scotland" (unless the owner can prove it).
- Money: "£148.00" in checkout and receipts; "£148" allowed in marketing "from" prices. Dates: "Saturday 14 November". Times: "8am–12pm".

## 11. Accessibility checklist (every page/screen)

Landmarks and one `h1`; heading order; labels on all inputs; errors announced (`aria-live="polite"`) and focus moved to the first invalid field on submit; combobox pattern for address search; keyboard path through the whole booking flow; visible focus everywhere; 200% zoom without horizontal scroll; reduced motion; colour never sole signal (status badges include text); tap targets per §4; apps support Dynamic Type and VoiceOver labels on every control.
