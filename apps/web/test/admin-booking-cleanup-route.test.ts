import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), remove: vi.fn(), restore: vi.fn(), legacyAudit: vi.fn(), closure: vi.fn() }));
vi.mock('@sv/db', () => ({ Prisma: { JsonNull: null }, prisma: { auditLog: { create: mocks.legacyAudit } } }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../src/server/admin/operations', () => ({ readAdminOperation: vi.fn() }));
vi.mock('../src/server/admin/booking-cleanup', () => ({ deleteAdminBooking: mocks.remove, restoreAdminBooking: mocks.restore }));
vi.mock('../src/server/admin/slot-closure', () => ({ setAdminSlotClosure: mocks.closure }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxEventNow: vi.fn() }));

import { handleAdminRoute } from '../src/server/admin/routes';

const result = { id: 'booking-unit', deletedAt: '2031-03-01T12:00:00.000Z', status: 'CANCELLED', version: 4 };
function request(method: 'DELETE' | 'POST' | 'PUT', body: unknown): Request {
  return new Request('http://localhost/api/v1/admin/bookings/booking-unit', {
    method, headers: { 'content-type': 'application/json', 'x-request-id': 'request-unit' }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: 'admin-unit', role: 'ADMIN', app: 'admin', sessionId: 'session-unit' });
  mocks.remove.mockResolvedValue(result);
  mocks.restore.mockResolvedValue({ ...result, deletedAt: null, version: 5 });
});

describe('manual capacity closure route remains narrowly ADMIN/OWNER protected', () => {
  const body = { date: '2031-03-03', slot: 'MORNING', closed: true, expectedClosureId: null, reason: 'No additional moves in this period.' };
  it('dispatches to the real closure service before legacy audit without changing general capacity permissions', async () => {
    mocks.closure.mockResolvedValue({ date: body.date, generatedAt: '2031-03-01T12:00:00.000Z', window: {} });
    const response = await handleAdminRoute(request('PUT', body), 'PUT', 'capacity/closures');
    expect(response.status).toBe(200);
    expect(mocks.closure).toHaveBeenCalledExactlyOnceWith(body, { userId: 'admin-unit', requestId: 'request-unit' });
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), { app: 'admin', roles: ['OWNER', 'ADMIN'] });
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });

  it.each([{ ...body, date: '2031-02-30' }, { ...body, reason: 'x' }, { ...body, closed: 'yes' }, { ...body, capacity: 100 }])('rejects invalid input %# before any mutation', async (invalid) => {
    const response = await handleAdminRoute(request('PUT', invalid), 'PUT', 'capacity/closures');
    expect(response.status).toBe(400);
    expect(mocks.closure).not.toHaveBeenCalled();
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)('rejects %s before mutation', async (code) => {
    mocks.authenticate.mockRejectedValue(new AppError(code, 'Unit test rejected staff'));
    const response = await handleAdminRoute(request('PUT', body), 'PUT', 'capacity/closures');
    expect(response.status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect(mocks.closure).not.toHaveBeenCalled();
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });
});

describe('authenticated cleanup dispatch uses the real service and transactional audit', () => {
  it.each([['DELETE', 'bookings/booking-unit'], ['POST', 'bookings/booking-unit/restore']] as const)('dispatches %s %s without the legacy premature audit', async (method, path) => {
    const response = await handleAdminRoute(request(method, { expectedVersion: 3 }), method, path);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), { app: 'admin', roles: ['OWNER', 'ADMIN'] });
    const service = method === 'DELETE' ? mocks.remove : mocks.restore;
    expect(service).toHaveBeenCalledExactlyOnceWith('booking-unit', { expectedVersion: 3 }, { userId: 'admin-unit', requestId: 'request-unit' });
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });

  it.each([{}, { expectedVersion: -1 }, { expectedVersion: 3, deletedAt: null }])('rejects invalid mutation input %# before a business call', async (body) => {
    const response = await handleAdminRoute(request('DELETE', body), 'DELETE', 'bookings/booking-unit');
    expect(response.status).toBe(400);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)('rejects %s before any cleanup or audit', async (code) => {
    mocks.authenticate.mockRejectedValue(new AppError(code, 'Unit test denied'));
    const response = await handleAdminRoute(request('DELETE', { expectedVersion: 3 }), 'DELETE', 'bookings/booking-unit');
    expect(response.status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });

  it('preserves a refreshable conflict from the service and never claims success or audits it twice', async () => {
    mocks.remove.mockRejectedValue(new AppError('CONFLICT', 'This payment is processing.'));
    const response = await handleAdminRoute(request('DELETE', { expectedVersion: 3 }), 'DELETE', 'bookings/booking-unit');
    expect(response.status).toBe(409);
    expect(mocks.legacyAudit).not.toHaveBeenCalled();
  });
});
