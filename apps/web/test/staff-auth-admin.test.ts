import { AppError } from '@sv/contracts';
import { prisma } from '@sv/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTE_DEFINITIONS, handleAdminRoute, type AdminMethod } from '../src/server/admin/routes';
import { refreshStaffSession, requestStaffOtp, verifyStaffOtp, type StaffApp, type StaffRole } from '../src/server/auth/staff';

const emailPrefix = 'phase12-';
const ownerEmail = `${emailPrefix}owner@example.test`;
const adminEmail = `${emailPrefix}admin@example.test`;
const driverEmail = `${emailPrefix}driver@example.test`;

function device(deviceId: string) {
  return {
    appVersion: '1.0.0',
    deviceId,
    deviceName: 'Vitest',
    platform: 'ios' as const,
  };
}

async function cleanup(): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { requestId: { startsWith: 'req_phase12' } } });
  await prisma.pushDevice.deleteMany({ where: { user: { email: { startsWith: emailPrefix } } } });
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: emailPrefix } } } });
  await prisma.authOtp.deleteMany({ where: { email: { startsWith: emailPrefix } } });
  await prisma.outboxEvent.deleteMany({ where: { dedupeKey: { startsWith: 'staff-login-code:phase12-' } } });
  await prisma.outboxEvent.deleteMany({ where: { dedupeKey: { startsWith: 'refresh-reuse-alert:' } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } });
}

async function upsertUser(email: string, role: StaffRole): Promise<void> {
  await prisma.user.upsert({
    create: { email, name: `${role} Test`, role, status: 'ACTIVE' },
    update: { role, status: 'ACTIVE' },
    where: { email },
  });
}

async function latestOtpCode(email: string, app: StaffApp): Promise<string> {
  const event = await prisma.outboxEvent.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { payload: true },
    where: { dedupeKey: { startsWith: `staff-login-code:${email}:${app}:` } },
  });
  const payload = event?.payload;
  if (!payload || typeof payload !== 'object' || !('data' in payload)) throw new Error('Missing OTP email payload.');
  const data = payload.data;
  if (!data || typeof data !== 'object' || !('signInCode' in data) || typeof data.signInCode !== 'string') {
    throw new Error('Missing OTP code in email payload.');
  }
  return data.signInCode;
}

async function tokenFor(email: string, app: StaffApp, deviceId: string): Promise<string> {
  await requestStaffOtp({ app, email });
  const code = await latestOtpCode(email, app);
  const response = await verifyStaffOtp({ app, code, device: device(deviceId), email });
  return response.accessToken;
}

function samplePath(pattern: string): string {
  return pattern
    .replaceAll(':id', 'id_phase12')
    .replaceAll(':key', 'company')
    .replaceAll(':slug', 'glasgow');
}

function requestFor(method: AdminMethod, path: string, token?: string): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    'x-request-id': `req_phase12_${method.toLowerCase()}_${path.replace(/[^a-z0-9]/gi, '_')}`,
    'x-sv-app': 'admin@1.0.0',
  });
  if (token) headers.set('authorization', `Bearer ${token}`);
  const needsBody = method !== 'GET';
  const init: RequestInit = {
    headers,
    method,
  };
  if (needsBody) init.body = '{}';
  return new Request(`http://localhost/api/v1/admin/${path}`, init);
}

beforeAll(async () => {
  process.env.JWT_ACCESS_SECRET = 'phase12-test-jwt-access-secret';
  process.env.OTP_PEPPER = 'phase12-test-otp-pepper';
  process.env.MIN_ADMIN_APP_VERSION = '1.0.0';
  process.env.MIN_DRIVER_APP_VERSION = '1.0.0';
  await cleanup();
  await upsertUser(ownerEmail, 'OWNER');
  await upsertUser(adminEmail, 'ADMIN');
  await upsertUser(driverEmail, 'DRIVER');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Phase 12 staff auth and admin API', () => {
  it('rejects anonymous and DRIVER access for every admin route', async () => {
    const driverToken = await tokenFor(driverEmail, 'driver', 'driver-device-admin-reject');
    for (const definition of ADMIN_ROUTE_DEFINITIONS) {
      const path = samplePath(definition.pattern);
      const anonymous = await handleAdminRoute(requestFor(definition.method, path), definition.method, path);
      expect(anonymous.status, `${definition.method} ${definition.pattern} anonymous`).toBe(401);

      const driver = await handleAdminRoute(requestFor(definition.method, path, driverToken), definition.method, path);
      expect(driver.status, `${definition.method} ${definition.pattern} driver`).toBe(403);
    }
  }, 30_000);

  it('audits a test-push attempt while reporting that the account has no registered phone', async () => {
    const ownerToken = await tokenFor(ownerEmail, 'admin', 'owner-device-audit');
    const response = await handleAdminRoute(requestFor('POST', 'test-push', ownerToken), 'POST', 'test-push');
    expect(response.status).toBe(409);
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'admin.test_push', actor: { email: ownerEmail } },
    });
    expect(audit).toMatchObject({ actorType: 'USER', entityType: 'pushDevice' });
  });

  it('refresh token reuse revokes the session', async () => {
    const email = adminEmail;
    await requestStaffOtp({ app: 'admin', email });
    const code = await latestOtpCode(email, 'admin');
    const initial = await verifyStaffOtp({ app: 'admin', code, device: device('admin-device-refresh'), email });
    await refreshStaffSession({ deviceId: 'admin-device-refresh', refreshToken: initial.refreshToken });
    await expect(refreshStaffSession({ deviceId: 'admin-device-refresh', refreshToken: initial.refreshToken })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    const session = await prisma.session.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { deviceId: 'admin-device-refresh', user: { email } },
    });
    expect(session?.revokedReason).toBe('refresh-token-reuse');
    expect(session?.revokedAt).toBeInstanceOf(Date);
  });

  it('locks OTP verification after ten failures per email in an hour', async () => {
    const email = `${emailPrefix}lockout@example.test`;
    await upsertUser(email, 'ADMIN');
    for (const attemptSet of [1, 2]) {
      await requestStaffOtp({ app: 'admin', email });
      for (let index = 0; index < 5; index += 1) {
        const attemptSetLabel = String(attemptSet);
        const indexLabel = String(index);
        await expect(verifyStaffOtp({ app: 'admin', code: `${attemptSetLabel}${indexLabel.padStart(5, '0')}`, device: device(`lockout-${attemptSetLabel}-${indexLabel}`), email })).rejects.toBeInstanceOf(AppError);
      }
    }
    await requestStaffOtp({ app: 'admin', email });
    const validCode = await latestOtpCode(email, 'admin');
    await expect(verifyStaffOtp({ app: 'admin', code: validCode, device: device('lockout-valid'), email })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});
