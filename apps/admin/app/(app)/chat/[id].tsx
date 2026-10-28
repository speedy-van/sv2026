import { router, useLocalSearchParams } from 'expo-router';
import { uuid } from 'expo-modules-core';
import { useContext, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatMessage } from '@sv/contracts';
import { AppText, Button, Card, TextField } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { chatCopy } from '@/content/chat';
import { useChatThread } from '@/data/chat';
import { displayChatTime } from '@/lib/chat-date-time';
import { useAppColors } from '@/theme/theme';
import { ChatSoundControl } from '@/components/chat-sound-control';
import { AdminHeaderHeightContext } from '@/shell/admin-header-context';
import { useKeyboardVisible } from '@/lib/use-keyboard-visible';

export default function ChatConversationScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = typeof params.id === 'string' ? params.id : '';
  return <ChatConversation key={id} conversationId={id} />;
}

export function ChatConversation({ conversationId }: { conversationId: string }): React.ReactElement {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const headerHeight = useContext(AdminHeaderHeightContext);
  const chat = useChatThread(conversationId);
  const { query, send, read, older } = chat;
  const [body, setBody] = useState('');
  const [atLatest, setAtLatest] = useState(true);
  const keyboardVisible = useKeyboardVisible();
  const list = useRef<FlatList<ChatMessage>>(null);
  const pending = useRef<{ body: string; clientMessageId: string } | null>(null);
  const lastRead = useRef<string | null>(null);
  const submitting = useRef(false);
  const messages = query.data?.messages ?? [];
  const lastCustomerMessage = [...messages].reverse().find((message) => message.sender === 'CUSTOMER');
  const unread = query.data?.conversation.unreadCount ?? 0;
  const readId = lastCustomerMessage?.id;
  const { mutate: markRead, isError: readFailed } = read;
  useEffect(() => {
    if (!chat.enabled || !atLatest || !readId || unread === 0 || lastRead.current === readId || readFailed)
      return;
    lastRead.current = readId;
    markRead(readId);
  }, [atLatest, chat.enabled, markRead, readFailed, readId, unread]);

  async function sendReply(): Promise<void> {
    if (submitting.current || !chat.enabled || !body.trim()) return;
    submitting.current = true;
    const text = body.trim();
    const input =
      pending.current?.body === text ? pending.current : { body: text, clientMessageId: uuid.v4() };
    pending.current = input;
    try {
      await send.mutateAsync(input);
      pending.current = null;
      setBody('');
      setAtLatest(true);
      list.current?.scrollToEnd({ animated: false });
    } catch {
      // The mutation exposes the failure below and keeps this exact UUID available for a safe retry.
    } finally {
      submitting.current = false;
    }
  }

  function updateScroll(event: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    setAtLatest(contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80);
  }

  const back = (
    <Button
      label="Back to live chat"
      tone="secondary"
      onPress={() => {
        router.push('/(app)/chat');
      }}
    />
  );
  if (!query.data || !conversationId) {
    return (
      <ScreenState
        title={chatCopy.title}
        status={!conversationId || query.isError || chat.offline ? 'error' : 'loading'}
        errorMessage={chat.offline ? chatCopy.offline : chatCopy.threadError}
        onRetry={() => {
          void query.refetch();
        }}
        toolbar={back}
      >
        {null}
      </ScreenState>
    );
  }
  const name = query.data.conversation.customerName ?? chatCopy.visitor;
  return (
    <KeyboardAvoidingView
      testID="chat-keyboard-avoiding-view"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={headerHeight}
      style={[styles.screen, { backgroundColor: colors.background }]}
    >
      <View style={styles.container}>
        <View style={[styles.header, keyboardVisible && styles.headerKeyboard]}>
          {back}
          <View style={[styles.heading, keyboardVisible && styles.headingKeyboard]}>
            <AppText
              accessibilityRole="header"
              aria-level={1}
              size="lg"
              weight="bold"
              numberOfLines={keyboardVisible ? 1 : undefined}
            >
              {name}
            </AppText>
            {!keyboardVisible ? (
              <AppText muted size="xs">
                Website conversation · London time
              </AppText>
            ) : null}
          </View>
        </View>
        {!keyboardVisible ? (
          <View style={styles.soundControl}>
            <ChatSoundControl />
          </View>
        ) : null}
        {chat.offline ? (
          <AppText accessibilityRole="alert" tone="danger" style={styles.notice}>
            {chatCopy.offline}
          </AppText>
        ) : null}
        {query.isError ? (
          <View style={styles.notice}>
            <AppText accessibilityRole="alert" tone="danger">
              {chatCopy.threadError}
            </AppText>
            <Button
              label="Retry messages"
              tone="secondary"
              onPress={() => {
                void query.refetch();
              }}
            />
          </View>
        ) : null}
        <FlatList
          accessibilityLabel={`Messages with ${name}`}
          data={messages}
          keyExtractor={(message) => message.id}
          ref={list}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={false}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScroll={updateScroll}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (atLatest) list.current?.scrollToEnd({ animated: false });
          }}
          contentContainerStyle={styles.messages}
          style={styles.list}
          ListHeaderComponent={
            query.data.hasOlder ? (
              <View style={styles.history}>
                <Button
                  label={chatCopy.older}
                  tone="secondary"
                  loading={older.isPending}
                  disabled={!chat.enabled}
                  onPress={() => {
                    setAtLatest(false);
                    older.mutate();
                  }}
                />
                {older.isError ? (
                  <AppText accessibilityRole="alert" tone="danger">
                    Earlier messages could not be loaded. Try again.
                  </AppText>
                ) : null}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <Card>
              <AppText muted>{chatCopy.emptyThread}</AppText>
            </Card>
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.message,
                item.sender === 'ADMIN' ? styles.outgoing : styles.incoming,
                {
                  backgroundColor: item.sender === 'ADMIN' ? colors.brandSoft : colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              <AppText size="xs" weight="bold" tone={item.sender === 'ADMIN' ? 'brand' : 'muted'}>
                {item.sender === 'ADMIN' ? chatCopy.staff : name}
              </AppText>
              <AppText selectable>{item.body}</AppText>
              <AppText size="xs" muted>
                {displayChatTime(item.createdAt)}
              </AppText>
            </View>
          )}
        />
        {!atLatest && unread > 0 ? (
          <Button
            label={chatCopy.newMessages}
            tone="secondary"
            onPress={() => {
              setAtLatest(true);
              list.current?.scrollToEnd({ animated: false });
            }}
          />
        ) : null}
        <View
          style={[
            styles.composer,
            {
              borderTopColor: colors.border,
              backgroundColor: colors.surface,
              paddingLeft: 16 + insets.left,
              paddingRight: 16 + insets.right,
            },
          ]}
        >
          {read.isError ? (
            <View style={styles.feedback}>
              <AppText accessibilityRole="alert" tone="danger" size="sm">
                {chatCopy.readError}
              </AppText>
              <Button
                label="Retry unread update"
                tone="secondary"
                disabled={!chat.enabled}
                loading={read.isPending}
                onPress={() => {
                  if (readId) read.mutate(readId);
                }}
              />
            </View>
          ) : null}
          <TextField
            label={chatCopy.replyLabel}
            accessibilityHint={chatCopy.replyHint}
            placeholder={chatCopy.replyPlaceholder}
            multiline
            maxLength={2_000}
            value={body}
            editable={!send.isPending}
            onChangeText={(text) => {
              setBody(text);
              send.reset();
            }}
            style={styles.input}
          />
          <View style={styles.sendRow}>
            <AppText size="xs" muted>
              {body.length.toLocaleString('en-GB')} / 2,000
            </AppText>
            <Button
              label={send.isError ? chatCopy.retrySend : chatCopy.send}
              loadingLabel={chatCopy.sending}
              loading={send.isPending}
              disabled={!chat.enabled || !body.trim() || body.trim().length > 2_000}
              onPress={() => {
                void sendReply();
              }}
            />
          </View>
          {send.isError ? (
            <AppText accessibilityRole="alert" tone="danger" size="sm">
              {chatCopy.sendError}
            </AppText>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { alignSelf: 'center', flex: 1, maxWidth: 900, minHeight: 0, width: '100%' },
  header: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 16 },
  headerKeyboard: { flexWrap: 'nowrap', paddingVertical: 8 },
  heading: { flex: 1, gap: 2, minWidth: 160 },
  headingKeyboard: { minWidth: 0 },
  list: { flex: 1, minHeight: 0 },
  messages: { gap: 12, padding: 16, paddingBottom: 24 },
  message: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
    maxWidth: '90%',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  outgoing: { alignSelf: 'flex-end', borderBottomRightRadius: 6 },
  incoming: { alignSelf: 'flex-start', borderBottomLeftRadius: 6 },
  composer: { borderTopWidth: StyleSheet.hairlineWidth, flexShrink: 0, gap: 10, padding: 16 },
  input: { minHeight: 64, maxHeight: 140 },
  sendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  notice: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  soundControl: { paddingHorizontal: 16, paddingBottom: 8 },
  feedback: { gap: 8 },
  history: { gap: 8, marginBottom: 12 },
});
