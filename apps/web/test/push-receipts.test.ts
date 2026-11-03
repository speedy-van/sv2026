import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), disable: vi.fn(), user: vi.fn(), receipts: vi.fn(), report: vi.fn() }));
vi.mock('@sv/db', () => ({ enqueueOutbox: vi.fn(), prisma: {
  pushTicket: { findMany: mocks.find, update: mocks.update },
  pushDevice: { update: mocks.disable }, user: { findUnique: mocks.user },
} }));
vi.mock('../src/server/chat/push', () => ({ shouldSendChatPush: vi.fn() }));
vi.mock('../src/server/env', () => ({ serverEnv: () => ({ EXPO_ACCESS_TOKEN: 'unit-fake-token', PUSH_MODE: 'live' }) }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: mocks.report }));
vi.mock('expo-server-sdk', () => ({ Expo: class {
  chunkPushNotificationReceiptIds(ids: string[]) { return [ids]; }
  getPushNotificationReceiptsAsync(ids: string[]) { return mocks.receipts(ids) as Promise<unknown>; }
} }));
import { checkPushReceipts } from '../src/server/integrations/expo-push';

const now = new Date('2031-03-01T12:00:00.000Z');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue([]);
  mocks.user.mockResolvedValue(null);
});

describe('bounded receipt polling with isolated provider and database mocks', () => {
  it('polls oldest eligible receipts without starving on already expired historical tickets', async () => {
    await expect(checkPushReceipts(now, 25)).resolves.toEqual({ checked: 0, disabled: 0, errors: 0 });
    expect(mocks.find).toHaveBeenCalledExactlyOnceWith({
      include: { pushDevice: { select: { id: true, userId: true } } }, orderBy: { createdAt: 'asc' }, take: 25,
      where: {
        checkedAt: null,
        createdAt: { gt: new Date('2031-02-28T12:00:00.000Z'), lte: new Date('2031-03-01T11:45:00.000Z') },
        status: 'ok', ticketId: { not: { startsWith: 'capture:' } },
      },
    });
    expect(mocks.receipts).not.toHaveBeenCalled();
  });

  it.each([[0, 1], [2.9, 2], [1000, 500], [Number.NaN, 500]])('bounds requested limit %s to %s', async (limit, expected) => {
    await checkPushReceipts(now, limit);
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ take: expected }));
  });

  it('records success, disables rejected devices and reports provider errors without raw private messages', async () => {
    mocks.find.mockResolvedValue(['ok', 'unregistered', 'credentials', 'missing'].map((id) => ({
      id, ticketId: `ticket-${id}`, pushDeviceId: `device-${id}`, pushDevice: { id: `device-${id}`, userId: 'admin-unit' },
    })));
    mocks.receipts.mockResolvedValue({
      'ticket-ok': { status: 'ok' },
      'ticket-unregistered': { status: 'error', message: 'Private token text', details: { error: 'DeviceNotRegistered' } },
      'ticket-credentials': { status: 'error', message: 'Private credential text', details: { error: 'InvalidCredentials' } },
    });
    await expect(checkPushReceipts(now, 25)).resolves.toEqual({ checked: 3, disabled: 1, errors: 1 });
    expect(mocks.update).toHaveBeenCalledWith({ data: { checkedAt: now, error: null, status: 'ok' }, where: { id: 'ok' } });
    expect(mocks.disable).toHaveBeenCalledExactlyOnceWith({ data: { enabled: false, lastError: 'DeviceNotRegistered' }, where: { id: 'device-unregistered' } });
    expect(mocks.report).toHaveBeenCalledWith('Expo push receipt error', { extra: { error: 'InvalidCredentials', ticketId: 'ticket-credentials' }, level: 'warning' });
    expect(mocks.update).toHaveBeenCalledTimes(3);
  });
});
