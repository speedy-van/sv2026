import { describe, expect, it } from 'vitest';
import {
  AdminBookingAlertsQuerySchema, AdminBookingAlertsResponseSchema,
  BookingAlertReadRequestSchema, BookingAlertReadResponseSchema,
} from '../src/booking-alerts';

const item = {
  id: 'notification-unit', createdAt: '2031-03-01T12:00:00.000Z', title: 'New booking', body: 'Glasgow to Edinburgh',
  data: { bookingId: 'booking-unit', deliveryKey: 'event:admin-unit', eventType: 'booking.confirmed', type: 'NEW_BOOKING', reference: 'SV-UNIT', pricePence: 12345, route: 'Glasgow to Edinburgh', service: 'man-and-van', slot: 'MORNING', moveDate: '2031-03-02' },
};
const response = { items: [item], generatedAt: '2031-03-01T12:00:00.000Z', nextCursor: null };
describe('admin booking alert contracts', () => {
  it('validates the complete dated booking feed and stable delivery identity', () => {
    expect(AdminBookingAlertsResponseSchema.parse(response)).toEqual(response);
    expect(AdminBookingAlertsQuerySchema.parse({})).toEqual({ limit: 50 });
  });
  it.each([
    { pricePence: 12.34 }, { slot: 'UNKNOWN' }, { moveDate: '2031-02-30' },
    { deliveryKey: '' }, { contactEmail: 'private@example.test' },
  ])('rejects malformed or private booking alert data %#', (patch) => {
    expect(AdminBookingAlertsResponseSchema.safeParse({ ...response, items: [{ ...item, data: { ...item.data, ...patch } }] }).success).toBe(false);
  });
  it('allows only a booking id in read acknowledgements and validates an explicit success response', () => {
    expect(BookingAlertReadRequestSchema.parse({ bookingId: 'booking-unit' })).toEqual({ bookingId: 'booking-unit' });
    expect(BookingAlertReadRequestSchema.safeParse({ bookingId: 'booking-unit', all: true }).success).toBe(false);
    expect(BookingAlertReadResponseSchema.safeParse({ ok: true }).success).toBe(true);
    expect(BookingAlertReadResponseSchema.safeParse({ ok: false }).success).toBe(false);
  });
});
