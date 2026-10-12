/**
 * Reference tests. Every expected number below was computed BY HAND from the owner's spec
 * (see 04-pricing-engine.md §6) and then confirmed against the engine.
 * Ported to Vitest from docs/reference/pricing/engine.test.ts.
 */
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DEFAULT_PRICING_CONFIG as C } from '../src/config.default';
import { londonToday } from '../src/dates';
import { computeQuote, priceForSlot, PricingError, validateConfig } from '../src/engine';
import type { CalendarDay, PricingInput, SlotKey, SlotPrice } from '../src/types';

function requireValue<T>(value: T | undefined, message: string): T {
  assert.ok(value, message);
  return value;
}

function price(q: ReturnType<typeof computeQuote>, date: string, slot: SlotKey): number {
  const day = requireValue(
    q.calendar.find((d) => d.date === date),
    `Missing day ${date}`,
  );
  const slotPrice = requireValue(
    day.slots.find((s) => s.slot === slot),
    `Missing slot ${slot}`,
  );
  return slotPrice.pricePence;
}

function slotAt(day: CalendarDay, index: number): SlotPrice {
  return requireValue(day.slots[index], `Missing slot index ${String(index)}`);
}

// ---------- Example A: man and van, weekday start, end of November ----------
const exampleA: PricingInput = {
  service: 'man-and-van',
  variant: 'standard',
  distanceMiles: 12.4,
  pickup: { floor: 2, hasLift: false },
  dropoff: { floor: 0, hasLift: false },
  inventory: [
    { itemId: 'sofa-3-seater', name: 'Sofa, 3-seater', quantity: 1, unitVolumeM3: 1.4 },
    { itemId: 'armchair', name: 'Armchair', quantity: 1, unitVolumeM3: 0.6 },
    { itemId: 'box-medium', name: 'Medium box', quantity: 1, unitVolumeM3: 0.08 },
  ],
  access: { carryMetres: 25, narrowAccess: false, permitZone: false },
  addons: { helpers: 1, packing: false, assembly: false },
};

test('A: static breakdown matches hand calculation (£124.08)', () => {
  const q = computeQuote(exampleA, C, '2026-11-02');
  const b = q.breakdown;
  assert.equal(b.baseAfterVariantPence, 4500);
  assert.equal(b.distance.billableMiles, 7.4);
  assert.equal(b.distance.pence, 1110); // 7.4 × £1.50
  assert.equal(b.floors.pickupPence, 2400); // 2 × £8 × 1.5 (no lift)
  assert.equal(b.floors.dropoffPence, 0);
  assert.equal(b.inventory.mode, 'STANDARD'); // 3 items is not > 4
  assert.equal(b.inventory.pence, 1848); // 3 × £2 + 2.08 m³ × £6
  assert.equal(b.access.pence, 750); // (25 − 10) × £0.50
  assert.equal(b.addons.pence, 1800); // 1 helper
  assert.equal(b.staticSubtotalPence, 12408);
  assert.equal(q.calendar.length, 28);
  assert.ok(q.calendar.every((d) => d.slots.length === 3));
});

test('A: slot prices across urgency, weekend and end-of-month', () => {
  const q = computeQuote(exampleA, C, '2026-11-02'); // Monday
  assert.equal(price(q, '2026-11-02', 'MORNING'), 18240); // ×1.4 ×1.05 = 18239.76
  assert.equal(price(q, '2026-11-02', 'AFTERNOON'), 17371); // ×1.4 = 17371.2
  assert.equal(price(q, '2026-11-02', 'EVENING'), 19108); // ×1.4 ×1.1 = 19108.32
  assert.equal(price(q, '2026-11-03', 'AFTERNOON'), 14890); // ×1.2 = 14889.6
  assert.equal(price(q, '2026-11-04', 'AFTERNOON'), 13649); // ×1.1 = 13648.8
  assert.equal(price(q, '2026-11-05', 'AFTERNOON'), 12408); // no multipliers
  assert.equal(price(q, '2026-11-07', 'AFTERNOON'), 14269); // Saturday ×1.15 = 14269.2
  assert.equal(price(q, '2026-11-28', 'AFTERNOON'), 15411); // Sat + last 3 days: ×1.15 ×1.08 = 15410.736
  assert.equal(price(q, '2026-11-28', 'MORNING'), 16181); // ×1.15 ×1.08 ×1.05 = 16181.27
  assert.equal(price(q, '2026-11-27', 'AFTERNOON'), 12408); // Friday 27th is NOT in the last 3 days of a 30-day month
});

