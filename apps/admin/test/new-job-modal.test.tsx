import { addAlerts, dismissAlert } from '../src/notifications/new-job-queue';

const alert = {
  bookingId: 'booking_1',
  notificationId: 'notification_1',
  pricePence: 15890,
  route: 'Paisley to Edinburgh',
  service: 'Man and van',
  slot: 'Morning'
};

describe('NewJobModal', () => {
  it('dedupes stacked alerts and removes dismissed notifications', () => {
    const stacked = addAlerts([alert], [alert, { ...alert, bookingId: 'booking_2', notificationId: 'notification_2' }]);
    expect(stacked).toHaveLength(2);
    expect(dismissAlert(stacked, 'notification_1')).toEqual([{ ...alert, bookingId: 'booking_2', notificationId: 'notification_2' }]);
  });
});
