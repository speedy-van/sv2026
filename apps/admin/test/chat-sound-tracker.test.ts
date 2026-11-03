import type { AdminChatInboxResponse, ChatMessage } from '@sv/contracts';
import { IncomingChatSoundTracker } from '../src/notifications/chat-sound-tracker';

function message(id: string, sender: ChatMessage['sender'] = 'CUSTOMER'): ChatMessage {
  return {
    id,
    sender,
    clientMessageId: '69d18e64-2d82-42f1-81c9-9ec19cb2ee7d',
    body: 'Message',
    createdAt: '2031-10-15T12:00:00.000Z',
  };
}
function snapshot(
  id: string,
  sequence = '1',
  sender: ChatMessage['sender'] = 'CUSTOMER',
): AdminChatInboxResponse {
  const customer = message(id);
  return {
    items: [
      {
        id: 'chat-1',
        customerName: null,
        createdAt: customer.createdAt,
        updatedAt: customer.createdAt,
        lastMessageAt: customer.createdAt,
        unreadCount: 1,
        lastMessage: sender === 'CUSTOMER' ? customer : message('admin-reply', 'ADMIN'),
        lastCustomerMessage: customer,
        lastCustomerMessageSequence: sequence,
      },
    ],
    unreadCount: 1,
    nextCursor: null,
    latestCustomerSequence: sequence,
  };
}

it('baselines existing history and detects a new customer message once even after an admin reply/read', () => {
  const tracker = new IncomingChatSoundTracker();
  expect(tracker.observeInbox(snapshot('old'))).toBe(false);
  const latest = snapshot('new', '2', 'ADMIN');
  latest.unreadCount = 0;
  expect(tracker.observeInbox(latest)).toBe(true);
  expect(tracker.observeInbox(latest)).toBe(false);
  expect(tracker.observeForward([message('new'), message('reply', 'ADMIN')], true)).toBe(false);
});

it('deduplicates forward thread delivery against the global summary, ignoring own replies', () => {
  const tracker = new IncomingChatSoundTracker();
  tracker.observeInbox(snapshot('old'));
  expect(tracker.observeForward([message('own-reply', 'ADMIN')], true)).toBe(false);
  expect(tracker.observeForward([message('new')], true)).toBe(true);
  expect(tracker.observeInbox(snapshot('new', '2'))).toBe(false);
  expect(tracker.observeForward([message('new')], true)).toBe(false);
});

it('uses the global database watermark for previously off-page conversations despite clock skew', () => {
  const tracker = new IncomingChatSoundTracker();
  const baseline = snapshot('old');
  baseline.latestCustomerSequence = '100';
  tracker.observeInbox(baseline);
  const historical = snapshot('off-page', '25', 'ADMIN');
  const item = historical.items[0];
  if (!item) throw new Error('Expected an inbox item.');
  item.id = 'previously-off-page';
  expect(tracker.observeInbox(historical)).toBe(false);
  const incoming = snapshot('genuinely-new', '101');
  const incomingItem = incoming.items[0];
  if (!incomingItem || !incomingItem.lastCustomerMessage) throw new Error('Expected a customer message.');
  incomingItem.id = 'new-conversation';
  incomingItem.lastCustomerMessage.createdAt = '2031-10-15T11:59:00.000Z';
  expect(tracker.observeInbox(incoming)).toBe(true);
});

it('does not replay background/locked catch-up messages or forget previously heard IDs on resume', () => {
  const tracker = new IncomingChatSoundTracker();
  tracker.observeInbox(snapshot('old'));
  expect(tracker.observeForward([message('heard')], true)).toBe(true);
  tracker.rebaseline();
  expect(tracker.observeForward([message('background')], false)).toBe(false);
  expect(tracker.observeInbox(snapshot('background', '3'))).toBe(false);
  expect(tracker.observeForward([message('heard'), message('background')], true)).toBe(false);
  expect(tracker.observeInbox(snapshot('next', '4'))).toBe(true);
});

it('detects the first new conversation after an empty baseline', () => {
  const tracker = new IncomingChatSoundTracker();
  expect(
    tracker.observeInbox({ items: [], nextCursor: null, unreadCount: 0, latestCustomerSequence: null }),
  ).toBe(false);
  expect(tracker.observeInbox(snapshot('first'))).toBe(true);
});

it('does not lose a genuine forward delivery while the first global snapshot is still loading', () => {
  const tracker = new IncomingChatSoundTracker();
  expect(tracker.observeForward([message('live-forward')], true)).toBe(true);
  expect(tracker.observeInbox(snapshot('live-forward', '2'))).toBe(false);
  expect(tracker.observeForward([message('live-forward')], true)).toBe(false);
});

it('supports an older preview response without sound-specific optional fields', () => {
  const tracker = new IncomingChatSoundTracker();
  const baseline = snapshot('old');
  delete baseline.latestCustomerSequence;
  const item = baseline.items[0];
  if (!item) throw new Error('Expected an inbox item.');
  delete item.lastCustomerMessage;
  delete item.lastCustomerMessageSequence;
  expect(tracker.observeInbox(baseline)).toBe(false);
  item.lastMessage = message('new');
  expect(tracker.observeInbox(baseline)).toBe(true);
  item.lastMessage = message('staff', 'ADMIN');
  expect(tracker.observeInbox(baseline)).toBe(false);
});
