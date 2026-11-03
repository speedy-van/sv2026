import { AuthTokenResponseSchema, DriverCreateSchema } from '@sv/contracts';
import { decodeJwt } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(), capture: vi.fn(), enqueue: vi.fn(), sessionCreate: vi.fn(),
  settingFind: vi.fn(), transaction: vi.fn(), userCreate: vi.fn(), userFind: vi.fn(), userUpdate: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  Prisma: { JsonNull: null }, enqueueOutbox: mocks.enqueue,
  prisma: { $transaction: mocks.transaction, user: { findUnique: mocks.userFind } },
}));
vi.mock('@sentry/nextjs', () => ({ captureException: mocks.capture }));
vi.mock('../src/server/env', () => ({ serverEnv: () => ({ JWT_ACCESS_SECRET: 'driver-account-test-signing-key' }) }));
vi.mock('../src/server/settings', () => ({ getPublicSettings: vi.fn() }));

import { createDriverAccount } from '../src/server/admin/driver-account';
import { loginStaffPassword } from '../src/server/auth/staff';
import { verifyStaffPassword } from '../src/server/auth/password';

const input = DriverCreateSchema.parse({ email: 'DRIVER@EXAMPLE.TEST', password: ' Driver passphrase 123! ', phone: '07465 227962' });
const actor = { userId: 'administrator-unit', requestId: 'request-driver-create-unit' };
const device = { appVersion: '1.0.0', deviceId: 'driver-device-unit', deviceName: 'Driver phone', platform: 'ios' as const };
interface StoredUser {
  id: string; email: string; name: string; phone: string; passwordHash: string;
  role: 'DRIVER'; status: 'ACTIVE'; driver: { create: { payoutPercent: null } };
}
let stored: StoredUser | null = null;
const tx = {
  auditLog: { create: mocks.auditCreate }, setting: { findUnique: mocks.settingFind },
  session: { create: mocks.sessionCreate },
  user: { create: mocks.userCreate, findUnique: mocks.userFind, updateMany: mocks.userUpdate },
};

beforeEach(() => {
  vi.resetAllMocks();
  stored = null;
  mocks.userFind.mockImplementation(() => Promise.resolve(stored));
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
  mocks.userCreate.mockImplementation((args: { data: Omit<StoredUser, 'id'> }) => {
    stored = { ...args.data, id: 'driver-unit' };
    return Promise.resolve({ id: 'driver-unit' });
  });
  mocks.userUpdate.mockResolvedValue({ count: 1 });
  mocks.sessionCreate.mockResolvedValue({ id: 'driver-session-unit' });
});

describe('direct driver account creation with the existing password implementation', () => {
  it('persists a real versioned hash without a percentage atomically, exposing no credentials or contacts in audit/response', async () => {
    const response = await createDriverAccount(input, actor);
    expect(response).toEqual({ id: 'driver-unit', ok: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.userCreate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        email: input.email, phone: input.phone, name: input.email, role: 'DRIVER', status: 'ACTIVE',
        driver: { create: { payoutPercent: null } },
      }, select: { id: true },
    });
    const hash = stored?.passwordHash ?? null;
    expect(hash).toMatch(/^scrypt\$v1\$/u);
    expect(await verifyStaffPassword(input.password, hash)).toBe(true);
    expect(await verifyStaffPassword(input.password.trim(), hash)).toBe(false);
    expect(hash).not.toContain(input.password);
    expect(mocks.auditCreate).toHaveBeenCalledExactlyOnceWith({ data: {
      action: 'admin.drivers.create', actorType: 'USER', actorUserId: actor.userId,
      entityType: 'driver', entityId: 'driver-unit', requestId: actor.requestId,
      before: null, after: { role: 'DRIVER', status: 'ACTIVE', payoutPercent: null },
    } });
    const publicData = JSON.stringify([response, mocks.auditCreate.mock.calls]);
    for (const privateValue of [input.email, input.phone, input.password, hash]) {
      if (privateValue) expect(publicData).not.toContain(privateValue);
    }
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.settingFind).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('signs the new driver into the driver app with the exact admin-set password and preserves the admin role barrier', async () => {
    await createDriverAccount(input, actor);
    const response = AuthTokenResponseSchema.parse(await loginStaffPassword({ ...input, app: 'driver', device }));
    expect(response.user).toMatchObject({ id: 'driver-unit', role: 'DRIVER', status: 'ACTIVE' });
    expect(decodeJwt(response.accessToken)).toMatchObject({ app: 'driver', role: 'DRIVER', sub: 'driver-unit' });
    expect(mocks.sessionCreate.mock.calls[0]?.[0]).toMatchObject({ data: { app: 'DRIVER', platform: 'IOS', deviceId: device.deviceId } });
    const sessionsBeforeFailure = mocks.sessionCreate.mock.calls.length;
    await expect(loginStaffPassword({ ...input, password: 'The wrong password!', app: 'driver', device })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(loginStaffPassword({ ...input, app: 'admin', device })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.sessionCreate).toHaveBeenCalledTimes(sessionsBeforeFailure);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('uses an optional supplied name rather than inventing one', async () => {
    await createDriverAccount({ ...input, name: 'Real Driver Name' }, actor);
    expect(stored?.name).toBe('Real Driver Name');
  });

  it.each(['OWNER', 'ADMIN', 'DRIVER'] as const)('rejects an existing %s email without changing its profile or password', async (role) => {
    mocks.userFind.mockResolvedValue({ id: 'existing-account', role, status: 'DISABLED' });
    await expect(createDriverAccount(input, actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.userCreate).not.toHaveBeenCalled();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('maps a concurrent email uniqueness conflict without retrying or replacing an account', async () => {
    mocks.userCreate.mockRejectedValue({ code: 'P2002' });
    await expect(createDriverAccount(input, actor)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.userCreate).toHaveBeenCalledOnce();
    expect(mocks.userUpdate).not.toHaveBeenCalled();
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it('ignores even an existing percentage default because the owner agrees each new driver payment by phone', async () => {
    mocks.settingFind.mockResolvedValue({ value: { defaultPayoutPercent: 43 } });
    await createDriverAccount(input, actor);
    expect(mocks.settingFind).not.toHaveBeenCalled();
    expect(stored?.driver.create.payoutPercent).toBeNull();
  });

  it('propagates an audit failure so the database transaction cannot commit a partially recorded creation', async () => {
    const failure = new Error('Audit storage failed');
    mocks.auditCreate.mockRejectedValue(failure);
    await expect(createDriverAccount(input, actor)).rejects.toBe(failure);
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(new Error('Driver account creation failed.'), { tags: { component: 'driver-account-create' } });
  });
});
