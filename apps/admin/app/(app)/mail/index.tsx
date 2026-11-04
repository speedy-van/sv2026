import type { MailFolder, MailMessageSummary } from '@sv/contracts';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { AdminToolFeedback } from '@/components/admin-tool-feedback';
import { MailThread } from '@/components/mail-thread';
import { AppText, Badge, Button, Card, SearchField, SegmentedControl } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { mailAddresses, mailCopy } from '@/content/mail';
import { useAdminToolAction } from '@/data/admin-tool-action';
import { useMailInbox } from '@/data/mail';
import { displayChatTime } from '@/lib/chat-date-time';
import { useAuth } from '@/state/auth';
import { useAppColors } from '@/theme/theme';

export default function MailScreen(): React.ReactElement {
  const auth = useAuth();
  return <Mailbox key={auth.user?.id ?? 'signed-out'} />;
}

function Mailbox(): React.ReactElement {
  const [folder, setFolder] = useState<MailFolder>('inbox');
  const [search, setSearch] = useState('');
  const [queryText, setQueryText] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const { width } = useWindowDimensions();
  const mail = useMailInbox(folder, queryText);
  const action = useAdminToolAction(mail.session);
  useEffect(() => {
    const timeout = setTimeout(() => {
      setQueryText(search.trim());
    }, 300);
    return () => {
      clearTimeout(timeout);
    };
  }, [search]);
  const statusData = mail.session.privateReady ? mail.status.data : undefined;
  const pages = mail.session.privateReady ? mail.query.data?.pages : undefined;
  const items = [...new Map(pages?.flatMap((page) => page.items).map((item) => [item.id, item])).values()];
  const configured = statusData?.configured === true;
  const status =
    !mail.session.privateReady || (mail.status.isPending && !mail.session.offline)
      ? 'loading'
      : !statusData
        ? 'error'
        : !configured
          ? 'ready'
          : mail.query.isPending && !mail.session.offline
            ? 'loading'
            : items.length
              ? 'ready'
              : mail.query.isError || mail.session.offline
                ? 'error'
                : 'empty';
  const split = width >= 1100;
  function openMessage(item: MailMessageSummary): void {
    if (split) setSelected(item.threadId);
    else router.push(`/(app)/mail/${encodeURIComponent(item.threadId)}`);
  }
  return (
    <View style={[styles.shell, split && styles.split]}>
      <View style={styles.panel}>
        <ScreenState
          title={mailCopy.title}
          subtitle={statusData?.mailbox ?? 'Business inbox and sent email'}
          status={status}
          emptyMessage={
            queryText
              ? 'No messages match your search.'
              : `No messages in ${folder === 'inbox' ? 'Inbox' : 'Sent'}.`
          }
          errorMessage={mail.session.offline ? mailCopy.offline : mailCopy.loadError}
          onRetry={() => {
            void mail.status.refetch();
            if (configured) void mail.query.refetch();
          }}
          onRefresh={() => {
            void mail.status.refetch();
            if (configured) void mail.query.refetch();
          }}
          refreshing={mail.query.isRefetching || mail.status.isRefetching}
          toolbar={
            <>
              <View style={styles.actions}>
                <Button
                  label="Back to More"
                  tone="secondary"
                  onPress={() => {
                    router.push('/(app)/more');
                  }}
                />
                <Button
                  label={`Deliveries${statusData?.failedCount || statusData?.uncertainCount ? ` (${String(statusData.failedCount + statusData.uncertainCount)} need attention)` : ''}`}
                  tone="secondary"
                  onPress={() => {
                    router.push('/(app)/mail/deliveries');
                  }}
                />
              </View>
              <SegmentedControl
                label="Mail folder"
                value={folder}
                onChange={(next) => {
                  setFolder(next);
                  setSelected(null);
                }}
                options={[
                  { label: 'Inbox', value: 'inbox' },
                  { label: 'Sent', value: 'sent' },
                ]}
              />
              <SearchField
                label="Search email"
                placeholder="Search synced subjects and previews"
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={200}
              />
              <Button
                label="Sync mailbox"
                tone="brand"
                disabled={!mail.session.enabled || !configured || action.busy}
                loading={mail.sync.isPending}
                onPress={() => {
                  void action.run(
                    async () => {
                      const result = await mail.sync.mutateAsync();
                      if (result.syncError) throw new Error(result.syncError);
                      return result;
                    },
                    { success: 'Mailbox sync completed.' },
                  );
                }}
              />
              <AdminToolFeedback
                offline={mail.session.offline}
                error={action.error ?? statusData?.syncError ?? pages?.[0]?.sync.error ?? null}
                message={action.message}
              />
              {statusData?.lastSyncAt ? (
                <AppText muted size="xs">
                  Last synced {displayChatTime(statusData.lastSyncAt)}
                </AppText>
              ) : null}
              {pages?.[0]?.sync.hasMore ? (
                <AppText muted size="sm">
                  More email is available. Use Load more email to view earlier messages.
                </AppText>
              ) : null}
              {mail.query.isError && items.length ? (
                <Card>
                  <AppText accessibilityRole="alert">
                    Mail could not be refreshed. Your last loaded messages are shown.
                  </AppText>
                  <Button
                    label="Retry mail"
                    tone="secondary"
                    onPress={() => {
                      void mail.query.refetch();
                    }}
                  />
                </Card>
              ) : null}
            </>
          }
        >
          {!configured ? (
            <Card>
              <AppText>{mailCopy.notConfigured}</AppText>
            </Card>
          ) : (
            <>
              <AppText muted size="sm">
                {statusData.folders.find((entry) => entry.id === folder)?.unreadCount ?? 0} unread · London
                time
              </AppText>
              <View style={styles.list}>
                {items.map((item) => (
                  <MailRow
                    key={item.id}
                    item={item}
                    onPress={() => {
                      openMessage(item);
                    }}
                  />
                ))}
              </View>
              {mail.query.hasNextPage ? (
                <Button
                  label="Load more email"
                  tone="secondary"
                  disabled={!mail.session.enabled}
                  loading={mail.query.isFetchingNextPage}
                  onPress={() => {
                    void mail.query.fetchNextPage();
                  }}
                />
              ) : null}
              <Card>
                <AppText weight="bold">Daily sending allowance</AppText>
                <AppText>
                  {statusData.quota.messagesUsed} of {statusData.quota.messagesLimit} messages ·{' '}
                  {statusData.quota.externalRecipientsUsed} of {statusData.quota.externalRecipientsLimit}{' '}
                  external recipients
                </AppText>
                <AppText muted size="sm">
                  Resets {displayChatTime(statusData.quota.resetsAt)}
                </AppText>
              </Card>
            </>
          )}
        </ScreenState>
      </View>
      {split && selected ? (
        <View style={styles.panel}>
          <MailThread id={selected} embedded />
        </View>
      ) : null}
    </View>
  );
}

