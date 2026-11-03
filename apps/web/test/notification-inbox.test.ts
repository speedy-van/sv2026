import { AppError } from '@sv/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffContext } from '../src/server/auth/staff';
import type * as StaffModule from '../src/server/auth/staff';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), list: vi.fn(), cursor: vi.fn(), count: vi.fn(), update: vi.fn(),
  chatSummary: vi.fn(), capture: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  enqueueOutbox: vi.fn(),
  prisma: {
    notification: { findMany: mocks.list, findFirst: mocks.cursor, count: mocks.count, updateMany: mocks.update },
    $queryRaw: mocks.chatSummary,
  },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture }));
vi.mock('../src/server/settings', () => ({ getPublicSettings: vi.fn() }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.rateLimit }));
vi.mock('../src/server/auth/staff', async (importOriginal) => ({
  ...await importOriginal<typeof StaffModule>(),
  authenticateStaffRequest: mocks.authenticate,
}));

import { GET, POST } from '../src/app/api/v1/notifications/route';
import { readNotificationCounts } from '../src/server/notifications/counts';

const staff: StaffContext = { userId: 'admin-one', role: 'ADMIN', app: 'admin', sessionId: 'session-one' };
const createdAt = new Date('2026-10-23T17:54:00.688Z');
const item = {
  id: 'contact-notification', type: 'contact.received', title: 'Contact message', body: 'A customer sent a message.',
  data: { eventType: 'contact.received', contactMessageId: 'contact-one' }, readAt: null, createdAt,
};
function request(query = '', body?: unknown): Request {
  return new Request(`https://example.test/api/v1/notifications${query}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue(staff);
  mocks.list.mockResolvedValue([item]);
  mocks.cursor.mockResolvedValue({ id: 'my-cursor' });
  mocks.count.mockResolvedValue(2);
  mocks.chatSummary.mockResolvedValue([{ count: 0n, latestCustomerSequence: null }]);
  mocks.update.mockResolvedValue({ count: 1 });
});

describe('authenticated notification inbox', () => {
  it('shows old non-booking notifications and exact totals without returning private recipient fields', async () => {
    mocks.chatSummary.mockResolvedValue([{ count: 3n, latestCustomerSequence: '90' }]);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ items: [{ ...item, createdAt: createdAt.toISOString() }], nextCursor: null, unreadCount: 2, badgeCount: 5 });
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({
      orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { body: true, createdAt: true, data: true, id: true, readAt: true, title: true, type: true },
      take: 51, where: { userId: staff.userId },
    });
    expect(mocks.count).toHaveBeenCalledWith({ where: { userId: staff.userId, readAt: null } });
  });

  it('paginates past fifty while preserving the full unread count', async () => {
    mocks.list.mockResolvedValue(Array.from({ length: 51 }, (_, index) => ({ ...item, id: `notification-${String(index)}` })));
    mocks.count.mockResolvedValue(76);
    const response = await GET(request());
    const body: unknown = await response.json();
    expect(body).toMatchObject({ unreadCount: 76, badgeCount: 76, nextCursor: 'notification-49' });
    expect(body).toHaveProperty('items.length', 50);
    mocks.list.mockClear();
    mocks.list.mockResolvedValue([{ ...item, id: 'notification-50' }]);
    const next = await GET(request('?cursor=notification-49&limit=25'));
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ nextCursor: null, unreadCount: 76 });
    expect(mocks.cursor).toHaveBeenLastCalledWith({ where: { id: 'notification-49', userId: staff.userId }, select: { id: true } });
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: staff.userId }, cursor: { id: 'notification-49' }, skip: 1, take: 26 }));
  });

  it('rejects a missing or another account cursor without reading any inbox rows', async () => {
    mocks.cursor.mockResolvedValue(null);
    const response = await GET(request('?cursor=someone-else'));
    expect(response.status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it.each(['?limit=101', '?limit=0', '?limit=1.5', '?userId=other-account', '?badgeCount=0'])('rejects malformed or forged query %s', async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it.each(['UNAUTHORIZED', 'FORBIDDEN'] as const)('refuses both methods when authentication returns %s', async (code) => {
    mocks.authenticate.mockRejectedValue(new AppError(code, 'Denied'));
    expect((await GET(request())).status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect((await POST(request('', { all: true }))).status).toBe(code === 'UNAUTHORIZED' ? 401 : 403);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('only marks unread notifications belonging to the authenticated account', async () => {
    const response = await POST(request('', { ids: ['contact-notification', 'another-account-id'] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      data: { readAt: expect.any(Date) as Date },
      where: { userId: staff.userId, readAt: null, id: { in: ['contact-notification', 'another-account-id'] } },
    });
  });

  it('marks all notification rows for this account without touching chat read watermarks', async () => {
    const response = await POST(request('', { all: true }));
    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ data: { readAt: expect.any(Date) as Date }, where: { userId: staff.userId, readAt: null } });
    expect(mocks.chatSummary).not.toHaveBeenCalled();
  });

  it.each([{ ids: [] }, { all: false }, { all: true, userId: 'someone-else' }, { ids: ['one'], badgeCount: 0 }])('rejects invalid or forged read action %j', async (body) => {
    expect((await POST(request('', body))).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns generic failure rather than treating a failed read acknowledgement as success', async () => {
    const failure = new Error('Private database failure');
    mocks.update.mockRejectedValue(failure);
    const response = await POST(request('', { all: true }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(failure.message);
    expect(mocks.capture).toHaveBeenCalledWith(failure, expect.any(Object));
  });

  it('does not expose team chat counts to a driver', async () => {
    mocks.authenticate.mockResolvedValue({ ...staff, app: 'driver', role: 'DRIVER' });
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ unreadCount: 2, badgeCount: 2 });
    expect(mocks.chatSummary).not.toHaveBeenCalled();
  });
});

describe('single notification badge authority', () => {
  it('includes only unread customer chat in unexpired conversations for admin badges', async () => {
    const now = new Date('2026-11-03T15:00:00.000Z');
    mocks.chatSummary.mockResolvedValue([{ count: 4n, latestCustomerSequence: '50' }]);
    expect(await readNotificationCounts('admin-one', true, now)).toEqual({ unreadCount: 2, badgeCount: 6 });
    const query = mocks.chatSummary.mock.calls[0];
    expect(query).toBeDefined();
    const sql = (query?.[0] as TemplateStringsArray).join('?');
    expect(sql).toContain('m."sequence" > c."adminReadSequence"');
    expect(sql).toContain('m."sender" = \'CUSTOMER\'');
    expect(sql).toContain('c."expiresAt" > ?');
    expect(query?.[1]).toEqual(now);
  });

  it('sets zero when every notification and customer message was read', async () => {
    mocks.count.mockResolvedValue(0);
    expect(await readNotificationCounts('admin-one', true)).toEqual({ unreadCount: 0, badgeCount: 0 });
  });
});
