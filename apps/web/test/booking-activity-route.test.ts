import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), limit: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), transaction: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: {
  bookingActivity: { create: mocks.create, updateMany: mocks.updateMany, findUnique: mocks.findUnique, deleteMany: mocks.deleteMany }, $transaction: mocks.transaction,
} }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.limit }));

import { POST, DELETE } from '../src/app/api/v1/bookings/activity/route';

const tx = { bookingActivity: { create: mocks.create, updateMany: mocks.updateMany, findUnique: mocks.findUnique, deleteMany: mocks.deleteMany } };
const visitor = '00000000-0000-4000-8000-000000000001';
function request(method: 'POST' | 'DELETE', body: unknown = { stage: 'MOVE', service: null }, cookie = ''): Request {
  return new Request('http://localhost/api/v1/bookings/activity', { method, headers: { origin: 'http://localhost', 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.deleteMany.mockResolvedValue({ count: 0 });
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
});

describe('public booking activity route', () => {
  it('acknowledges that activity was not tracked without consent and applies the public limiter', async () => {
    const response = await POST(request('POST'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tracked: false, activeWindowSeconds: 90, retentionHours: 24 });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(Request), 'visitorPresence');
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('sets a server-only cookie on a consented first stage without returning the capability in JSON', async () => {
    const consent = encodeURIComponent(JSON.stringify({ analytics: true, advertising: false, version: 1, savedAt: new Date(Date.now() - 1000).toISOString() }));
    const response = await POST(request('POST', { stage: 'ITEMS', service: 'man-and-van' }, `sv_consent=${consent}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tracked: true, activeWindowSeconds: 90, retentionHours: 24 });
    expect(response.headers.get('set-cookie')).toMatch(/^sv_booking_activity=[a-f0-9-]+; Path=\/; HttpOnly; SameSite=Lax/u);
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it.each([{ stage: 'MOVE', service: null, bookingId: 'foreign-booking' }, { stage: 'MOVE', service: null, quoteId: 'foreign-quote' }, { stage: 'DATE', service: null, email: 'test@example.test' }, { stage: 'UNKNOWN', service: null }, null])('rejects invalid or identifying client payloads %# before any database call', async (body) => {
    expect((await POST(request('POST', body))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects cross-origin mutation before persistence', async () => {
    const original = request('POST');
    const headers = new Headers(original.headers);
    headers.set('origin', 'https://other.example.test');
    expect((await POST(new Request(original, { headers }))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('returns retry guidance without tracking on rate limit', async () => {
    mocks.limit.mockRejectedValue(new AppError('RATE_LIMITED', 'Unit limiter', { retryAfter: 60 }));
    const response = await POST(request('POST'));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('withdraws only the current capability without requiring active consent', async () => {
    const response = await DELETE(request('DELETE', {}, `sv_booking_activity=${visitor}`));
    expect(response.status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: visitor } });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
});
