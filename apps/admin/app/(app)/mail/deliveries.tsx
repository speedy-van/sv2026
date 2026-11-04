import type { MailDelivery } from '@sv/contracts';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { AdminToolFeedback } from '@/components/admin-tool-feedback';
import { AppText, Badge, Button, Card } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { mailAddresses, mailCopy, mailDeliveryLabel } from '@/content/mail';
import { useAdminToolAction } from '@/data/admin-tool-action';
import { useMailDeliveries } from '@/data/mail';
import { displayChatTime } from '@/lib/chat-date-time';
import { useAppColors } from '@/theme/theme';
import { useAuth } from '@/state/auth';

export default function MailDeliveriesScreen(): React.ReactElement {
  const auth = useAuth();
  return <MailDeliveryList key={auth.user?.id ?? 'signed-out'} />;
}

function MailDeliveryList(): React.ReactElement {
  const mail = useMailDeliveries();
  const action = useAdminToolAction(mail.session);
  const colors = useAppColors();
  const [confirm, setConfirm] = useState<MailDelivery | null>(null);
  const items = mail.session.privateReady
    ? [
        ...new Map(
          mail.query.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]),
        ).values(),
      ]
    : [];
  const disabled = !mail.session.enabled || action.busy;
  async function retry(item: MailDelivery, acknowledgeDuplicateRisk: boolean): Promise<void> {
    setConfirm(null);
    await action.run(() => mail.retry.mutateAsync({ id: item.id, acknowledgeDuplicateRisk }), {
      success:
        item.status === 'SENT'
          ? 'Sent-folder copy retry queued.'
          : 'Retry requested. Check the delivery status for the result.',
    });
  }
  return (
    <>
      <ScreenState
        title="Mail deliveries"
        subtitle="Queued replies, send status and failures"
        status={
          !mail.session.privateReady || (mail.query.isPending && !mail.session.offline)
            ? 'loading'
            : items.length
              ? 'ready'
              : mail.query.isError || mail.session.offline
                ? 'error'
                : 'empty'
        }
        emptyMessage="No outgoing replies yet."
        errorMessage={mail.session.offline ? mailCopy.offline : 'Delivery status could not be loaded.'}
        onRetry={() => {
          void mail.query.refetch();
        }}
        onRefresh={() => {
          void mail.query.refetch();
        }}
        refreshing={mail.query.isRefetching}
        toolbar={
          <>
            <Button
              label="Back to Mail"
              tone="secondary"
              onPress={() => {
                router.push('/(app)/mail');
              }}
            />
            <AdminToolFeedback offline={mail.session.offline} error={action.error} message={action.message} />
            {mail.query.isError && items.length ? (
              <AppText accessibilityRole="alert">
                Delivery updates could not be refreshed. Retry before resending.
              </AppText>
            ) : null}
          </>
        }
      >
        {items.map((item) => (
          <Card key={item.id}>
            <AppText weight="bold">{item.subject || 'No subject'}</AppText>
            <AppText selectable>To: {mailAddresses(item.to)}</AppText>
            <Badge
              label={mailDeliveryLabel(item.status)}
              tone={
                item.status === 'FAILED' || item.status === 'UNCERTAIN'
                  ? 'danger'
                  : item.status === 'SENT'
                    ? 'success'
                    : 'neutral'
              }
            />
            <AppText muted size="sm">
              Created {displayChatTime(item.createdAt)} · {item.attempts} attempts
            </AppText>
            {item.sentAt ? <AppText size="sm">Sent {displayChatTime(item.sentAt)}</AppText> : null}
            {item.status === 'UNCERTAIN' ? (
              <AppText accessibilityRole="alert">{mailCopy.uncertain}</AppText>
            ) : null}
            {item.status === 'FAILED' ? (
              <AppText accessibilityRole="alert">
                The email could not be sent. Retry when the sending issue is resolved.
              </AppText>
            ) : null}
            {item.nextAttemptAt ? (
              <AppText muted size="sm">
                Next attempt {displayChatTime(item.nextAttemptAt)}
              </AppText>
            ) : null}
            {item.canRetry && item.status === 'SENT' ? (
              <AppText accessibilityRole="alert">
                Email sent. Its copy could not yet be saved in the Sent folder.
              </AppText>
            ) : null}
            {item.canRetry ? (
              <Button
                label={
                  item.status === 'SENT'
                    ? 'Save Sent-folder copy again'
                    : item.status === 'DEFERRED'
                      ? 'Recheck sending allowance'
                      : `Retry ${item.subject || 'email'}`
                }
                tone="secondary"
                disabled={disabled || mail.query.isError}
                onPress={() => {
                  if (item.status === 'UNCERTAIN') setConfirm(item);
                  else void retry(item, false);
                }}
              />
            ) : null}
          </Card>
        ))}
        {mail.query.hasNextPage ? (
          <Button
            label="Load more deliveries"
            tone="secondary"
            disabled={!mail.session.enabled}
            loading={mail.query.isFetchingNextPage}
            onPress={() => {
              void mail.query.fetchNextPage();
            }}
          />
        ) : null}
      </ScreenState>
      <Modal
        visible={confirm !== null && mail.session.privateReady}
        transparent
        animationType="none"
        onRequestClose={() => {
          setConfirm(null);
        }}
      >
        <View style={[styles.overlay, { backgroundColor: colors.background }]}>
          <View accessibilityViewIsModal style={styles.dialog}>
            <Card>
              <AppText accessibilityRole="header" size="lg" weight="bold">
                Retry an unconfirmed delivery?
              </AppText>
              <AppText>{mailCopy.uncertain}</AppText>
              <AppText weight="bold">{confirm?.subject}</AppText>
              <Button
                label="Retry — I understand it may send twice"
                tone="danger"
                disabled={disabled}
                onPress={() => {
                  if (confirm) void retry(confirm, true);
                }}
              />
              <Button
                label="Keep current delivery"
                tone="secondary"
                onPress={() => {
                  setConfirm(null);
                }}
              />
            </Card>
          </View>
        </View>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  overlay: { alignItems: 'center', flex: 1, justifyContent: 'center', padding: 24 },
  dialog: { maxWidth: 520, width: '100%' },
});
