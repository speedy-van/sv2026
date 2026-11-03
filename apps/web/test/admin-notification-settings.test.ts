import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ list: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn() }));
vi.mock('@sv/db', () => {
  const db = { pushDevice: { findMany: mocks.list, findFirst: mocks.find, update: mocks.update }, auditLog: { create: mocks.audit } };
  return { prisma: { ...db, $transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db) } };
});
import { readAdminNotificationSettings, updateAdminNotificationSettings } from '../src/server/admin/notification-settings';
const staff = { app: 'admin', role: 'ADMIN', userId: 'admin-one', sessionId: 'session-one' } as const;
beforeEach(() => vi.resetAllMocks());
describe('notification device preferences stay within the authenticated account', () => {
  it('exposes current-device state and receipt metadata without tokens or session ids', async () => {
    const at = new Date('2031-01-01T12:00:00Z');
    mocks.list.mockResolvedValue([{ id: 'my-phone', platform: 'IOS', enabled: true, sessionId: 'session-one', session: { deviceName: 'iPhone' }, pendingBookingAlerts: false, lastRegisteredAt: at, lastError: null, tickets: [{ status: 'ok', createdAt: at, checkedAt: null, error: null }] }]);
    const result = await readAdminNotificationSettings(staff);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ where: { app: 'ADMIN', userId: staff.userId } }));
    expect(result.devices[0]).toMatchObject({ currentSession: true, pendingBookingAlerts: false, latestTicket: { status: 'ok', checkedAt: null } });
    expect(result.devices[0]).not.toHaveProperty('sessionId'); expect(result.devices[0]).not.toHaveProperty('expoPushToken');
  });
  it('rejects an unknown or other-account device without a write or audit', async () => {
    mocks.find.mockResolvedValue(null);
    await expect(updateAdminNotificationSettings(staff, { deviceId: 'someone-else', pendingBookingAlerts: true }, 'request-one')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.find).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'someone-else', userId: staff.userId, app: 'ADMIN' } }));
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('records a real opt-in change and its previous value in one transaction', async () => {
    mocks.find.mockResolvedValue({ pendingBookingAlerts: false });
    await expect(updateAdminNotificationSettings(staff, { deviceId: 'my-phone', pendingBookingAlerts: true }, 'request-one')).resolves.toEqual({ ok: true });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'my-phone' }, data: { pendingBookingAlerts: true } });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorUserId: 'admin-one', before: { pendingBookingAlerts: false }, after: { pendingBookingAlerts: true } }) as unknown }));
  });
});
