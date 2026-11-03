import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), audit: vi.fn(), read: vi.fn(), context: vi.fn(), patch: vi.fn(), repricePreview: vi.fn(), reprice: vi.fn(),
  options: vi.fn(), calendar: vi.fn(), reschedulePreview: vi.fn(), reschedule: vi.fn(), assign: vi.fn(), offer: vi.fn(), unassign: vi.fn(),
  schedule: vi.fn(), origin: vi.fn(),
}));
vi.mock('@sv/db', () => ({ Prisma: { JsonNull: null }, prisma: { auditLog: { create: mocks.audit } } }));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/auth/browser-session', () => ({ assertBrowserSessionOrigin: mocks.origin }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn(), enforceAdminDriverRateLimit: vi.fn() }));
vi.mock('../src/server/admin/operations', () => ({ readAdminOperation: mocks.read }));
vi.mock('../src/server/admin/booking-edit', () => ({ readAdminBookingEditContext: mocks.context, patchAdminBooking: mocks.patch, previewAdminBookingReprice: mocks.repricePreview, applyAdminBookingReprice: mocks.reprice }));
vi.mock('../src/server/admin/booking-dispatch', () => ({ readAdminAssignmentOptions: mocks.options, assignAdminBooking: mocks.assign, offerAdminBooking: mocks.offer, unassignAdminBooking: mocks.unassign }));
vi.mock('../src/server/admin/booking-reschedule', () => ({ readAdminBookingCalendar: mocks.calendar, previewAdminReschedule: mocks.reschedulePreview, rescheduleAdminBooking: mocks.reschedule }));
vi.mock('../src/server/admin/booking-edit-dispatch', () => ({ scheduleAdminBookingEdit: mocks.schedule }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxEventNow: vi.fn() }));
import { handleAdminRoute, type AdminMethod } from '../src/server/admin/routes';

const saved = { ok: true, id: 'booking-edit', version: 4 };
const actor = { userId: 'admin-one', role: 'ADMIN', requestId: 'request-edit' };
const contact = { name: 'Customer', email: 'customer@example.test', phone: '07700900123' };
const address = { line1: '1 Example Street', town: 'Glasgow', postcode: 'G2 1DU', lat: 55.86, lng: -4.25, label: '1 Example Street', source: 'MANUAL' };
const access = { floorChoice: 'GROUND', hasLift: false, carryMetres: 0, narrowAccess: false, permitZone: false };
const changes = { service: 'man-and-van', variant: 'small', pickup: address, dropoff: address, pickupAccess: access, dropoffAccess: access, items: [], addons: { helpers: 1, packing: false, assembly: false } };
const move = { expectedVersion: 3, date: '2031-11-06', slot: 'MORNING', priceMode: 'KEEP_PRICE', reason: 'Customer requested this date.' };
const preview = { id: 'booking-edit', expectedVersion: 3, currentTotalPence: 20000, newTotalPence: 22000, differencePence: 2000, settle: 'EXTRA_CHARGE', settlementAmountPence: 2000 };
const mutations = [
  { name: 'patch', method: 'PATCH', path: 'bookings/booking-edit', body: { expectedVersion: 3, contact, notes: 'Internal note.' } },
  { name: 'reprice', method: 'POST', path: 'bookings/booking-edit/reprice-apply', body: { expectedVersion: 3, changes, expectedTotalPence: 22000, expectedSettlementPence: 2000, settle: 'EXTRA_CHARGE', reason: 'More items.' } },
  { name: 'reschedule', method: 'POST', path: 'bookings/booking-edit/reschedule', body: { ...move, expectedTotalPence: 20000, expectedSettlementPence: 0, settle: 'NONE' } },
  { name: 'assign', method: 'POST', path: 'bookings/booking-edit/assign', body: { expectedVersion: 3, driverId: 'driver-one', mode: 'DIRECT' } },
  { name: 'offer', method: 'POST', path: 'bookings/booking-edit/offer', body: { expectedVersion: 3, driverIds: ['driver-one'], expiresInMinutes: 30 } },
  { name: 'unassign', method: 'POST', path: 'bookings/booking-edit/unassign', body: { expectedVersion: 3, reason: 'Driver changed.' } },
] as const;

