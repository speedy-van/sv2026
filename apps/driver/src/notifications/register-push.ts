import type { SpeedyVanApiClient } from '@sv/api-client';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { z } from 'zod';

const OkSchema = z.object({ ok: z.boolean() }).strict();

function tokenData(token: { data?: unknown }): string | null {
  return typeof token.data === 'string' ? token.data : null;
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? null;
}

async function upsertToken(api: SpeedyVanApiClient, expoPushToken: string): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;
  await api.request('/api/v1/me/push-device', {
    body: { expoPushToken, platform: Platform.OS },
    method: 'PUT',
    schema: OkSchema
  });
}

export async function registerPushDevice(api: SpeedyVanApiClient): Promise<() => void> {
  const id = projectId();
  if (!id) return () => undefined;
  const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
  const initialToken = tokenData(token);
  if (initialToken) await upsertToken(api, initialToken);
  const subscription = Notifications.addPushTokenListener((nextToken) => {
    const changedToken = tokenData(nextToken);
    if (changedToken) void upsertToken(api, changedToken).catch(() => undefined);
  });
  return () => { subscription.remove(); };
}
