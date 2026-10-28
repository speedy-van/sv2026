import { z } from 'zod';

const ChatPushSchema = z.object({
  type: z.literal('CHAT_MESSAGE'),
  conversationId: z.string().trim().min(1).max(200),
  messageId: z.string().trim().min(1).max(200),
  recipientUserId: z.string().trim().min(1).max(200),
});

export type ChatPush = z.infer<typeof ChatPushSchema>;

const listeners = new Set<(event: ChatPush) => boolean>();

/** Only an active account sound runtime can take over foreground native audio. */
export function handleForegroundChatPush(data: unknown): boolean {
  const parsed = ChatPushSchema.safeParse(data);
  if (!parsed.success) return false;
  let handled = false;
  for (const listener of listeners) handled = listener(parsed.data) || handled;
  return handled;
}

export function subscribeForegroundChatPush(listener: (event: ChatPush) => boolean): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
