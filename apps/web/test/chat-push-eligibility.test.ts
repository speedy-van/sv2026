import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: { chatMessage: { findFirst: mocks.message } } }));
import { shouldSendChatPush } from '../src/server/chat/push';

const now = new Date('2026-10-28T12:00:00.000Z');
const data = { conversationId: 'thread-unit', messageId: 'message-unit' };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.message.mockResolvedValue({ sequence: 12n, conversation: { adminReadSequence: 11n } });
});

describe('chat push eligibility at delivery time without database access', () => {
  it('checks the exact customer message, expiry and one-hour freshness without loading private text', async () => {
    expect(await shouldSendChatPush(data, now)).toBe(true);
    expect(mocks.message).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: 'message-unit', conversationId: 'thread-unit', sender: 'CUSTOMER',
        createdAt: { gt: new Date('2026-10-28T11:00:00.000Z') },
        conversation: { expiresAt: { gt: now } },
      },
      select: { sequence: true, conversation: { select: { adminReadSequence: true } } },
    });
  });

  it.each([12n, 13n])('suppresses a message already read through sequence %s', async (adminReadSequence) => {
    mocks.message.mockResolvedValue({ sequence: 12n, conversation: { adminReadSequence } });
    expect(await shouldSendChatPush(data, now)).toBe(false);
  });

  it('suppresses a missing, deleted, expired or stale customer message', async () => {
    mocks.message.mockResolvedValue(null);
    expect(await shouldSendChatPush(data, now)).toBe(false);
  });

  it.each([undefined, {}, { conversationId: 'thread-unit' }, { messageId: 'message-unit' }, { conversationId: 1, messageId: 'message-unit' }])(
    'does not query for incomplete or malformed identifiers %#', async (payload) => {
      expect(await shouldSendChatPush(payload, now)).toBe(false);
      expect(mocks.message).not.toHaveBeenCalled();
    },
  );

  it('propagates a database failure so the outbox retries instead of dropping the alert', async () => {
    mocks.message.mockRejectedValue(new Error('Unit database failure'));
    await expect(shouldSendChatPush(data, now)).rejects.toThrow('Unit database failure');
  });
});
