import { describe, expect, it } from 'vitest';
import { AdminBookingSummarySchema, type AdminBookingSummary } from '../src/admin-read';

const summary = {
  id: 'booking-unit', reference: 'SV-ABC123', customerName: 'Unit test customer', service: 'man-and-van', variant: 'standard',
  routeLabel: 'Glasgow to Edinburgh', pickupTown: 'Glasgow', dropoffTown: 'Edinburgh', moveDate: '2031-03-04',
  createdAt: '2031-02-23T23:47:18.456Z', slot: 'MORNING', status: 'CONFIRMED', dispatchStatus: 'UNASSIGNED', jobStage: 'NOT_STARTED',
  totalPence: 10000, paidPence: 10000, refundedPence: 0, holdExpiresAt: null, driver: null, capacityUnits: 1, blocksSlots: 1,
} satisfies AdminBookingSummary;

describe('admin booking creation timestamp contract', () => {
  it('retains the precise persisted instant independently of the civil move date', () => {
    expect(AdminBookingSummarySchema.parse(summary).createdAt).toBe('2031-02-23T23:47:18.456Z');
    const missing: Record<string, unknown> = { ...summary };
    delete missing.createdAt;
    expect(AdminBookingSummarySchema.safeParse(missing).success).toBe(false);
  });

  it.each([null, undefined, 1930000000000, '2031-03-04', '2031-03-04T12:00:00'])('rejects a missing or non-ISO instant: %s', (createdAt) => {
    expect(AdminBookingSummarySchema.safeParse({ ...summary, createdAt }).success).toBe(false);
  });
});
