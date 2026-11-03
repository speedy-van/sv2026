import { routeFromNotificationData } from '../src/notifications/routing';

describe('notification routing', () => {
  it('routes deep links and typed notification payloads', () => {
    expect(routeFromNotificationData({ url: 'speedyvan-admin://bookings/booking_1' })).toBe('/bookings/booking_1');
    expect(routeFromNotificationData({ bookingId: 'booking_2', type: 'NEW_BOOKING' })).toBe('/(app)/bookings/booking_2');
    expect(routeFromNotificationData({ type: 'QUOTE_REQUEST' })).toBe('/(app)/more?section=leads');
    expect(routeFromNotificationData({ type: 'CHAT_MESSAGE', conversationId: 'chat_1' })).toBe('/(app)/chat/chat_1');
    expect(routeFromNotificationData({ type: 'CHAT_MESSAGE', conversationId: 'chat/with?separator' })).toBe('/(app)/chat/chat%2Fwith%3Fseparator');
    expect(routeFromNotificationData({ type: 'CHAT_MESSAGE' })).toBe('/(app)/chat');
    expect(routeFromNotificationData({})).toBe('/(app)/today');
  });
});
