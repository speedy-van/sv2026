import { AdminVisitorPresenceResponseSchema, AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), limit: vi.fn(), count: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), transaction: vi.fn(), audit: vi.fn(),
}));
vi.mock('@sv/db', () => ({ Prisma: { JsonNull: null }, prisma: {
  websiteVisitorPresence: { count: mocks.count, upsert: mocks.upsert, updateMany: mocks.updateMany, findUnique: mocks.findUnique, deleteMany: mocks.deleteMany },
  $transaction: mocks.transaction, auditLog: { create: mocks.audit },
} }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.limit }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxEventNow: vi.fn() }));

import { POST, DELETE } from '../src/app/api/v1/visitors/presence/route';
import { handleAdminRoute } from '../src/server/admin/routes';

const tx = { websiteVisitorPresence: { upsert: mocks.upsert, updateMany: mocks.updateMany, findUnique: mocks.findUnique, deleteMany: mocks.deleteMany } };
const visitor = '00000000-0000-4000-8000-000000000001';
function request(method: 'POST' | 'DELETE', body: unknown = {}, cookie = ''): Request {
  return new Request('http://localhost/api/v1/visitors/presence', {
    method, headers: { origin: 'http://localhost', 'content-type': 'application/json', 'x-request-id': 'request-unit', cookie }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: 'admin-unit', app: 'admin', role: 'ADMIN', sessionId: 'session-unit' });
  mocks.count.mockResolvedValue(4);
  mocks.deleteMany.mockResolvedValue({ count: 0 });
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
});

describe('public presence and private admin count routes', () => {
  it('returns success with no database call or cookie when analytics consent is absent', async () => {
    const response = await POST(request('POST'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activeWindowSeconds: 90 });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(Request), 'visitorPresence');
  });

  it('issues the server-only session cookie after valid consent without exposing identifiers in the response body', async () => {
    const consent = encodeURIComponent(JSON.stringify({ analytics: true, advertising: false, version: 1, savedAt: new Date(Date.now() - 1000).toISOString() }));
    const response = await POST(request('POST', {}, `sv_consent=${consent}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ activeWindowSeconds: 90 });
    expect(response.headers.get('set-cookie')).toMatch(/^sv_visitor=[a-f0-9-]+; Path=\/; HttpOnly; SameSite=Lax/u);
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it.each([{ id: visitor }, { lastSeenAt: '2031-03-01T12:00:00.000Z' }, { path: '/book' }, null])('rejects extra or invalid heartbeat data %# before tracking', async (body) => {
    const response = await POST(request('POST', body));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects a cross-origin mutation before tracking', async () => {
    const original = request('POST');
    const headers = new Headers(original.headers);
    headers.set('origin', 'https://other.example.test');
    const response = await POST(new Request(original, { headers }));
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('applies the public security limiter and returns a retry delay without tracking on429', async () => {
    mocks.limit.mockRejectedValue(new AppError('RATE_LIMITED', 'Unit test limiter', { retryAfter: 60 }));
    const response = await POST(request('POST'));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('permits consent withdrawal using the current cookie alone and clears only that presence', async () => {
    const response = await DELETE(request('DELETE', {}, `sv_visitor=${visitor}`));
    expect(response.status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id: visitor } });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('serves real count metadata only through the authenticated ADMIN/OWNER route', async () => {
    const response = await handleAdminRoute(new Request('http://localhost/api/v1/admin/visitors/presence'), 'GET', 'visitors/presence');
    expect(response.status).toBe(200);
    expect(AdminVisitorPresenceResponseSchema.parse(await response.json())).toMatchObject({ activeVisitors: 4, activeWindowSeconds: 90, measurement: 'consenting-browsers' });
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), { app: 'admin', roles: ['OWNER', 'ADMIN'] });
    expect(mocks.count).toHaveBeenCalledOnce();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)('rejects %s before reading any visitor count', async (code) => {
    mocks.authenticate.mockRejectedValue(new AppError(code, 'Unit test denied'));
    const response = await handleAdminRoute(new Request('http://localhost/api/v1/admin/visitors/presence'), 'GET', 'visitors/presence');
    expect(response.status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect(mocks.count).not.toHaveBeenCalled();
  });
});
