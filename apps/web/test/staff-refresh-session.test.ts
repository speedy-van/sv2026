import { AuthTokenResponseSchema, RefreshRequestSchema } from '@sv/contracts';
import { decodeJwt } from 'jose';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  candidate: vi.fn(),
  enqueueOutbox: vi.fn(),
  findSession: vi.fn(),
  lock: vi.fn(),
  pushUpdate: vi.fn(),
  sessionCreate: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  transaction: vi.fn(),
  userFind: vi.fn(),
  userUpdate: vi.fn(),
  verifyPassword: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  enqueueOutbox: mocks.enqueueOutbox,
  prisma: {
    $transaction: mocks.transaction,
    session: { findFirst: mocks.candidate, findUnique: mocks.findSession },
    user: { findUnique: mocks.userFind },
  },
}));
vi.mock('../src/server/auth/password', () => ({ verifyStaffPassword: mocks.verifyPassword }));
vi.mock('../src/server/env', () => ({
  serverEnv: () => ({
    JWT_ACCESS_SECRET: 'isolated-session-test-signing-key',
    OTP_PEPPER: 'isolated-session-test-derivation-key',
  }),
}));
vi.mock('../src/server/settings', () => ({ getPublicSettings: vi.fn() }));

import {
  authenticateStaffRequest,
  issueStaffAccessResponse,
  loginStaffPassword,
  refreshStaffSession,
} from '../src/server/auth/staff';

const now = new Date('2026-10-15T12:00:00.000Z');
const token = 'isolated-original-refresh-token-0001';
const deviceId = 'isolated-native-device';
const requestId = '8fe2857e-5c14-44b8-87d8-c13be562d397';
const otherRequestId = '09d438e2-b4b9-470f-bc89-e4ba9c896204';
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
interface TestSession {
  id: string;
  userId: string;
  app: 'ADMIN' | 'DRIVER';
  platform: 'IOS' | 'ANDROID' | 'WEB';
  deviceId: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  refreshTokenHash: string;
  previousRefreshTokenHash: string | null;
  lastRefreshRequestId: string | null;
  user: {
    email: string;
    id: string;
    name: string;
    role: 'ADMIN' | 'OWNER' | 'DRIVER';
    status: 'ACTIVE' | 'DISABLED' | 'INVITED';
  };
}
let session: TestSession;
let transactionQueue: Promise<void>;
const tx = {
  $queryRaw: mocks.lock,
  session: {
    create: mocks.sessionCreate,
    findUnique: mocks.findSession,
    update: mocks.sessionUpdate,
    updateMany: mocks.sessionUpdateMany,
  },
  pushDevice: { updateMany: mocks.pushUpdate },
  user: { updateMany: mocks.userUpdate },
};
function input(overrides: Partial<Parameters<typeof refreshStaffSession>[0]> = {}) {
  return RefreshRequestSchema.parse({ deviceId, refreshToken: token, requestId, ...overrides });
}
function snapshot(): TestSession {
  return { ...session, user: { ...session.user } };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  transactionQueue = Promise.resolve();
  session = {
    id: 'session-native-test',
    userId: 'staff-native-test',
    app: 'ADMIN',
    platform: 'IOS',
    deviceId,
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    expiresAt: null,
    revokedAt: null,
    revokedReason: null,
    refreshTokenHash: hash(token),
    previousRefreshTokenHash: null,
    lastRefreshRequestId: null,
    user: {
      email: 'staff@example.test',
      id: 'staff-native-test',
      name: 'Unit test staff',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
  };
  mocks.candidate.mockResolvedValue({ id: session.id });
  mocks.findSession.mockImplementation(() => Promise.resolve(snapshot()));
  mocks.lock.mockResolvedValue([{ id: session.id }]);
  mocks.sessionUpdateMany.mockImplementation(
    (args: { data: Partial<TestSession>; where: { refreshTokenHash: string } }) => {
      if (session.refreshTokenHash !== args.where.refreshTokenHash || session.revokedAt)
        return Promise.resolve({ count: 0 });
      session = { ...session, ...args.data };
      return Promise.resolve({ count: 1 });
    },
  );
  mocks.sessionUpdate.mockImplementation((args: { data: Partial<TestSession> }) => {
    session = { ...session, ...args.data };
    return Promise.resolve(snapshot());
  });
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => {
    const result = transactionQueue.then(async () => {
      const before = snapshot();
      try {
        return await operation(tx);
      } catch (error) {
        session = before;
        throw error;
      }
    });
    transactionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  });
  mocks.userFind.mockImplementation(() =>
    Promise.resolve({ ...session.user, passwordHash: 'isolated-password-hash' }),
  );
  mocks.verifyPassword.mockResolvedValue(true);
  mocks.userUpdate.mockResolvedValue({ count: 1 });
  mocks.sessionCreate.mockResolvedValue({ id: session.id });
});
afterEach(() => vi.useRealTimers());

