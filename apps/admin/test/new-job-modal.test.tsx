import { fireEvent, render } from '@testing-library/react-native';
import { NewJobModal } from '../src/notifications/new-job-modal';
import { addAlerts, dismissAlert, newJobAlertFromNotification } from '../src/notifications/new-job-queue';

const alert = {
  bookingId: 'booking_1',
  notificationId: 'notification_1',
  pricePence: 15890,
  route: 'Paisley to Edinburgh',
  service: 'Man and van',
  slot: 'Morning',
};

describe('NewJobModal', () => {
  it('dedupes stacked alerts and removes dismissed notifications', () => {
    const stacked = addAlerts(
      [alert],
      [alert, { ...alert, bookingId: 'booking_2', notificationId: 'notification_2' }],
    );
    expect(stacked).toHaveLength(2);
    expect(dismissAlert(stacked, 'notification_1')).toEqual([
      { ...alert, bookingId: 'booking_2', notificationId: 'notification_2' },
    ]);
  });

  it('accepts actual push payloads without a database notification id and omits missing details', async () => {
    const incoming = newJobAlertFromNotification(
      { type: 'NEW_BOOKING', bookingId: 'booking_1' },
      'real-delivery-id',
    );
    expect(incoming).toEqual({ bookingId: 'booking_1', notificationId: 'real-delivery-id' });
    if (!incoming) throw new Error('The real booking notification should be accepted.');
    const open = jest.fn();
    const view = await render(<NewJobModal alerts={[incoming]} onOpen={open} onDismiss={jest.fn()} />);
    expect(view.getByText('New booking')).toBeTruthy();
    expect(view.queryByText('£0.00')).toBeNull();
    expect(view.queryByText('New web booking')).toBeNull();
    expect(view.queryByText('Booking · Open now')).toBeNull();
    expect(view.queryByRole('button', { name: 'Assign driver' })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'View booking' }));
    expect(open).toHaveBeenCalledWith('booking_1');
  });

  it('shows supplied metadata and removes the popup immediately when its controlled queue clears', async () => {
    const dismiss = jest.fn();
    const view = await render(<NewJobModal alerts={[alert]} onOpen={jest.fn()} onDismiss={dismiss} />);
    expect(view.getByText('£158.90')).toBeTruthy();
    expect(view.getByText('Paisley to Edinburgh')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Dismiss' }));
    expect(dismiss).toHaveBeenCalledWith('notification_1');
    await view.rerender(<NewJobModal alerts={[]} onOpen={jest.fn()} onDismiss={dismiss} />);
    expect(view.queryByText('New booking')).toBeNull();
    expect(view.queryByText('£158.90')).toBeNull();
  });

  it.each([0, -1, 1.5, '15890', Number.NaN])(
    'does not fabricate a price from invalid or zero metadata: %s',
    (pricePence) => {
      expect(
        newJobAlertFromNotification({ type: 'NEW_BOOKING', bookingId: 'booking_1', pricePence }, 'delivery'),
      ).toEqual({ bookingId: 'booking_1', notificationId: 'delivery' });
    },
  );

  it('requires a booking event identity and preserves valid metadata without placeholders', () => {
    expect(
      newJobAlertFromNotification({ type: 'QUOTE_REQUEST', bookingId: 'booking_1' }, 'delivery'),
    ).toBeNull();
    expect(newJobAlertFromNotification({ type: 'NEW_BOOKING' }, 'delivery')).toBeNull();
    expect(newJobAlertFromNotification({ type: 'NEW_BOOKING', bookingId: 'booking_1' }, '')).toBeNull();
    expect(
      newJobAlertFromNotification(
        { type: 'NEW_BOOKING', ...alert, reference: 'SV-TEST', service: false, slot: '' },
        'delivery',
      ),
    ).toEqual({
      bookingId: 'booking_1',
      notificationId: 'notification_1',
      reference: 'SV-TEST',
      pricePence: 15890,
      route: 'Paisley to Edinburgh',
    });
  });

  it('uses the same domain delivery key for push and feed deduplication', () => {
    const payload = {
      type: 'NEW_BOOKING',
      bookingId: 'booking_1',
      deliveryKey: 'event:notification:admin',
      notificationId: 'row-one',
    };
    const push = newJobAlertFromNotification(payload, 'apns-delivery');
    const feed = newJobAlertFromNotification(payload, 'row-one');
    if (!push || !feed) throw new Error('The valid booking delivery should be accepted.');
    expect(addAlerts([push], [feed])).toHaveLength(1);
    expect(push.notificationId).toBe('event:notification:admin');
  });
});
