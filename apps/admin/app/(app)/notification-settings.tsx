import {
  AdminNotificationSettingsResponseSchema,
  AdminNotificationSettingsUpdateSchema,
  AdminNotificationSettingsUpdateResponseSchema,
  AdminTestPushResponseSchema,
} from '@sv/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card } from '@/components/primitives';
import { ToggleField } from '@/components/booking-edit-fields';
import { ScreenState } from '@/components/screen-state';
import { useAdminToolSession } from '@/data/admin-tool-session';
import { displayBookingCreatedAt } from '@/lib/admin-date-time';
import { registerPushDevice } from '@/notifications/register-push';
import { useAuth } from '@/state/auth';

export default function NotificationSettingsScreen(): React.ReactElement {
  const session = useAdminToolSession();
  const auth = useAuth();
  const [permission, setPermission] = useState<'checking' | 'allowed' | 'quiet' | 'denied' | 'error' | 'web'>(
    Platform.OS === 'web' ? 'web' : 'checking',
  );
  const [permissionVersion, setPermissionVersion] = useState(0);
  const [registration, setRegistration] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(session);
  current.current = session;
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!session.enabled || Platform.OS === 'web') return;
    let active = true;
    void Notifications.getPermissionsAsync()
      .then((value) => {
        if (active)
          setPermission(!value.granted ? 'denied' : value.ios?.allowsSound === false ? 'quiet' : 'allowed');
      })
      .catch(() => {
        if (active) setPermission('error');
      });
    return () => {
      active = false;
    };
  }, [session.enabled, permissionVersion]);
  const query = useQuery({
    ...session.queryOptions,
    queryKey: ['admin', session.actorId, 'notification-settings'],
    queryFn: ({ signal }) =>
      session.request('/api/v1/admin/notification-settings', AdminNotificationSettingsResponseSchema, {
        signal,
      }),
  });
  const preference = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: async (input: { deviceId: string; pendingBookingAlerts: boolean }) => {
      await session.request(
        '/api/v1/admin/notification-settings',
        AdminNotificationSettingsUpdateResponseSchema,
        { method: 'PATCH', body: AdminNotificationSettingsUpdateSchema.parse(input) },
      );
      await session.invalidate();
    },
  });
  const test = useMutation({
    retry: false,
    networkMode: 'always',
    mutationFn: (deviceId: string) =>
      session.request('/api/v1/admin/test-push', AdminTestPushResponseSchema, {
        method: 'POST',
        body: { deviceId },
      }),
  });
  const busy = registration || preference.isPending || test.isPending;
  const disabled = !session.enabled || busy;
  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    if (disabled || pending.current) return;
    pending.current = true;
    const revision = session.revision;
    setError(null);
    setMessage(null);
    try {
      await action();
      if (mounted.current && current.current.isCurrent(revision)) setMessage(success);
    } catch (cause) {
      if (mounted.current && current.current.isCurrent(revision))
        setError(cause instanceof Error ? cause.message : 'The action could not be completed. Try again.');
    } finally {
      pending.current = false;
    }
  }
  async function register(): Promise<void> {
    if (disabled || pending.current || Platform.OS === 'web') return;
    pending.current = true;
    let revision = session.revision;
    const identityRevision = session.identityRevision;
    const hasIdentity = (): boolean => mounted.current && current.current.isIdentityCurrent(identityRevision);
    setRegistration(true);
    setError(null);
    setMessage(null);
    try {
      const allowed = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      });
      if (!hasIdentity()) return;
      if (!allowed.granted) throw new Error('Allow notifications in device settings to register this phone.');
      const ready = await current.current.waitForReady(identityRevision);
      if (!hasIdentity()) return;
      if (!ready)
        throw new Error('Return to the unlocked admin app while online, then register this phone again.');
      revision = current.current.revision;
      const stop = await registerPushDevice(
        auth.api,
        undefined,
        () => mounted.current && current.current.isCurrent(revision),
      );
      stop();
      if (!current.current.isCurrent(revision)) return;
      await query.refetch();
      if (!mounted.current || !current.current.isCurrent(revision)) return;
      setPermissionVersion((value) => value + 1);
      setMessage('This phone is registered. Send a test and check the alert on your phone.');
    } catch (cause) {
      if (mounted.current && current.current.isIdentityCurrent(identityRevision))
        setError(cause instanceof Error ? cause.message : 'Phone registration failed. Try again.');
    } finally {
      pending.current = false;
      if (mounted.current) setRegistration(false);
    }
  }
  return (
    <ScreenState
      title="Notification settings"
      subtitle="Check your devices and choose pending-booking alerts."
      status={
        !session.privateReady || (query.isPending && !session.offline)
          ? 'loading'
          : (query.isError && !query.data) || (session.offline && !query.data)
            ? 'error'
            : 'ready'
      }
      errorMessage="Notification settings could not be loaded. Reconnect and retry."
      onRetry={() => {
        void query.refetch();
      }}
    >
      {session.privateReady ? (
        <View style={styles.stack}>
          {session.offline ? (
            <AppText accessibilityRole="alert">You're offline. Notification changes are paused.</AppText>
          ) : null}
          <Card>
            <AppText weight="bold">This device</AppText>
            <AppText>
              {permission === 'web'
                ? 'External iPhone alerts must be enabled in the installed admin app.'
                : permission === 'allowed'
                  ? 'Notification permission is enabled.'
                  : permission === 'quiet'
                    ? 'Notifications are enabled, but sounds are off in iOS settings.'
                    : permission === 'denied'
                      ? 'Notification permission is off.'
                      : permission === 'error'
                        ? 'Notification permission could not be checked.'
                        : 'Checking notification permission…'}
            </AppText>
            {Platform.OS !== 'web' ? (
              <>
                <Button
                  label="Register this phone"
                  loading={registration}
                  disabled={disabled}
                  onPress={() => {
                    void register();
                  }}
                />
                <Button
                  label="Open device settings"
                  tone="secondary"
                  disabled={disabled}
                  onPress={() => {
                    void run(() => Linking.openSettings(), 'Return here after changing permissions.');
                  }}
                />
              </>
            ) : null}
            <Button
              label="Refresh device status"
              tone="secondary"
              disabled={disabled}
              onPress={() => {
                setPermissionVersion((value) => value + 1);
                void query.refetch();
              }}
            />
          </Card>
          {error ? (
            <AppText accessibilityRole="alert" tone="danger">
              {error}
            </AppText>
          ) : null}
          {message ? (
            <AppText accessibilityLiveRegion="polite" tone="success">
              {message}
            </AppText>
          ) : null}
          <AppText muted>
            New paid-booking alerts remain enabled for registered phones. Pending alerts are optional and tell
            you a customer has submitted a booking before payment succeeds.
          </AppText>
          {query.data?.devices.length === 0 ? (
            <Card>
              <AppText>
                No phones are registered to this account. Open this screen in the installed admin app and
                register the phone.
              </AppText>
            </Card>
          ) : null}
          {query.data?.devices.map((device) => (
            <Card key={device.id}>
              <AppText weight="bold">
                {device.deviceName ?? `${device.platform} device`}
                {device.currentSession ? ' · this session' : ''}
              </AppText>
              <Badge
                label={device.enabled ? 'Registered' : 'Disabled'}
                tone={device.enabled ? 'success' : 'warning'}
              />
              <AppText size="sm" muted>
                Last registered: {displayBookingCreatedAt(device.lastRegisteredAt)}
              </AppText>
              {device.lastError ? <AppText tone="danger">{device.lastError}</AppText> : null}
              {device.latestTicket ? (
                <AppText size="sm" muted>
                  Latest provider status: {device.latestTicket.status ?? 'Awaiting receipt'}
                  {device.latestTicket.error ? ` · ${device.latestTicket.error}` : ''}
                </AppText>
              ) : null}
              <ToggleField
                label={`Pending-booking alerts for ${device.deviceName ?? device.platform}`}
                value={device.pendingBookingAlerts}
                disabled={disabled || !device.enabled || device.platform === 'WEB'}
                onChange={(pendingBookingAlerts) => {
                  void run(
                    () => preference.mutateAsync({ deviceId: device.id, pendingBookingAlerts }),
                    'Notification preference saved.',
                  );
                }}
              />
              <Button
                label={`Send test to ${device.deviceName ?? device.platform}`}
                tone="secondary"
                disabled={disabled || !device.enabled || device.platform === 'WEB'}
                onPress={() => {
                  void run(
                    () => test.mutateAsync(device.id),
                    'The notification service accepted the test. Check this phone for the alert; acceptance alone does not confirm delivery.',
                  );
                }}
              />
            </Card>
          ))}
          {query.isError && query.data ? (
            <Card>
              <AppText accessibilityRole="alert">
                Device status could not be refreshed. Last loaded information is shown.
              </AppText>
              <Button
                label="Retry status"
                tone="secondary"
                disabled={disabled}
                onPress={() => {
                  void query.refetch();
                }}
              />
            </Card>
          ) : null}
        </View>
      ) : null}
    </ScreenState>
  );
}
const styles = StyleSheet.create({ stack: { gap: 16 } });
