import assert from 'node:assert/strict';
import { test } from 'vitest';
import { DEFAULT_PRICING_CONFIG as C } from '../src/config.default';
import { formatIsoDate, londonToday, parseIsoDate } from '../src/dates';
import {
  computeQuote,
  poundsToPence,
  round2,
  roundHalfUp,
  validateConfig,
} from '../src/engine';
import type { PricingConfig, PricingInput, ServiceKey, ServicePricing, VariantPricing } from '../src/types';

const validInput: PricingInput = {
  service: 'man-and-van',
  variant: 'standard',
  distanceMiles: 12.4,
  pickup: { floor: 2, hasLift: false },
  dropoff: { floor: 0, hasLift: false },
  inventory: [{ itemId: 'box', name: 'Box', quantity: 1, unitVolumeM3: 0.3 }],
  access: { carryMetres: 25, narrowAccess: false, permitZone: false },
  addons: { helpers: 1, packing: false, assembly: false },
};

function configWith(mutator: (config: PricingConfig) => void): PricingConfig {
  const config = structuredClone(C);
  mutator(config);
  return config;
}

function firstIkeaVariant(config: PricingConfig): VariantPricing {
  const variant = config.services.ikea.variants[0];
  assert.ok(variant);
  return variant;
}

test('rounding helpers reject non-finite and negative money values', () => {
  assert.equal(roundHalfUp(148.004999999999), 148);
  assert.equal(poundsToPence(1.235), 124);
  assert.equal(round2(1.235), 1.24);
  assert.throws(() => roundHalfUp(Number.POSITIVE_INFINITY), { code: 'NON_FINITE' });
  assert.throws(() => roundHalfUp(-1), { code: 'NON_FINITE' });
});

test('date helpers reject malformed and unreal dates', () => {
  assert.deepEqual(parseIsoDate('2026-10-12'), { year: 2026, month: 10, day: 12 });
  assert.equal(formatIsoDate({ year: 26, month: 1, day: 2 }), '0026-01-02');
  assert.throws(() => parseIsoDate('2026/10/12'), RangeError);
  assert.throws(() => parseIsoDate('2026-02-30'), RangeError);
});

test('londonToday reports missing Intl parts as an error', () => {
  const original = Intl.DateTimeFormat;
  const brokenFormatter = function BrokenDateTimeFormat(): Pick<Intl.DateTimeFormat, 'formatToParts'> {
    return { formatToParts: () => [] };
  } as unknown as typeof Intl.DateTimeFormat;

  Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, value: brokenFormatter });
  try {
    assert.throws(() => londonToday(new Date('2026-10-12T00:00:00Z')), /Intl did not return year/);
  } finally {
    Object.defineProperty(Intl, 'DateTimeFormat', { configurable: true, value: original });
  }
});

test('validateInput rejects every public typed error category', () => {
  assert.throws(() => computeQuote({ ...validInput, service: 'unknown' as ServiceKey }, C, '2026-11-02'), {
    code: 'UNKNOWN_SERVICE',
  });
  assert.throws(() => computeQuote({ ...validInput, variant: 'nope' }, C, '2026-11-02'), {
    code: 'UNKNOWN_VARIANT',
  });
  assert.throws(() => computeQuote({ ...validInput, distanceMiles: Number.NaN }, C, '2026-11-02'), {
    code: 'INVALID_DISTANCE',
  });
  assert.throws(() => computeQuote({ ...validInput, distanceMiles: 2_001 }, C, '2026-11-02'), {
    code: 'INVALID_DISTANCE',
  });
  assert.throws(() => computeQuote({ ...validInput, pickup: { floor: 31, hasLift: false } }, C, '2026-11-02'), {
    code: 'INVALID_FLOOR',
  });
  assert.throws(() => computeQuote({ ...validInput, dropoff: null }, C, '2026-11-02'), {
    code: 'DROPOFF_REQUIRED',
  });
  assert.throws(
    () => computeQuote({ ...validInput, dropoff: { floor: 31, hasLift: false } }, C, '2026-11-02'),
    { code: 'INVALID_FLOOR' },
  );
  assert.throws(
    () =>
      computeQuote(
        { ...validInput, service: 'rubbish', variant: 'standard', dropoff: { floor: 0, hasLift: false } },
        C,
        '2026-11-02',
      ),
    { code: 'DROPOFF_NOT_ALLOWED' },
  );
  assert.throws(
    () => computeQuote({ ...validInput, inventory: [{ itemId: '', name: 'Broken', quantity: 1, unitVolumeM3: 1 }] }, C, '2026-11-02'),
    { code: 'INVALID_INVENTORY' },
  );
  assert.throws(
    () =>
      computeQuote(
        { ...validInput, inventory: [{ itemId: 'box', name: 'Box', quantity: 0, unitVolumeM3: 1 }] },
        C,
        '2026-11-02',
      ),
    { code: 'INVALID_INVENTORY' },
  );
  assert.throws(
    () =>
      computeQuote(
        { ...validInput, inventory: [{ itemId: 'box', name: 'Box', quantity: 1, unitVolumeM3: Number.NaN }] },
        C,
        '2026-11-02',
      ),
    { code: 'INVALID_INVENTORY' },
  );
  assert.throws(() => computeQuote({ ...validInput, access: { ...validInput.access, carryMetres: 501 } }, C, '2026-11-02'), {
    code: 'INVALID_ACCESS',
  });
  assert.throws(() => computeQuote({ ...validInput, addons: { ...validInput.addons, helpers: 4 } }, C, '2026-11-02'), {
    code: 'INVALID_ADDONS',
  });
});

