import { AppError } from '@sv/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ after: vi.fn(), batch: vi.fn(), capture: vi.fn(), rateLimit: vi.fn(), requestLink: vi.fn() }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.batch }));
vi.mock('../src/server/services/customer-self-service', () => ({ requestManageLink: mocks.requestLink }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: vi.fn() }));

import { POST } from '../src/app/manage/request-link/route';

const input = { email: 'manage-link@example.test', reference: 'SV-ABC123' };
function request(body: unknown = input): Request {
  return new Request('https://example.test/manage/request-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  mocks.requestLink.mockResolvedValue('requested-email-event');
  mocks.batch.mockResolvedValue({ done: 1, failed: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe('requested manage-link email delivery', () => {
  it('schedules only the privately returned email event and preserves the generic response', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.any(Request), 'manageLink');
    expect(mocks.requestLink).toHaveBeenCalledExactlyOnceWith(input);
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ message: "If those details match a booking, we've emailed you a link. It can take a minute to arrive." });
    await callback()();
    expect(mocks.batch).toHaveBeenCalledExactlyOnceWith(1, ['email.send'], { rootEventId: 'requested-email-event' });
  });

  it('returns the same body without scheduling a queue drain when no booking matches', async () => {
    const matched = await POST(request());
    mocks.requestLink.mockResolvedValue(null);
    mocks.after.mockClear();
    const unmatched = await POST(request());
    expect(unmatched.status).toBe(matched.status);
    expect(await unmatched.json()).toEqual(await matched.json());
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('awaits the delivery callback rather than discarding its promise', async () => {
    let finish: (() => void) | undefined;
    let completed = false;
    mocks.batch.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await POST(request());
    const delivery = callback()().then(() => { completed = true; });
    expect(completed).toBe(false);
    if (!finish) throw new Error('Expected the scoped delivery to start.');
    finish();
    await delivery;
    expect(completed).toBe(true);
  });

  it('reports a scheduling failure without starting unrelated or inline deliveries', async () => {
    const failure = new Error('Scheduling is unavailable.');
    mocks.after.mockImplementation(() => { throw failure; });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.capture).toHaveBeenCalledWith(failure, { tags: { feature: 'manage-link-email-scheduling' } });
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('handles a scoped delivery failure without an unhandled background rejection', async () => {
    const failure = new Error('Delivery is unavailable.');
    mocks.batch.mockRejectedValue(failure);
    await POST(request());
    await expect(callback()()).resolves.toBeUndefined();
    expect(mocks.capture).toHaveBeenCalledWith(failure, { tags: { feature: 'manage-link-email-delivery' } });
  });

  it('validates input before creating or delivering an email', async () => {
    expect((await POST(request({ email: 'invalid', reference: '' }))).status).toBe(400);
    expect(mocks.requestLink).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('preserves rate limiting without creating or delivering an email', async () => {
    mocks.rateLimit.mockRejectedValue(new AppError('RATE_LIMITED', 'Try again shortly.', { retryAfter: 60 }));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.requestLink).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
