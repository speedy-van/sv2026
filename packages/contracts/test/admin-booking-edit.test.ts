import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING_CONFIG, computeStaticBreakdown, priceForSlot, type PricingInput } from '@sv/pricing';
import { AdminBookingMutationResponseSchema, AdminBookingRepricePreviewSchema, BookingPricingConfigSchema, BookingPricingInputSchema, BookingStoredPriceSchema, RepricePreviewSchema, RepriceApplySchema } from '../src';

const input: PricingInput = { service: 'man-and-van', variant: 'standard', distanceMiles: 4, pickup: { floor: 0, hasLift: false }, dropoff: { floor: 0, hasLift: false }, inventory: [{ itemId: 'box', name: 'Box', quantity: 1, unitVolumeM3: 0.1 }], access: { carryMetres: 0, narrowAccess: false, permitZone: false }, addons: { helpers: 0, packing: false, assembly: false } };
const address = { line1: '12 Byres Road', town: 'Glasgow', postcode: 'G11 5JY', lat: 55.87, lng: -4.29, label: '12 Byres Road, Glasgow', source: 'MANUAL' };
const access = { floorChoice: 'GROUND', hasLift: false, carryMetres: 0, narrowAccess: false, permitZone: false };
const changes = { service: 'man-and-van', variant: 'standard', pickup: address, dropoff: address, pickupAccess: access, dropoffAccess: access, items: [{ kind: 'catalogue', itemSlug: 'box', quantity: 1 }], addons: input.addons };
const preview = { id: 'booking-one', expectedVersion: 3, currentTotalPence: 10000, newTotalPence: 12000, differencePence: 2000, oldBreakdownLines: [], newBreakdownLines: [], settle: 'EXTRA_CHARGE', settlementAmountPence: 1500 };

describe('admin booking edit contracts', () => {
  it('validates the persisted engine snapshot without inventing missing data', () => {
    expect(BookingPricingConfigSchema.parse(DEFAULT_PRICING_CONFIG)).toEqual(DEFAULT_PRICING_CONFIG);
    expect(BookingPricingInputSchema.parse(input)).toEqual(input);
    const price = priceForSlot(input, DEFAULT_PRICING_CONFIG, '2026-11-02', '2026-11-03', 'AFTERNOON');
    expect(BookingStoredPriceSchema.safeParse({ breakdown: computeStaticBreakdown(input, DEFAULT_PRICING_CONFIG), slot: { date: '2026-11-03', multipliers: price.multipliers, slot: 'AFTERNOON' } }).success).toBe(true);
    expect(BookingPricingInputSchema.safeParse({ ...input, access: undefined }).success).toBe(false);
    expect(BookingStoredPriceSchema.safeParse({ manual: true, pricePence: 10000 }).success).toBe(false);
  });
  it('accepts the original complete edit contract and rejects client prices or volumes', () => {
    expect(RepricePreviewSchema.safeParse({ expectedVersion: 3, changes }).success).toBe(true);
    expect(RepricePreviewSchema.safeParse({ expectedVersion: 3, changes: { ...changes, attribution: { utmSource: 'forged' } } }).success).toBe(false);
    expect(RepricePreviewSchema.safeParse({ expectedVersion: 3, changes: { ...changes, totalPence: 1 } }).success).toBe(false);
    expect(RepricePreviewSchema.safeParse({ expectedVersion: 3, changes: { ...changes, items: [{ ...changes.items[0], unitVolumeM3: 0 }] } }).success).toBe(false);
  });
  it('retains dropoff validation and requires the confirmed total and settlement on apply', () => {
    expect(RepricePreviewSchema.safeParse({ expectedVersion: 3, changes: { ...changes, dropoff: null } }).success).toBe(false);
    const action = { expectedVersion: 3, changes, expectedTotalPence: 12000, expectedSettlementPence: 1500, settle: 'EXTRA_CHARGE', reason: 'More furniture' };
    expect(RepriceApplySchema.safeParse(action).success).toBe(true);
    expect(RepriceApplySchema.safeParse({ ...action, expectedSettlementPence: undefined }).success).toBe(false);
  });
  it('separates the change in agreed price from the actual amount to collect', () => {
    expect(AdminBookingRepricePreviewSchema.parse(preview)).toEqual(preview);
    expect(AdminBookingMutationResponseSchema.parse({ ok: true, id: 'booking-one', version: 4 })).toEqual({ ok: true, id: 'booking-one', version: 4 });
  });
  it.each([{ differencePence: 1 }, { settle: 'NONE' }, { settlementAmountPence: 0 }, { settlementAmountPence: -1 }])('rejects contradictory preview amounts %j', (override) => {
    expect(AdminBookingRepricePreviewSchema.safeParse({ ...preview, ...override }).success).toBe(false);
  });
});
