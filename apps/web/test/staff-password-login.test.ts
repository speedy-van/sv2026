import { AppError, AuthTokenResponseSchema, BrowserAuthTokenResponseSchema, PasswordLoginRequestSchema } from '@sv/contracts';
import { decodeJwt } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  accountLimit: vi.fn(),
  enqueueOutbox: vi.fn(),
  ipLimit: vi.fn(),
  otpFindFirst: vi.fn(),
  otpFindMany: vi.fn(),
  otpUpdate: vi.fn(),
  sessionCreate: vi.fn(),
  transaction: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  userUpdateMany: vi.fn(),
  verifyStaffPassword: vi.fn(),
}));

vi.mock('@sv/db', () => ({
  enqueueOutbox: mocks.enqueueOutbox,
  prisma: {
    $transaction: mocks.transaction,
    authOtp: { findFirst: mocks.otpFindFirst, findMany: mocks.otpFindMany, update: mocks.otpUpdate },
    session: { create: mocks.sessionCreate },
    user: { findUnique: mocks.userFindUnique, update: mocks.userUpdate, updateMany: mocks.userUpdateMany },
  },
}));
vi.mock('../src/server/auth/password', () => ({ verifyStaffPassword: mocks.verifyStaffPassword }));
vi.mock('../src/server/env', () => ({ serverEnv: () => ({ JWT_ACCESS_SECRET: 'unit-test-signing-key-with-no-external-access', OTP_PEPPER: 'unit-test-otp-pepper' }) }));
vi.mock('../src/server/settings', () => ({ getPublicSettings: vi.fn() }));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.ipLimit, enforcePasswordAccountRateLimit: mocks.accountLimit }));

import { loginStaffPassword, verifyStaffOtp } from '../src/server/auth/staff';
import { POST } from '../src/app/api/v1/auth/password/login/route';

const tx = { session: { create: mocks.sessionCreate }, user: { updateMany: mocks.userUpdateMany } };
const input = PasswordLoginRequestSchema.parse({
  app: 'admin',
  device: { appVersion: '1.0.0', deviceId: 'password-test-device', deviceName: 'Unit test browser', platform: 'web' },
  email: 'staff@example.test',
  password: randomBytes(24).toString('base64url'),
});
const staff = {
  email: input.email,
  id: 'staff-password-test',
  name: 'Unit test staff',
  passwordHash: 'stored-unit-test-hash',
  role: 'ADMIN',
  status: 'ACTIVE',
};

