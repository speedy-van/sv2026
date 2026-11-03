import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { PermissionStatus } from 'expo';
import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
import { Linking, Platform, Text } from 'react-native';
import { NotificationPermissionGate } from '../src/components/notification-permission-gate';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual<typeof Notifications>('expo-notifications'),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

function permission(granted: boolean, canAskAgain = true): Notifications.NotificationPermissionsStatus {
  return {
    granted,
    canAskAgain,
    expires: 'never',
    status: granted ? PermissionStatus.GRANTED : PermissionStatus.DENIED,
  };
}

let mounts = 0;
function MountedContent(): React.ReactElement {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <Text>Dashboard</Text>;
}

describe('NotificationPermissionGate', () => {
  beforeEach(() => {
    mounts = 0;
    jest.replaceProperty(Platform, 'OS', 'ios');
    jest.mocked(Notifications.getPermissionsAsync).mockReset().mockResolvedValue(permission(true));
    jest.mocked(Notifications.requestPermissionsAsync).mockReset().mockResolvedValue(permission(true));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the child content when permission is granted', async () => {
    const view = await render(
      <NotificationPermissionGate>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    await waitFor(() => {
      expect(view.getByText('Dashboard')).toBeTruthy();
    });
    expect(view.queryByText('Notifications are off')).toBeNull();
  });

  it('defers permission lookup until enabled and preserves mounted navigation through the banner transition', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(false));
    const view = await render(
      <NotificationPermissionGate enabled={false}>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    await view.rerender(
      <NotificationPermissionGate enabled>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    await waitFor(() => {
      expect(view.getByText('Notifications are off')).toBeTruthy();
    });
    expect(view.getByText('Dashboard')).toBeTruthy();
    expect(mounts).toBe(1);
    await view.rerender(
      <NotificationPermissionGate enabled={false}>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    expect(view.queryByText('Notifications are off')).toBeNull();
    expect(mounts).toBe(1);
  });

  it('surfaces a permission lookup error and retries without blocking the app', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockRejectedValueOnce(new Error('Unavailable'));
    const view = await render(
      <NotificationPermissionGate>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    await waitFor(() => {
      expect(view.getByText('Notification permissions could not be checked. Try again.')).toBeTruthy();
    });
    expect(view.getByText('Dashboard')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Check again' }));
    await waitFor(() => {
      expect(view.queryByText('Check notifications')).toBeNull();
    });
    expect(Notifications.getPermissionsAsync).toHaveBeenCalledTimes(2);
  });

  it('requests notification permission with real native options and removes the banner when granted', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(false));
    const view = await render(
      <NotificationPermissionGate>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Enable notifications' })).toBeTruthy();
    });
    await fireEvent.press(view.getByRole('button', { name: 'Enable notifications' }));
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledWith({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    expect(view.queryByText('Notifications are off')).toBeNull();
    expect(mounts).toBe(1);
  });

  it('handles Open settings failures visibly while leaving the dashboard usable', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(false, false));
    jest.spyOn(Linking, 'openSettings').mockRejectedValueOnce(new Error('Unavailable'));
    const view = await render(
      <NotificationPermissionGate>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Open settings' })).toBeTruthy();
    });
    expect(view.queryByRole('button', { name: 'Enable notifications' })).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: 'Open settings' }));
    expect(
      view.getByText(
        'Device settings could not be opened. Open Settings on your device to manage notifications.',
      ),
    ).toBeTruthy();
    expect(view.getByText('Dashboard')).toBeTruthy();
  });

  it('handles a rejected permission request visibly and permits another action', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(false));
    jest.mocked(Notifications.requestPermissionsAsync).mockRejectedValueOnce(new Error('Unavailable'));
    const view = await render(
      <NotificationPermissionGate>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Enable notifications' })).toBeTruthy();
    });
    await fireEvent.press(view.getByRole('button', { name: 'Enable notifications' }));
    expect(
      view.getByText('Notifications could not be enabled. Try again or open device settings.'),
    ).toBeTruthy();
    expect(view.getByRole('button', { name: 'Open settings' })).not.toBeDisabled();
  });

  it('does not access native permission APIs on web', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    const view = await render(
      <NotificationPermissionGate>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    expect(view.getByText('Dashboard')).toBeTruthy();
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('starts registration only after notification permission has actually been granted', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue(permission(false));
    const registered = jest.fn();
    const view = await render(
      <NotificationPermissionGate onPermissionGranted={registered}>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    await waitFor(() => {
      expect(view.getByRole('button', { name: 'Enable notifications' })).toBeTruthy();
    });
    expect(registered).not.toHaveBeenCalled();
    await fireEvent.press(view.getByRole('button', { name: 'Enable notifications' }));
    expect(registered).toHaveBeenCalledTimes(1);
  });

  it('warns when iOS allows notifications but the booking sound has been disabled', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
      ...permission(true),
      ios: {
        allowsAlert: true,
        allowsBadge: true,
        allowsSound: false,
        allowsAnnouncements: false,
        allowsCriticalAlerts: false,
        allowsDisplayInCarPlay: false,
        allowsDisplayInNotificationCenter: true,
        allowsDisplayOnLockScreen: true,
        alertStyle: Notifications.IosAlertStyle.BANNER,
        providesAppNotificationSettings: false,
        allowsPreviews: Notifications.IosAllowsPreviews.ALWAYS,
        status: Notifications.IosAuthorizationStatus.AUTHORIZED,
      },
    });
    const view = await render(
      <NotificationPermissionGate>
        <MountedContent />
      </NotificationPermissionGate>,
    );
    await waitFor(() => {
      expect(view.getByText('Notification sounds are off')).toBeTruthy();
    });
    expect(view.getByRole('button', { name: 'Open settings' })).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Enable notifications' })).toBeNull();
  });
});
