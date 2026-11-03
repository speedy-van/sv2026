import { AdminBookingAlertsResponseSchema, AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  notifications: vi.fn(),
  bookings: vi.fn(),
  read: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  Prisma: { JsonNull: null },
  prisma: {
    notification: { findMany: mocks.notifications, updateMany: mocks.read },
    booking: { findMany: mocks.bookings },
    auditLog: { create: mocks.audit },
  },
}));
vi.mock('../src/server/auth/staff', () => ({ authenticateStaffRequest: mocks.authenticate }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: vi.fn() }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxEventNow: vi.fn() }));

import { handleAdminRoute } from '../src/server/admin/routes';
import { readBookingAlerts } from '../src/server/notifications/booking-alerts';

const now = new Date('2031-03-01T12:00:00.000Z');
const row = {
  id: 'notification-unit',
  createdAt: now,
  title: 'New booking',
  body: 'Glasgow to Edinburgh',
  data: { bookingId: 'booking-unit', deliveryKey: 'event:notification:admin-unit' },
};
const booking = {
  id: 'booking-unit',
  reference: 'SV-UNIT',
  totalPence: 12345,
  pickup: { town: 'Glasgow', line1: 'Private address' },
  dropoff: { town: 'Edinburgh' },
  service: 'man-and-van',
  slot: 'MORNING',
  moveDate: new Date('2031-03-02T00:00:00.000Z'),
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({
    userId: 'admin-unit',
    app: 'admin',
    role: 'ADMIN',
    sessionId: 'session-unit',
  });
  mocks.notifications.mockResolvedValue([row]);
  mocks.bookings.mockResolvedValue([booking]);
  mocks.read.mockResolvedValue({ count: 1 });
});

describe('unread upcoming paid booking alerts with isolated database mocks', () => {
  it('returns real booking facts and the same delivery identity as the push, without full addresses or links', async () => {
    const result = AdminBookingAlertsResponseSchema.parse(
      await readBookingAlerts('admin-unit', new URLSearchParams(), now),
    );
    expect(result).toEqual({
      items: [
        {
          id: row.id,
          title: row.title,
          body: row.body,
          createdAt: now.toISOString(),
          data: {
            bookingId: booking.id,
            deliveryKey: row.data.deliveryKey,
            type: 'NEW_BOOKING',
            eventType: 'booking.confirmed',
            reference: booking.reference,
            pricePence: 12345,
            route: 'Glasgow to Edinburgh',
            service: 'man-and-van',
            slot: 'MORNING',
            moveDate: '2031-03-02',
          },
        },
      ],
      nextCursor: null,
      generatedAt: now.toISOString(),
    });
    expect(mocks.notifications).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'admin-unit', readAt: null, type: 'booking.confirmed' } }),
    );
    expect(mocks.bookings).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['booking-unit'] },
          deletedAt: null,
          status: 'CONFIRMED',
          moveDate: { gte: new Date('2031-03-01T00:00:00.000Z') },
        },
      }),
    );
    expect(JSON.stringify(result)).not.toContain('Private address');
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('pages through unread rows without dropping a cursor when deleted or cancelled jobs are filtered', async () => {
    mocks.notifications.mockResolvedValue([row, { ...row, id: 'next-row' }]);
    mocks.bookings.mockResolvedValue([]);
    const result = await readBookingAlerts(
      'admin-unit',
      new URLSearchParams('limit=1&cursor=earlier-row'),
      now,
    );
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBe(row.id);
    expect(mocks.notifications).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 2,
        cursor: { id: 'earlier-row' },
        skip: 1,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('handles empty and legacy notification data without inventing a booking or making an unnecessary query', async () => {
    mocks.notifications.mockResolvedValue([{ ...row, data: null }]);
    expect((await readBookingAlerts('admin-unit', new URLSearchParams(), now)).items).toEqual([]);
    expect(mocks.bookings).not.toHaveBeenCalled();
    mocks.notifications.mockResolvedValue([{ ...row, data: { bookingId: booking.id } }]);
    expect(
      (await readBookingAlerts('admin-unit', new URLSearchParams(), now)).items[0]?.data.deliveryKey,
    ).toBe(row.id);
  });

  it.each(['limit=0', 'limit=101', 'cursor=', 'extra=1'])(
    'rejects invalid feed query %s before reading private data',
    async (query) => {
      await expect(readBookingAlerts('admin-unit', new URLSearchParams(query), now)).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
      expect(mocks.notifications).not.toHaveBeenCalled();
    },
  );

  it('serves the feed only after ADMIN/OWNER authentication', async () => {
    const response = await handleAdminRoute(new Request('http://localhost/api/v1/admin/feed'), 'GET', 'feed');
    expect(response.status).toBe(200);
    expect(AdminBookingAlertsResponseSchema.safeParse(await response.json()).success).toBe(true);
    expect(mocks.authenticate).toHaveBeenCalledWith(expect.any(Request), {
      app: 'admin',
      roles: ['OWNER', 'ADMIN'],
    });
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)(
    'rejects %s without reading or acknowledging alerts',
    async (code) => {
      mocks.authenticate.mockRejectedValue(new AppError(code, 'Unit denied'));
      const response = await handleAdminRoute(
        new Request('http://localhost/api/v1/admin/feed'),
        'GET',
        'feed',
      );
      expect(response.status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
      expect(mocks.notifications).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );

  it('acknowledges only this admin’s unread confirmed booking alerts, idempotently', async () => {
    const response = await handleAdminRoute(
      new Request('http://localhost/api/v1/admin/feed/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: 'booking-unit' }),
      }),
      'POST',
      'feed/read',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const readInstant: unknown = expect.any(Date);
    expect(mocks.read).toHaveBeenCalledWith({
      where: {
        userId: 'admin-unit',
        readAt: null,
        type: 'booking.confirmed',
        data: { path: ['bookingId'], equals: 'booking-unit' },
      },
      data: { readAt: readInstant },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rejects an acknowledgement that tries to select another user or mark everything read', async () => {
    const response = await handleAdminRoute(
      new Request('http://localhost/api/v1/admin/feed/read', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bookingId: 'booking-unit', userId: 'other-user', all: true }),
      }),
      'POST',
      'feed/read',
    );
    expect(response.status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)(
    'rejects %s on read acknowledgement before changing any notification',
    async (code) => {
      mocks.authenticate.mockRejectedValue(new AppError(code, 'Unit denied'));
      const response = await handleAdminRoute(
        new Request('http://localhost/api/v1/admin/feed/read', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ bookingId: 'booking-unit' }),
        }),
        'POST',
        'feed/read',
      );
      expect(response.status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
});
