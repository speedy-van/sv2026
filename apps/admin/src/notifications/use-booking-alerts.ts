import NetInfo from '@react-native-community/netinfo';
import * as Sentry from '@sentry/react-native';
import { AdminBookingAlertsResponseSchema, BookingAlertReadResponseSchema } from '@sv/contracts';
import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from '@/state/auth';
import { addAlerts, dismissAlert, newJobAlertFromNotification, type NewJobAlert } from './new-job-queue';
import { routeFromNotificationData, type NotificationData } from './routing';
import { handleForegroundChatPush } from './chat-push';

let customForegroundAlertReady = false;

export function foregroundNotificationBehavior(
  data: unknown,
  deliveryId: string,
): Notifications.NotificationBehavior {
  const customAlert = customForegroundAlertReady && Boolean(newJobAlertFromNotification(data, deliveryId));
  const handledChat = handleForegroundChatPush(data);
  return {
    shouldPlaySound: !customAlert && !handledChat,
    shouldSetBadge: true,
    shouldShowBanner: !customAlert,
    shouldShowList: true,
  };
}

interface PendingResponse {
  key: string;
  data: NotificationData;
}

function responseData(data: Notifications.NotificationContent['data']): NotificationData {
  if (!data) return {};
  return {
    ...(typeof data.bookingId === 'string' ? { bookingId: data.bookingId } : {}),
    ...(typeof data.conversationId === 'string' ? { conversationId: data.conversationId } : {}),
    ...(typeof data.recipientUserId === 'string' ? { recipientUserId: data.recipientUserId } : {}),
    ...(typeof data.type === 'string' ? { type: data.type } : {}),
    ...(typeof data.url === 'string' ? { url: data.url } : {}),
  };
}