describe('native staff refresh sessions', () => {
  it('rotates an until-revoked admin session under a row lock and stores hashes only', async () => {
    const result = AuthTokenResponseSchema.parse(await refreshStaffSession(input()));
    expect(result.refreshToken).not.toBe(token);
    expect(session).toMatchObject({
      expiresAt: null,
      previousRefreshTokenHash: hash(token),
      refreshTokenHash: hash(result.refreshToken),
      lastRefreshRequestId: requestId,
    });
    expect(decodeJwt(result.accessToken)).toMatchObject({
      app: 'admin',
      role: 'ADMIN',
      sid: session.id,
      sub: session.userId,
      exp: now.getTime() / 1000 + 900,
    });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.findSession.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(JSON.stringify(mocks.sessionUpdateMany.mock.calls)).not.toContain(result.refreshToken);
    expect(JSON.stringify(mocks.sessionUpdateMany.mock.calls)).not.toContain(token);
  });

  it('returns the same rotation for an exact retry after a lost response without revoking or rotating again', async () => {
    const first = await refreshStaffSession(input());
    vi.setSystemTime(new Date(now.getTime() + 60_000));
    const retry = await refreshStaffSession(input());
    expect(retry.refreshToken).toBe(first.refreshToken);
    expect(decodeJwt(retry.accessToken).exp).toBe(now.getTime() / 1000 + 960);
    expect(mocks.sessionUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.sessionUpdate).not.toHaveBeenCalled();
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled();
  });

  it('serializes concurrent exact requests into one rotation and one deterministic retry', async () => {
    const results = await Promise.all([refreshStaffSession(input()), refreshStaffSession(input())]);
    expect(results[0].refreshToken).toBe(results[1].refreshToken);
    expect(mocks.sessionUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.lock).toHaveBeenCalledTimes(2);
  });

  it('commits revocation, push disable and outbox alert for reuse with a different request ID', async () => {
    await refreshStaffSession(input());
    await expect(refreshStaffSession(input({ requestId: otherRequestId }))).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(session.revokedReason).toBe('refresh-token-reuse');
    expect(session.revokedAt).toEqual(now);
    expect(mocks.pushUpdate).toHaveBeenCalledExactlyOnceWith({
      data: { enabled: false, lastError: 'session-revoked' },
      where: { sessionId: session.id },
    });
    expect(mocks.enqueueOutbox).toHaveBeenCalledOnce();
  });

  it('preserves legacy rotation but still revokes legacy previous-token reuse without a retry ID', async () => {
    const legacy = RefreshRequestSchema.parse({ deviceId, refreshToken: token });
    const response = await refreshStaffSession(legacy);
    expect(response.refreshToken).not.toBe(token);
    expect(session.lastRefreshRequestId).toBeNull();
    await expect(refreshStaffSession(legacy)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(session.revokedReason).toBe('refresh-token-reuse');
  });

  it.each([
    [
      'wrong device',
      (record: TestSession) => {
        record.deviceId = 'another-device';
      },
    ],
    [
      'disabled staff',
      (record: TestSession) => {
        record.user.status = 'DISABLED';
      },
    ],
    [
      'invited staff',
      (record: TestSession) => {
        record.user.status = 'INVITED';
      },
    ],
    [
      'role changed',
      (record: TestSession) => {
        record.user.role = 'DRIVER';
      },
    ],
    [
      'revoked session',
      (record: TestSession) => {
        record.revokedAt = now;
      },
    ],
    [
      'expired legacy admin',
      (record: TestSession) => {
        record.expiresAt = now;
      },
    ],
    [
      'browser session',
      (record: TestSession) => {
        record.platform = 'WEB';
      },
    ],
  ] as const)('rejects %s before returning an exact previous-token retry', async (_name, alter) => {
    await refreshStaffSession(input());
    alter(session);
    const before = snapshot();
    await expect(refreshStaffSession(input())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(session).toEqual(before);
    expect(mocks.sessionUpdate).not.toHaveBeenCalled();
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled();
  });

  it('upgrades a valid finite admin session but never revives an expired one', async () => {
    session.expiresAt = new Date(now.getTime() + 60_000);
    await refreshStaffSession(input());
    expect(session.expiresAt).toBeNull();
    session.expiresAt = new Date(now.getTime() - 1);
    await expect(refreshStaffSession(input())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(session.expiresAt).toEqual(new Date(now.getTime() - 1));
  });

  it.each(['null expiry', 'absolute expiry'] as const)(
    'fails closed for a driver with %s',
    async (reason) => {
      session.app = 'DRIVER';
      session.user.role = 'DRIVER';
      session.createdAt = reason === 'absolute expiry' ? new Date('2026-07-01T12:00:00.000Z') : now;
      session.expiresAt = reason === 'null expiry' ? null : new Date(now.getTime() + 86_400_000);
      await expect(refreshStaffSession(input())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      expect(mocks.sessionUpdateMany).not.toHaveBeenCalled();
    },
  );

  it.each([
    [10, 30],
    [80, 10],
  ])('retains driver sliding30/absolute90 days at account age %s', async (age, remaining) => {
    session.app = 'DRIVER';
    session.user.role = 'DRIVER';
    session.createdAt = new Date(now.getTime() - age * 86_400_000);
    session.expiresAt = new Date(now.getTime() + 86_400_000);
    const result = await refreshStaffSession(input());
    expect(session.expiresAt).toEqual(new Date(now.getTime() + remaining * 86_400_000));
    expect(decodeJwt(result.accessToken)).toMatchObject({ app: 'driver', role: 'DRIVER' });
  });

  it('does not issue credentials if the conditional rotation loses its authorization predicate', async () => {
    mocks.sessionUpdateMany.mockResolvedValue({ count: 0 });
    await expect(refreshStaffSession(input())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(session.refreshTokenHash).toBe(hash(token));
  });

  it('rejects a missing session and validates UUID retry IDs', async () => {
    mocks.candidate.mockResolvedValue(null);
    await expect(refreshStaffSession(input())).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(
      RefreshRequestSchema.safeParse({ deviceId, refreshToken: token, requestId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});

describe('staff session creation and bearer authorization', () => {
  it.each(['admin', 'driver'] as const)(
    'creates %s with the correct expiry policy and a short access JWT',
    async (app) => {
      session.user.role = app === 'admin' ? 'ADMIN' : 'DRIVER';
      const result = await loginStaffPassword({
        app,
        email: session.user.email,
        password: 'synthetic-unit-test-password',
        device: { appVersion: '1.0.0', deviceId, deviceName: 'Isolated test device', platform: 'ios' },
      });
      const args = mocks.sessionCreate.mock.calls[0]?.[0] as { data: { expiresAt: Date | null } };
      expect(args.data.expiresAt).toEqual(app === 'admin' ? null : new Date(now.getTime() + 30 * 86_400_000));
      expect(decodeJwt(result.accessToken).exp).toBe(now.getTime() / 1000 + 900);
    },
  );

  it('accepts a valid until-revoked admin bearer session', async () => {
    const signed = await issueStaffAccessResponse(session.user, session.id, 'admin');
    const result = await authenticateStaffRequest(
      new Request('https://example.test/api/v1/me', {
        headers: { authorization: `Bearer ${signed.accessToken}` },
      }),
      { app: 'admin', roles: ['ADMIN', 'OWNER'] },
    );
    expect(result).toEqual({ app: 'admin', role: 'ADMIN', sessionId: session.id, userId: session.userId });
  });

  it.each([
    [
      'null driver expiry',
      (record: TestSession) => {
        record.app = 'DRIVER';
        record.user.role = 'DRIVER';
      },
    ],
    [
      'expired admin',
      (record: TestSession) => {
        record.expiresAt = now;
      },
    ],
    [
      'revoked admin',
      (record: TestSession) => {
        record.revokedAt = now;
      },
    ],
    [
      'disabled admin',
      (record: TestSession) => {
        record.user.status = 'DISABLED';
      },
    ],
    [
      'wrong stored app',
      (record: TestSession) => {
        record.app = 'DRIVER';
      },
    ],
  ] as const)('denies bearer authorization for %s', async (_name, alter) => {
    const signed = await issueStaffAccessResponse(session.user, session.id, 'admin');
    alter(session);
    await expect(
      authenticateStaffRequest(
        new Request('https://example.test/api/v1/me', {
          headers: { authorization: `Bearer ${signed.accessToken}` },
        }),
        {},
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
