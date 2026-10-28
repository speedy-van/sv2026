import { AppError, DriverCreateResponseSchema } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), create: vi.fn(), rateLimit: vi.fn(), legacyAudit: vi.fn(), origin: vi.fn() }));
vi.mock('@sv/db', () => ({ Prisma: { JsonNull: null }, prisma: { auditLog: { create: mocks.legacyAudit } } }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/auth/browser-session', () => ({ assertBrowserSessionOrigin: mocks.origin }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn(), enforceAdminDriverRateLimit: mocks.rateLimit }));
vi.mock('../src/server/admin/driver-account', () => ({ createDriverAccount: mocks.create }));
vi.mock('../src/server/admin/operations', () => ({ readAdminOperation: vi.fn() }));
vi.mock('../src/server/admin/booking-cleanup', () => ({ deleteAdminBooking: vi.fn(), restoreAdminBooking: vi.fn() }));
vi.mock('../src/server/admin/slot-closure', () => ({ setAdminSlotClosure: vi.fn() }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxEventNow: vi.fn() }));

import { handleAdminRoute, matchAdminRoute } from '../src/server/admin/routes';

const input = { email: ' DRIVER@EXAMPLE.TEST ', password: ' A long driver password! ', phone: '07465 227962' };
function request(body: unknown = input, origin?: string): Request {
  return new Request('http://localhost/api/v1/admin/drivers', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'driver-create-request', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: 'admin-unit', app: 'admin', role: 'ADMIN', sessionId: 'session-unit' });
  mocks.create.mockResolvedValue({ id: 'driver-unit', ok: true });
});

describe('admin Add driver API', () => {
  it('dispatches normalized strict input to the real transactional service without the legacy audit', async () => {
    const response = await handleAdminRoute(request(), 'POST', 'drivers');
    expect(response.status).toBe(201);
    expect(response.headers.get('x-request-id')).toBe('driver-create-request');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(DriverCreateResponseSchema.parse(await response.json())).toEqual({ id: 'driver-unit', ok: true });
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), { app: 'admin', roles: ['OWNER', 'ADMIN'] });
    expect(mocks.rateLimit).toHaveBeenCalledExactlyOnceWith('admin-unit');
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith(
      { email: 'driver@example.test', password: input.password, phone: '07465227962' },
      { userId: 'admin-unit', requestId: 'driver-create-request' },
    );
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
    expect(matchAdminRoute('GET', 'drivers')?.definition.action).toBe('admin.drivers.list');
    expect(matchAdminRoute('POST', 'drivers/invite')?.definition.action).toBe('admin.drivers.invite');
  });

  it.each(['OWNER', 'ADMIN'] as const)('allows authenticated %s creation', async (role) => {
    mocks.authenticate.mockResolvedValue({ userId: 'admin-unit', app: 'admin', role, sessionId: 'session-unit' });
    expect((await handleAdminRoute(request(), 'POST', 'drivers')).status).toBe(201);
  });

  it.each([
    { ...input, password: '' }, { ...input, password: 'short' }, { ...input, password: 'x'.repeat(1025) },
    { ...input, phone: undefined }, { ...input, email: 'invalid' }, { ...input, role: 'OWNER' },
  ])('rejects invalid input %# before persistence or hashing', async (body) => {
    const response = await handleAdminRoute(request(body), 'POST', 'drivers');
    expect(response.status).toBe(400);
    const payload: unknown = await response.json();
    expect(payload).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(JSON.stringify(payload)).not.toContain(input.password);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)('rejects anonymous/driver %s before mutation', async (code) => {
    mocks.authenticate.mockRejectedValue(new AppError(code, 'Denied'));
    expect((await handleAdminRoute(request(), 'POST', 'drivers')).status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });

  it('validates browser origins while allowing native bearer clients without an Origin header', async () => {
    expect((await handleAdminRoute(request(input, 'http://localhost:8081'), 'POST', 'drivers')).status).toBe(201);
    expect(mocks.origin).toHaveBeenCalledOnce();
    mocks.create.mockClear();
    // The origin guard is synchronous in production.
    mocks.origin.mockImplementation(() => { throw new AppError('FORBIDDEN', 'Invalid browser origin'); });
    expect((await handleAdminRoute(request(input, 'https://other.example'), 'POST', 'drivers')).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('stops before password work when the staff rate limit is exceeded', async () => {
    mocks.rateLimit.mockRejectedValue(new AppError('RATE_LIMITED', 'Try again shortly.', { retryAfter: 60 }));
    const response = await handleAdminRoute(request(), 'POST', 'drivers');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('returns email conflicts without resetting credentials or writing a premature audit', async () => {
    mocks.create.mockRejectedValue(new AppError('CONFLICT', 'An account already uses this email.'));
    expect((await handleAdminRoute(request(), 'POST', 'drivers')).status).toBe(409);
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });
});
