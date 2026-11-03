import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), profile: vi.fn(), bookings: vi.fn(), offers: vi.fn(), bookingCount: vi.fn(),
  assignmentCount: vi.fn(), bookingDetail: vi.fn(), earningRows: vi.fn(), user: vi.fn(), transaction: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  Prisma: { JsonNull: null }, prisma: {
    driverProfile: { findUnique: mocks.profile }, booking: { findMany: mocks.bookings, count: mocks.bookingCount, findUniqueOrThrow: mocks.bookingDetail },
    assignment: { findMany: mocks.offers, count: mocks.assignmentCount },
    driverEarning: { findMany: mocks.earningRows }, user: { findUnique: mocks.user }, $transaction: mocks.transaction,
  },
}));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));

import { handleDriverRoute } from '../src/server/driver/routes';

const booking = {
  id: 'job-unit', dispatchStatus: 'ACCEPTED', jobStage: 'NOT_STARTED', status: 'CONFIRMED',
  reference: 'SV-UNIT123', pickup: { town: 'Glasgow' }, dropoff: { town: 'Edinburgh' },
  moveDate: new Date('2031-03-04T00:00:00.000Z'), service: 'man-and-van', slot: 'MORNING', totalPence: 10003,
  accessDetail: {}, contactName: 'Customer', contactPhone: '07000000000', customerNotes: null,
  extraCharges: [], photos: [], signature: null, pricingInput: { inventory: [] },
};
function request(path: string): Request { return new Request(`http://localhost/api/v1/driver/${path}`); }
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: 'driver-unit', app: 'driver', role: 'DRIVER', sessionId: 'session-unit' });
  mocks.profile.mockResolvedValue({ payoutPercent: null });
  mocks.bookings.mockResolvedValue([booking]);
  mocks.offers.mockResolvedValue([{ id: 'offer-unit', expiresAt: null, booking }]);
  mocks.bookingCount.mockResolvedValue(1);
  mocks.assignmentCount.mockResolvedValue(0);
  mocks.bookingDetail.mockResolvedValue(booking);
  mocks.user.mockResolvedValue({
    email: 'driver@example.test', name: 'Driver', phone: '07000000001',
    driver: { payoutPercent: null, homePostcode: null, licenceExpiry: null },
  });
});

describe('phone-agreed driver payments are represented as unassigned amounts', () => {
  it.each(['jobs?scope=today', 'jobs?scope=upcoming', 'jobs?scope=history', 'jobs?scope=offers'])('returns null rather than invented zero for %s', async (path) => {
    const response = await handleDriverRoute(request(path), 'GET', 'jobs');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ bookingId: booking.id, earningPence: null }] });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([0, 40, 100])('preserves the existing numeric estimate for an explicitly configured %i percent', async (payoutPercent) => {
    mocks.profile.mockResolvedValue({ payoutPercent });
    const response = await handleDriverRoute(request('jobs'), 'GET', 'jobs');
    expect(await response.json()).toMatchObject({ items: [{ earningPence: Math.round(booking.totalPence * payoutPercent / 100) }] });
  });

  it('returns job detail and profile with explicit null payment agreement fields', async () => {
    const detail = await handleDriverRoute(request('jobs/job-unit'), 'GET', 'jobs/job-unit');
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({ id: 'job-unit', earningPence: null });
    const profile = await handleDriverRoute(request('profile'), 'GET', 'profile');
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({ payoutPercent: null });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('keeps actual recorded earnings independent of an absent percentage', async () => {
    mocks.earningRows.mockResolvedValue([
      { id: 'earning-unit', amountPence: 8750, payoutId: null, booking: { reference: booking.reference, moveDate: booking.moveDate, service: booking.service } },
    ]);
    const response = await handleDriverRoute(request('earnings'), 'GET', 'earnings');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      items: [{ amountPence: 8750 }], totals: { earnedPence: 8750, paidPence: 0, unpaidPence: 8750 },
    });
    expect(mocks.profile).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('retains the authenticated DRIVER role and ownership boundary', async () => {
    mocks.authenticate.mockRejectedValue(new AppError('FORBIDDEN', 'Denied'));
    expect((await handleDriverRoute(request('jobs'), 'GET', 'jobs')).status).toBe(403);
    expect(mocks.profile).not.toHaveBeenCalled();
    mocks.authenticate.mockResolvedValue({ userId: 'driver-unit', app: 'driver', role: 'DRIVER', sessionId: 'session-unit' });
    mocks.bookingCount.mockResolvedValue(0);
    expect((await handleDriverRoute(request('jobs/other-driver-job'), 'GET', 'jobs/other-driver-job')).status).toBe(404);
    expect(mocks.bookingDetail).not.toHaveBeenCalled();
  });
});
