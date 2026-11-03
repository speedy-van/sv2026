import { AppError } from '@sv/contracts';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), assigned: vi.fn(), offers: vi.fn(), details: vi.fn(), accept: vi.fn(), decline: vi.fn(), schedule: vi.fn() }));
vi.mock('@sv/db', () => ({ Prisma: { JsonNull: null }, prisma: {
  booking: { count: mocks.assigned, findUniqueOrThrow: mocks.details }, assignment: { count: mocks.offers },
} }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../src/server/admin/booking-dispatch', () => ({ acceptAdminBookingOffer: mocks.accept, declineAdminBookingOffer: mocks.decline }));
vi.mock('../src/server/admin/booking-edit-dispatch', () => ({ scheduleDriverBookingEdit: mocks.schedule }));
import { handleDriverRoute } from '../src/server/driver/routes';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: 'driver', app: 'driver', role: 'DRIVER', sessionId: 'driver-session' });
  mocks.assigned.mockResolvedValue(0); mocks.offers.mockResolvedValue(0);
  mocks.accept.mockResolvedValue({ ok: true, id: 'booking', version: 9 }); mocks.decline.mockResolvedValue({ ok: true, id: 'booking', version: 9 });
});

it('does not expose job detail through an expired offer', async () => {
  const before = Date.now();
  const response = await handleDriverRoute(new Request('http://localhost/api/v1/driver/jobs/booking'), 'GET', 'jobs/booking');
  expect(response.status).toBe(404); expect(mocks.details).not.toHaveBeenCalled();
  const access = mocks.offers.mock.calls[0]?.[0] as { where: { bookingId: string; driverId: string; OR: [{ status: string }, { status: string; OR: [{ expiresAt: null }, { expiresAt: { gt: Date } }] }] } };
  expect(access.where.bookingId).toBe('booking'); expect(access.where.driverId).toBe('driver');
  expect(access.where.OR[0]).toEqual({ status: 'ACCEPTED' });
  expect(access.where.OR[1].status).toBe('OFFERED');
  expect(access.where.OR[1].OR[1].expiresAt.gt.getTime()).toBeGreaterThanOrEqual(before);
  expect(access.where.OR[1].OR[1].expiresAt.gt.getTime()).toBeLessThanOrEqual(Date.now());
});

it.each(['accept', 'decline'] as const)('schedules only the committed version after driver %s succeeds', async (action) => {
  const operation = action === 'accept' ? mocks.accept : mocks.decline;
  operation.mockImplementation(async () => {
    await Promise.resolve();
    expect(mocks.schedule).not.toHaveBeenCalled();
    return { ok: true, id: 'booking', version: 9 };
  });
  const request = new Request(`http://localhost/api/v1/driver/jobs/booking/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const response = await handleDriverRoute(request, 'POST', `jobs/booking/${action}`);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, id: 'booking', version: 9 });
  expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('booking', 9);
});

it.each(['accept', 'decline'] as const)('does not schedule effects after rejected driver %s', async (action) => {
  const operation = action === 'accept' ? mocks.accept : mocks.decline;
  operation.mockRejectedValue(new AppError('OFFER_TAKEN', 'This offer expired.'));
  const request = new Request(`http://localhost/api/v1/driver/jobs/booking/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  const response = await handleDriverRoute(request, 'POST', `jobs/booking/${action}`);
  expect(response.status).toBe(409); expect(mocks.schedule).not.toHaveBeenCalled();
});
