/**
 * Speedy Van pricing engine — public types.
 * REFERENCE IMPLEMENTATION. Codex copies this file to packages/pricing/src/types.ts unchanged.
 * Pure TypeScript, zero runtime dependencies, runs identically on Node (Vercel) and Hermes (iOS apps).
 */

export const SERVICE_KEYS = [
  'house-removals',
  'furniture',
  'storage',
  'office',
  'man-and-van',
  'student',
  'ikea',
  'rubbish',
  'piano',
  'same-day',
] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SLOT_KEYS = ['MORNING', 'AFTERNOON', 'EVENING'] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];

/** Civil date in Europe/London, format YYYY-MM-DD. Never a JS Date. */
export type IsoDate = string;

export interface DistanceRates {
  /** Miles included at no charge. Default 5. */
  freeMiles: number;
  /** £ per billable mile. Default 1.50. */
  perMile: number;
  /** After this many BILLABLE miles the discounted rate applies. Default 20. */
  discountAfterBillableMiles: number;
  /** Multiplier applied to perMile beyond the threshold. Default 0.85. */
  discountMultiplier: number;
}

export interface VariantPricing {
  key: string;
  label: string;
  /** Applied to the service base price. Default 1.0 (owner tunes in Admin → Pricing). */
  multiplier: number;
  /** true = no instant price; customer is routed to a manual quote. */
  manualQuote: boolean;
}

export interface ServicePricing {
  label: string;
  /** £ base price before variant multiplier. */
  basePrice: number;
  /** false = single address job (e.g. rubbish removal); distance is 0. */
  requiresDropoff: boolean;
  variants: VariantPricing[];
}

export interface PricingConfig {
  schemaVersion: 1;
  services: Record<ServiceKey, ServicePricing>;
  distance: DistanceRates;
  largeInventory: {
    /** Large when itemCount > minItemsExclusive AND volume >= minVolumeM3. Defaults 4 and 1. */
    minItemsExclusive: number;
    minVolumeM3: number;
    /** Inventory cost when large: max(minimum, items*perItem + volume*perM3). */
    inventory: { minimum: number; perItem: number; perM3: number };
    /** Distance override when large. null = use standard distance rates. */
    distance: DistanceRates | null;
  };
  floors: { perFloor: number; noLiftMultiplier: number };
  inventory: { perItem: number; perM3: number };
  access: {
    freeCarryMetres: number;
    perMetreAfterFree: number;
    narrowAccess: number;
    permitZone: number;
  };
  addons: { helper: number; packing: number; assembly: number; maxHelpers: number };
  /** m³ per unit for customer-described items that aren't in the catalogue. */
  customItemSizes: { S: number; M: number; L: number; XL: number };
  multipliers: {
    urgency: { dayOffset0: number; dayOffset1: number; dayOffset2: number };
    weekend: number;
    /** Months 1–12. Default [6, 7, 8]. */
    peakMonths: number[];
    peakMonth: number;
    /** Final N days of a month. Default 3. */
    endOfMonthLastDays: number;
    endOfMonth: number;
    slot: Record<SlotKey, number>;
  };
  calendarDays: number;
}

export interface AddressAccess {
  /** Floors of stairs/lift travel. Ground = 0, basement = 1 (UI maps it). Max 30. */
  floor: number;
  hasLift: boolean;
}

export interface InventoryLine {
  itemId: string;
  name: string;
  quantity: number;
  /** Volume of ONE unit in m³ (snapshotted from the catalogue at quote time). */
  unitVolumeM3: number;
}

export interface PricingInput {
  service: ServiceKey;
  variant: string;
  /** Road miles, already rounded to 2 dp by the route service. Stored on the quote. */
  distanceMiles: number;
  pickup: AddressAccess;
  /** Must be null when the service does not require a dropoff. */
  dropoff: AddressAccess | null;
  inventory: InventoryLine[];
  /** Job-level access, derived from per-address answers (see 04-pricing-engine.md §5). */
  access: { carryMetres: number; narrowAccess: boolean; permitZone: boolean };
  addons: { helpers: number; packing: boolean; assembly: boolean };
}

export interface StaticBreakdown {
  basePence: number;
  variantMultiplier: number;
  baseAfterVariantPence: number;
  distance: {
    miles: number;
    billableMiles: number;
    fullRateMiles: number;
    discountedMiles: number;
    mode: 'STANDARD' | 'LARGE_INVENTORY';
    pence: number;
  };
  floors: { pickupPence: number; dropoffPence: number };
  inventory: { itemCount: number; volumeM3: number; mode: 'STANDARD' | 'LARGE'; pence: number };
  access: { carryPence: number; narrowPence: number; permitPence: number; pence: number };
  addons: { helpersPence: number; packingPence: number; assemblyPence: number; pence: number };
  staticSubtotalPence: number;
}

export interface SlotMultipliers {
  urgency: number;
  weekend: number;
  peakMonth: number;
  endOfMonth: number;
  slot: number;
}

export interface SlotPrice {
  slot: SlotKey;
  multipliers: SlotMultipliers;
  pricePence: number;
}

export interface CalendarDay {
  date: IsoDate;
  dayOffset: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  slots: SlotPrice[];
}

export type ManualQuoteReason = 'VARIANT_REQUIRES_SURVEY';

export interface QuoteResult {
  breakdown: StaticBreakdown;
  calendar: CalendarDay[];
  requiresManualQuote: boolean;
  manualQuoteReasons: ManualQuoteReason[];
}

export type PricingErrorCode =
  | 'UNKNOWN_SERVICE'
  | 'UNKNOWN_VARIANT'
  | 'INVALID_DISTANCE'
  | 'INVALID_FLOOR'
  | 'DROPOFF_REQUIRED'
  | 'DROPOFF_NOT_ALLOWED'
  | 'INVALID_INVENTORY'
  | 'INVALID_ACCESS'
  | 'INVALID_ADDONS'
  | 'INVALID_DATE'
  | 'INVALID_CONFIG'
  | 'NON_FINITE';
