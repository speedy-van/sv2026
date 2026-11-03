import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque';
import { Manrope_500Medium, Manrope_700Bold } from '@expo-google-fonts/manrope';
import * as Sentry from '@sentry/react-native';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import * as Updates from 'expo-updates';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppText, Button, Card } from '@/components/primitives';
import { OfflineBanner } from '@/components/offline-banner';
import { JobOfferModal, type JobOfferAlert } from '@/notifications/job-offer-modal';
import { registerPushDevice } from '@/notifications/register-push';
import { routeFromNotificationData, type NotificationData } from '@/notifications/routing';
import { AuthProvider, useAuth } from '@/state/auth';
import { DriverQuerySession } from '@/state/query-session';

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
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_700Bold,
    Manrope_500Medium,
    Manrope_700Bold
  });
  if (!fontsLoaded) return <View />;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DriverQuerySession>
          <RuntimeGates>{props.children}</RuntimeGates>
        </DriverQuerySession>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function RuntimeGates(props: { children: React.ReactNode }): React.ReactElement {
  const auth = useAuth();
  const [alerts, setAlerts] = useState<JobOfferAlert[]>([]);
  const routedNotification = useRef<string | null>(null);
  useEffect(() => {
    if (auth.status !== 'signed-in' || auth.appLocked) return;
    function open(response: Notifications.NotificationResponse): void {
      const id = response.notification.request.identifier;
      if (routedNotification.current === id) return;
      routedNotification.current = id;
      router.push(routeFromNotificationData(notificationData(response.notification.request.content.data)));
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    const response = Notifications.getLastNotificationResponse();
    if (response) open(response);
    return () => { subscription.remove(); };
  }, [auth.status, auth.appLocked]);
  useEffect(() => {
    if (auth.status !== 'signed-in' || auth.appLocked) return;
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    void registerPushDevice(auth.api)
      .then((dispose) => {
        if (cancelled) {
          dispose();
        } else {
          cleanup = dispose;
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [auth.api, auth.status, auth.appLocked]);
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
    <>
      <UpdateBanner />
      {auth.status === 'signed-in' && !auth.appLocked ? <OfflineBanner /> : null}
      {props.children}
      {auth.status === 'signed-in' && !auth.appLocked ? <JobOfferModal
        alerts={alerts}
        onOpen={(bookingId) => {
          setAlerts([]);
          router.push(`/(app)/offers/${bookingId}`);
        }}
      /> : null}
    </>
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
