import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  authenticateStaffRequest: vi.fn(),
  enforceRateLimit: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.captureException }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticateStaffRequest }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.enforceRateLimit }));

import { withApi } from '../src/server/request';

function request(body = '{}'): Request {
  return new Request('https://example.test/api/v1/address/suggest?q=private-address', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_address_test' },
    body,
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe('API error reporting', () => {
  it('reports an unexpected failure with request context and returns a generic 500', async () => {
    const failure = new Error('Internal upstream diagnostic');
    const response = await withApi(request(), { auth: false }, () => Promise.reject(failure));

    expect(mocks.captureException).toHaveBeenCalledExactlyOnceWith(failure, {
      tags: { component: 'api' },
      extra: { requestId: 'req_address_test', path: '/api/v1/address/suggest' },
    });
    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req_address_test');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL', message: 'Something went wrong. Try again in a moment.', requestId: 'req_address_test' },
    });
  });

  it('keeps expected application errors actionable without reporting them as unknown failures', async () => {
    const failure = new AppError('UPSTREAM_UNAVAILABLE', 'Address search is not responding. Try again.');
    const response = await withApi(request(), { auth: false }, () => Promise.reject(failure));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'UPSTREAM_UNAVAILABLE', message: failure.message, requestId: 'req_address_test' },
    });
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it('returns validation failures before calling the handler and does not report them to Sentry', async () => {
    const handler = vi.fn(() => Promise.resolve(Response.json({ ok: true })));
    const response = await withApi(request(), { auth: false, input: z.object({ q: z.string().min(2) }) }, handler);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR', requestId: 'req_address_test' } });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});
