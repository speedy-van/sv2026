import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ expiry: vi.fn(), repeats: vi.fn(), receipts: vi.fn(), batch: vi.fn(), cutoff: vi.fn() }));
vi.mock('@sv/db', () => ({ enqueueOutbox: vi.fn(), prisma: {} }));
vi.mock('../src/server/services/hold-expiry', () => ({ expireBookingHolds: mocks.expiry }));
vi.mock('../src/server/notifications/repeat-alerts', () => ({ runRepeatAlerts: mocks.repeats }));
vi.mock('../src/server/integrations/expo-push', () => ({ checkPushReceipts: mocks.receipts }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.batch }));
vi.mock('../src/server/env', () => ({ outboxProcessFrom: mocks.cutoff, serverEnv: () => ({ CRON_SECRET: 'unit-cron-secret' }) }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: vi.fn() }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
import { AppError } from '@sv/contracts';
import { runOperationsCron } from '../src/server/cron-jobs';
import { GET, maxDuration } from '../src/app/api/cron/operations/route';

const now = new Date('2031-03-01T12:00:00.000Z');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.expiry.mockResolvedValue({ bookingsExpired: 1, slotHoldsExpired: 2 });
  mocks.repeats.mockResolvedValue({ bookingsChecked: 3, pushesQueued: 4 });
  mocks.receipts.mockResolvedValue({ checked: 5, disabled: 1, errors: 2 });
  mocks.batch.mockResolvedValue({ done: 0, failed: 0 });
});
afterEach(() => vi.restoreAllMocks());

describe('protected opt-in operations scheduler', () => {
  it('rejects missing or wrong credentials before any operation', async () => {
    for (const authorization of ['', 'Bearer wrong']) {
      expect((await GET(new Request('https://example.test/api/cron/operations', { headers: { authorization } }))).status).toBe(401);
    }
    expect(mocks.expiry).not.toHaveBeenCalled();
    expect(mocks.repeats).not.toHaveBeenCalled();
    expect(mocks.receipts).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('returns truthful bounded counters through the authenticated route without cache', async () => {
    mocks.batch.mockResolvedValueOnce({ done: 1, failed: 0 }).mockResolvedValueOnce({ done: 0, failed: 1 });
    const response = await GET(new Request('https://example.test/api/cron/operations', { headers: { authorization: 'Bearer unit-cron-secret' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ok: true, bookingsExpired: 1, slotHoldsExpired: 2, bookingsChecked: 3, pushesQueued: 4, receiptsChecked: 5, devicesDisabled: 1, receiptErrors: 2, outboxDone: 1, outboxFailed: 1, deferred: false });
    expect(maxDuration).toBe(180);
    expect(mocks.receipts).toHaveBeenCalledWith(expect.any(Date), 25);
    expect(mocks.batch).toHaveBeenCalledTimes(3);
    for (const call of mocks.batch.mock.calls) expect(call).toEqual([1]);
  });

  it('fails closed on missing activation cutoff before starting provider or database work', async () => {
    mocks.cutoff.mockImplementation(() => { throw new AppError('INTERNAL', 'Missing activation cutoff.'); });
    await expect(runOperationsCron(now)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(mocks.expiry).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('stops starting work after the shared time budget, leaving provider retry headroom', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(20_001);
    const result = await runOperationsCron(now);
    expect(result).toMatchObject({ bookingsExpired: 1, slotHoldsExpired: 2, bookingsChecked: 0, pushesQueued: 0, receiptsChecked: 0, outboxDone: 0, deferred: true });
    expect(mocks.expiry).toHaveBeenCalledWith(now, 20_000);
    expect(mocks.repeats).not.toHaveBeenCalled();
    expect(mocks.receipts).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('caps outbox claims even when every claim finds work', async () => {
    mocks.batch.mockResolvedValue({ done: 1, failed: 0 });
    const result = await runOperationsCron(now);
    expect(result.outboxDone).toBe(50);
    expect(result.deferred).toBe(true);
    expect(mocks.batch).toHaveBeenCalledTimes(50);
  });
});
