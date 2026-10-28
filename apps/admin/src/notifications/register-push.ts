import type { SpeedyVanApiClient } from '@sv/api-client';
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { z } from 'zod';

const OkSchema = z.object({ ok: z.literal(true) }).strict();

function projectId(): string {
  const extra = z
    .object({ eas: z.object({ projectId: z.uuid() }).optional() })
    .safeParse(Constants.expoConfig?.extra);
  const id = z
    .uuid()
    .safeParse(Constants.easConfig?.projectId ?? (extra.success ? extra.data.eas?.projectId : undefined));
  if (!id.success) throw new Error('Push notifications need a configured Expo project and a new iOS build.');
  return id.data;
}

function bounded<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Notification registration timed out. Check your connection and try again.'));
    }, 15_000);
    operation
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timeout);
      })
      .catch(reject);
  });
}

async function upsertToken(api: SpeedyVanApiClient, expoPushToken: string): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  await api.request('/api/v1/me/push-device', {
    body: { expoPushToken, platform: Platform.OS },
    method: 'PUT',
    schema: OkSchema,
  });
}

export async function registerPushDevice(
  api: SpeedyVanApiClient,
  onError?: (error: unknown) => void,
): Promise<() => void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return () => undefined;
  const permission = await bounded(Notifications.getPermissionsAsync());
  if (!permission.granted)
    throw new Error('Allow notifications in device settings before registering booking alerts.');
  const id = projectId();
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('new-bookings', {
      name: 'New bookings',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'new-job.wav',
      vibrationPattern: [0, 250, 150, 250],
    });
  let active = true;
  let registration = 0;
  async function refresh(devicePushToken?: Notifications.DevicePushToken): Promise<void> {
    const current = ++registration;
    const token = await bounded(
      Notifications.getExpoPushTokenAsync({
        projectId: id,
        ...(devicePushToken ? { devicePushToken } : {}),
      }),
    );
    if (!active || current !== registration) return;
    const expoPushToken = z
      .string()
      .regex(/^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/u)
      .parse(token.data);
    await upsertToken(api, expoPushToken);
  }
  const subscription = Notifications.addPushTokenListener((nextToken) => {
    if (!active) return;
    // This listener provides an APNs/FCM token. Exchange it; never store it as an Expo token.
    void refresh(nextToken).catch((error: unknown) => {
      if (!active) return;
      Sentry.captureException(error, { tags: { feature: 'admin-push-token-change' } });
      onError?.(error);
    });
  });
  try {
    await refresh();
  } catch (error) {
    active = false;
    subscription.remove();
    throw error;
  }
  return () => {
    active = false;
    subscription.remove();
  };
}