test('validateConfig reports structural pricing-config problems', () => {
  const serviceMap = (config: PricingConfig): Partial<Record<ServiceKey, ServicePricing>> => config.services;
  const cases: Array<[string, (config: PricingConfig) => void, string]> = [
    [
      'schemaVersion',
      (config) => {
        (config as unknown as { schemaVersion: number }).schemaVersion = 2;
      },
      'schemaVersion must be 1',
    ],
    [
      'missing service',
      (config) => {
        delete serviceMap(config).ikea;
      },
      'services.ikea is missing',
    ],
    [
      'base price',
      (config) => {
        config.services.ikea.basePrice = -1;
      },
      'services.ikea.basePrice must be a number ≥ 0',
    ],
    [
      'empty variants',
      (config) => {
        config.services.ikea.variants = [];
      },
      'services.ikea needs at least one variant',
    ],
    [
      'duplicate variant',
      (config) => {
        config.services.ikea.variants.push({ ...firstIkeaVariant(config) });
      },
      'services.ikea has duplicate variant standard',
    ],
    [
      'variant multiplier',
      (config) => {
        firstIkeaVariant(config).multiplier = 4;
      },
      'services.ikea.variants.standard.multiplier must be between 0.5 and 3',
    ],
    [
      'distance',
      (config) => {
        config.distance.perMile = -1;
      },
      'distance.perMile must be a number ≥ 0',
    ],
    [
      'large distance',
      (config) => {
        config.largeInventory.distance = { ...config.distance, discountMultiplier: 4 };
      },
      'largeInventory.distance.discountMultiplier must be between 0.5 and 3',
    ],
    [
      'large minimum',
      (config) => {
        config.largeInventory.inventory.minimum = -1;
      },
      'largeInventory.inventory.minimum must be a number ≥ 0',
    ],
    [
      'floor multiplier',
      (config) => {
        config.floors.noLiftMultiplier = 4;
      },
      'floors.noLiftMultiplier must be between 0.5 and 3',
    ],
    [
      'inventory',
      (config) => {
        config.inventory.perM3 = -1;
      },
      'inventory.perM3 must be a number ≥ 0',
    ],
    [
      'access',
      (config) => {
        config.access.permitZone = -1;
      },
      'access.permitZone must be a number ≥ 0',
    ],
    [
      'addon',
      (config) => {
        config.addons.assembly = -1;
      },
      'addons.assembly must be a number ≥ 0',
    ],
    [
      'max helpers',
      (config) => {
        config.addons.maxHelpers = 11;
      },
      'addons.maxHelpers must be an integer 0–10',
    ],
    [
      'custom size',
      (config) => {
        config.customItemSizes.S = 0;
      },
      'customItemSizes.S must be > 0 and ≤ 20',
    ],
    [
      'urgency',
      (config) => {
        config.multipliers.urgency.dayOffset0 = 4;
      },
      'multipliers.urgency.dayOffset0 must be between 0.5 and 3',
    ],
    [
      'slot multiplier',
      (config) => {
        config.multipliers.slot.MORNING = 4;
      },
      'multipliers.slot.MORNING must be between 0.5 and 3',
    ],
    [
      'peak month',
      (config) => {
        config.multipliers.peakMonths = [13];
      },
      'multipliers.peakMonths must contain months 1–12',
    ],
    [
      'end of month window',
      (config) => {
        config.multipliers.endOfMonthLastDays = 11;
      },
      'multipliers.endOfMonthLastDays must be an integer 0–10',
    ],
    [
      'calendar days',
      (config) => {
        config.calendarDays = 61;
      },
      'calendarDays must be an integer 7–60',
    ],
  ];

  for (const [name, mutate, expectedProblem] of cases) {
    const config = configWith(mutate);
    assert.ok(validateConfig(config).includes(expectedProblem), name);
  }
});