export function useBookingAlerts(): {
  alerts: NewJobAlert[];
  error: string | null;
  dismiss: (notificationId: string) => void;
  open: (bookingId: string) => void;
  retry: () => void;
} {
  const auth = useAuth();
  const queries = useQueryClient();
  const network = NetInfo.useNetInfo();
  const [foreground, setForeground] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const privateReady = auth.status === 'signed-in' && !auth.appLocked;
  const active = privateReady && foreground;
  const online = network.isConnected !== false && network.isInternetReachable !== false;
  const [queue, setQueue] = useState<{ client: typeof auth.api | null; alerts: NewJobAlert[] }>({
    client: null,
    alerts: [],
  });
  const [error, setError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pollVersion, setPollVersion] = useState(0);
  const [pending, setPending] = useState<PendingResponse | null>(null);
  const handledResponses = useRef(new Set<string>());
  const seen = useRef({ client: auth.api, keys: new Set<string>() });
  const unreadAcknowledgements = useRef(new Set<string>());
  const current = useRef({ api: auth.api, active, userId: auth.user?.id });
  current.current = { api: auth.api, active, userId: auth.user?.id };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
    });
    // Native startup can become active between render and listener registration.
    setForeground(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
    return () => {
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!privateReady) setQueue({ client: null, alerts: [] });
    if (seen.current.client !== auth.api) {
      seen.current = { client: auth.api, keys: new Set() };
      unreadAcknowledgements.current.clear();
      setError(null);
      setReadError(null);
    }
  }, [auth.api, privateReady]);

  const receive = useCallback(
    (incoming: NewJobAlert[]): void => {
      const client = auth.api;
      if (!current.current.active || current.current.api !== client) return;
      if (seen.current.client !== client) seen.current = { client, keys: new Set() };
      const fresh = incoming.filter((alert) => !seen.current.keys.has(alert.notificationId));
      if (!fresh.length) return;
      for (const alert of fresh) seen.current.keys.add(alert.notificationId);
      setQueue((value) => ({
        client,
        alerts: addAlerts(value.client === client ? value.alerts : [], fresh),
      }));
      void queries.invalidateQueries({ queryKey: ['admin', current.current.userId] });
    },
    [auth.api, queries],
  );

  useEffect(() => {
    if (Platform.OS === 'web' || !active) return;
    let listening = true;
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      if (!listening) return;
      const alert = newJobAlertFromNotification(
        notification.request.content.data,
        notification.request.identifier,
      );
      if (alert) receive([alert]);
      else void queries.invalidateQueries({ queryKey: ['admin', auth.user?.id] });
    });
    customForegroundAlertReady = true;
    return () => {
      listening = false;
      customForegroundAlertReady = false;
      subscription.remove();
    };
  }, [active, auth.user?.id, queries, receive]);

  useEffect(() => {
    if (!active || !online) return;
    let listening = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cursors = new Set<string>();
    async function poll(cursor?: string): Promise<void> {
      try {
        const parameters = new URLSearchParams({ limit: '100' });
        if (cursor) parameters.set('cursor', cursor);
        const page = await auth.api.request(`/api/v1/admin/feed?${parameters.toString()}`, {
          schema: AdminBookingAlertsResponseSchema,
        });
        if (!listening) return;
        receive(
          page.items.flatMap((item) => {
            const alert = newJobAlertFromNotification(item.data, item.id);
            return alert ? [alert] : [];
          }),
        );
        setError(null);
        const next = page.nextCursor;
        if (next && cursors.has(next)) throw new Error('The booking alert feed repeated a page.');
        if (next) cursors.add(next);
        else cursors.clear();
        timer = setTimeout(
          () => {
            void poll(next ?? undefined);
          },
          next ? 0 : 20_000,
        );
      } catch (cause) {
        if (!listening) return;
        setError('New booking alerts could not be refreshed. Existing bookings are still available.');
        Sentry.captureException(cause, { tags: { feature: 'admin-booking-alert-feed' } });
        cursors.clear();
        timer = setTimeout(() => {
          void poll();
        }, 20_000);
      }
    }
    void poll();
    return () => {
      listening = false;
      clearTimeout(timer);
    };
  }, [active, auth.api, online, pollVersion, receive]);

  const acknowledge = useCallback(
    (bookingId: string): void => {
      const client = auth.api;
      unreadAcknowledgements.current.add(bookingId);
      void client
        .request('/api/v1/admin/feed/read', {
          body: { bookingId },
          method: 'POST',
          schema: BookingAlertReadResponseSchema,
        })
        .then(() => {
          if (current.current.api === client) {
            unreadAcknowledgements.current.delete(bookingId);
            if (!unreadAcknowledgements.current.size) setReadError(null);
          }
        })
        .catch((cause: unknown) => {
          if (current.current.api !== client || !current.current.active) return;
          setReadError(
            'The booking opened, but its alert could not be marked as read. Retry when connected.',
          );
          Sentry.captureException(cause, { tags: { feature: 'admin-booking-alert-read' } });
        });
    },
    [auth.api],
  );

  const open = useCallback(
    (bookingId: string): void => {
      if (!current.current.active || current.current.api !== auth.api) return;
      setQueue((value) => ({
        ...value,
        alerts: value.alerts.filter((alert) => alert.bookingId !== bookingId),
      }));
      acknowledge(bookingId);
      router.push(`/(app)/bookings/${encodeURIComponent(bookingId)}`);
    },
    [acknowledge, auth.api],
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let listening = true;
    function capture(response: Notifications.NotificationResponse): void {
      if (!listening) return;
      const key = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      if (handledResponses.current.has(key)) return;
      handledResponses.current.add(key);
      if (
        ![Notifications.DEFAULT_ACTION_IDENTIFIER, 'OPEN', 'VIEW', 'ASSIGN'].includes(
          response.actionIdentifier,
        )
      )
        return;
      setPending({ key, data: responseData(response.notification.request.content.data) });
      try {
        Notifications.clearLastNotificationResponse();
      } catch (cause) {
        Sentry.captureException(cause, { tags: { feature: 'admin-booking-alert-response-clear' } });
      }
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(capture);
    try {
      const response = Notifications.getLastNotificationResponse();
      if (response) capture(response);
    } catch (cause) {
      Sentry.captureException(cause, { tags: { feature: 'admin-booking-alert-cold-start' } });
    }
    return () => {
      listening = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    if (!active || !pending) return;
    setPending(null);
    if (pending.data.recipientUserId && pending.data.recipientUserId !== auth.user?.id) return;
    if (pending.data.type === 'NEW_BOOKING' && pending.data.bookingId) open(pending.data.bookingId);
    else router.push(routeFromNotificationData(pending.data));
  }, [active, auth.user?.id, open, pending]);

  return {
    alerts: active && queue.client === auth.api ? queue.alerts : [],
    error: privateReady ? (readError ?? error) : null,
    dismiss: (notificationId) => {
      setQueue((value) =>
        value.client === auth.api ? { ...value, alerts: dismissAlert(value.alerts, notificationId) } : value,
      );
    },
    open,
    retry: () => {
      if (!active) return;
      for (const bookingId of unreadAcknowledgements.current) acknowledge(bookingId);
      setPollVersion((value) => value + 1);
    },
  };
}
