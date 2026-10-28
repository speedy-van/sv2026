import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ batch: vi.fn(), auth: vi.fn(), update: vi.fn(), create: vi.fn(), receipts: vi.fn() }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.batch }));
vi.mock('../src/server/notifications/receipt-maintenance', () => ({ maintainPushReceipts: mocks.receipts }));
vi.mock('../src/server/cron', () => ({ assertCronRequest: mocks.auth }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: vi.fn() }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('@sv/db', () => ({ enqueueOutbox: vi.fn(), prisma: { outboxEvent: { updateMany: mocks.update, create: mocks.create } } }));
import { GET, maxDuration } from '../src/app/api/cron/outbox/route';
import { runIntegrityChecks } from '../src/server/cron-jobs';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.batch.mockResolvedValue({ done: 0, failed: 0 });
  mocks.update.mockResolvedValue({ count: 0 });
  mocks.receipts.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('bounded daily outbox safety net', () => {
  it('claims one event at a time, returns totals and stops when empty', async () => {
    mocks.batch.mockResolvedValueOnce({ done: 1, failed: 0 }).mockResolvedValueOnce({ done: 0, failed: 1 });
    const response = await GET(new Request('https://example.test/api/cron/outbox'));
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ done: 1, failed: 1 });
    expect(mocks.batch).toHaveBeenCalledTimes(3);
    for (const call of mocks.batch.mock.calls) expect(call).toEqual([1]);
    expect(maxDuration).toBe(60);
    expect(mocks.receipts).toHaveBeenCalledOnce();
    expect(mocks.receipts.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.auth.mock.invocationCallOrder[0] ?? 0);
  });
  it('does not claim another event after40seconds', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(40_001);
    mocks.batch.mockResolvedValue({ done: 1, failed: 0 });
    expect((await GET(new Request('https://example.test/api/cron/outbox'))).status).toBe(200);
    expect(mocks.batch).toHaveBeenCalledTimes(1);
  });
  it('rejects unauthorized runs before claiming anything', async () => {
    const { AppError } = await import('@sv/contracts');
    mocks.auth.mockImplementation(() => { throw new AppError('UNAUTHORIZED', 'Invalid cron token.'); });
    expect((await GET(new Request('https://example.test/api/cron/outbox'))).status).toBe(401);
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(mocks.receipts).not.toHaveBeenCalled();
  });
  it('never resets historical PROCESSING events before the configured activation boundary', async () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('OUTBOX_PROCESS_FROM', '2026-10-15T22:00:00.000Z');
    const now = new Date('2026-10-16T03:30:00.000Z');
    expect(await runIntegrityChecks(now)).toEqual({ alertsQueued: 0, stuckOutboxReset: 0 });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      data: { lastError: 'Reset by integrity cron after being stuck in PROCESSING.', nextAttemptAt: now, status: 'PENDING' },
      where: { nextAttemptAt: { lt: new Date('2026-10-16T03:20:00.000Z') }, status: 'PROCESSING', createdAt: { gte: new Date('2026-10-15T22:00:00.000Z') } },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
