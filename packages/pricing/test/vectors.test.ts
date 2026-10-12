import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { DEFAULT_PRICING_CONFIG as C } from '../src/config.default';
import { computeQuote } from '../src/engine';
import { formatPriceBreakdownLines } from '../src/format';
import type { CalendarDay, PricingInput, StaticBreakdown } from '../src/types';

interface GoldenCalendarDay {
  date: string;
  MORNING: number;
  AFTERNOON: number;
  EVENING: number;
}

interface GoldenVector {
  id: string;
  note: string;
  today: string;
  input: PricingInput;
  expected: {
    staticSubtotalPence: number;
    breakdown: StaticBreakdown;
    requiresManualQuote: boolean;
    calendar: GoldenCalendarDay[];
  };
}

interface GoldenVectorFile {
  configVersion: string;
  generatedBy: string;
  vectors: GoldenVector[];
}

function loadGoldenVectors(): GoldenVectorFile {
  const path = new URL('../../../docs/reference/pricing/vectors.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8')) as GoldenVectorFile;
}

function slotPrices(day: CalendarDay): Record<'MORNING' | 'AFTERNOON' | 'EVENING', number> {
  return {
    MORNING: day.slots[0]?.pricePence ?? Number.NaN,
    AFTERNOON: day.slots[1]?.pricePence ?? Number.NaN,
    EVENING: day.slots[2]?.pricePence ?? Number.NaN,
  };
}

test('golden vectors match every breakdown and all 672 slot prices', () => {
  const vectors = loadGoldenVectors();
  assert.equal(vectors.configVersion, 'DEFAULT_PRICING_CONFIG v1');
  assert.equal(vectors.generatedBy, 'reference engine');
  assert.equal(vectors.vectors.length, 8);

  let checkedSlotPrices = 0;

  for (const vector of vectors.vectors) {
    const quote = computeQuote(vector.input, C, vector.today);
    assert.equal(quote.breakdown.staticSubtotalPence, vector.expected.staticSubtotalPence, vector.id);
    assert.deepEqual(quote.breakdown, vector.expected.breakdown, vector.id);
    assert.equal(quote.requiresManualQuote, vector.expected.requiresManualQuote, vector.id);
    assert.equal(quote.calendar.length, vector.expected.calendar.length, vector.id);

    for (const [dayIndex, expectedDay] of vector.expected.calendar.entries()) {
      const actualDay = quote.calendar[dayIndex];
      assert.ok(actualDay, `${vector.id} missing day ${String(dayIndex)}`);
      assert.equal(actualDay.date, expectedDay.date, vector.id);
      assert.deepEqual(slotPrices(actualDay), {
        MORNING: expectedDay.MORNING,
        AFTERNOON: expectedDay.AFTERNOON,
        EVENING: expectedDay.EVENING,
      });
      checkedSlotPrices += 3;
    }
  }

  assert.equal(checkedSlotPrices, 672);
});

test('formatPriceBreakdownLines returns UI lines that sum to the static subtotal', () => {
  const vector = loadGoldenVectors().vectors[1];
  assert.ok(vector);
  const quote = computeQuote(vector.input, C, vector.today);
  const lines = formatPriceBreakdownLines(quote.breakdown);
  assert.deepEqual(
    lines.map((line) => line.key),
    ['base', 'distance', 'pickup-floors', 'dropoff-floors', 'inventory', 'access', 'addons'],
  );
  assert.equal(
    lines.reduce((sum, line) => sum + line.pence, 0),
    quote.breakdown.staticSubtotalPence,
  );
});

test('formatPriceBreakdownLines labels variant-adjusted base prices and omits zero lines', () => {
  const vector = loadGoldenVectors().vectors[3];
  assert.ok(vector);
  const config = structuredClone(C);
  config.services['same-day'].variants[0] = {
    key: 'standard',
    label: 'Standard',
    multiplier: 1.25,
    manualQuote: false,
  };
  const quote = computeQuote(vector.input, config, vector.today);
  const lines = formatPriceBreakdownLines(quote.breakdown);
  assert.deepEqual(lines, [{ key: 'base', label: 'Base price with service variant', pence: 6875 }]);
});
