import type { ChatMessage } from '@sv/contracts';

export interface IncomingChatMessages {
  actorId: string;
  conversationId: string;
  messages: ChatMessage[];
}

const listeners = new Set<(event: IncomingChatMessages) => void>();

/** Only forward GET pages are published; initial history and mutations never notify. */
export function publishIncomingChatMessages(event: IncomingChatMessages): void {
  listeners.forEach((listener) => {
    listener(event);
  });
}

export function subscribeIncomingChatMessages(listener: (event: IncomingChatMessages) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