// ---------- Example B: large inventory, peak month, long distance ----------
const exampleB: PricingInput = {
  service: 'house-removals',
  variant: '2-bed',
  distanceMiles: 46.3,
  pickup: { floor: 1, hasLift: true },
  dropoff: { floor: 3, hasLift: false },
  inventory: [
    { itemId: 'box-large', name: 'Large box', quantity: 20, unitVolumeM3: 0.25 }, // 5.0 m³
    { itemId: 'wardrobe-double', name: 'Wardrobe, double', quantity: 2, unitVolumeM3: 1.25 }, // 2.5 m³
    { itemId: 'bed-double', name: 'Double bed', quantity: 2, unitVolumeM3: 1.5 }, // 3.0 m³
    { itemId: 'sofa-3-seater', name: 'Sofa, 3-seater', quantity: 1, unitVolumeM3: 1.4 }, // 1.4 m³
    { itemId: 'misc', name: 'Misc', quantity: 5, unitVolumeM3: 0.12 }, // 0.6 m³
  ], // 30 items, 12.5 m³
  access: { carryMetres: 10, narrowAccess: true, permitZone: true },
  addons: { helpers: 2, packing: true, assembly: true },
};

test('B: large inventory and discounted long-distance miles', () => {
  const q = computeQuote(exampleB, C, '2026-07-01'); // Wednesday, July (peak)
  const b = q.breakdown;
  assert.equal(b.baseAfterVariantPence, 12000);
  assert.equal(b.distance.billableMiles, 41.3);
  assert.equal(b.distance.fullRateMiles, 20);
  assert.equal(b.distance.discountedMiles, 21.3);
  assert.equal(b.distance.pence, 5716); // 20×150 + 21.3×127.5 = 5715.75
  assert.equal(b.distance.mode, 'STANDARD'); // largeInventory.distance is null by default
  assert.equal(b.floors.pickupPence, 800); // lift: no 1.5×
  assert.equal(b.floors.dropoffPence, 3600);
  assert.equal(b.inventory.itemCount, 30);
  assert.equal(b.inventory.volumeM3, 12.5);
  assert.equal(b.inventory.mode, 'LARGE');
  assert.equal(b.inventory.pence, 27000); // max(£75, 30×£4 + 12.5×£12)
  assert.equal(b.access.pence, 4500); // carry 10m free + narrow £25 + permit £20
  assert.equal(b.addons.pence, 9600); // 2×£18 + £35 + £25
  assert.equal(b.staticSubtotalPence, 63216);
  assert.equal(price(q, '2026-07-01', 'AFTERNOON'), 97353); // ×1.4 ×1.1 = 97352.64
  assert.equal(price(q, '2026-07-04', 'AFTERNOON'), 79968); // Sat ×1.15 ×1.1 = 79968.24
  assert.equal(price(q, '2026-07-28', 'EVENING'), 76491); // ×1.1 peak ×1.1 evening = 76491.36
  assert.equal(requireValue(q.calendar.at(-1), 'Missing final calendar day').date, '2026-07-28');
});

test('B: large-inventory distance override is used only when configured', () => {
  const cfg = structuredClone(C);
  cfg.largeInventory.distance = { freeMiles: 0, perMile: 2, discountAfterBillableMiles: 1000, discountMultiplier: 1 };
  const q = computeQuote(exampleB, cfg, '2026-07-01');
  assert.equal(q.breakdown.distance.mode, 'LARGE_INVENTORY');
  assert.equal(q.breakdown.distance.pence, 9260); // 46.3 × £2
});

// ---------- Example C: single-address job, February end of month ----------
const exampleC: PricingInput = {
  service: 'rubbish',
  variant: 'standard',
  distanceMiles: 0,
  pickup: { floor: 0, hasLift: false },
  dropoff: null,
  inventory: [
    { itemId: 'bag-black', name: 'Black bag', quantity: 6, unitVolumeM3: 0.05 },
    { itemId: 'mattress-double', name: 'Double mattress', quantity: 1, unitVolumeM3: 0.7 },
  ], // 7 items, 0.30000000000000004 + 0.7 must count as exactly 1.0 m³
  access: { carryMetres: 30, narrowAccess: false, permitZone: false },
  addons: { helpers: 0, packing: false, assembly: false },
};

test('C: float-safe volume threshold and large-inventory minimum', () => {
  const q = computeQuote(exampleC, C, '2027-02-20'); // Saturday
  assert.equal(q.breakdown.inventory.volumeM3, 1);
  assert.equal(q.breakdown.inventory.mode, 'LARGE');
  assert.equal(q.breakdown.inventory.pence, 7500); // max(£75, 7×£4 + 1×£12 = £40)
  assert.equal(q.breakdown.access.carryPence, 1000);
  assert.equal(q.breakdown.staticSubtotalPence, 17500);
  assert.equal(price(q, '2027-02-20', 'MORNING'), 29584); // ×1.4 ×1.15 ×1.05 = 29583.75
  assert.equal(price(q, '2027-02-26', 'AFTERNOON'), 18900); // Feb has 28 days: 26th is in the last 3 → ×1.08
  assert.equal(price(q, '2027-02-27', 'AFTERNOON'), 21735); // Sat + EOM ×1.15 ×1.08
  assert.equal(price(q, '2027-03-01', 'AFTERNOON'), 17500); // Monday 1 March, no multipliers
});