function request(method: AdminMethod, path: string, body?: unknown, origin?: string): Request {
  return new Request(`https://example.test/api/v1/admin/${path}`, {
    method, headers: { 'content-type': 'application/json', 'x-request-id': 'request-edit', ...(origin ? { origin } : {}) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: 'admin-one', role: 'ADMIN', app: 'admin', sessionId: 'session-one' });
  for (const item of mutations) mocks[item.name].mockResolvedValue(saved);
  mocks.context.mockResolvedValue({ id: 'booking-edit', version: 3, contact, notes: null, vanId: null, changes: null, currentTotalPence: 20000,
    editable: true, reason: null, repriceEditable: false, repriceReason: 'Review saved inputs.', services: [] });
  mocks.options.mockResolvedValue({ bookingId: 'booking-edit', version: 3, editable: true, reason: null, drivers: [], vans: [] });
  mocks.calendar.mockResolvedValue({ bookingId: 'booking-edit', version: 3, currentDate: '2031-11-06', currentSlot: 'MORNING', currentTotalPence: 20000, days: [] });
  mocks.repricePreview.mockResolvedValue({ ...preview, oldBreakdownLines: [], newBreakdownLines: [] });
  mocks.reschedulePreview.mockResolvedValue({ ...preview, date: '2031-11-06', slot: 'MORNING', willUnassignDriver: true });
});

describe('real admin booking edit service dispatch', () => {
  it.each(mutations)('dispatches $name to the real service and schedules only the committed version', async ({ name, method, path, body }) => {
    const response = await handleAdminRoute(request(method, path, body), method, path);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(saved);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks[name]).toHaveBeenCalledExactlyOnceWith('booking-edit', body, actor);
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith('booking-edit', 4);
  });
  it.each(mutations)('validates $name before mutation or audit', async ({ name, method, path, body }) => {
    const response = await handleAdminRoute(request(method, path, { ...body, expectedVersion: -1 }), method, path);
    expect(response.status).toBe(400);
    expect(mocks[name]).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it.each(mutations)('requires authentication for $name before inspecting or changing a booking', async ({ name, method, path, body }) => {
    mocks.authenticate.mockRejectedValue(new AppError('UNAUTHORIZED', 'Sign in required.'));
    const response = await handleAdminRoute(request(method, path, body), method, path);
    expect(response.status).toBe(401);
    expect(mocks[name]).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it.each(mutations)('preserves conflicts for $name without scheduling or returning success', async ({ name, method, path, body }) => {
    mocks[name].mockRejectedValue(new AppError('CONFLICT', 'Reload the latest booking.'));
    const response = await handleAdminRoute(request(method, path, body), method, path);
    expect(response.status).toBe(409);
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([
    ['edit-context', 'context'], ['assignment-options', 'options'], ['calendar', 'calendar'],
  ] as const)('reads a validated %s response without scheduling writes', async (suffix, name) => {
    const path = `bookings/booking-edit/${suffix}`;
    const response = await handleAdminRoute(request('GET', path), 'GET', path);
    expect(response.status).toBe(200);
    expect(mocks[name]).toHaveBeenCalledExactlyOnceWith('booking-edit');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('returns server-derived reprice and reschedule previews without changing or scheduling anything', async () => {
    const price = await handleAdminRoute(request('POST', 'bookings/booking-edit/reprice-preview', { expectedVersion: 3, changes }), 'POST', 'bookings/booking-edit/reprice-preview');
    const date = await handleAdminRoute(request('POST', 'bookings/booking-edit/reschedule-preview', move), 'POST', 'bookings/booking-edit/reschedule-preview');
    expect(price.status).toBe(200); expect(date.status).toBe(200);
    expect(mocks.repricePreview).toHaveBeenCalledExactlyOnceWith('booking-edit', { expectedVersion: 3, changes });
    expect(mocks.reschedulePreview).toHaveBeenCalledExactlyOnceWith('booking-edit', move, actor);
    expect(mocks.schedule).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('checks browser origin before an authenticated mutation', async () => {
    mocks.origin.mockImplementation(() => { throw new AppError('FORBIDDEN', 'Origin rejected.'); });
    const item = mutations[0];
    const response = await handleAdminRoute(request(item.method, item.path, item.body, 'https://untrusted.example'), item.method, item.path);
    expect(response.status).toBe(403); expect(mocks.patch).not.toHaveBeenCalled();
  });
  it('refuses DRIVER access even if an invalid staff context reaches the dispatch layer', async () => {
    mocks.authenticate.mockResolvedValue({ userId: 'driver-one', role: 'DRIVER', app: 'driver' });
    const response = await handleAdminRoute(request('PATCH', 'bookings/booking-edit', { expectedVersion: 3, notes: 'Forged update' }), 'PATCH', 'bookings/booking-edit');
    expect(response.status).toBe(403); expect(mocks.patch).not.toHaveBeenCalled();
  });
  it('does not return canned success for an unimplemented booking action', async () => {
    const response = await handleAdminRoute(request('POST', 'bookings/booking-edit/status', { expectedVersion: 3, to: 'COMPLETED', reason: 'A reason' }), 'POST', 'bookings/booking-edit/status');
    expect(response.status).toBe(409); expect(mocks.audit).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: { message: 'This booking action is not available yet. No changes were saved.' } });
  });
});
