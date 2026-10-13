import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { Manrope_500Medium, Manrope_700Bold } from '@expo-google-fonts/manrope';
import * as Sentry from '@sentry/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, Card } from '@/components/primitives';
import { OfflineBanner } from '@/components/offline-banner';
import { DriverPermissionGates } from '@/components/permission-gates';
import { JobOfferModal, type JobOfferAlert } from '@/notifications/job-offer-modal';
import { routeFromNotificationData, type NotificationData } from '@/notifications/routing';
import { AuthProvider, useAuth } from '@/state/auth';

const sentryDsn = typeof process.env.EXPO_PUBLIC_SENTRY_DSN === 'string' ? process.env.EXPO_PUBLIC_SENTRY_DSN : '';

Sentry.init({
  dsn: sentryDsn,
  enabled: sentryDsn.length > 0
});

Notifications.setNotificationHandler({
  handleNotification: () => Promise.resolve({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

export function RootShell(props: { children: React.ReactNode }): React.ReactElement {
  const queryClient = useMemo(() => new QueryClient(), []);
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_700Bold,
    Manrope_500Medium,
    Manrope_700Bold
  });
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      router.push(routeFromNotificationData(notificationData(response.notification.request.content.data)));
    });
    const response = Notifications.getLastNotificationResponse();
    if (response) router.push(routeFromNotificationData(notificationData(response.notification.request.content.data)));
    return () => { subscription.remove(); };
  }, []);
  if (!fontsLoaded) return <View />;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RuntimeGates>{props.children}</RuntimeGates>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function RuntimeGates(props: { children: React.ReactNode }): React.ReactElement {
  const auth = useAuth();
  const [alerts, setAlerts] = useState<JobOfferAlert[]>([]);
  useEffect(() => {
    void Notifications.setNotificationCategoryAsync('JOB_OFFERED', [
      { buttonTitle: 'Open', identifier: 'OPEN', options: { opensAppToForeground: true } },
      { buttonTitle: 'Decline', identifier: 'DECLINE', options: { opensAppToForeground: true } }
    ]);
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      const alert = jobOfferAlertFromData(notificationData(notification.request.content.data));
      if (alert) setAlerts((current) => [...current, alert]);
    });
    return () => { subscription.remove(); };
  }, []);
  return (
    <DriverPermissionGates>
      <UpdateBanner />
      <OfflineBanner />
      {auth.appLocked ? <AppLockGate /> : props.children}
      <JobOfferModal
        alerts={alerts}
        onOpen={(bookingId) => {
          setAlerts([]);
          router.push(`/(app)/offers/${bookingId}`);
        }}
      />
    </DriverPermissionGates>
  );
}

function AppLockGate(): React.ReactElement {
  const auth = useAuth();
  return (
    <SafeAreaView style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
      <Card>
        <AppText size="lg" weight="bold">Unlock Driver</AppText>
        <AppText muted>Use Face ID before viewing jobs, pay or customer details.</AppText>
        <Button label="Unlock" onPress={() => { void auth.unlock(); }} />
      </Card>
    </SafeAreaView>
  );
}

function UpdateBanner(): React.ReactElement | null {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    let cancelled = false;
    void Updates.checkForUpdateAsync()
      .then(async (result) => {
        if (!result.isAvailable) return;
        await Updates.fetchUpdateAsync();
        if (!cancelled) setReady(true);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  if (!ready) return null;
  return (
    <View style={{ padding: 12 }}>
      <Card>
        <AppText weight="bold">Update ready</AppText>
        <Button label="Restart to update" onPress={() => { void Updates.reloadAsync(); }} />
      </Card>
    </View>
  );
}

function notificationData(data: Notifications.NotificationContent['data']): NotificationData {
  if (!data) return {};
  const parsed: NotificationData = {};
  if (typeof data.bookingId === 'string') parsed.bookingId = data.bookingId;
  if (typeof data.notificationId === 'string') parsed.notificationId = data.notificationId;
  if (typeof data.type === 'string') parsed.type = data.type;
  if (typeof data.url === 'string') parsed.url = data.url;
  return parsed;
}

function jobOfferAlertFromData(data: NotificationData): JobOfferAlert | null {
  if (data.type !== 'JOB_OFFERED' || !data.bookingId || !data.notificationId) return null;
  return {
    bookingId: data.bookingId,
    notificationId: data.notificationId,
    route: 'New job offer',
    slot: 'Review now'
  };
}
