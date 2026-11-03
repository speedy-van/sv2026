import { describe, expect, it } from 'vitest';
import { AdminAbandonedCheckoutsQuerySchema, AdminBookingActivityQuerySchema, BookingActivityHeartbeatRequestSchema, BookingActivityWithdrawRequestSchema } from '../src/booking-activity';

describe('booking activity contracts', () => {
  it.each(['SERVICE', 'MOVE', 'ITEMS', 'DATE', 'PAYMENT'])('accepts only the bounded stage and service payload: %s', (stage) => {
    expect(BookingActivityHeartbeatRequestSchema.parse({ stage, service: null })).toEqual({ stage, service: null });
  });
  it.each(['id', 'quoteId', 'bookingId', 'email', 'phone', 'name', 'postcode', 'path', 'lastSeenAt'])('rejects public client input for %s', (key) => {
    expect(BookingActivityHeartbeatRequestSchema.safeParse({ stage: 'MOVE', service: null, [key]: 'client-input' }).success).toBe(false);
  });
  it('rejects unknown stages/services and nonempty withdrawal payloads', () => {
    expect(BookingActivityHeartbeatRequestSchema.safeParse({ stage: 'CONFIRMED', service: null }).success).toBe(false);
    expect(BookingActivityHeartbeatRequestSchema.safeParse({ stage: 'MOVE', service: 'unknown' }).success).toBe(false);
    expect(BookingActivityWithdrawRequestSchema.safeParse({ id: 'client-input' }).success).toBe(false);
  });
  it('bounds pagination and requires server UUID cursors for activity', () => {
    expect(AdminBookingActivityQuerySchema.parse({})).toEqual({ scope: 'active', limit: 30 });
    expect(AdminBookingActivityQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(AdminBookingActivityQuerySchema.safeParse({ cursor: 'client-input' }).success).toBe(false);
    expect(AdminBookingActivityQuerySchema.safeParse({ scope: 'everything' }).success).toBe(false);
    expect(AdminAbandonedCheckoutsQuerySchema.safeParse({ q: 'a'.repeat(121) }).success).toBe(false);
    expect(AdminAbandonedCheckoutsQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(AdminAbandonedCheckoutsQuerySchema.safeParse({ cursor: 'a'.repeat(101) }).success).toBe(false);
  });
});
