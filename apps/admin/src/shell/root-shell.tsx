import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { Manrope_500Medium, Manrope_700Bold } from '@expo-google-fonts/manrope';
import * as Sentry from '@sentry/react-native';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppText, Button, Card } from '@/components/primitives';
import { OfflineBanner } from '@/components/offline-banner';
import { NotificationPermissionGate } from '@/components/notification-permission-gate';
import { NewJobModal } from '@/notifications/new-job-modal';
import { registerPushDevice } from '@/notifications/register-push';
import { foregroundNotificationBehavior, useBookingAlerts } from '@/notifications/use-booking-alerts';
import { AuthProvider, useAuth } from '@/state/auth';
import { QueryRuntime } from '@/state/query-runtime';
import { AdminNavigationPrefetch } from '@/data/admin-navigation-prefetch';
import { useAppColorScheme, useAppColors } from '@/theme/theme';
import { ChatSoundProvider } from '@/notifications/chat-sound-provider';

const sentryDsn =
  typeof process.env.EXPO_PUBLIC_SENTRY_DSN === 'string' ? process.env.EXPO_PUBLIC_SENTRY_DSN : '';

Sentry.init({
  dsn: sentryDsn,
  enabled: sentryDsn.length > 0,
});

if (Platform.OS !== 'web')
  Notifications.setNotificationHandler({
    handleNotification: (notification) =>
      Promise.resolve(
        foregroundNotificationBehavior(notification.request.content.data, notification.request.identifier),
      ),
  });

export function RootShell(props: { children: React.ReactNode }): React.ReactElement {
  const colors = useAppColors();
  const scheme = useAppColorScheme();
  const baseTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.brand,
      notification: colors.danger,
    },
  };
  const queryClient = useMemo(() => new QueryClient(), []);
  useEffect(
    () => () => {
      queryClient.clear();
    },
    [queryClient],
  );
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_700Bold,
    Manrope_500Medium,
    Manrope_700Bold,
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  return (
    <SafeAreaProvider style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemeProvider value={navigationTheme}>
        <QueryClientProvider client={queryClient}>
          <QueryRuntime />
          <AuthProvider>
            <RuntimeGates>{props.children}</RuntimeGates>
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function RuntimeGates(props: { children: React.ReactNode }): React.ReactElement {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const bookingAlerts = useBookingAlerts();
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [pushVersion, setPushVersion] = useState(0);
  const [pushError, setPushError] = useState<string | null>(null);
  const onPermissionGranted = useCallback(() => {
    setPermissionGranted(true);
  }, []);
  const privateReady = auth.status === 'signed-in' && !auth.appLocked;
  useEffect(() => {
    if (auth.status === 'idle') {
      queryClient.clear();
      setPermissionGranted(false);
      setPushError(null);
    }
  }, [auth.status, privateReady, queryClient]);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setPushVersion((current) => current + 1);
    });
    return () => {
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (auth.status !== 'signed-in' || !permissionGranted) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    setPushError(null);
    void registerPushDevice(auth.api, () => {
      if (!cancelled)
        setPushError(
          'Push registration could not be refreshed. Retry to restore alerts when the app is closed.',
        );
    })
      .then((dispose) => {
        if (cancelled) {
          dispose();
        } else {
          cleanup = dispose;
        }
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setPushError(
            error instanceof Error
              ? error.message
              : 'Booking push alerts could not be registered. Try again.',
          );
        Sentry.captureException(error, { tags: { feature: 'admin-push-registration' } });
      });
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [auth.api, auth.status, permissionGranted, pushVersion]);
  useEffect(() => {
    if (Platform.OS === 'web' || !privateReady) return;
    void Notifications.setNotificationCategoryAsync('NEW_BOOKING', [
      { buttonTitle: 'Open', identifier: 'OPEN', options: { opensAppToForeground: true } },
      { buttonTitle: 'Dismiss', identifier: 'DISMISS', options: { opensAppToForeground: false } },
    ]).catch((error: unknown) => {
      Sentry.captureException(error, { tags: { feature: 'admin-notification-category' } });
    });
  }, [auth.api, privateReady]);
  const content = (
    <>
      <AdminNavigationPrefetch />
      <UpdateBanner />
      <OfflineBanner />
      {privateReady && pushError ? (
        <View style={{ padding: 16 }}>
          <Card>
            <AppText weight="bold">Booking push alerts need attention</AppText>
            <AppText accessibilityRole="alert" size="sm" tone="danger">
              {pushError}
            </AppText>
            <Button
              label="Retry push registration"
              tone="secondary"
              onPress={() => {
                setPushVersion((current) => current + 1);
              }}
            />
          </Card>
        </View>
      ) : null}
      {bookingAlerts.error ? (
        <View style={{ padding: 16 }}>
          <Card>
            <AppText accessibilityRole="alert" size="sm" tone="danger">
              {bookingAlerts.error}
            </AppText>
            <Button label="Retry booking alerts" tone="secondary" onPress={bookingAlerts.retry} />
          </Card>
        </View>
      ) : null}
      <ChatSoundProvider>{props.children}</ChatSoundProvider>
    </>
  );
  return (
    <>
      <NotificationPermissionGate enabled={privateReady} onPermissionGranted={onPermissionGranted}>
        {content}
      </NotificationPermissionGate>
      {privateReady ? (
        <NewJobModal
          alerts={bookingAlerts.alerts}
          onDismiss={bookingAlerts.dismiss}
          onOpen={bookingAlerts.open}
        />
      ) : null}
    </>
  );
}

function UpdateBanner(): React.ReactElement | null {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (process.env.NODE_ENV !== 'production') return;
    let cancelled = false;
    void Updates.checkForUpdateAsync()
      .then(async (result) => {
        if (!result.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (!cancelled) setReady(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  if (!ready) return null;
  return (
    <View style={{ padding: 12 }}>
      <Card>
        <AppText weight="bold">Update ready</AppText>
        <Button
          label="Restart to update"
          onPress={() => {
            void Updates.reloadAsync();
          }}
        />
      </Card>
    </View>
  );
}