test('leap year: 29 Feb 2028 handled, last-3-days = 27, 28, 29', () => {
  const q = computeQuote(exampleC, C, '2028-02-20');
  const feb26 = requireValue(
    q.calendar.find((d) => d.date === '2028-02-26'),
    'Missing 2028-02-26',
  );
  const feb27 = requireValue(
    q.calendar.find((d) => d.date === '2028-02-27'),
    'Missing 2028-02-27',
  );
  const feb29 = requireValue(
    q.calendar.find((d) => d.date === '2028-02-29'),
    'Missing 2028-02-29',
  );
  assert.equal(slotAt(feb26, 1).multipliers.endOfMonth, 1);
  assert.equal(slotAt(feb27, 1).multipliers.endOfMonth, 1.08);
  assert.equal(slotAt(feb29, 1).multipliers.endOfMonth, 1.08);
});

test('priceForSlot equals the calendar value and rejects dates outside the window', () => {
  const r = priceForSlot(exampleA, C, '2026-11-02', '2026-11-28', 'MORNING');
  assert.equal(r.pricePence, 16181);
  assert.throws(() => priceForSlot(exampleA, C, '2026-11-02', '2026-12-30', 'MORNING'), PricingError);
  assert.throws(() => priceForSlot(exampleA, C, '2026-11-02', '2026-11-28', 'MIDDAY' as SlotKey), {
    code: 'INVALID_DATE',
  });
});

test('variants flagged for survey require a manual quote', () => {
  const q = computeQuote({ ...exampleA, service: 'piano', variant: 'grand' }, C, '2026-11-02');
  assert.equal(q.requiresManualQuote, true);
  assert.deepEqual(q.manualQuoteReasons, ['VARIANT_REQUIRES_SURVEY']);
});

test('invalid inputs throw typed errors', () => {
  assert.throws(() => computeQuote({ ...exampleA, variant: 'nope' }, C, '2026-11-02'), { code: 'UNKNOWN_VARIANT' });
  assert.throws(() => computeQuote({ ...exampleA, dropoff: null }, C, '2026-11-02'), { code: 'DROPOFF_REQUIRED' });
  assert.throws(() => computeQuote({ ...exampleC, distanceMiles: 3 }, C, '2027-02-20'), { code: 'INVALID_DISTANCE' });
  assert.throws(() => computeQuote({ ...exampleA, distanceMiles: -1 }, C, '2026-11-02'), { code: 'INVALID_DISTANCE' });
  assert.throws(() => computeQuote({ ...exampleA, pickup: { floor: 1.5, hasLift: false } }, C, '2026-11-02'), {
    code: 'INVALID_FLOOR',
  });
  assert.throws(() => computeQuote({ ...exampleA, addons: { helpers: 9, packing: false, assembly: false } }, C, '2026-11-02'), {
    code: 'INVALID_ADDONS',
  });
  assert.throws(() => computeQuote(exampleA, C, '2026-02-30'), { code: 'INVALID_DATE' });
});

test('invariants hold for every slot of every example', () => {
  for (const [input, today] of [
    [exampleA, '2026-11-02'],
    [exampleB, '2026-07-01'],
    [exampleC, '2027-02-20'],
  ] as const) {
    const q = computeQuote(input, C, today);
    for (const day of q.calendar) {
      const [m, a, e] = day.slots;
      const morning = requireValue(m, 'Missing morning slot');
      const afternoon = requireValue(a, 'Missing afternoon slot');
      const evening = requireValue(e, 'Missing evening slot');
      assert.ok(Number.isInteger(afternoon.pricePence) && afternoon.pricePence > 0);
      assert.ok(morning.pricePence >= afternoon.pricePence, 'morning ≥ afternoon');
      assert.ok(evening.pricePence >= afternoon.pricePence, 'evening ≥ afternoon');
      assert.ok(afternoon.pricePence >= q.breakdown.staticSubtotalPence, 'multipliers never discount');
    }
  }
});

test('default config is valid', () => {
  assert.deepEqual(validateConfig(C), []);
});

test('londonToday respects BST/GMT boundaries', () => {
  // 23:30 UTC on 31 Mar 2026 is 00:30 BST on 1 Apr 2026 in London.
  assert.equal(londonToday(new Date('2026-03-31T23:30:00Z')), '2026-04-01');
  // 23:30 UTC on 15 Dec 2026 is still 15 Dec in London (GMT).
  assert.equal(londonToday(new Date('2026-12-15T23:30:00Z')), '2026-12-15');
});
