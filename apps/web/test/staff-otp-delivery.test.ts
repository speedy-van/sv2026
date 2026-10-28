import { AppError } from '@sv/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  after: vi.fn(), batch: vi.fn(), capture: vi.fn(), message: vi.fn(), rateLimit: vi.fn(), requestOtp: vi.fn(),
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture, captureMessage: mocks.message }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.batch }));
vi.mock('../src/server/auth/staff', () => ({ requestStaffOtp: mocks.requestOtp, authenticateStaffRequest: vi.fn() }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.rateLimit }));

import { POST } from '../src/app/api/v1/auth/otp/request/route';

const input = { app: 'admin', email: 'staff@example.test' };
function request(body: unknown = input): Request {
  return new Request('https://example.test/api/v1/auth/otp/request', {
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
  mocks.requestOtp.mockResolvedValue('requested-otp-email-event');
  mocks.batch.mockResolvedValue({ done: 1, failed: 0 });
});

afterEach(() => vi.unstubAllEnvs());

describe('requested staff OTP email delivery', () => {
  it('schedules only the committed private email event and exposes neither event id nor code', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.rateLimit).toHaveBeenCalledWith(expect.any(Request), 'authOtpRequest');
    expect(mocks.requestOtp).toHaveBeenCalledExactlyOnceWith(input);
    expect(mocks.batch).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ ok: true });
    await callback()();
    expect(mocks.batch).toHaveBeenCalledExactlyOnceWith(1, ['email.send'], { rootEventId: 'requested-otp-email-event' });
  });

  it('preserves the identical generic 202 response for ineligible or unknown staff without scheduling any work', async () => {
    const matched = await POST(request());
    mocks.requestOtp.mockResolvedValue(null);
    mocks.after.mockClear();
    const unmatched = await POST(request());
    expect(unmatched.status).toBe(matched.status);
    expect(await unmatched.json()).toEqual(await matched.json());
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('awaits the scoped delivery promise', async () => {
    let finish: ((result: { done: number; failed: number }) => void) | undefined;
    let completed = false;
    mocks.batch.mockImplementation(() => new Promise<{ done: number; failed: number }>((resolve) => { finish = resolve; }));
    await POST(request());
    const delivery = callback()().then(() => { completed = true; });
    expect(completed).toBe(false);
    if (!finish) throw new Error('Expected the scoped delivery to start.');
    finish({ done: 1, failed: 0 });
    await delivery;
    expect(completed).toBe(true);
  });

  it('reports a scheduling error without delivering inline or changing the generic response', async () => {
    const failure = new Error('Scheduling is unavailable.');
    mocks.after.mockImplementation(() => { throw failure; });
    expect((await POST(request())).status).toBe(202);
    expect(mocks.capture).toHaveBeenCalledWith(failure, { tags: { feature: 'staff-otp-email-scheduling' } });
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('handles a delivery infrastructure rejection without an unhandled background error', async () => {
    const failure = new Error('Delivery is unavailable.');
    mocks.batch.mockRejectedValue(failure);
    await POST(request());
    await expect(callback()()).resolves.toBeUndefined();
    expect(mocks.capture).toHaveBeenCalledWith(failure, { tags: { feature: 'staff-otp-email-delivery' } });
  });

  it('reports a provider failure returned by the durable processor without exposing request details', async () => {
    mocks.batch.mockResolvedValue({ done: 0, failed: 1 });
    await POST(request());
    await callback()();
    expect(mocks.message).toHaveBeenCalledExactlyOnceWith('Staff sign-in email delivery failed.', {
      level: 'error', tags: { feature: 'staff-otp-email-delivery' },
    });
  });

  it('does not schedule delivery before the OTP transaction succeeds', async () => {
    mocks.requestOtp.mockRejectedValue(new Error('Unit transaction failed.'));
    expect((await POST(request())).status).toBe(500);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it('validates input before creating or delivering a code', async () => {
    expect((await POST(request({ app: 'admin', email: 'invalid' }))).status).toBe(400);
    expect(mocks.requestOtp).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('keeps rate limiting before code creation and delivery', async () => {
    mocks.rateLimit.mockRejectedValue(new AppError('RATE_LIMITED', 'Try again shortly.', { retryAfter: 60 }));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.requestOtp).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it('does not start background provider work in integration-test mode', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    expect((await POST(request())).status).toBe(202);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.batch).not.toHaveBeenCalled();
  });
});
