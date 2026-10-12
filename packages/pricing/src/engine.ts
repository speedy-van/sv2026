/**
 * Speedy Van pricing engine — REFERENCE IMPLEMENTATION (tested).
 * Codex copies this to packages/pricing/src/engine.ts. Do not "improve" the arithmetic:
 * any change must keep every golden vector in vectors.json passing to the penny.
 *
 * Algorithm (owner spec):
 *   staticSubtotal = base×variant + distance + pickup floors + dropoff floors
 *                  + inventory + access + addons
 *   slotPrice      = round(staticSubtotal × urgency × weekend × peakMonth × endOfMonth × slot)
 * Output: calendarDays (28) × 3 slots, starting at `today` (Europe/London civil date).
 *
 * Precision rules (04-pricing-engine.md §4):
 *   - All money is integer pence. Config is in pounds and converted once.
 *   - Each component is rounded half-up to the penny; the subtotal is their exact sum.
 *   - Slot price = subtotal pence × multipliers (in the spec's order), rounded half-up.
 *   - Binary float noise is removed with toPrecision(15) before rounding.
 */
import { addDays, daysInMonth, parseIsoDate, weekdayOf } from './dates';
import {
  SERVICE_KEYS,
  SLOT_KEYS,
  type CalendarDay,
  type DistanceRates,
  type IsoDate,
  type ManualQuoteReason,
  type PricingConfig,
  type PricingErrorCode,
  type PricingInput,
  type QuoteResult,
  type ServiceKey,
  type ServicePricing,
  type SlotPrice,
  type VariantPricing,
  type StaticBreakdown,
} from './types';

export class PricingError extends Error {
  readonly code: PricingErrorCode;
  constructor(code: PricingErrorCode, message: string) {
    super(message);
    this.name = 'PricingError';
    this.code = code;
  }
}

/** Round half-up to an integer after stripping binary floating-point noise. */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new PricingError('NON_FINITE', `Non-finite value: ${String(value)}`);
  if (value < 0) throw new PricingError('NON_FINITE', `Negative money value: ${String(value)}`);
  return Math.round(Number(value.toPrecision(15)));
}

export function poundsToPence(pounds: number): number {
  return roundHalfUp(pounds * 100);
}

/** Display helper: 2 dp, noise-free. */
export function round2(value: number): number {
  return Math.round(Number((value * 100).toPrecision(15))) / 100;
}

const MAX_DISTANCE_MILES = 2000;
const MAX_FLOOR = 30;
const MAX_QTY_PER_LINE = 500;
const MAX_UNIT_VOLUME_M3 = 20;
const MAX_CARRY_METRES = 500;

function isNonNegInt(n: unknown, max: number): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;
}

function findVariant(service: ServicePricing, variantKey: string, serviceKey: string): VariantPricing {
  const variant = service.variants.find((v) => v.key === variantKey);
  if (!variant) {
    throw new PricingError('UNKNOWN_VARIANT', `Unknown variant "${variantKey}" for ${serviceKey}`);
  }
  return variant;
}

export function validateInput(input: PricingInput, config: PricingConfig): void {
  const serviceKey = input.service as string;
  if (!(SERVICE_KEYS as readonly string[]).includes(serviceKey)) {
    throw new PricingError('UNKNOWN_SERVICE', `Unknown service: ${serviceKey}`);
  }
  const service = config.services[input.service];
  findVariant(service, input.variant, serviceKey);
  if (
    typeof input.distanceMiles !== 'number' ||
    !Number.isFinite(input.distanceMiles) ||
    input.distanceMiles < 0 ||
    input.distanceMiles > MAX_DISTANCE_MILES
  ) {
    throw new PricingError('INVALID_DISTANCE', `Invalid distance: ${String(input.distanceMiles)}`);
  }
  if (!isNonNegInt(input.pickup.floor, MAX_FLOOR)) {
    throw new PricingError('INVALID_FLOOR', `Invalid pickup floor: ${String(input.pickup.floor)}`);
  }
  if (service.requiresDropoff) {
    if (!input.dropoff) throw new PricingError('DROPOFF_REQUIRED', `${input.service} requires a dropoff`);
    if (!isNonNegInt(input.dropoff.floor, MAX_FLOOR)) {
      throw new PricingError('INVALID_FLOOR', `Invalid dropoff floor: ${String(input.dropoff.floor)}`);
    }
  } else {
    if (input.dropoff !== null) {
      throw new PricingError('DROPOFF_NOT_ALLOWED', `${input.service} is a single-address job`);
    }
    if (input.distanceMiles !== 0) {
      throw new PricingError('INVALID_DISTANCE', `${input.service} must be priced with distance 0`);
    }
  }
  for (const line of input.inventory) {
    if (
      !line.itemId ||
      !isNonNegInt(line.quantity, MAX_QTY_PER_LINE) ||
      line.quantity === 0 ||
      typeof line.unitVolumeM3 !== 'number' ||
      !Number.isFinite(line.unitVolumeM3) ||
      line.unitVolumeM3 <= 0 ||
      line.unitVolumeM3 > MAX_UNIT_VOLUME_M3
    ) {
      throw new PricingError('INVALID_INVENTORY', `Invalid inventory line: ${JSON.stringify(line)}`);
    }
  }
  if (!isNonNegInt(input.access.carryMetres, MAX_CARRY_METRES)) {
    throw new PricingError('INVALID_ACCESS', `Invalid carry distance: ${String(input.access.carryMetres)}`);
  }
  if (!isNonNegInt(input.addons.helpers, config.addons.maxHelpers)) {
    throw new PricingError('INVALID_ADDONS', `Invalid helpers: ${String(input.addons.helpers)}`);
  }
}

