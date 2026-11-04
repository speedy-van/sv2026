import {
  mailReplyRecipients,
  type MailDelivery,
  type MailMessage,
  type MailReplyRequest,
} from '@sv/contracts';
import { router } from 'expo-router';
import { uuid } from 'expo-modules-core';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { mailAddresses, mailCopy, mailDeliveryLabel } from '@/content/mail';
import { useAdminToolAction } from '@/data/admin-tool-action';
import { useMailThread, type MailAttachmentContent } from '@/data/mail';
import { displayChatTime } from '@/lib/chat-date-time';
import { useAuth } from '@/state/auth';
import { AdminToolFeedback } from './admin-tool-feedback';
import { MailAttachment } from './mail-attachment';
import { MailHtml } from './mail-html';
import { AppText, Badge, Button, Card, SegmentedControl, TextField } from './primitives';
import { ScreenState } from './screen-state';

export function MailThread({ id, embedded = false }: { id: string; embedded?: boolean }): React.ReactElement {
  const auth = useAuth();
  return <ThreadContent key={`${auth.user?.id ?? 'signed-out'}:${id}`} id={id} embedded={embedded} />;
}

function ThreadContent({ id, embedded }: { id: string; embedded: boolean }): React.ReactElement {
  const mail = useMailThread(id);
  const action = useAdminToolAction(mail.session);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [mode, setMode] = useState<MailReplyRequest['mode']>('reply');
  const [body, setBody] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState<MailDelivery['status'] | null>(null);
  const [preview, setPreview] = useState<{ key: string; content: MailAttachmentContent } | null>(null);
  const pending = useRef<{ id: string; reply: MailReplyRequest } | null>(null);
  const messages = mail.session.privateReady
    ? [
        ...new Map(
          mail.query.data?.pages.flatMap((page) => page.messages).map((message) => [message.id, message]),
        ).values(),
      ]
    : [];
  const selected = messages.find((message) => message.id === replyTo);
  const mailbox = mail.status.data?.mailbox;
  const recipients = selected && mailbox ? mailReplyRecipients(selected, mode, mailbox) : null;
  const disabled = !mail.session.enabled || action.busy;
  const status =
    !mail.session.privateReady || (mail.query.isPending && !mail.session.offline)
      ? 'loading'
      : messages.length
        ? 'ready'
        : mail.query.isError || mail.session.offline || !id
          ? 'error'
          : 'empty';

  async function send(): Promise<void> {
    if (!selected || !recipients?.to.length || disabled || !body.trim()) return;
    const text = body.trim();
    const previous = pending.current;
    const input =
      previous?.id === selected.id && previous.reply.text === text && previous.reply.mode === mode
        ? previous
        : { id: selected.id, reply: { text, mode, clientMessageId: uuid.v4() } };
    pending.current = input;
    const result = await action.run(() => mail.reply.mutateAsync(input));
    if (result) {
      pending.current = null;
      setBody('');
      setDeliveryStatus(result.status);
    }
  }
  async function openAttachment(messageId: string, attachmentId: string): Promise<void> {
    const result = await action.run(() => mail.attachment.mutateAsync({ messageId, attachmentId }));
    if (result) setPreview({ key: `${messageId}:${attachmentId}:${uuid.v4()}`, content: result });
  }
  return (
    <ScreenState
      title={
        mail.session.privateReady ? mail.query.data?.pages[0]?.subject || 'Conversation' : 'Conversation'
      }
      subtitle="Business email · London time"
      status={status}
      emptyMessage="No messages in this conversation."
      errorMessage={mail.session.offline ? mailCopy.offline : mailCopy.loadError}
      onRetry={() => {
        void mail.query.refetch();
      }}
      onRefresh={() => {
        void mail.query.refetch();
      }}
      refreshing={mail.query.isRefetching}
      toolbar={
        <>
          {!embedded ? (
            <Button
              label="Back to Mail"
              tone="secondary"
              onPress={() => {
                router.push('/(app)/mail');
              }}
            />
          ) : null}
          <AdminToolFeedback offline={mail.session.offline} error={action.error} message={action.message} />
          {mail.query.isError && messages.length ? (
            <Card>
              <AppText accessibilityRole="alert">The latest messages could not be refreshed.</AppText>
              <Button
                label="Retry conversation"
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
      <AppText muted size="sm">
        Conversation includes messages synced from Inbox and Sent.
      </AppText>
      {messages.map((message) => (
        <MailMessageCard
          key={message.id}
          message={message}
          replyLabel={
            mailbox
              ? `Reply to ${mailReplyRecipients(message, 'reply', mailbox).to.join(', ') || 'this message'}`
              : 'Reply to this message'
          }
          disabled={disabled}
          onRead={() => {
            void action.run(() => mail.read.mutateAsync({ id: message.id, read: !message.read }), {
              success: message.read ? 'Marked unread.' : 'Marked read.',
            });
          }}
          onReply={() => {
            setReplyTo(message.id);
            setDeliveryStatus(null);
            action.clear();
          }}
          onAttachment={(attachmentId) => {
            void openAttachment(message.id, attachmentId);
          }}
        />
      ))}
      {mail.query.hasNextPage ? (
        <Button
          label="Load more messages"
          tone="secondary"
          disabled={!mail.session.enabled}
          loading={mail.query.isFetchingNextPage}
          onPress={() => {
            void mail.query.fetchNextPage();
          }}
        />
      ) : null}
      {preview && mail.session.privateReady ? (
        <MailAttachment
          key={preview.key}
          content={preview.content}
          onClose={() => {
            setPreview(null);
          }}
        />
      ) : null}
      {selected ? (
        <Card>
          <AppText accessibilityRole="header" weight="bold">
            Reply to this message
          </AppText>
          {recipients ? (
            <View>
              <AppText selectable>To: {recipients.to.join(', ')}</AppText>
              {recipients.cc.length ? <AppText selectable>Cc: {recipients.cc.join(', ')}</AppText> : null}
            </View>
          ) : (
            <View>
              <AppText accessibilityRole="alert">Reply addresses could not be loaded.</AppText>
              <Button
                label="Retry reply addresses"
                tone="secondary"
                disabled={!mail.session.enabled}
                onPress={() => {
                  void mail.status.refetch();
                }}
              />
            </View>
          )}
          {recipients && !recipients.to.length ? (
            <AppText accessibilityRole="alert">This message has no reply address.</AppText>
          ) : null}
          <SegmentedControl
            label="Reply recipients"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setDeliveryStatus(null);
            }}
            options={[
              { label: 'Reply', value: 'reply' },
              { label: 'Reply all', value: 'reply-all' },
            ]}
          />
          {mode === 'reply-all' ? (
            <AppText muted size="sm">
              Reply all includes the sender and other recipients in To and Cc.
            </AppText>
          ) : null}
          <TextField
            label="Email reply"
            value={body}
            onChangeText={(value) => {
              setBody(value);
              setDeliveryStatus(null);
            }}
            multiline
            maxLength={20_000}
            editable={!disabled}
            style={styles.composer}
          />
          <AppText muted size="xs">
            {body.length}/20,000 characters. The reply will be queued for sending.
          </AppText>
          {deliveryStatus ? (
            <AppText
              accessibilityLiveRegion="polite"
              tone={deliveryStatus === 'FAILED' || deliveryStatus === 'UNCERTAIN' ? 'danger' : 'success'}
            >
              {deliveryStatus === 'QUEUED'
                ? mailCopy.replyQueued
                : `Reply status: ${mailDeliveryLabel(deliveryStatus)}. Check Deliveries for details.`}
            </AppText>
          ) : null}
          <Button
            label={mode === 'reply-all' ? 'Queue reply to all' : 'Queue reply'}
            disabled={disabled || !body.trim() || !recipients?.to.length}
            loading={mail.reply.isPending}
            onPress={() => {
              void send();
            }}
          />
          <Button
            label="View deliveries"
            tone="secondary"
            onPress={() => {
              router.push('/(app)/mail/deliveries');
            }}
          />
          <Button
            label="Close reply"
            tone="secondary"
            disabled={action.busy}
            onPress={() => {
              setReplyTo(null);
              setBody('');
              pending.current = null;
            }}
          />
        </Card>
      ) : null}
    </ScreenState>
  );
}

function MailMessageCard({
  message,
  replyLabel,
  disabled,
  onRead,
  onReply,
  onAttachment,
}: {
  message: MailMessage;
  replyLabel: string;
  disabled: boolean;
  onRead: () => void;
  onReply: () => void;
  onAttachment: (id: string) => void;
}): React.ReactElement {
  const [formatted, setFormatted] = useState(false);
  return (
    <Card>
      <View style={styles.heading}>
        <AppText weight="bold" selectable>
          {mailAddresses(message.from)}
        </AppText>
        <Badge label={message.read ? 'Read' : 'Unread'} tone={message.read ? 'neutral' : 'warning'} />
      </View>
      <AppText size="sm" muted>
        {displayChatTime(message.sentAt)}
      </AppText>
      <AppText size="sm" selectable>
        To: {mailAddresses(message.to)}
      </AppText>
      {message.cc.length ? (
        <AppText size="sm" selectable>
          Cc: {mailAddresses(message.cc)}
        </AppText>
      ) : null}
      {formatted && message.bodyHtml ? (
        <MailHtml html={message.bodyHtml} text={message.bodyText} />
      ) : (
        <AppText selectable>{message.bodyText || 'No plain text version is available.'}</AppText>
      )}
      {message.bodyTruncated ? (
        <AppText accessibilityRole="alert" weight="bold">
          {mailCopy.bodyTruncated}
        </AppText>
      ) : null}
      {message.bodyHtml ? (
        <Button
          label={formatted ? 'Show plain text' : 'Show formatted email'}
          tone="secondary"
          onPress={() => {
            setFormatted(!formatted);
          }}
        />
      ) : null}
      {message.attachments.length ? (
        <View style={styles.attachments}>
          <AppText weight="bold">Attachments</AppText>
          <AppText muted size="sm">
            {mailCopy.attachmentLimit}
          </AppText>
          {message.attachments.map((attachment) => (
            <View key={attachment.id} style={styles.attachment}>
              <AppText selectable>
                {attachment.filename} · {Math.ceil(attachment.size / 1024)} KB
              </AppText>
              {attachment.blockedReason ? (
                <AppText accessibilityRole="alert" tone="danger">
                  {attachment.blockedReason}
                </AppText>
              ) : (
                <Button
                  label={`Open ${attachment.filename}`}
                  tone="secondary"
                  disabled={disabled}
                  onPress={() => {
                    onAttachment(attachment.id);
                  }}
                />
              )}
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          label={message.read ? 'Mark unread' : 'Mark read'}
          tone="secondary"
          disabled={disabled}
          onPress={onRead}
        />
        <Button label={replyLabel} tone="brand" disabled={disabled} onPress={onReply} />
      </View>
    </Card>
  );
}
const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  attachment: { gap: 8 },
  attachments: { gap: 14 },
  composer: { minHeight: 140, textAlignVertical: 'top' },
  heading: { alignItems: 'flex-start', gap: 10 },
});
