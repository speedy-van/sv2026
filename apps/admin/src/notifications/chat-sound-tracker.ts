import type { AdminChatInboxResponse, ChatMessage } from '@sv/contracts';

/** Per-login, memory-only delivery IDs; never stores customer names or message bodies. */
export class IncomingChatSoundTracker {
  #baseline = true;
  #suppressForward = false;
  #initialSequence: bigint | null = null;
  #legacyCutoff = 0;
  readonly #seen = new Set<string>();
  readonly #knownConversations = new Set<string>();

  rebaseline(): void {
    this.#baseline = true;
    this.#suppressForward = true;
  }

  observePush(messageId: string): boolean {
    if (this.#seen.has(messageId)) return false;
    this.#seen.add(messageId);
    return true;
  }

  observeInbox(snapshot: AdminChatInboxResponse): boolean {
    const { items } = snapshot;
    const baseline = this.#baseline;
    let incoming = false;
    if (baseline && snapshot.latestCustomerSequence) {
      const watermark = BigInt(snapshot.latestCustomerSequence);
      if (this.#initialSequence === null || watermark > this.#initialSequence)
        this.#initialSequence = watermark;
    }
    for (const item of items) {
      const customer =
        item.lastCustomerMessage ?? (item.lastMessage?.sender === 'CUSTOMER' ? item.lastMessage : null);
      const sequence = item.lastCustomerMessageSequence ? BigInt(item.lastCustomerMessageSequence) : null;
      if (baseline) {
        if (sequence !== null && (this.#initialSequence === null || sequence > this.#initialSequence))
          this.#initialSequence = sequence;
        this.#legacyCutoff = Math.max(this.#legacyCutoff, Date.parse(item.lastMessageAt));
      }
      if (customer && !this.#seen.has(customer.id)) {
        const known = this.#knownConversations.has(item.id);
        const newer =
          sequence !== null
            ? this.#initialSequence === null || sequence > this.#initialSequence
            : Date.parse(customer.createdAt) > this.#legacyCutoff;
        if (!baseline && (known || newer)) incoming = true;
        this.#seen.add(customer.id);
      }
      this.#knownConversations.add(item.id);
    }
    this.#baseline = false;
    this.#suppressForward = false;
    return incoming;
  }

  observeForward(messages: ChatMessage[], audible: boolean): boolean {
    let incoming = false;
    for (const message of messages) {
      if (message.sender !== 'CUSTOMER' || this.#seen.has(message.id)) continue;
      this.#seen.add(message.id);
      if (audible && !this.#suppressForward) incoming = true;
    }
    return incoming;
  }
}
