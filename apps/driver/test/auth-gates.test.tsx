import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { MemoryTokenStorage, SpeedyVanApiClient } from '@sv/api-client';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Text } from 'react-native';
import type * as ReactModule from 'react';
import type * as NativeModule from 'react-native';
import { AppLockGate } from '../src/components/app-lock-gate';
import DriverAppLayout from '../app/(app)/_layout';
import { RootShell } from '../src/shell/root-shell';

const mockAuth = {
  api: new SpeedyVanApiClient({ appVersion: 'driver@1.0.0', baseUrl: 'https://api.example.test', deviceId: 'test-device', storage: new MemoryTokenStorage() }),
  appLocked: true,
  sessionVersion: 1,
  status: 'signed-in' as 'idle' | 'submitting' | 'signed-in',
  unlock: jest.fn<Promise<boolean>, []>(),
};
const mockMounts = jest.fn();
jest.mock('../src/state/auth', () => ({
  AuthProvider: (props: { children: React.ReactNode }) => props.children,
  useAuth: () => mockAuth,
}));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('../src/components/offline-banner', () => ({ OfflineBanner: () => null }));
jest.mock('../src/notifications/register-push', () => ({ registerPushDevice: () => Promise.resolve(() => undefined) }));
jest.mock('../src/notifications/job-offer-modal', () => ({ JobOfferModal: () => null }));
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const Native = jest.requireActual<typeof NativeModule>('react-native');
  const tabs = Object.assign(() => React.createElement(Native.Text, null, 'Private driver tabs'), { Screen: () => null });
  return { router: { push: jest.fn() }, Tabs: tabs };
});

function MountedNavigator(): React.ReactElement {
  useEffect(() => { mockMounts(); }, []);
  return <Text>Mounted root navigator</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.appLocked = true;
  mockAuth.status = 'signed-in';
  mockAuth.sessionVersion = 1;
  mockAuth.unlock.mockResolvedValue(true);
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(null);
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
});

it('keeps the root navigator mounted through native password success, lock and missing permissions', async () => {
  mockAuth.status = 'submitting';
  const view = await render(<RootShell><MountedNavigator /></RootShell>);
  expect(view.getByText('Mounted root navigator')).toBeTruthy();
  mockAuth.status = 'signed-in';
  mockAuth.appLocked = true;
  await view.rerender(<RootShell><MountedNavigator /></RootShell>);
  expect(view.getByText('Mounted root navigator')).toBeTruthy();
  mockAuth.appLocked = false;
  await view.rerender(<RootShell><MountedNavigator /></RootShell>);
  expect(view.getByText('Mounted root navigator')).toBeTruthy();
  expect(mockMounts).toHaveBeenCalledTimes(1);
});

it('keeps private tabs and permission requests behind the native lock', async () => {
  const view = await render(<DriverAppLayout />);
  expect(view.getByText('Unlock Driver')).toBeTruthy();
  expect(view.queryByText('Private driver tabs')).toBeNull();
  expect(Location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  mockAuth.appLocked = false;
  await view.rerender(<DriverAppLayout />);
  await waitFor(() => { expect(view.getByText('Private driver tabs')).toBeTruthy(); });
  expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(1);
});

it('makes native biometric cancellation and failure recoverable', async () => {
  mockAuth.unlock.mockRejectedValueOnce(new Error('Test-only biometric error'));
  const view = await render(<AppLockGate />);
  await fireEvent.press(view.getByRole('button', { name: 'Unlock' }));
  await waitFor(() => { expect(view.getByRole('alert')).toHaveTextContent('Unlock was not completed. Please try again.'); });
  expect(view.getByRole('button', { name: 'Unlock' })).toBeEnabled();
});

it('defers opened-notification navigation until a signed-in driver unlocks', async () => {
  const notification = {
    actionIdentifier: 'OPEN',
    notification: { date: 0, request: {
      identifier: 'test-driver-notification', trigger: null,
      content: { title: 'Test job', subtitle: null, body: 'Test-only', sound: null, badge: 0, categoryIdentifier: '', data: { type: 'JOB_OFFERED', bookingId: 'test-booking' } },
    } },
  };
  jest.mocked(Notifications.getLastNotificationResponse).mockReturnValue(notification);
  const view = await render(<RootShell><MountedNavigator /></RootShell>);
  expect(router.push).not.toHaveBeenCalled();
  mockAuth.appLocked = false;
  await view.rerender(<RootShell><MountedNavigator /></RootShell>);
  await waitFor(() => { expect(router.push).toHaveBeenCalledTimes(1); });
  expect(router.push).toHaveBeenCalledWith('/(app)/offers/test-booking');
  mockAuth.appLocked = true;
  await view.rerender(<RootShell><MountedNavigator /></RootShell>);
  mockAuth.appLocked = false;
  await view.rerender(<RootShell><MountedNavigator /></RootShell>);
  expect(router.push).toHaveBeenCalledTimes(1);
});
