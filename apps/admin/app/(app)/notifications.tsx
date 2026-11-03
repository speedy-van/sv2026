import { BookingAlertReadRequestSchema, type NotificationItem } from '@sv/contracts';
import { router } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { notificationCopy } from '@/content/notifications';
import { useMarkNotificationsRead, useNotificationInbox } from '@/data/notifications';
import { displayChatTime } from '@/lib/chat-date-time';
import { useAuth } from '@/state/auth';

/** Use known entity identifiers, never a URL supplied in notification data. */
export function notificationDestination(item: NotificationItem): { bookingId?: string; label: string; path: string } | null {
  const booking = BookingAlertReadRequestSchema.safeParse({ bookingId: item.data?.bookingId });
  if (booking.success) {
    const { bookingId } = booking.data;
    return { bookingId, label: 'Open booking', path: `/(app)/bookings/${encodeURIComponent(bookingId)}` };
  }
  const conversationId = item.data?.conversationId;
  if (typeof conversationId === 'string' && conversationId.trim()) {
    return { label: 'Open conversation', path: `/(app)/chat/${encodeURIComponent(conversationId)}` };
  }
  if (item.type === 'manual_quote.requested') {
    return { label: 'Open quote requests', path: '/(app)/manual-quotes' };
  }
  return null;
}

export default function NotificationsScreen(): React.ReactElement {
  const { query, enabled, privateReady, offline } = useNotificationInbox();
  const auth = useAuth();
  const read = useMarkNotificationsRead();
  const session = { api: auth.api, userId: auth.user?.id, enabled };
  const currentSession = useRef(session);
  if (currentSession.current.api !== session.api || currentSession.current.userId !== session.userId || currentSession.current.enabled !== enabled) {
    currentSession.current = session;
  }
  const items = [...new Map(query.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item])).values()];
  const unreadCount = query.data?.pages[0]?.unreadCount;
  const status = !privateReady
    ? 'loading'
    : offline && !query.data
      ? 'error'
      : query.isPending
        ? 'loading'
        : !query.data
          ? 'error'
          : items.length === 0 ? 'empty' : 'ready';
  const refresh = (): void => { void query.refetch(); };
  return (
    <ScreenState
      title={notificationCopy.title}
      subtitle={notificationCopy.subtitle}
      status={status}
      emptyMessage={notificationCopy.empty}
      errorMessage={offline ? notificationCopy.offline : notificationCopy.error}
      onRetry={refresh}
      onRefresh={refresh}
      refreshing={query.isRefetching}
      toolbar={
        <>
          <Button label="Back to More" tone="secondary" onPress={() => { router.push('/(app)/more'); }} />
          {privateReady && unreadCount !== undefined ? (
            <View style={styles.summary}>
              <AppText accessibilityLiveRegion="polite" weight="bold">
                {String(unreadCount)} unread {unreadCount === 1 ? 'notification' : 'notifications'}
              </AppText>
              <Button
                label={notificationCopy.readAll}
                tone="secondary"
                disabled={!enabled || unreadCount === 0 || read.isPending}
                loading={read.isPending && 'all' in read.variables}
                onPress={() => { read.mutate({ all: true }); }}
              />
            </View>
          ) : null}
          {offline ? <AppText accessibilityRole="alert" tone="danger">{notificationCopy.offline}</AppText> : null}
          {read.isError ? <AppText accessibilityRole="alert" tone="danger">{notificationCopy.readError}</AppText> : null}
          {read.isSuccess ? (
            <AppText accessibilityLiveRegion="polite" tone="success">Notifications marked as read.</AppText>
          ) : null}
          {query.isError && query.data ? (
            <Card>
              <AppText accessibilityRole="alert" tone="danger">{notificationCopy.error}</AppText>
              <Button label="Retry notifications" tone="secondary" disabled={!enabled} onPress={refresh} />
            </Card>
          ) : null}
        </>
      }
    >
      <AppText muted size="sm">Unread notifications appear first. {notificationCopy.timeZone}</AppText>
      <View style={styles.list}>
        {items.map((item) => {
          const destination = notificationDestination(item);
          const unread = item.readAt === null;
          return (
            <Card key={item.id}>
              <View style={styles.heading}>
                <AppText accessibilityRole="header" aria-level={2} weight="bold" style={styles.title}>{item.title}</AppText>
                <Badge label={unread ? 'Unread' : 'Read'} tone={unread ? 'warning' : 'neutral'} />
              </View>
              <AppText selectable>{item.body}</AppText>
              <AppText muted size="sm">{displayChatTime(item.createdAt)}</AppText>
              <View style={styles.actions}>
                {unread ? (
                  <Button
                    label={`Mark read: ${item.title}`}
                    tone="secondary"
                    disabled={!enabled || read.isPending}
                    loading={read.isPending && 'ids' in read.variables && read.variables.ids.includes(item.id)}
                    onPress={() => { read.mutate({ ids: [item.id] }); }}
                  />
                ) : null}
                {destination ? (
                  <Button
                    label={destination.label}
                    tone="secondary"
                    disabled={!enabled || read.isPending}
                    loading={read.isPending && (
                      ('bookingId' in read.variables && read.variables.bookingId === destination.bookingId)
                      || ('ids' in read.variables && read.variables.ids.includes(item.id))
                    )}
                    onPress={() => {
                      if (unread && destination.bookingId) {
                        const initiatingSession = currentSession.current;
                        read.mutate(
                          item.type === 'booking.confirmed' ? { bookingId: destination.bookingId } : { ids: [item.id] },
                          {
                            onSuccess: () => {
                              if (currentSession.current === initiatingSession && currentSession.current.enabled) {
                                router.push(destination.path);
                              }
                            },
                          },
                        );
                      } else {
                        router.push(destination.path);
                      }
                    }}
                  />
                ) : null}
              </View>
            </Card>
          );
        })}
      </View>
      {query.hasNextPage ? (
        <Button
          label={notificationCopy.more}
          tone="secondary"
          disabled={!enabled || read.isPending}
          loading={query.isFetchingNextPage}
          onPress={() => { void query.fetchNextPage(); }}
        />
      ) : null}
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  heading: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  title: { flexBasis: 160, flexGrow: 1 },
  actions: { alignItems: 'flex-start', gap: 8 },
  summary: { gap: 12 },
});