function MailRow({ item, onPress }: { item: MailMessageSummary; onPress: () => void }): React.ReactElement {
  const colors = useAppColors();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.subject || 'No subject'}, ${item.read ? 'read' : 'unread'}`}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
          borderColor: focused ? colors.focus : colors.border,
        },
      ]}
    >
      <AppText weight="bold" numberOfLines={2}>
        {item.subject || 'No subject'}
      </AppText>
      <AppText size="sm" numberOfLines={2}>
        {mailAddresses(item.folder === 'sent' ? item.to : item.from)}
      </AppText>
      <AppText size="sm" muted numberOfLines={2}>
        {item.snippet}
      </AppText>
      <View style={styles.actions}>
        <Badge label={item.read ? 'Read' : 'Unread'} tone={item.read ? 'neutral' : 'warning'} />
        {item.attachmentCount ? (
          <AppText size="xs" muted>
            {item.attachmentCount} attachments
          </AppText>
        ) : null}
      </View>
      <AppText size="xs" muted>
        {displayChatTime(item.sentAt)}
      </AppText>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  shell: { flex: 1 },
  split: { flexDirection: 'row' },
  panel: { flex: 1, minWidth: 0 },
  actions: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  list: { gap: 12 },
  row: { borderRadius: 18, borderWidth: 2, gap: 8, minHeight: 100, padding: 16 },
});
