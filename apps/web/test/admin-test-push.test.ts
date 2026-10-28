import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ devices: vi.fn(), create: vi.fn(), process: vi.fn(), accepted: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: {
  pushDevice: { count: mocks.devices }, outboxEvent: { create: mocks.create }, pushTicket: { count: mocks.accepted },
} }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxEventNow: mocks.process }));
import { sendAdminTestPush } from '../src/server/admin/test-push';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.devices.mockResolvedValue(1);
  mocks.create.mockResolvedValue({ id: 'test-event' });
  mocks.process.mockResolvedValue({ done: 1, failed: 0 });
  mocks.accepted.mockResolvedValue(1);
});

describe('test notification reports actual submission outcome with isolated database mocks', () => {
  it('requires an enabled device belonging to the active admin and reports queued only after acceptance', async () => {
    await expect(sendAdminTestPush({ userId: 'admin-unit' })).resolves.toEqual({ id: 'test-event', ok: true, queued: true });
    expect(mocks.devices).toHaveBeenCalledExactlyOnceWith({ where: {
      app: 'ADMIN', enabled: true, userId: 'admin-unit', user: { status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } },
    } });
    const payload: unknown = expect.objectContaining({ userId: 'admin-unit', sound: 'new-job.wav', data: { eventType: 'admin.test_push', type: 'NEW_BOOKING' } });
    const data: unknown = expect.objectContaining({ type: 'push.send', payload });
    expect(mocks.create).toHaveBeenCalledWith({ select: { id: true }, data });
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith('test-event');
    expect(mocks.accepted).toHaveBeenCalledExactlyOnceWith({ where: { outboxEventId: 'test-event', status: 'ok' } });
  });

  it('does not create work or announce success without an enabled recipient', async () => {
    mocks.devices.mockResolvedValue(0);
    await expect(sendAdminTestPush({ userId: 'admin-unit' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it.each([{ done: 0, failed: 1 }, { done: 0, failed: 0 }])('does not hide a provider/worker failure: %j', async (result) => {
    mocks.process.mockResolvedValue(result);
    await expect(sendAdminTestPush({ userId: 'admin-unit' })).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', details: { eventId: 'test-event' } });
    expect(mocks.accepted).not.toHaveBeenCalled();
  });

  it('rejects zero successful tickets even if the worker completed after disabling the phone', async () => {
    mocks.accepted.mockResolvedValue(0);
    await expect(sendAdminTestPush({ userId: 'admin-unit' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
