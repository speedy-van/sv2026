import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ receipts: vi.fn(), capture: vi.fn() }));
vi.mock('../src/server/integrations/expo-push', () => ({ checkPushReceipts: mocks.receipts }));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture }));

const now = new Date('2026-10-28T12:00:00.000Z');

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.receipts.mockResolvedValue({ checked: 1, disabled: 0, errors: 0 });
});
afterEach(() => { vi.useRealTimers(); });

describe('best-effort push receipt maintenance with no live provider/database', () => {
  it('requests a small receipt batch and limits attempts to once a minute per process', async () => {
    const { maintainPushReceipts } = await import('../src/server/notifications/receipt-maintenance');
    await maintainPushReceipts();
    expect(mocks.receipts).toHaveBeenCalledExactlyOnceWith(now, 25);
    await maintainPushReceipts();
    vi.setSystemTime(new Date(now.getTime() + 59_999));
    await maintainPushReceipts();
    expect(mocks.receipts).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    await maintainPushReceipts();
    expect(mocks.receipts).toHaveBeenCalledTimes(2);
  });

  it('shares one in-flight check even if its cooldown has elapsed', async () => {
    let finish: ((result: { checked: number; disabled: number; errors: number }) => void) | undefined;
    mocks.receipts.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { maintainPushReceipts } = await import('../src/server/notifications/receipt-maintenance');
    const first = maintainPushReceipts();
    await Promise.resolve();
    vi.setSystemTime(new Date(now.getTime() + 120_000));
    const concurrent = maintainPushReceipts();
    expect(concurrent).toBe(first);
    expect(mocks.receipts).toHaveBeenCalledOnce();
    if (!finish) throw new Error('Expected an in-flight receipt request.');
    finish({ checked: 1, disabled: 0, errors: 0 });
    await first;
  });

  it('reports a failed provider check without rejecting delivery or retrying on every message', async () => {
    const error = new Error('Unit receipt provider unavailable');
    mocks.receipts.mockRejectedValue(error);
    const { maintainPushReceipts } = await import('../src/server/notifications/receipt-maintenance');
    await expect(maintainPushReceipts()).resolves.toBeUndefined();
    await expect(maintainPushReceipts()).resolves.toBeUndefined();
    expect(mocks.receipts).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledWith(error, { tags: { feature: 'push-receipt-maintenance' } });
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    mocks.receipts.mockResolvedValue({ checked: 0, disabled: 0, errors: 0 });
    await maintainPushReceipts();
    expect(mocks.receipts).toHaveBeenCalledTimes(2);
  });
});