function distanceComponent(miles: number, rates: DistanceRates) {
  const billable = Math.max(0, miles - rates.freeMiles);
  const fullRateMiles = Math.min(billable, rates.discountAfterBillableMiles);
  const discountedMiles = Math.max(0, billable - rates.discountAfterBillableMiles);
  const perMilePence = rates.perMile * 100;
  const pence = roundHalfUp(
    fullRateMiles * perMilePence + discountedMiles * perMilePence * rates.discountMultiplier,
  );
  return {
    billableMiles: round2(billable),
    fullRateMiles: round2(fullRateMiles),
    discountedMiles: round2(discountedMiles),
    pence,
  };
}

function floorPence(
  access: { floor: number; hasLift: boolean } | null,
  config: PricingConfig,
): number {
  if (!access || access.floor <= 0) return 0;
  const multiplier = access.hasLift ? 1 : config.floors.noLiftMultiplier;
  return roundHalfUp(access.floor * config.floors.perFloor * 100 * multiplier);
}

export function computeStaticBreakdown(input: PricingInput, config: PricingConfig): StaticBreakdown {
  validateInput(input, config);
  const service = config.services[input.service];
  const variant = findVariant(service, input.variant, input.service);

  const basePence = poundsToPence(service.basePrice);
  const baseAfterVariantPence = roundHalfUp(basePence * variant.multiplier);

  // Inventory first: "large inventory" also decides which distance rates apply.
  const itemCount = input.inventory.reduce((sum, l) => sum + l.quantity, 0);
  const rawVolume = input.inventory.reduce((sum, l) => sum + l.quantity * l.unitVolumeM3, 0);
  const volumeM3 = Number(rawVolume.toFixed(4)); // 0.7 + 0.3 must equal exactly 1
  const isLarge =
    itemCount > config.largeInventory.minItemsExclusive && volumeM3 >= config.largeInventory.minVolumeM3;

  const inventoryPence = isLarge
    ? Math.max(
        poundsToPence(config.largeInventory.inventory.minimum),
        roundHalfUp(
          itemCount * config.largeInventory.inventory.perItem * 100 +
            volumeM3 * config.largeInventory.inventory.perM3 * 100,
        ),
      )
    : roundHalfUp(itemCount * config.inventory.perItem * 100 + volumeM3 * config.inventory.perM3 * 100);

  const largeDistanceRates = config.largeInventory.distance;
  const useLargeDistance = isLarge && largeDistanceRates !== null;
  const rates = useLargeDistance ? largeDistanceRates : config.distance;
  const distance = distanceComponent(input.distanceMiles, rates);

  const pickupPence = floorPence(input.pickup, config);
  const dropoffPence = floorPence(input.dropoff, config);

  const carryPence = roundHalfUp(
    Math.max(0, input.access.carryMetres - config.access.freeCarryMetres) * config.access.perMetreAfterFree * 100,
  );
  const narrowPence = input.access.narrowAccess ? poundsToPence(config.access.narrowAccess) : 0;
  const permitPence = input.access.permitZone ? poundsToPence(config.access.permitZone) : 0;

  const helpersPence = input.addons.helpers * poundsToPence(config.addons.helper);
  const packingPence = input.addons.packing ? poundsToPence(config.addons.packing) : 0;
  const assemblyPence = input.addons.assembly ? poundsToPence(config.addons.assembly) : 0;

  const accessPence = carryPence + narrowPence + permitPence;
  const addonsPence = helpersPence + packingPence + assemblyPence;

  const staticSubtotalPence =
    baseAfterVariantPence + distance.pence + pickupPence + dropoffPence + inventoryPence + accessPence + addonsPence;

  return {
    basePence,
    variantMultiplier: variant.multiplier,
    baseAfterVariantPence,
    distance: {
      miles: input.distanceMiles,
      billableMiles: distance.billableMiles,
      fullRateMiles: distance.fullRateMiles,
      discountedMiles: distance.discountedMiles,
      mode: useLargeDistance ? 'LARGE_INVENTORY' : 'STANDARD',
      pence: distance.pence,
    },
    floors: { pickupPence, dropoffPence },
    inventory: { itemCount, volumeM3, mode: isLarge ? 'LARGE' : 'STANDARD', pence: inventoryPence },
    access: { carryPence, narrowPence, permitPence, pence: accessPence },
    addons: { helpersPence, packingPence, assemblyPence, pence: addonsPence },
    staticSubtotalPence,
  };
}

