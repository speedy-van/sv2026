import { AppError } from '@sv/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(), batch: vi.fn(), capture: vi.fn(), message: vi.fn(), rateLimit: vi.fn(),
  transaction: vi.fn(), create: vi.fn(), enqueue: vi.fn(),
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture, captureMessage: mocks.message }));
vi.mock('@sv/db', () => ({ enqueueOutbox: mocks.enqueue, prisma: { $transaction: mocks.transaction } }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.batch }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: vi.fn() }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.rateLimit }));

import { POST } from '../src/app/api/v1/contact/route';

const input = { name: 'Contact Customer', email: 'contact@example.test', message: 'Please help me arrange my move.' };
function request(body: unknown = input): Request {
  return new Request('https://example.test/api/v1/contact', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function callback(): () => Promise<void> {
  const scheduled: unknown = mocks.after.mock.calls[0]?.[0];
  if (typeof scheduled !== 'function') throw new Error('Expected an awaited after callback.');
  return scheduled as () => Promise<void>;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'production');
  mocks.create.mockResolvedValue({ id: 'contact-message-unit' });
  mocks.enqueue.mockResolvedValue({ id: 'contact-event-unit' });
  mocks.transaction.mockImplementation((operation: (tx: { contactMessage: { create: typeof mocks.create } }) => Promise<unknown>) =>
    operation({ contactMessage: { create: mocks.create } }),
  );
  mocks.batch.mockResolvedValue({ done: 0, failed: 0 });
});

afterEach(() => vi.unstubAllEnvs());

describe('requested contact message delivery', () => {
  it('commits the contact and event before scheduling only its event tree without leaking private ids', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.any(Request), 'contact');
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.any(Object), 'contact.received', { contactMessageId: 'contact-message-unit' }, 'contact.received:contact-message-unit',
    );
    expect(mocks.batch).not.toHaveBeenCalled();
    mocks.batch.mockResolvedValueOnce({ done: 1, failed: 0 }).mockResolvedValueOnce({ done: 1, failed: 0 });
    await callback()();
    expect(mocks.batch).toHaveBeenCalledTimes(3);
    for (const call of mocks.batch.mock.calls) expect(call).toEqual([1, undefined, { rootEventId: 'contact-event-unit' }]);
  });

  it('awaits the active delivery instead of discarding its promise', async () => {
    let finish: ((result: { done: number; failed: number }) => void) | undefined;
    let completed = false;
    mocks.batch.mockImplementationOnce(() => new Promise<{ done: number; failed: number }>((resolve) => { finish = resolve; }));
    await POST(request());
    const delivery = callback()().then(() => { completed = true; });
    expect(completed).toBe(false);
    if (!finish) throw new Error('Expected the scoped delivery to start.');
    finish({ done: 0, failed: 0 });
    await delivery;
    expect(completed).toBe(true);
  });

  it('bounds work to eight single-event claims while retaining the exact scope', async () => {
    mocks.batch.mockResolvedValue({ done: 1, failed: 0 });
    await POST(request());
    await callback()();
    expect(mocks.batch).toHaveBeenCalledTimes(8);
  });

  it('reports scheduling failure while preserving the committed generic 202 response', async () => {
    const failure = new Error('Scheduling is unavailable.');
    mocks.after.mockImplementation(() => { throw failure; });
    expect((await POST(request())).status).toBe(202);
    expect(mocks.capture).toHaveBeenCalledWith(failure, { tags: { feature: 'contact-message-scheduling' } });
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('handles delivery infrastructure failure without an unhandled callback rejection', async () => {
    const failure = new Error('Delivery is unavailable.');
    mocks.batch.mockRejectedValue(failure);
    await POST(request());
    await expect(callback()()).resolves.toBeUndefined();
    expect(mocks.capture).toHaveBeenCalledWith(failure, { tags: { feature: 'contact-message-delivery' } });
  });

  it('reports a provider failure and continues the other due children in the same contact scope', async () => {
    mocks.batch.mockResolvedValueOnce({ done: 0, failed: 1 });
    await POST(request());
    await callback()();
    expect(mocks.message).toHaveBeenCalledExactlyOnceWith('Contact message delivery failed.', {
      level: 'error', tags: { feature: 'contact-message-delivery' },
    });
    expect(mocks.batch).toHaveBeenCalledTimes(2);
  });

  it('does not schedule before the contact transaction commits successfully', async () => {
    mocks.transaction.mockRejectedValue(new Error('Unit transaction failed.'));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('keeps the existing honeypot validation before persistence or delivery', async () => {
    expect((await POST(request({ ...input, company: 'robot' }))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('keeps rate limiting before contact creation or delivery', async () => {
    mocks.rateLimit.mockRejectedValue(new AppError('RATE_LIMITED', 'Try again shortly.', { retryAfter: 60 }));
    expect((await POST(request())).status).toBe(429);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('does not start provider work in integration-test mode', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect((await POST(request())).status).toBe(202);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });
});
