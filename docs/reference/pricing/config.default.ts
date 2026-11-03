/**
 * Pricing config v1 — values from the owner's pricing specification.
 * Codex copies this to packages/pricing/src/config.default.ts and seeds it as PricingConfigVersion v1.
 * Live prices come from the ACTIVE PricingConfigVersion in the database (editable in the Admin app).
 *
 * Owner decisions still open are marked OWNER-DECISION (see docs/workflows/04-pricing-engine.md §7).
 * Their defaults are deliberately neutral (multiplier 1.0 / standard rates) so no number is invented.
 */
import type { PricingConfig } from './types.ts';

const standard = (label = 'Standard') => [
  { key: 'standard', label, multiplier: 1, manualQuote: false },
];

export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  schemaVersion: 1,
  services: {
    'house-removals': {
      label: 'House removals',
      basePrice: 120,
      requiresDropoff: true,
      // OWNER-DECISION P1: multipliers per property size. Neutral 1.0 until the owner sets them.
      variants: [
        { key: 'studio', label: 'Studio', multiplier: 1, manualQuote: false },
        { key: '1-bed', label: '1 bedroom', multiplier: 1, manualQuote: false },
        { key: '2-bed', label: '2 bedrooms', multiplier: 1, manualQuote: false },
        { key: '3-bed', label: '3 bedrooms', multiplier: 1, manualQuote: false },
        { key: '4-bed-plus', label: '4+ bedrooms', multiplier: 1, manualQuote: false },
      ],
    },
    furniture: { label: 'Furniture delivery', basePrice: 60, requiresDropoff: true, variants: standard() },
    storage: {
      label: 'Storage moves',
      basePrice: 45,
      requiresDropoff: true,
      variants: [
        { key: 'to-storage', label: 'Into storage', multiplier: 1, manualQuote: false },
        { key: 'from-storage', label: 'Out of storage', multiplier: 1, manualQuote: false },
      ],
    },
    office: {
      label: 'Office moves',
      basePrice: 150,
      requiresDropoff: true,
      variants: [
        { key: 'small', label: 'Up to 5 desks', multiplier: 1, manualQuote: false },
        { key: 'medium', label: '6–15 desks', multiplier: 1, manualQuote: false },
        // 16+ desks needs a survey: routed to manual quote by default.
        { key: 'large', label: '16+ desks', multiplier: 1, manualQuote: true },
      ],
    },
    'man-and-van': { label: 'Man and van', basePrice: 45, requiresDropoff: true, variants: standard() },
    student: {
      label: 'Student moves',
      basePrice: 80,
      requiresDropoff: true,
      variants: [
        { key: 'halls', label: 'Halls of residence', multiplier: 1, manualQuote: false },
        { key: 'shared-flat', label: 'Shared flat or house', multiplier: 1, manualQuote: false },
      ],
    },
    ikea: { label: 'IKEA & flat-pack delivery', basePrice: 70, requiresDropoff: true, variants: standard() },
    piano: {
      label: 'Piano moving',
      basePrice: 200,
      requiresDropoff: true,
      variants: [
        { key: 'digital', label: 'Digital piano', multiplier: 1, manualQuote: false },
        { key: 'upright', label: 'Upright piano', multiplier: 1, manualQuote: false },
        // Grand pianos always need a survey: manual quote.
        { key: 'baby-grand', label: 'Baby grand', multiplier: 1, manualQuote: true },
        { key: 'grand', label: 'Grand piano', multiplier: 1, manualQuote: true },
      ],
    },
    'same-day': { label: 'Same-day delivery', basePrice: 55, requiresDropoff: true, variants: standard() },
  },
  distance: { freeMiles: 5, perMile: 1.5, discountAfterBillableMiles: 20, discountMultiplier: 0.85 },
  largeInventory: {
    minItemsExclusive: 4,
    minVolumeM3: 1,
    inventory: { minimum: 75, perItem: 4, perM3: 12 },
    // OWNER-DECISION P2: separate distance rates for large loads. null = same as standard.
    distance: null,
  },
  floors: { perFloor: 8, noLiftMultiplier: 1.5 },
  inventory: { perItem: 2, perM3: 6 },
  access: { freeCarryMetres: 10, perMetreAfterFree: 0.5, narrowAccess: 25, permitZone: 20 },
  addons: { helper: 18, packing: 35, assembly: 25, maxHelpers: 3 },
  customItemSizes: { S: 0.1, M: 0.3, L: 0.8, XL: 1.5 },
  multipliers: {
    urgency: { dayOffset0: 1.4, dayOffset1: 1.2, dayOffset2: 1.1 },
    weekend: 1.15,
    peakMonths: [6, 7, 8],
    peakMonth: 1.1,
    endOfMonthLastDays: 3,
    endOfMonth: 1.08,
    slot: { MORNING: 1.05, AFTERNOON: 1.0, EVENING: 1.1 },
  },
  calendarDays: 28,
};