function request(body: unknown = input): Request {
  return new Request('http://localhost/api/v1/auth/password/login', {
    body: JSON.stringify(body),
    headers: { origin: 'http://localhost', 'content-type': 'application/json', 'x-request-id': 'req_password-unit-test' },
    method: 'POST',
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.userFindUnique.mockResolvedValue(staff);
  mocks.verifyStaffPassword.mockResolvedValue(true);
  mocks.userUpdateMany.mockResolvedValue({ count: 1 });
  mocks.sessionCreate.mockResolvedValue({ id: 'session-password-test' });
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
});

describe('staff password login service', () => {
  it.each([
    ['ADMIN', 'admin'],
    ['OWNER', 'admin'],
    ['DRIVER', 'driver'],
  ] as const)('issues existing session token response for %s in %s app', async (role, app) => {
    mocks.userFindUnique.mockResolvedValue({ ...staff, role });
    const response = AuthTokenResponseSchema.parse(await loginStaffPassword({ ...input, app }));
    expect(response.user).toEqual({ email: input.email, id: staff.id, name: staff.name, role, status: 'ACTIVE' });
    expect(decodeJwt(response.accessToken)).toMatchObject({ app, role, sid: 'session-password-test', sub: staff.id });
    expect(mocks.verifyStaffPassword).toHaveBeenCalledExactlyOnceWith(input.password, staff.passwordHash);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.sessionCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { app: app.toUpperCase(), deviceId: input.device.deviceId, deviceName: input.device.deviceName, platform: 'WEB', userId: staff.id },
    });
    expect(mocks.sessionCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { refreshTokenHash: createHash('sha256').update(response.refreshToken).digest('hex') },
    });
    expect(JSON.stringify(response)).not.toContain(staff.passwordHash);
    expect(JSON.stringify(response)).not.toContain(input.password);
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android', 'web'] as const)('preserves %s session platform correctly', async (platform) => {
    await loginStaffPassword({ ...input, device: { ...input.device, platform } });
    expect(mocks.sessionCreate.mock.calls[0]?.[0]).toMatchObject({ data: { platform: platform.toUpperCase() } });
  });

  it('activates an invited account only after password verification in the same transaction as session creation', async () => {
    mocks.userFindUnique.mockResolvedValue({ ...staff, status: 'INVITED' });
    expect((await loginStaffPassword(input)).user.status).toBe('ACTIVE');
    expect(mocks.userUpdateMany.mock.calls[0]?.[0]).toMatchObject({
      data: { status: 'ACTIVE' },
      where: { id: staff.id, passwordHash: staff.passwordHash, role: staff.role, status: 'INVITED' },
    });
    expect(mocks.verifyStaffPassword.mock.invocationCallOrder[0]).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0] ?? Infinity);
  });

  it.each([
    null,
    { ...staff, passwordHash: null },
    { ...staff, status: 'DISABLED' },
    { ...staff, role: 'DRIVER' },
  ])('returns the same generic error without creating sessions for an ineligible account', async (user) => {
    mocks.userFindUnique.mockResolvedValue(user);
    mocks.verifyStaffPassword.mockResolvedValue(user !== null && user.passwordHash !== null);
    await expect(loginStaffPassword(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid email or password.' });
    expect(mocks.verifyStaffPassword).toHaveBeenCalledExactlyOnceWith(input.password, user?.passwordHash ?? null);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled();
  });

  it.each(['ADMIN', 'OWNER'] as const)('prevents %s passwords from signing in to the driver app', async (role) => {
    mocks.userFindUnique.mockResolvedValue({ ...staff, role });
    await expect(loginStaffPassword({ ...input, app: 'driver' })).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid email or password.' });
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a wrong password without changing login time or creating a session', async () => {
    mocks.verifyStaffPassword.mockResolvedValue(false);
    await expect(loginStaffPassword(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid email or password.' });
    expect(mocks.userUpdateMany).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('rejects changed credentials, role or account status before creating a session', async () => {
    mocks.userUpdateMany.mockResolvedValue({ count: 0 });
    await expect(loginStaffPassword(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'Invalid email or password.' });
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('retains OTP login for accounts with no password hash', async () => {
    const code = '123456';
    mocks.userFindUnique.mockResolvedValue({ ...staff, passwordHash: null });
    mocks.otpFindMany.mockResolvedValue([]);
    mocks.otpFindFirst.mockResolvedValue({
      attempts: 0,
      codeHash: createHash('sha256').update(`${input.email}:${code}:unit-test-otp-pepper`).digest('hex'),
      id: 'otp-unit-test',
    });
    const response = AuthTokenResponseSchema.parse(await verifyStaffOtp({ app: input.app, code, device: input.device, email: input.email }));
    expect(response.user.id).toBe(staff.id);
    expect(mocks.verifyStaffPassword).not.toHaveBeenCalled();
    expect(mocks.sessionCreate.mock.calls[0]?.[0]).toMatchObject({ data: { platform: 'WEB' } });
    expect(mocks.enqueueOutbox).not.toHaveBeenCalled();
  });
});

describe('password login API without external services', () => {
  it('normalizes email, enforces both limits, and returns no-store tokens with request id', async () => {
    const response = await POST(request({ ...input, email: '  STAFF@EXAMPLE.TEST  ' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe('req_password-unit-test');
    expect(BrowserAuthTokenResponseSchema.safeParse(await response.json()).success).toBe(true);
    expect(mocks.ipLimit.mock.calls[0]?.[1]).toBe('authPasswordLogin');
    expect(mocks.accountLimit).toHaveBeenCalledExactlyOnceWith(input.email);
    expect(mocks.accountLimit.mock.invocationCallOrder[0]).toBeLessThan(mocks.userFindUnique.mock.invocationCallOrder[0] ?? Infinity);
  });

  it('rejects missing password and unexpected privilege fields before authentication', async () => {
    for (const body of [{ ...input, password: '' }, { ...input, role: 'OWNER' }, { ...input, device: undefined }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
    expect(mocks.verifyStaffPassword).not.toHaveBeenCalled();
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it('returns generic unauthorized for missing accounts without exposing credentials', async () => {
    mocks.userFindUnique.mockResolvedValue(null);
    mocks.verifyStaffPassword.mockResolvedValue(false);
    const response = await POST(request());
    expect(response.status).toBe(401);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password.' } });
    expect(JSON.stringify(body)).not.toContain(input.password);
    expect(JSON.stringify(body)).not.toContain(input.email);
  });

  it.each(['ip', 'account'] as const)('stops before password work when %s rate limit is exceeded', async (limit) => {
    const limiter = limit === 'ip' ? mocks.ipLimit : mocks.accountLimit;
    limiter.mockRejectedValue(new AppError('RATE_LIMITED', 'Too many requests. Try again shortly.', { retryAfter: 3600 }));
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('3600');
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(mocks.verifyStaffPassword).not.toHaveBeenCalled();
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });
});
