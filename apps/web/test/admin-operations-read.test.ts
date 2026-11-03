import {
  AdminBookingDetailResponseSchema, AdminBookingsResponseSchema, AdminDashboardResponseSchema,
  AdminDriverDetailResponseSchema, AdminDriversResponseSchema, AdminScheduleResponseSchema, AppError,
} from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), auditCreate: vi.fn(), bookingFindMany: vi.fn(), bookingFindUnique: vi.fn(),
  capacityFor: vi.fn(), countSlotUsage: vi.fn(), driverFindMany: vi.fn(), driverFindUnique: vi.fn(),
  earningAggregate: vi.fn(), slotHoldFindMany: vi.fn(), transaction: vi.fn(),
  closureFindMany: vi.fn(), paymentFindMany: vi.fn(), overrideFindMany: vi.fn(), ruleFindMany: vi.fn(), settingFindUnique: vi.fn(),
}));
vi.mock('@sv/db', async () => {
  const { ORDERED_SLOTS, slotsCovered, configuredCapacitiesForSlots, capacityUnitsInSlot } = await import('../../../packages/db/src/locks');
  return {
    Prisma: { JsonNull: null }, ORDERED_SLOTS, slotsCovered, configuredCapacitiesForSlots, capacityUnitsInSlot,
    capacityFor: mocks.capacityFor, configuredCapacityFor: mocks.capacityFor, countSlotUsage: mocks.countSlotUsage,
    prisma: {
      auditLog: { create: mocks.auditCreate },
      booking: { findMany: mocks.bookingFindMany, findUnique: mocks.bookingFindUnique },
      driverProfile: { findMany: mocks.driverFindMany, findUnique: mocks.driverFindUnique },
      driverEarning: { aggregate: mocks.earningAggregate },
      slotHold: { findMany: mocks.slotHoldFindMany }, $transaction: mocks.transaction,
    },
  };
});
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxEventNow: vi.fn() }));

import { readAdminOperation } from '../src/server/admin/operations';
import { handleAdminRoute } from '../src/server/admin/routes';

const now = new Date('2031-03-01T12:00:00.000Z');
const date = new Date('2031-03-04T00:00:00.000Z');
const bookingCreatedAt = new Date('2031-02-23T23:47:18.456Z');
const address = {
  label: 'Unit test pickup, Glasgow G2 1DU', line1: 'Unit test pickup', town: 'Glasgow', postcode: 'G2 1DU',
  lat: 55.86, lng: -4.25, source: 'MANUAL',
};
const baseBooking = {
  id: 'booking-unit', reference: 'SV-ABC123', contactName: 'Unit test customer', contactEmail: 'customer@example.test', contactPhone: '+447700900111',
  service: 'man-and-van', variant: 'standard', pickup: address, dropoff: null, pickupPostcode: 'G2 1DU', dropoffPostcode: null,
  moveDate: date, createdAt: bookingCreatedAt, slot: 'MORNING', status: 'CONFIRMED', dispatchStatus: 'UNASSIGNED', jobStage: 'NOT_STARTED',
  totalPence: 10000, paidPence: 10000, refundedPence: 0, holdExpiresAt: null, deletedAt: null, driverId: null, slotHolds: [], driver: null, capacityUnits: 1, blocksSlots: 1,
  customerNotes: null, adminNotes: null, distanceMiles: 5, durationMinutes: 15, version: 0, van: null, payments: [],
  passwordHash: 'private-field-must-not-leak', stripePaymentIntentId: 'private-field-must-not-leak',
};
const baseDriver = {
  userId: 'driver-unit', user: { name: 'Unit test driver', email: 'driver@example.test', phone: null, status: 'ACTIVE', role: 'DRIVER', passwordHash: 'private-field-must-not-leak' },
  homePostcode: 'G2 1DU', licenceExpiry: null, defaultVan: null, _count: { bookings: 2 },
  unavailabilities: [{ slot: 'EVENING' }], payoutPercent: 40, notes: null, rightToWorkAt: null,
};
const tx = {
  booking: { findMany: mocks.bookingFindMany }, slotHold: { findMany: mocks.slotHoldFindMany },
  capacityClosure: { findMany: mocks.closureFindMany }, payment: { findMany: mocks.paymentFindMany },
  capacityOverride: { findMany: mocks.overrideFindMany }, capacityRule: { findMany: mocks.ruleFindMany }, setting: { findUnique: mocks.settingFindUnique },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: 'admin-unit', app: 'admin', role: 'ADMIN', sessionId: 'session-unit' });
  mocks.bookingFindMany.mockResolvedValue([]);
  mocks.bookingFindUnique.mockResolvedValue(null);
  mocks.driverFindMany.mockResolvedValue([]);
  mocks.driverFindUnique.mockResolvedValue(null);
  mocks.earningAggregate.mockResolvedValue({ _sum: { amountPence: null } });
  mocks.slotHoldFindMany.mockResolvedValue([]);
  mocks.closureFindMany.mockResolvedValue([]);
  mocks.paymentFindMany.mockResolvedValue([]);
  mocks.overrideFindMany.mockResolvedValue(['MORNING', 'AFTERNOON', 'EVENING'].map((slot) => ({ slot, capacity: 5 })));
  mocks.ruleFindMany.mockResolvedValue([]);
  mocks.settingFindUnique.mockResolvedValue(null);
  mocks.capacityFor.mockResolvedValue(5);
  mocks.countSlotUsage.mockResolvedValue(0);
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
});

