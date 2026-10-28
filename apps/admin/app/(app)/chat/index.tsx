import { router } from 'expo-router';
import { MessageCircle } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Card } from '@/components/primitives';
import { ScreenState } from '@/components/screen-state';
import { chatCopy } from '@/content/chat';
import { useChatInbox } from '@/data/chat';
import { displayChatTime } from '@/lib/chat-date-time';
import { useAppColors } from '@/theme/theme';
import { ChatSoundControl } from '@/components/chat-sound-control';

export default function ChatInboxScreen(): React.ReactElement {
  const { query, offline } = useChatInbox();
  const colors = useAppColors();
  const [focused, setFocused] = useState<string | null>(null);
  const conversations = [
    ...new Map(
      query.data?.pages.flatMap((page) => page.items).map((conversation) => [conversation.id, conversation]),
    ).values(),
  ];
  const status =
    offline && !query.data
      ? 'error'
      : query.isPending
        ? 'loading'
        : !query.data
          ? 'error'
          : conversations.length === 0
            ? 'empty'
            : 'ready';
  return (
    <ScreenState
      title={chatCopy.title}
      subtitle={chatCopy.subtitle}
      status={status}
      emptyMessage={chatCopy.empty}
      errorMessage={offline ? chatCopy.offline : chatCopy.inboxError}
      onRetry={() => {
        void query.refetch();
      }}
      onRefresh={() => {
        void query.refetch();
      }}
      refreshing={query.isRefetching}
      toolbar={
        <>
          <Button
            label="Back to More"
            tone="secondary"
            onPress={() => {
              router.push('/(app)/more');
            }}
          />
          <ChatSoundControl />
          {offline ? (
            <AppText accessibilityRole="alert" tone="danger">
              {chatCopy.offline}
            </AppText>
          ) : null}
          {query.isError && query.data ? (
            <Card>
              <AppText accessibilityRole="alert" tone="danger">
                {chatCopy.inboxError}
              </AppText>
              <Button
                label="Retry conversations"
                tone="secondary"
                onPress={() => {
                  void query.refetch();
                }}
              />
            </Card>
          ) : null}
        </>
      }
    >
      <AppText muted size="sm">
        Unread messages are shared across the admin team. {chatCopy.timeZone}
      </AppText>
      <View style={styles.list}>
        {conversations.map((conversation) => {
          const name = conversation.customerName ?? chatCopy.visitor;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open chat with ${name}, ${String(conversation.unreadCount)} unread messages`}
              key={conversation.id}
              onFocus={() => {
                setFocused(conversation.id);
              }}
              onBlur={() => {
                setFocused(null);
              }}
              onPress={() => {
                router.push(`/(app)/chat/${conversation.id}`);
              }}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                  borderColor: focused === conversation.id ? colors.focus : colors.border,
                },
                focused === conversation.id &&
                  Platform.OS === 'web' && {
                    outlineColor: colors.focus,
                    outlineOffset: 2,
                    outlineStyle: 'solid',
                    outlineWidth: 3,
                  },
              ]}
            >
              <View style={[styles.avatar, { backgroundColor: colors.brandSoft }]}>
                <MessageCircle color={colors.brand} size={23} />
              </View>
              <View style={styles.copy}>
                <AppText weight="bold">{name}</AppText>
                <AppText muted size="sm" numberOfLines={2}>
                  {conversation.lastMessage?.sender === 'ADMIN' ? `${chatCopy.staff}: ` : ''}
                  {conversation.lastMessage?.body ?? chatCopy.emptyThread}
                </AppText>
                <AppText muted size="xs">
                  {displayChatTime(conversation.lastMessageAt)}
                </AppText>
              </View>
              {conversation.unreadCount > 0 ? (
                <Badge label={`${String(conversation.unreadCount)} unread`} tone="warning" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
      {query.hasNextPage ? (
        <Button
          label={chatCopy.more}
          tone="secondary"
          disabled={offline}
          loading={query.isFetchingNextPage}
          onPress={() => {
            void query.fetchNextPage();
          }}
        />
      ) : null}
    </ScreenState>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  row: {
    alignItems: 'flex-start',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    minHeight: 104,
    padding: 16,
  },
  avatar: { alignItems: 'center', borderRadius: 15, height: 46, justifyContent: 'center', width: 46 },
  copy: { flex: 1, gap: 5, minWidth: 140 },
});
