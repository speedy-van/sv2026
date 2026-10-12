import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { test } from 'vitest';
import { DEFAULT_PRICING_CONFIG as C } from '../src/config.default';
import { computeQuote, priceForSlot } from '../src/engine';
import { SERVICE_KEYS, SLOT_KEYS, type PricingInput, type ServiceKey } from '../src/types';

const propertyRuns = 1_000;
const todayArbitrary = fc.constantFrom(
  '2026-01-15',
  '2026-06-28',
  '2026-08-29',
  '2026-10-12',
  '2026-12-24',
  '2027-02-20',
  '2028-02-20',
);

const addressArbitrary = fc.record({
  floor: fc.integer({ min: 0, max: 8 }),
  hasLift: fc.boolean(),
});

const inventoryLineArbitrary = fc.record({
  itemId: fc.constantFrom('box', 'sofa', 'desk', 'chair', 'bed', 'bag'),
  name: fc.constantFrom('Box', 'Sofa', 'Desk', 'Chair', 'Bed', 'Bag'),
  quantity: fc.integer({ min: 1, max: 30 }),
  unitVolumeM3: fc.integer({ min: 1, max: 300 }).map((value) => value / 100),
});

const accessArbitrary = fc.record({
  carryMetres: fc.integer({ min: 0, max: 100 }),
  narrowAccess: fc.boolean(),
  permitZone: fc.boolean(),
});

const addonsArbitrary = fc.record({
  helpers: fc.integer({ min: 0, max: C.addons.maxHelpers }),
  packing: fc.boolean(),
  assembly: fc.boolean(),
});

function serviceVariants(service: ServiceKey): [string, ...string[]] {
  const variants = C.services[service].variants.map((variant) => variant.key);
  const first = variants[0];
  assert.ok(first);
  return [first, ...variants.slice(1)];
}

function pricingInputArbitrary(options: { dropoffOnly?: boolean } = {}): fc.Arbitrary<PricingInput> {
  const services = SERVICE_KEYS.filter((service) => !options.dropoffOnly || C.services[service].requiresDropoff);
  const serviceTuple = services as [ServiceKey, ...ServiceKey[]];

  return fc.constantFrom(...serviceTuple).chain((service) => {
    const serviceConfig = C.services[service];
    return fc
      .record({
        variant: fc.constantFrom(...serviceVariants(service)),
        distanceMiles: serviceConfig.requiresDropoff
          ? fc.integer({ min: 0, max: 20_000 }).map((value) => value / 100)
          : fc.constant(0),
        pickup: addressArbitrary,
        dropoff: serviceConfig.requiresDropoff ? addressArbitrary : fc.constant(null),
        inventory: fc.array(inventoryLineArbitrary, { minLength: 0, maxLength: 8 }),
        access: accessArbitrary,
        addons: addonsArbitrary,
      })
      .map((partial) => ({
        service,
        ...partial,
      }));
  });
}

test('property: prices are never negative', () => {
  fc.assert(
    fc.property(pricingInputArbitrary(), todayArbitrary, (input, today) => {
      const quote = computeQuote(input, C, today);
      assert.ok(quote.breakdown.staticSubtotalPence >= 0);
      for (const day of quote.calendar) {
        for (const slot of day.slots) {
          assert.ok(slot.pricePence >= 0);
        }
      }
    }),
    { numRuns: propertyRuns },
  );
});

test('property: adding an item never lowers the static subtotal', () => {
  fc.assert(
    fc.property(pricingInputArbitrary(), inventoryLineArbitrary, todayArbitrary, (input, extraLine, today) => {
      const base = computeQuote(input, C, today).breakdown.staticSubtotalPence;
      const withExtraItem = computeQuote({ ...input, inventory: [...input.inventory, extraLine] }, C, today).breakdown
        .staticSubtotalPence;
      assert.ok(withExtraItem >= base);
    }),
    { numRuns: propertyRuns },
  );
});

test('property: more miles never lowers the static subtotal for dropoff jobs', () => {
  fc.assert(
    fc.property(
      pricingInputArbitrary({ dropoffOnly: true }),
      fc.integer({ min: 0, max: 10_000 }).map((value) => value / 100),
      todayArbitrary,
      (input, extraMiles, today) => {
        const base = computeQuote(input, C, today).breakdown.staticSubtotalPence;
        const longer = computeQuote({ ...input, distanceMiles: input.distanceMiles + extraMiles }, C, today).breakdown
          .staticSubtotalPence;
        assert.ok(longer >= base);
      },
    ),
    { numRuns: propertyRuns },
  );
});

test('property: afternoon is never above morning or evening under the default config', () => {
  fc.assert(
    fc.property(pricingInputArbitrary(), todayArbitrary, (input, today) => {
      const quote = computeQuote(input, C, today);
      for (const day of quote.calendar) {
        const morning = day.slots[0];
        const afternoon = day.slots[1];
        const evening = day.slots[2];
        assert.ok(morning);
        assert.ok(afternoon);
        assert.ok(evening);
        assert.ok(afternoon.pricePence <= morning.pricePence);
        assert.ok(afternoon.pricePence <= evening.pricePence);
      }
    }),
    { numRuns: propertyRuns },
  );
});

test('property: output is always 28 days by 3 slots', () => {
  fc.assert(
    fc.property(pricingInputArbitrary(), todayArbitrary, (input, today) => {
      const quote = computeQuote(input, C, today);
      assert.equal(quote.calendar.length, 28);
      for (const day of quote.calendar) {
        assert.equal(day.slots.length, 3);
      }
    }),
    { numRuns: propertyRuns },
  );
});

test('property: priceForSlot always equals the matching calendar entry', () => {
  fc.assert(
    fc.property(
      pricingInputArbitrary(),
      todayArbitrary,
      fc.integer({ min: 0, max: 27 }),
      fc.constantFrom(...SLOT_KEYS),
      (input, today, dayOffset, slot) => {
        const quote = computeQuote(input, C, today);
        const day = quote.calendar[dayOffset];
        assert.ok(day);
        const calendarSlot = day.slots.find((candidate) => candidate.slot === slot);
        assert.ok(calendarSlot);
        const direct = priceForSlot(input, C, today, day.date, slot);
        assert.equal(direct.pricePence, calendarSlot.pricePence);
      },
    ),
    { numRuns: propertyRuns },
  );
});
