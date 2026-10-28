import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ batch: vi.fn(), capture: vi.fn(), report: vi.fn(), receipts: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: {} }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.batch }));
vi.mock('../src/server/notifications/receipt-maintenance', () => ({ maintainPushReceipts: mocks.receipts }));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture, captureMessage: mocks.report }));
import { dispatchChatPush } from '../src/server/chat/push-dispatch';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.batch.mockResolvedValue({ done: 0, failed: 0 });
  mocks.receipts.mockResolvedValue(undefined);
});

describe('bounded dispatch for one committed chat message', () => {
  it('claims only push jobs in the canonical message scope until its queue is empty', async () => {
    mocks.batch.mockResolvedValueOnce({ done: 1, failed: 0 }).mockResolvedValueOnce({ done: 1, failed: 0 });
    await dispatchChatPush('message-unit');
    expect(mocks.batch).toHaveBeenCalledTimes(3);
    for (const call of mocks.batch.mock.calls) {
      expect(call).toEqual([1, ['push.send'], { rootEventId: 'chat.message:message-unit' }]);
    }
    expect(mocks.receipts).toHaveBeenCalledOnce();
    expect(mocks.receipts.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.batch.mock.invocationCallOrder.at(-1) ?? 0);
  });

  it('does not drain any queue for an empty message identifier', async () => {
    await dispatchChatPush('');
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.receipts).not.toHaveBeenCalled();
  });

  it('reports failed delivery while allowing other recipients to be processed', async () => {
    mocks.batch.mockResolvedValueOnce({ done: 0, failed: 1 }).mockResolvedValueOnce({ done: 1, failed: 0 });
    await dispatchChatPush('message-unit');
    expect(mocks.batch).toHaveBeenCalledTimes(3);
    expect(mocks.report).toHaveBeenCalledOnce();
  });

  it('stops after its bounded number of single-job claims', async () => {
    mocks.batch.mockResolvedValue({ done: 1, failed: 0 });
    await dispatchChatPush('message-unit');
    expect(mocks.batch).toHaveBeenCalledTimes(100);
  });

  it('does not start another claim after the time budget expires', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(40_001);
    mocks.batch.mockResolvedValue({ done: 1, failed: 0 });
    try {
      await dispatchChatPush('message-unit');
      expect(mocks.batch).toHaveBeenCalledOnce();
      expect(mocks.receipts).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });

  it('awaits in-flight work and reports infrastructure failure without changing the committed response', async () => {
    const error = new Error('Unit processor unavailable');
    mocks.batch.mockRejectedValue(error);
    await expect(dispatchChatPush('message-unit')).resolves.toBeUndefined();
    expect(mocks.capture).toHaveBeenCalledWith(error, { tags: { feature: 'chat-push-delivery' } });
  });
});