describe('real admin operations read models with isolated database mocks', () => {
  it('preserves the exact persisted booking creation instant through list, detail, dashboard and schedule, independently of move/payment time', async () => {
    mocks.bookingFindMany.mockResolvedValue([baseBooking]);
    mocks.bookingFindUnique.mockResolvedValue({ ...baseBooking, payments: [{
      id: 'payment-unit', kind: 'BOOKING', method: 'STRIPE', status: 'SUCCEEDED',
      amountPence: 10000, currency: 'gbp', createdAt: now,
    }] });
    const list = AdminBookingsResponseSchema.parse(await readAdminOperation('admin.bookings.list', {}, new URLSearchParams(), now));
    const detail = AdminBookingDetailResponseSchema.parse(await readAdminOperation('admin.bookings.view', { id: baseBooking.id }, new URLSearchParams(), now));
    const dashboard = AdminDashboardResponseSchema.parse(await readAdminOperation('admin.dashboard.view', {}, new URLSearchParams(), now));
    const schedule = AdminScheduleResponseSchema.parse(await readAdminOperation('admin.schedule.view', {}, new URLSearchParams(), now));
    expect([list.items[0]?.createdAt, detail.createdAt, dashboard.jobs[0]?.createdAt, schedule.jobs[0]?.createdAt]).toEqual([
      '2031-02-23T23:47:18.456Z', '2031-02-23T23:47:18.456Z', '2031-02-23T23:47:18.456Z', '2031-02-23T23:47:18.456Z',
    ]);
    expect(detail.moveDate).toBe('2031-03-04');
    expect(detail.payments[0]?.createdAt).toBe(now.toISOString());
    expect(mocks.bookingFindMany.mock.calls[0]?.[0]).toMatchObject({ select: { createdAt: true } });
    expect(mocks.bookingFindUnique.mock.calls[0]?.[0]).toMatchObject({ select: { createdAt: true } });
  });

  it('returns accurate empty dashboard counts rather than fabricated jobs or money', async () => {
    const data = AdminDashboardResponseSchema.parse(await readAdminOperation('admin.dashboard.view', {}, new URLSearchParams('date=2031-03-04'), now));
    expect(data.counts).toEqual({ scheduled: 0, needsDriver: 0, inProgress: 0, completed: 0, pendingPayment: 0 });
    expect(data.jobs).toEqual([]);
    expect(data.bookedValuePence).toBe(0);
    expect(data.paidPence).toBe(0);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('uses London civil dates and counts only the selected date’s booked work and live holds', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      baseBooking,
      { ...baseBooking, id: 'progress', status: 'IN_PROGRESS', driver: { userId: 'driver-unit', user: { name: 'Unit test driver' } } },
      { ...baseBooking, id: 'completed', status: 'COMPLETED' },
      { ...baseBooking, id: 'held', status: 'PENDING_PAYMENT', paidPence: 0, holdExpiresAt: new Date(now.getTime() + 1000) },
    ]);
    const data = AdminDashboardResponseSchema.parse(await readAdminOperation('admin.dashboard.view', {}, new URLSearchParams(), new Date('2031-07-01T23:30:00.000Z')));
    expect(data.date).toBe('2031-07-02');
    expect(data.counts).toEqual({ scheduled: 3, needsDriver: 1, inProgress: 1, completed: 1, pendingPayment: 1 });
    expect(data.bookedValuePence).toBe(30000);
    expect(data.paidPence).toBe(30000);
    expect(mocks.bookingFindMany.mock.calls[0]?.[0]).toMatchObject({ where: { moveDate: new Date('2031-07-02T00:00:00.000Z'), OR: [{ status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } }, { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: new Date('2031-07-01T23:30:00.000Z') } }] } });
    expect(JSON.stringify(data)).not.toContain('private-field-must-not-leak');
  });

  it('applies all booking filters and advances a stable cursor using lookahead', async () => {
    mocks.bookingFindMany.mockResolvedValue([baseBooking, { ...baseBooking, id: 'booking-2' }, { ...baseBooking, id: 'booking-3' }]);
    const search = new URLSearchParams({ q: '  G2  ', status: 'CONFIRMED', dispatch: 'UNASSIGNED', from: '2031-03-01', to: '2031-03-31', service: 'man-and-van', driverId: 'driver-unit', cursor: 'previous-booking', limit: '2' });
    const data = AdminBookingsResponseSchema.parse(await readAdminOperation('admin.bookings.list', {}, search, now));
    expect(data.items.map((item) => item.id)).toEqual(['booking-unit', 'booking-2']);
    expect(data.nextCursor).toBe('booking-2');
    expect(mocks.bookingFindMany.mock.calls[0]?.[0]).toMatchObject({
      cursor: { id: 'previous-booking' }, skip: 1, take: 3,
      where: { status: 'CONFIRMED', dispatchStatus: 'UNASSIGNED', service: 'man-and-van', driverId: 'driver-unit', moveDate: { gte: new Date('2031-03-01T00:00:00.000Z'), lte: new Date('2031-03-31T00:00:00.000Z') }, OR: [{ reference: { contains: 'G2', mode: 'insensitive' } }, { contactName: { contains: 'G2', mode: 'insensitive' } }, { contactEmail: { contains: 'G2', mode: 'insensitive' } }, { contactPhone: { contains: 'G2', mode: 'insensitive' } }, { pickupPostcode: { contains: 'G2', mode: 'insensitive' } }, { dropoffPostcode: { contains: 'G2', mode: 'insensitive' } }] },
    });
  });

  it('uses recorded postcodes when stored address JSON cannot be validated', async () => {
    mocks.bookingFindMany.mockResolvedValue([{ ...baseBooking, pickup: { town: 'unvalidated input' }, dropoffPostcode: 'EH1 1BB' }]);
    const data = AdminBookingsResponseSchema.parse(await readAdminOperation('admin.bookings.list', {}, new URLSearchParams(), now));
    expect(data.items[0]).toMatchObject({ pickupTown: null, dropoffTown: null, routeLabel: 'G2 1DU to EH1 1BB' });
    expect(data.nextCursor).toBeNull();
  });

  it('excludes removed bookings by default and supports the explicit removed view', async () => {
    await readAdminOperation('admin.bookings.list', {}, new URLSearchParams(), now);
    expect(mocks.bookingFindMany.mock.calls[0]?.[0]).toMatchObject({ where: { deletedAt: null } });
    await readAdminOperation('admin.bookings.list', {}, new URLSearchParams('deleted=only'), now);
    expect(mocks.bookingFindMany.mock.calls[1]?.[0]).toMatchObject({ where: { deletedAt: { not: null } } });
    await expect(readAdminOperation('admin.bookings.list', {}, new URLSearchParams('deleted=all'), now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('keeps recorded completed value in dashboard totals while removing its work-list row', async () => {
    mocks.bookingFindMany.mockResolvedValue([{ ...baseBooking, status: 'COMPLETED', deletedAt: now }]);
    const data = AdminDashboardResponseSchema.parse(await readAdminOperation('admin.dashboard.view', {}, new URLSearchParams(), now));
    expect(data.jobs).toEqual([]);
    expect(data.bookedValuePence).toBe(10000);
    expect(data.paidPence).toBe(10000);
    expect(data.counts.completed).toBe(1);
  });

  it.each(['from=2031-03-31&to=2031-03-01', 'status=UNKNOWN', 'limit=1000', 'from=2031-02-30'])('rejects invalid booking query %s before database access', async (query) => {
    await expect(readAdminOperation('admin.bookings.list', {}, new URLSearchParams(query), now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.bookingFindMany).not.toHaveBeenCalled();
  });

  it('returns real booking contact/payment detail without Stripe identifiers or credentials', async () => {
    mocks.bookingFindUnique.mockResolvedValue({ ...baseBooking, payments: [{ id: 'payment-unit', kind: 'BOOKING', method: 'STRIPE', status: 'SUCCEEDED', amountPence: 10000, currency: 'gbp', createdAt: now }] });
    const data = AdminBookingDetailResponseSchema.parse(await readAdminOperation('admin.bookings.view', { id: 'booking-unit' }, new URLSearchParams(), now));
    expect(data.contactEmail).toBe('customer@example.test');
    expect(data.deletedAt).toBeNull();
    expect(data.deletion).toMatchObject({ allowed: false });
    expect(data.payments[0]).toMatchObject({ status: 'SUCCEEDED', amountPence: 10000, createdAt: now.toISOString() });
    expect(JSON.stringify(data)).not.toMatch(/private-field|stripePaymentIntentId|passwordHash|clientSecret/);
    expect(mocks.bookingFindUnique.mock.calls[0]?.[0]).toMatchObject({ where: { id: 'booking-unit' } });
  });

  it('returns NOT_FOUND for an unknown booking', async () => {
    await expect(readAdminOperation('admin.bookings.view', { id: 'missing' }, new URLSearchParams(), now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reads each capacity dataset once and accounts for multi-slot checkout and reschedule holds', async () => {
    mocks.bookingFindMany.mockResolvedValue([
      { ...baseBooking, status: 'PENDING_PAYMENT', slot: 'MORNING', blocksSlots: 2, capacityUnits: 2, holdExpiresAt: new Date(now.getTime() + 1000) },
      baseBooking,
      { ...baseBooking, slot: 'AFTERNOON' },
    ]);
    mocks.slotHoldFindMany.mockResolvedValue([{ slot: 'AFTERNOON', blocksSlots: 2, capacityUnits: 1, expiresAt: new Date(now.getTime() + 1000), paymentId: null }]);
    mocks.countSlotUsage.mockImplementation((_client: unknown, _date: Date, slot: string) => Promise.resolve(slot === 'MORNING' ? 3 : slot === 'AFTERNOON' ? 4 : 1));
    const data = AdminScheduleResponseSchema.parse(await readAdminOperation('admin.schedule.view', {}, new URLSearchParams('date=2031-03-04'), now));
    expect(data.slots).toMatchObject([
      { slot: 'MORNING', capacity: 5, heldUnits: 2, confirmedUnits: 1, availableUnits: 2 },
      { slot: 'AFTERNOON', capacity: 5, heldUnits: 3, confirmedUnits: 1, availableUnits: 1 },
      { slot: 'EVENING', capacity: 5, heldUnits: 1, confirmedUnits: 0, availableUnits: 4 },
    ]);
    expect(data.slots.every((slot) => slot.configuredCapacity === 5 && slot.manualClosure === null && !slot.closeAllowed)).toBe(true);
    expect(mocks.transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: 'RepeatableRead' });
    expect(mocks.bookingFindMany).toHaveBeenCalledTimes(2);
    expect(mocks.slotHoldFindMany).toHaveBeenCalledOnce();
    expect(mocks.overrideFindMany).toHaveBeenCalledOnce();
    expect(mocks.ruleFindMany).toHaveBeenCalledOnce();
    expect(mocks.settingFindUnique).toHaveBeenCalledOnce();
    expect(mocks.capacityFor).not.toHaveBeenCalled();
    expect(mocks.countSlotUsage).not.toHaveBeenCalled();
  });

  it('clamps over-capacity free units at zero and accepts legacy single-day from/to', async () => {
    mocks.overrideFindMany.mockResolvedValue(['MORNING', 'AFTERNOON', 'EVENING'].map((slot) => ({ slot, capacity: 0 })));
    mocks.bookingFindMany.mockResolvedValue([{ ...baseBooking, blocksSlots: 3, capacityUnits: 2 }]);
    const data = AdminScheduleResponseSchema.parse(await readAdminOperation('admin.schedule.view', {}, new URLSearchParams('from=2031-03-04&to=2031-03-04'), now));
    expect(data.date).toBe('2031-03-04');
    expect(data.slots.every((slot) => slot.availableUnits === 0)).toBe(true);
  });

  it('rejects unsupported date ranges instead of silently returning a different day', async () => {
    await expect(readAdminOperation('admin.schedule.view', {}, new URLSearchParams('from=2031-03-04&to=2031-03-05'), now)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('reads actual driver profiles, per-day assigned jobs and unavailability without inventing online status', async () => {
    mocks.driverFindMany.mockResolvedValue([baseDriver]);
    const data = AdminDriversResponseSchema.parse(await readAdminOperation('admin.drivers.list', {}, new URLSearchParams('q=unit&date=2031-03-04'), now));
    expect(data.items[0]).toMatchObject({ id: 'driver-unit', name: 'Unit test driver', status: 'ACTIVE', jobsOnDate: 2, unavailableSlots: ['EVENING'] });
    expect(data.nextCursor).toBeNull();
    expect(mocks.driverFindMany.mock.calls[0]?.[0]).toMatchObject({ where: { user: { role: 'DRIVER' } }, take: 26 });
    expect(JSON.stringify(data)).not.toMatch(/passwordHash|private-field|online|availableNow/);
  });

  it('reads stored unpaid driver earnings and marks a truncated upcoming list honestly', async () => {
    mocks.driverFindUnique.mockResolvedValue(baseDriver);
    mocks.bookingFindMany.mockResolvedValue(Array.from({ length: 26 }, (_, index) => ({ ...baseBooking, id: `upcoming-${String(index)}` })));
    mocks.earningAggregate.mockResolvedValue({ _sum: { amountPence: 8400 } });
    const data = AdminDriverDetailResponseSchema.parse(await readAdminOperation('admin.drivers.view', { id: 'driver-unit' }, new URLSearchParams('date=2031-03-04'), now));
    expect(data.unpaidEarningsPence).toBe(8400);
    expect(data.upcomingBookings).toHaveLength(25);
    expect(data.upcomingBookings[0]?.createdAt).toBe(bookingCreatedAt.toISOString());
    expect(data.hasMoreUpcomingBookings).toBe(true);
    expect(mocks.earningAggregate).toHaveBeenCalledWith({ where: { driverId: 'driver-unit', payoutId: null }, _sum: { amountPence: true } });
  });

  it('returns a phone-agreement driver without inventing a percentage or changing recorded earnings', async () => {
    mocks.driverFindUnique.mockResolvedValue({ ...baseDriver, payoutPercent: null });
    mocks.bookingFindMany.mockResolvedValue([]);
    mocks.earningAggregate.mockResolvedValue({ _sum: { amountPence: 8400 } });
    const data = AdminDriverDetailResponseSchema.parse(await readAdminOperation('admin.drivers.view', { id: 'driver-unit' }, new URLSearchParams('date=2031-03-04'), now));
    expect(data.payoutPercent).toBeNull();
    expect(data.unpaidEarningsPence).toBe(8400);
  });

  it.each([null, { ...baseDriver, user: { ...baseDriver.user, role: 'ADMIN' } }])('does not expose a missing or no-longer-driver profile as a driver', async (driver) => {
    mocks.driverFindUnique.mockResolvedValue(driver);
    await expect(readAdminOperation('admin.drivers.view', { id: 'driver-unit' }, new URLSearchParams(), now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.earningAggregate).not.toHaveBeenCalled();
  });
});

describe('admin read endpoints retain staff authorization', () => {
  it.each(['dashboard', 'bookings', 'bookings/booking-unit', 'schedule', 'drivers', 'drivers/driver-unit'])('rejects anonymous and driver requests before querying %s', async (path) => {
    for (const [code, status] of [['UNAUTHORIZED', 401], ['FORBIDDEN', 403]] as const) {
      mocks.authenticate.mockRejectedValue(new AppError(code, 'Sign in required.'));
      const response = await handleAdminRoute(new Request(`http://localhost/api/v1/admin/${path}`), 'GET', path);
      expect(response.status).toBe(status);
    }
    expect(mocks.authenticate.mock.calls[0]?.[1]).toEqual({ app: 'admin', roles: ['OWNER', 'ADMIN'] });
    expect(mocks.bookingFindMany).not.toHaveBeenCalled();
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled();
    expect(mocks.driverFindMany).not.toHaveBeenCalled();
    expect(mocks.driverFindUnique).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('serves the real list with no-store response and no mutation audit', async () => {
    mocks.bookingFindMany.mockResolvedValue([baseBooking]);
    const response = await handleAdminRoute(new Request('http://localhost/api/v1/admin/bookings?status=CONFIRMED'), 'GET', 'bookings');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(AdminBookingsResponseSchema.parse(await response.json()).items[0]?.id).toBe(baseBooking.id);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});
