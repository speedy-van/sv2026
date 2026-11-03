import type { ChatMessage } from '@sv/contracts';

/** Tracks only authoritative forward pages; older history and send acknowledgements never enter here. */
export class ChatSoundArrivals {
  private conversationId: string | null = null;
  private baselined = false;
  private catchingUp = false;
  private seen = new Set<string>();

  setConversation(id: string | null): void {
    if (id === this.conversationId) return;
    this.conversationId = id;
    this.baselined = false;
    this.catchingUp = false;
    this.seen.clear();
  }

  suspend(): void {
    this.baselined = false;
    this.catchingUp = false;
  }

  observe(id: string | null, messages: readonly ChatMessage[], hasMore: boolean, silent = false): boolean {
    this.setConversation(id);
    const initial = !this.baselined;
    const incoming = messages.some((message) => message.sender === 'ADMIN' && !this.seen.has(message.id));
    for (const message of messages) this.seen.add(message.id);
    const notify = Boolean(id) && !initial && !this.catchingUp && !silent && incoming;
    // Resume/history backlogs can span several pages. Catch up quietly to the live edge.
    this.catchingUp = (initial || this.catchingUp || silent) && hasMore;
    this.baselined = true;
    return notify;
  }
}
