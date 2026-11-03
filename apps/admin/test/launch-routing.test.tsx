import { resolve } from 'node:path';
import { useEffect, type PropsWithChildren } from 'react';
import type * as ReactModule from 'react';
import { Platform, Text } from 'react-native';
import * as Notifications from 'expo-notifications';
import { MemoryTokenStorage, SpeedyVanApiClient } from '@sv/api-client';
import { ExpoRoot, usePathname } from 'expo-router';
import { getMockContext } from 'expo-router/testing-library';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { useAuth } from '../src/state/auth';
import type * as IconMocks from './lucide-react-native.mock';

type Auth = ReturnType<typeof useAuth>;
const mockListeners = new Set<() => void>();
const mockPrivateMount = jest.fn();
const mockUnlock = jest.fn<Promise<boolean>, []>();
const mockFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
let mockAuth: Auth;

jest.mock('../src/state/auth', () => ({
  AuthProvider: ({ children }: PropsWithChildren) => children,
  useAuth: () => jest.requireActual<typeof ReactModule>('react').useSyncExternalStore(
    (listener) => {
      mockListeners.add(listener);
      return () => { mockListeners.delete(listener); };
    },
    () => mockAuth,
  ),
}));
jest.mock('@expo-google-fonts/bricolage-grotesque', () => ({ BricolageGrotesque_700Bold: 1 }));
jest.mock('@expo-google-fonts/manrope', () => ({ Manrope_500Medium: 1, Manrope_700Bold: 1 }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
  default: {
    executionEnvironment: 'standalone',
    expoConfig: { scheme: 'speedyvan-admin', extra: { apiBaseUrl: 'https://api.example.test' } },
    sessionId: 'test-session',
  },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: () => () => undefined,
    useNetInfo: () => ({ isConnected: true, isInternetReachable: true }),
  },
}));
jest.mock('lucide-react-native', () => {
  const icons = jest.requireActual<typeof IconMocks>('./lucide-react-native.mock');
  return { ...icons, LockKeyhole: icons.AlertCircle, Mail: icons.AlertCircle };
});
jest.mock('../src/notifications/use-booking-alerts', () => ({
  foregroundNotificationBehavior: () => ({}),
  useBookingAlerts: () => ({ alerts: [], error: null, retry: jest.fn(), dismiss: jest.fn(), open: jest.fn() }),
}));
jest.mock('../src/notifications/register-push', () => ({
  registerPushDevice: () => Promise.resolve(() => undefined),
}));
jest.mock('../src/notifications/chat-sound-provider', () => ({
  ChatSoundProvider: ({ children }: PropsWithChildren) => children,
}));
jest.mock('../src/data/chat', () => ({ useChatUnread: () => ({ isError: false, data: { unreadCount: 0 } }) }));
jest.mock('../src/components/website-visitors-header', () => ({ WebsiteVisitorsHeader: () => null }));

function PrivateScreen(): React.ReactElement {
  useEffect(() => { mockPrivateMount(); }, []);
  return <Text>Private Today workspace</Text>;
}

function DetailScreen(): React.ReactElement {
  useEffect(() => { mockPrivateMount(); }, []);
  return <Text>Private booking details</Text>;
}

const routes = {
  appDir: resolve(__dirname, '../app'),
  overrides: {
    '(app)/today': PrivateScreen,
    '(app)/bookings/[id]': DetailScreen,
  },
};

function RouterProbe({ children }: PropsWithChildren): React.ReactElement {
  const pathname = usePathname();
  return <><Text testID="route-pathname">{pathname}</Text>{children}</>;
}

async function launch(initialUrl = 'speedyvan-admin:///'): Promise<void> {
  // Expo's renderRouter currently wraps the asynchronous RNTL14 render as if it
  // were synchronous. Render its real ExpoRoot/context directly and await it.
  await render(<ExpoRoot context={getMockContext(routes)} location={new URL(initialUrl)} wrapper={RouterProbe} />);
}

