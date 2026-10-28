/**
 * Generates vectors.json — the golden regression set for packages/pricing.
 * Run: node --experimental-strip-types docs/reference/pricing/generate-vectors.ts
 * Codex: do NOT regenerate vectors to make a failing port pass. Fix the port.
 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_PRICING_CONFIG as C } from './config.default.ts';
import { computeQuote } from './engine.ts';
import type { PricingInput } from './types.ts';

const line = (itemId: string, quantity: number, unitVolumeM3: number) => ({ itemId, name: itemId, quantity, unitVolumeM3 });

const cases: { id: string; note: string; today: string; input: PricingInput }[] = [
  {
    id: 'gv-01-man-and-van-small',
    note: 'Example A from the spec walkthrough',
    today: '2026-11-02',
    input: {
      service: 'man-and-van', variant: 'standard', distanceMiles: 12.4,
      pickup: { floor: 2, hasLift: false }, dropoff: { floor: 0, hasLift: false },
      inventory: [line('sofa-3-seater', 1, 1.4), line('armchair', 1, 0.6), line('box-medium', 1, 0.08)],
      access: { carryMetres: 25, narrowAccess: false, permitZone: false },
      addons: { helpers: 1, packing: false, assembly: false },
    },
  },
  {
    id: 'gv-02-house-large-peak',
    note: 'Example B: large inventory, July, 46.3 miles',
    today: '2026-07-01',
    input: {
      service: 'house-removals', variant: '2-bed', distanceMiles: 46.3,
      pickup: { floor: 1, hasLift: true }, dropoff: { floor: 3, hasLift: false },
      inventory: [line('box-large', 20, 0.25), line('wardrobe-double', 2, 1.25), line('bed-double', 2, 1.5), line('sofa-3-seater', 1, 1.4), line('misc', 5, 0.12)],
      access: { carryMetres: 10, narrowAccess: true, permitZone: true },
      addons: { helpers: 2, packing: true, assembly: true },
    },
  },
  {
    id: 'gv-03-furniture-feb-eom',
    note: 'Example C: float-safe 1.0 m³ threshold, February',
    today: '2027-02-20',
    input: {
      service: 'furniture', variant: 'standard', distanceMiles: 5,
      pickup: { floor: 0, hasLift: false }, dropoff: { floor: 0, hasLift: false },
      inventory: [line('box-small', 6, 0.05), line('mattress-double', 1, 0.7)],
      access: { carryMetres: 30, narrowAccess: false, permitZone: false },
      addons: { helpers: 0, packing: false, assembly: false },
    },
  },
  {
    id: 'gv-04-same-day-short',
    note: 'Inside free miles, no items, today multiplier',
    today: '2026-10-12',
    input: {
      service: 'same-day', variant: 'standard', distanceMiles: 4.99,
      pickup: { floor: 0, hasLift: false }, dropoff: { floor: 0, hasLift: false },
      inventory: [],
      access: { carryMetres: 0, narrowAccess: false, permitZone: false },
      addons: { helpers: 0, packing: false, assembly: false },
    },
  },
  {
    id: 'gv-05-student-exactly-threshold',
    note: 'Exactly 20 billable miles (25.0 total) — no discounted miles; 4 items is not large',
    today: '2026-12-24',
    input: {
      service: 'student', variant: 'halls', distanceMiles: 25,
      pickup: { floor: 4, hasLift: true }, dropoff: { floor: 2, hasLift: false },
      inventory: [line('box-medium', 3, 0.08), line('suitcase', 1, 0.1)],
      access: { carryMetres: 11, narrowAccess: false, permitZone: true },
      addons: { helpers: 0, packing: false, assembly: false },
    },
  },
  {
    id: 'gv-06-office-medium-long',
    note: 'Long distance with discount, large load, Sunday/Monday boundary',
    today: '2026-08-29',
    input: {
      service: 'office', variant: 'medium', distanceMiles: 142.37,
      pickup: { floor: 5, hasLift: true }, dropoff: { floor: 0, hasLift: false },
      inventory: [line('desk-office', 10, 0.7), line('chair-office', 10, 0.3), line('cabinet-filing-4', 4, 0.55), line('box-archive', 40, 0.05)],
      access: { carryMetres: 40, narrowAccess: true, permitZone: true },
      addons: { helpers: 3, packing: true, assembly: true },
    },
  },
  {
    id: 'gv-07-piano-upright',
    note: 'Piano upright, no inventory lines, ground floors',
    today: '2026-05-29',
    input: {
      service: 'piano', variant: 'upright', distanceMiles: 8.6,
      pickup: { floor: 0, hasLift: false }, dropoff: { floor: 1, hasLift: false },
      inventory: [],
      access: { carryMetres: 15, narrowAccess: false, permitZone: false },
      addons: { helpers: 1, packing: false, assembly: false },
    },
  },
  {
    id: 'gv-08-ikea-assembly',
    note: 'IKEA with assembly add-on, 5 small items under 1 m³ (not large)',
    today: '2026-06-28',
    input: {
      service: 'ikea', variant: 'standard', distanceMiles: 17.25,
      pickup: { floor: 0, hasLift: false }, dropoff: { floor: 2, hasLift: true },
      inventory: [line('flatpack-small', 5, 0.15)],
      access: { carryMetres: 0, narrowAccess: false, permitZone: false },
      addons: { helpers: 0, packing: false, assembly: true },
    },
  },
];

const vectors = cases.map((c) => {
  const q = computeQuote(c.input, C, c.today);
  return {
    id: c.id,
    note: c.note,
    today: c.today,
    input: c.input,
    expected: {
      staticSubtotalPence: q.breakdown.staticSubtotalPence,
      breakdown: q.breakdown,
      requiresManualQuote: q.requiresManualQuote,
      calendar: q.calendar.map((d) => ({
        date: d.date,
        MORNING: d.slots[0]!.pricePence,
        AFTERNOON: d.slots[1]!.pricePence,
        EVENING: d.slots[2]!.pricePence,
      })),
    },
  };
});

const out = new URL('./vectors.json', import.meta.url);
writeFileSync(out, JSON.stringify({ configVersion: 'DEFAULT_PRICING_CONFIG v1', generatedBy: 'reference engine', vectors }, null, 2) + '\n');
for (const v of vectors) {
  const prices = v.expected.calendar.flatMap((d) => [d.MORNING, d.AFTERNOON, d.EVENING]);
  console.log(`${v.id.padEnd(34)} subtotal £${(v.expected.staticSubtotalPence / 100).toFixed(2).padStart(8)}  min £${(Math.min(...prices) / 100).toFixed(2)}  max £${(Math.max(...prices) / 100).toFixed(2)}`);
}