export function slotPricePence(
  staticSubtotalPence: number,
  m: { urgency: number; weekend: number; peakMonth: number; endOfMonth: number; slot: number },
): number {
  // Spec order: subtotal × urgency × weekend × peakMonth × endOfMonth × slot
  return roundHalfUp(staticSubtotalPence * m.urgency * m.weekend * m.peakMonth * m.endOfMonth * m.slot);
}

export function buildCalendar(staticSubtotalPence: number, today: IsoDate, config: PricingConfig): CalendarDay[] {
  try {
    parseIsoDate(today);
  } catch {
    throw new PricingError('INVALID_DATE', `Invalid today: ${today}`);
  }
  const mult = config.multipliers;
  const days: CalendarDay[] = [];
  for (let dayOffset = 0; dayOffset < config.calendarDays; dayOffset++) {
    const date = addDays(today, dayOffset);
    const { year, month, day } = parseIsoDate(date);
    const weekday = weekdayOf(date);
    const urgency =
      dayOffset === 0
        ? mult.urgency.dayOffset0
        : dayOffset === 1
          ? mult.urgency.dayOffset1
          : dayOffset === 2
            ? mult.urgency.dayOffset2
            : 1;
    const weekend = weekday === 0 || weekday === 6 ? mult.weekend : 1;
    const peakMonth = mult.peakMonths.includes(month) ? mult.peakMonth : 1;
    const endOfMonth = day > daysInMonth(year, month) - mult.endOfMonthLastDays ? mult.endOfMonth : 1;
    const slots: SlotPrice[] = SLOT_KEYS.map((slot) => {
      const multipliers = { urgency, weekend, peakMonth, endOfMonth, slot: mult.slot[slot] };
      return { slot, multipliers, pricePence: slotPricePence(staticSubtotalPence, multipliers) };
    });
    days.push({ date, dayOffset, weekday, slots });
  }
  return days;
}

/** Main entry point. Pure: same input + config + today ⇒ same output, on every platform. */
export function computeQuote(input: PricingInput, config: PricingConfig, today: IsoDate): QuoteResult {
  const breakdown = computeStaticBreakdown(input, config);
  const calendar = buildCalendar(breakdown.staticSubtotalPence, today, config);
  const variant = findVariant(config.services[input.service], input.variant, input.service);
  const manualQuoteReasons: ManualQuoteReason[] = variant.manualQuote ? ['VARIANT_REQUIRES_SURVEY'] : [];
  return { breakdown, calendar, requiresManualQuote: manualQuoteReasons.length > 0, manualQuoteReasons };
}

/** Price of one specific date/slot — used by booking creation and admin re-pricing. */
export function priceForSlot(
  input: PricingInput,
  config: PricingConfig,
  today: IsoDate,
  date: IsoDate,
  slot: (typeof SLOT_KEYS)[number],
): { pricePence: number; breakdown: StaticBreakdown; multipliers: SlotPrice['multipliers'] } {
  const quote = computeQuote(input, config, today);
  const day = quote.calendar.find((d) => d.date === date);
  if (!day) {
    throw new PricingError('INVALID_DATE', `${date} is outside the ${String(config.calendarDays)}-day window`);
  }
  const s = day.slots.find((x) => x.slot === slot);
  if (!s) {
    throw new PricingError('INVALID_DATE', `Slot ${slot} missing for ${date}`);
  }
  return { pricePence: s.pricePence, breakdown: quote.breakdown, multipliers: s.multipliers };
}