function expectPathname(value: string): void {
  expect(screen.getByTestId('route-pathname')).toHaveTextContent(value, { exact: true });
}

async function changeAuth(next: Partial<Auth>): Promise<void> {
  await act(() => {
    mockAuth = { ...mockAuth, ...next };
    for (const listener of mockListeners) listener();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockAuth = {
    api: new SpeedyVanApiClient({
      appVersion: 'admin@1.0.0',
      baseUrl: 'https://api.example.test',
      deviceId: 'launch-routing-test-device',
      fetch: mockFetch,
      storage: new MemoryTokenStorage(),
    }),
    appLocked: false,
    user: null,
    signOutWarning: null,
    restoreError: null,
    lockApp: jest.fn(),
    requestCode: jest.fn(),
    signInWithCode: jest.fn(),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(),
    retryRestore: jest.fn(),
    status: 'idle',
    unlock: mockUnlock,
  };
  mockUnlock.mockImplementation(async () => {
    await changeAuth({ appLocked: false });
    return true;
  });
});

afterEach(async () => {
  await cleanup();
  mockListeners.clear();
  jest.restoreAllMocks();
});

it('resolves the native cold-launch root URL to the real sign-in screen when signed out', async () => {
  await launch();
  await waitFor(() => { expectPathname('/sign-in'); });
  expect(screen.getByLabelText('Email')).toBeTruthy();
  expect(screen.getByLabelText('Password')).toBeTruthy();
  expect(screen.queryByText('Unmatched Route')).toBeNull();
  expect(mockPrivateMount).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
});

it('opens Today through the real router for an unlocked signed-in cold launch', async () => {
  mockAuth = { ...mockAuth, status: 'signed-in' };
  await launch();
  await waitFor(() => { expectPathname('/today'); });
  expect(screen.getByText('Private Today workspace')).toBeTruthy();
  expect(mockPrivateMount).toHaveBeenCalledTimes(1);
});

it('keeps both auth and private routes unmounted until restoration finishes, then opens sign-in', async () => {
  mockAuth = { ...mockAuth, status: 'restoring' };
  await launch();
  expect(screen.getByRole('header', { name: 'Restoring your session' })).toBeTruthy();
  expect(screen.queryByLabelText('Email')).toBeNull();
  expect(mockPrivateMount).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  await changeAuth({ status: 'idle' });
  await waitFor(() => { expectPathname('/sign-in'); });
  expect(screen.getByLabelText('Password')).toBeTruthy();
  expect(mockPrivateMount).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});

it('preserves the lock after native session restoration and mounts private content only after unlock', async () => {
  mockAuth = { ...mockAuth, status: 'restoring' };
  await launch();
  await changeAuth({ status: 'signed-in', appLocked: true });
  await waitFor(() => { expect(screen.getByRole('header', { name: 'Unlock SV Admin' })).toBeTruthy(); });
  expect(mockPrivateMount).not.toHaveBeenCalled();
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Unlock' }));
  await waitFor(() => { expectPathname('/today'); });
  expect(mockUnlock).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Private Today workspace')).toBeTruthy();
  expect(mockPrivateMount).toHaveBeenCalledTimes(1);
});

it('keeps a valid signed-in booking deep link instead of redirecting it to Today', async () => {
  mockAuth = { ...mockAuth, status: 'signed-in' };
  await launch('speedyvan-admin:///bookings/test-booking');
  await waitFor(() => { expectPathname('/bookings/test-booking'); });
  expect(screen.getByText('Private booking details')).toBeTruthy();
  expect(screen.queryByText('Private Today workspace')).toBeNull();
});

it('still rejects a private booking deep link when signed out', async () => {
  await launch('speedyvan-admin:///bookings/test-booking');
  await waitFor(() => { expectPathname('/sign-in'); });
  expect(screen.getByLabelText('Password')).toBeTruthy();
  expect(mockPrivateMount).not.toHaveBeenCalled();
  expect(mockFetch).not.toHaveBeenCalled();
});
