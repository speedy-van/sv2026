import { routeFromNotificationData } from '../src/notifications/routing';

describe('notification routing', () => {
  it('routes deep links and typed notification payloads', () => {
    expect(routeFromNotificationData({ url: 'speedyvan-admin://bookings/booking_1' })).toBe('/bookings/booking_1');
    expect(routeFromNotificationData({ bookingId: 'booking_2', type: 'NEW_BOOKING' })).toBe('/(app)/bookings/booking_2');
    expect(routeFromNotificationData({ type: 'QUOTE_REQUEST' })).toBe('/(app)/more?section=leads');
    expect(routeFromNotificationData({})).toBe('/(app)/today');
  });
});
