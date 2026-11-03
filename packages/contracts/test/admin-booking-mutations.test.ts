import { describe, expect, it } from 'vitest';
import { AdminBookingPatchSchema, AdminBookingReschedulePreviewSchema, AdminReschedulePreviewRequestSchema, AdminRescheduleSchema, AdminUnassignBookingSchema, AssignBookingSchema, OfferBookingSchema } from '../src';

const schedule = { expectedVersion: 3, date: '2031-01-12', slot: 'MORNING', priceMode: 'KEEP_PRICE', reason: 'Customer requested another day' };
const preview = { id: 'booking-one', expectedVersion: 3, date: '2031-01-12', slot: 'MORNING', currentTotalPence: 10000, newTotalPence: 12000, differencePence: 2000, willUnassignDriver: true, settle: 'EXTRA_CHARGE', settlementAmountPence: 2000 };

describe('versioned admin booking mutations', () => {
  it('permits clearing internal notes and a van but refuses an empty edit', () => {
    expect(AdminBookingPatchSchema.safeParse({ expectedVersion: 3, notes: '', vanId: null }).success).toBe(true);
    expect(AdminBookingPatchSchema.safeParse({ expectedVersion: 3 }).success).toBe(false);
  });
  it('validates contact details and forbids price injection through a basic patch', () => {
    const input = { expectedVersion: 3, contact: { name: 'Customer Name', email: 'customer@example.test', phone: '07700900123' } };
    expect(AdminBookingPatchSchema.safeParse(input).success).toBe(true);
    expect(AdminBookingPatchSchema.safeParse({ ...input, contact: { ...input.contact, email: 'broken' } }).success).toBe(false);
    expect(AdminBookingPatchSchema.safeParse({ ...input, totalPence: 1 }).success).toBe(false);
  });
  it.each([undefined, -1, 1.5])('rejects invalid version %s for dispatch and detail edits', (expectedVersion) => {
    expect(AdminBookingPatchSchema.safeParse({ expectedVersion, notes: 'Updated' }).success).toBe(false);
    expect(AssignBookingSchema.safeParse({ expectedVersion, driverId: 'driver-one', mode: 'DIRECT' }).success).toBe(false);
    expect(OfferBookingSchema.safeParse({ expectedVersion, driverIds: ['driver-one'], expiresInMinutes: 30 }).success).toBe(false);
    expect(AdminUnassignBookingSchema.safeParse({ expectedVersion, reason: 'Unavailable' }).success).toBe(false);
  });
  it('requires a valid driver selection, assignment mode, and unassignment reason', () => {
    expect(AssignBookingSchema.safeParse({ expectedVersion: 3, driverId: 'driver-one', mode: 'DIRECT' }).success).toBe(true);
    expect(AssignBookingSchema.safeParse({ expectedVersion: 3, driverId: '', mode: 'DIRECT' }).success).toBe(false);
    expect(AssignBookingSchema.safeParse({ expectedVersion: 3, driverId: 'driver-one', mode: 'UNKNOWN' }).success).toBe(false);
    expect(AdminUnassignBookingSchema.safeParse({ expectedVersion: 3, reason: '  ' }).success).toBe(false);
  });
  it.each([0, 1441, 1.5])('rejects invalid offer expiry %s', (expiresInMinutes) => {
    expect(OfferBookingSchema.safeParse({ expectedVersion: 3, driverIds: ['driver-one'], expiresInMinutes }).success).toBe(false);
  });
  it('allows a schedule preview without authorizing an unconfirmed financial apply', () => {
    expect(AdminReschedulePreviewRequestSchema.safeParse(schedule).success).toBe(true);
    expect(AdminRescheduleSchema.safeParse(schedule).success).toBe(false);
    expect(AdminRescheduleSchema.safeParse({ ...schedule, expectedTotalPence: 10000, expectedSettlementPence: 0, settle: 'NONE' }).success).toBe(true);
  });
  it.each(['2031-02-30', '2031-13-01', '12/01/2031'])('rejects invalid civil date %s', (date) => {
    expect(AdminReschedulePreviewRequestSchema.safeParse({ ...schedule, date }).success).toBe(false);
  });
  it('requires a reason and rejects unknown scheduling policy', () => {
    expect(AdminReschedulePreviewRequestSchema.safeParse({ ...schedule, reason: '' }).success).toBe(false);
    expect(AdminReschedulePreviewRequestSchema.safeParse({ ...schedule, priceMode: 'FREE' }).success).toBe(false);
  });
  it('validates an internally consistent schedule preview', () => {
    expect(AdminBookingReschedulePreviewSchema.parse(preview)).toEqual(preview);
  });
  it.each([{ differencePence: 1 }, { settle: 'NONE' }, { settlementAmountPence: 0 }, { settlementAmountPence: -1 }])('rejects contradictory schedule financial preview %j', (override) => {
    expect(AdminBookingReschedulePreviewSchema.safeParse({ ...preview, ...override }).success).toBe(false);
  });
});
