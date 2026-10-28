import { SpeedyVanApiClient } from '@sv/api-client';
import { waitFor } from '@testing-library/react-native';
import { PermissionStatus } from 'expo';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerPushDevice } from '../src/notifications/register-push';

let mockProjectId = '11111111-1111-4111-8111-111111111111';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { eas: { projectId: mockProjectId } } };
    },
  },
}));
jest.mock('expo-notifications', () => ({
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  getExpoPushTokenAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  AndroidImportance: { HIGH: 4 },
}));

function client(): SpeedyVanApiClient {
  return new SpeedyVanApiClient({
    appVersion: '1.0.0',
    baseUrl: 'https://api.example.test',
    deviceId: 'device',
    storage: {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    },
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.replaceProperty(Platform, 'OS', 'ios');
  mockProjectId = '11111111-1111-4111-8111-111111111111';
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
    granted: true,
    canAskAgain: false,
    expires: 'never',
    status: PermissionStatus.GRANTED,
  });
  jest
    .mocked(Notifications.getExpoPushTokenAsync)
    .mockResolvedValue({ type: 'expo', data: 'ExpoPushToken[test-token]' });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('registers the Expo token and exchanges a changed APNs token before updating the backend', async () => {
  const api = client();
  const request = jest.spyOn(api, 'request').mockResolvedValue({ ok: true });
  const dispose = await registerPushDevice(api);
  expect(request).toHaveBeenCalledWith(
    '/api/v1/me/push-device',
    expect.objectContaining({
      method: 'PUT',
      body: { expoPushToken: 'ExpoPushToken[test-token]', platform: 'ios' },
    }),
  );
  const callback = jest.mocked(Notifications.addPushTokenListener).mock.calls[0]?.[0];
  if (!callback) throw new Error('A registered phone needs token rotation updates.');
  const nativeToken = { type: 'ios' as const, data: 'native-apns-token' };
  callback(nativeToken);
  await waitFor(() => {
    expect(request).toHaveBeenCalledTimes(2);
  });
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenLastCalledWith({
    projectId: mockProjectId,
    devicePushToken: nativeToken,
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(request.mock.calls)).not.toContain('native-apns-token');
  dispose();
  callback({ type: 'ios', data: 'new-native-token-after-disposal' });
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(2);
});

it('reports changed-token registration failure instead of silently losing push support', async () => {
  const api = client();
  jest.spyOn(api, 'request').mockResolvedValue({ ok: true });
  const failure = jest.fn();
  const dispose = await registerPushDevice(api, failure);
  jest.mocked(Notifications.getExpoPushTokenAsync).mockRejectedValueOnce(new Error('Offline'));
  const callback = jest.mocked(Notifications.addPushTokenListener).mock.calls[0]?.[0];
  if (!callback) throw new Error('Expected token rotation listener.');
  callback({ type: 'ios', data: 'native' });
  await waitFor(() => {
    expect(failure).toHaveBeenCalledWith(expect.any(Error));
  });
  dispose();
});

it('fails clearly when the Expo project is missing instead of pretending pushes are registered', async () => {
  mockProjectId = 'placeholder-project';
  await expect(registerPushDevice(client())).rejects.toThrow('configured Expo project');
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});

it('waits for permission and never prompts or registers a denied device itself', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({
    granted: false,
    canAskAgain: true,
    expires: 'never',
    status: PermissionStatus.DENIED,
  });
  await expect(registerPushDevice(client())).rejects.toThrow('Allow notifications');
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});

it('settles stalled registration with an actionable timeout', async () => {
  jest.useFakeTimers();
  jest.mocked(Notifications.getExpoPushTokenAsync).mockReturnValue(new Promise(() => undefined));
  const registration = registerPushDevice(client());
  const assertion = expect(registration).rejects.toThrow('timed out');
  await jest.advanceTimersByTimeAsync(15_001);
  await assertion;
});

it('does not access native push APIs in the web preview', async () => {
  jest.replaceProperty(Platform, 'OS', 'web');
  await registerPushDevice(client());
  expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});