/** Structural validation for configs saved from the Admin app. Returns a list of problems. */
export function validateConfig(config: PricingConfig): string[] {
  type ValidatablePricingConfig = Omit<PricingConfig, 'schemaVersion' | 'services'> & {
    schemaVersion: number;
    services: Partial<Record<ServiceKey, ServicePricing>>;
  };

  const candidate = config as ValidatablePricingConfig;
  const problems: string[] = [];
  const positive = (path: string, v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) problems.push(`${path} must be a number ≥ 0`);
  };
  const multiplier = (path: string, v: unknown) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0.5 || v > 3) {
      problems.push(`${path} must be between 0.5 and 3`);
    }
  };
  if (candidate.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  for (const key of SERVICE_KEYS) {
    const s = candidate.services[key];
    if (!s) {
      problems.push(`services.${key} is missing`);
      continue;
    }
    positive(`services.${key}.basePrice`, s.basePrice);
    if (s.variants.length === 0) problems.push(`services.${key} needs at least one variant`);
    const keys = new Set<string>();
    for (const v of s.variants) {
      if (keys.has(v.key)) problems.push(`services.${key} has duplicate variant ${v.key}`);
      keys.add(v.key);
      multiplier(`services.${key}.variants.${v.key}.multiplier`, v.multiplier);
    }
  }
  const checkRates = (path: string, r: DistanceRates) => {
    positive(`${path}.freeMiles`, r.freeMiles);
    positive(`${path}.perMile`, r.perMile);
    positive(`${path}.discountAfterBillableMiles`, r.discountAfterBillableMiles);
    multiplier(`${path}.discountMultiplier`, r.discountMultiplier);
  };
  checkRates('distance', config.distance);
  if (config.largeInventory.distance) checkRates('largeInventory.distance', config.largeInventory.distance);
  positive('largeInventory.minItemsExclusive', config.largeInventory.minItemsExclusive);
  positive('largeInventory.minVolumeM3', config.largeInventory.minVolumeM3);
  positive('largeInventory.inventory.minimum', config.largeInventory.inventory.minimum);
  positive('largeInventory.inventory.perItem', config.largeInventory.inventory.perItem);
  positive('largeInventory.inventory.perM3', config.largeInventory.inventory.perM3);
  positive('floors.perFloor', config.floors.perFloor);
  multiplier('floors.noLiftMultiplier', config.floors.noLiftMultiplier);
  positive('inventory.perItem', config.inventory.perItem);
  positive('inventory.perM3', config.inventory.perM3);
  positive('access.freeCarryMetres', config.access.freeCarryMetres);
  positive('access.perMetreAfterFree', config.access.perMetreAfterFree);
  positive('access.narrowAccess', config.access.narrowAccess);
  positive('access.permitZone', config.access.permitZone);
  positive('addons.helper', config.addons.helper);
  positive('addons.packing', config.addons.packing);
  positive('addons.assembly', config.addons.assembly);
  if (!Number.isInteger(config.addons.maxHelpers) || config.addons.maxHelpers < 0 || config.addons.maxHelpers > 10) {
    problems.push('addons.maxHelpers must be an integer 0–10');
  }
  for (const size of ['S', 'M', 'L', 'XL'] as const) {
    const v = config.customItemSizes[size];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_UNIT_VOLUME_M3) {
      problems.push(`customItemSizes.${size} must be > 0 and ≤ ${String(MAX_UNIT_VOLUME_M3)}`);
    }
  }
  const m = config.multipliers;
  multiplier('multipliers.urgency.dayOffset0', m.urgency.dayOffset0);
  multiplier('multipliers.urgency.dayOffset1', m.urgency.dayOffset1);
  multiplier('multipliers.urgency.dayOffset2', m.urgency.dayOffset2);
  multiplier('multipliers.weekend', m.weekend);
  multiplier('multipliers.peakMonth', m.peakMonth);
  multiplier('multipliers.endOfMonth', m.endOfMonth);
  for (const slot of SLOT_KEYS) multiplier(`multipliers.slot.${slot}`, m.slot[slot]);
  if (!m.peakMonths.every((x) => Number.isInteger(x) && x >= 1 && x <= 12)) {
    problems.push('multipliers.peakMonths must contain months 1–12');
  }
  if (!Number.isInteger(m.endOfMonthLastDays) || m.endOfMonthLastDays < 0 || m.endOfMonthLastDays > 10) {
    problems.push('multipliers.endOfMonthLastDays must be an integer 0–10');
  }
  if (!Number.isInteger(config.calendarDays) || config.calendarDays < 7 || config.calendarDays > 60) {
    problems.push('calendarDays must be an integer 7–60');
  }
  return problems;
}
