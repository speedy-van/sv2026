import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), deleteMany: vi.fn(), authOtp: vi.fn(), pushTicket: vi.fn() }));
vi.mock('@sv/db', () => ({ enqueueOutbox: vi.fn(), prisma: {
  chatConversation: { findMany: mocks.findMany, deleteMany: mocks.deleteMany }, authOtp: { deleteMany: mocks.authOtp }, pushTicket: { deleteMany: mocks.pushTicket },
} }));
import { pruneExpiredChatConversations } from '../src/server/chat/retention';
import { runDataRetention } from '../src/server/cron-jobs';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([{ id: 'expired_thread_1' }, { id: 'expired_thread_2' }]);
  mocks.deleteMany.mockResolvedValue({ count: 2 });
  mocks.authOtp.mockResolvedValue({ count: 0 });
  mocks.pushTicket.mockResolvedValue({ count: 0 });
});

describe('owner-approved bounded chat retention', () => {
  it('loads at most 100 expired conversations in oldest-first order and deletes only that batch', async () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    expect(await pruneExpiredChatConversations(now)).toBe(2);
    expect(mocks.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { expiresAt: { lte: now } }, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], take: 100, select: { id: true },
    });
    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: ['expired_thread_1', 'expired_thread_2'] }, expiresAt: { lte: now } } });
  });

  it('does not issue a delete when there are no expired conversations', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await pruneExpiredChatConversations()).toBe(0);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('uses the existing data-retention job and returns the chat cleanup count', async () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    expect(await runDataRetention(now)).toEqual({ authOtpDeleted: 0, oldPushTicketsDeleted: 0, chatsDeleted: 2 });
    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: ['expired_thread_1', 'expired_thread_2'] }, expiresAt: { lte: now } } });
  });
});
