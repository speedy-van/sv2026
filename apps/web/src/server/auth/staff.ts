import 'server-only';

import {
  AppError,
  type DeviceSchema,
  type OtpRequestSchema,
  type OtpVerifySchema,
  type PasswordLoginRequestSchema,
  type RefreshRequestSchema,
  type MeResponseSchema,
  type StaffRoleSchema,
} from '@sv/contracts';
import { enqueueOutbox, prisma, type DbTx, type Prisma } from '@sv/db';
import { jwtVerify, SignJWT } from 'jose';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { serverEnv } from '../env';
import { getPublicSettings } from '../settings';
import { verifyStaffPassword } from './password';

export type StaffRole = z.infer<typeof StaffRoleSchema>;
export type StaffApp = 'admin' | 'driver';
export interface StaffAccessUser {
  email: string;
  id: string;
  name: string;
  role: StaffRole;
  status: 'ACTIVE' | 'DISABLED' | 'INVITED';
}

type DbApp = 'ADMIN' | 'DRIVER';
type DbPlatform = 'IOS' | 'ANDROID' | 'WEB';

export interface StaffAuthOptions {
  app?: StaffApp;
  roles?: readonly StaffRole[];
}

export interface StaffContext {
  app: StaffApp;
  role: StaffRole;
  sessionId: string;
  userId: string;
}

interface StaffClaims {
  app: StaffApp;
  role: StaffRole;
  sessionId: string;
  userId: string;
  ver: 1;
}

const ACCESS_TOKEN_MINUTES = 15;
const OTP_MINUTES = 10;
const REFRESH_DAYS = 30;
const REFRESH_ABSOLUTE_DAYS = 90;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function secret(name: 'JWT_ACCESS_SECRET' | 'OTP_PEPPER'): string {
  const env = serverEnv();
  const value = name === 'JWT_ACCESS_SECRET' ? env.JWT_ACCESS_SECRET : env.OTP_PEPPER;
  if (value) return value;
  if (process.env.NODE_ENV === 'production') throw new AppError('INTERNAL', `${name} is required.`);
  return name === 'JWT_ACCESS_SECRET'
    ? 'local-development-jwt-access-secret'
    : 'local-development-otp-pepper';
}

function accessKey(): Uint8Array {
  return new TextEncoder().encode(secret('JWT_ACCESS_SECRET'));
}

function otpHash(email: string, code: string): string {
  return sha256(`${email.toLowerCase()}:${code}:${secret('OTP_PEPPER')}`);
}

function refreshHash(token: string): string {
  return sha256(token);
}

function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

function appToDb(app: StaffApp): DbApp {
  return app === 'admin' ? 'ADMIN' : 'DRIVER';
}

function dbToApp(app: DbApp): StaffApp {
  return app === 'ADMIN' ? 'admin' : 'driver';
}

function devicePlatform(platform: z.infer<typeof DeviceSchema>['platform']): DbPlatform {
  return platform === 'web' ? 'WEB' : platform === 'android' ? 'ANDROID' : 'IOS';
}

function allowedRoleForApp(role: StaffRole, app: StaffApp): boolean {
  if (app === 'admin') return role === 'OWNER' || role === 'ADMIN';
  return role === 'DRIVER';
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function parseAppHeader(value: string | null): { app: StaffApp; version: string } | null {
  if (!value) return null;
  const match = /^(admin|driver)@([0-9]+(?:\.[0-9]+){0,2})$/i.exec(value.trim());
  if (!match) return null;
  const app = match[1]?.toLowerCase();
  const version = match[2];
  if ((app !== 'admin' && app !== 'driver') || !version) return null;
  return { app, version };
}

function compareVersion(left: string, right: string): number {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10));
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function assertMinimumAppVersion(request: Request, tokenApp: StaffApp): void {
  const parsed = parseAppHeader(request.headers.get('x-sv-app'));
  if (!parsed) return;
  if (parsed.app !== tokenApp) throw new AppError('FORBIDDEN', 'This token is for another app.');
  const env = serverEnv();
  const minimum = tokenApp === 'admin' ? env.MIN_ADMIN_APP_VERSION : env.MIN_DRIVER_APP_VERSION;
  if (minimum && compareVersion(parsed.version, minimum) < 0) {
    throw new AppError('APP_UPDATE_REQUIRED', 'Update required before continuing.', {
      minimumVersion: minimum,
    });
  }
}

async function signAccessToken(
  claims: StaffClaims,
): Promise<{ accessExpiresAt: string; accessToken: string }> {
  const expiresAt = addMinutes(new Date(), ACCESS_TOKEN_MINUTES);
  const accessToken = await new SignJWT({ app: claims.app, role: claims.role, sid: claims.sessionId, ver: 1 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(accessKey());
  return { accessExpiresAt: expiresAt.toISOString(), accessToken };
}

function mapUser(user: {
  email: string;
  id: string;
  name: string;
  role: StaffRole;
  status: 'ACTIVE' | 'DISABLED' | 'INVITED';
}) {
  return {
    email: user.email,
    id: user.id,
    name: user.name,
    role: user.role,
    status: user.status,
  };
}

async function issueTokenResponse(
  user: {
    email: string;
    id: string;
    name: string;
    role: StaffRole;
    status: 'ACTIVE' | 'DISABLED' | 'INVITED';
  },
  sessionId: string,
  app: StaffApp,
  refreshToken: string,
): Promise<{
  accessExpiresAt: string;
  accessToken: string;
  refreshToken: string;
  user: ReturnType<typeof mapUser>;
}> {
  const signed = await issueStaffAccessResponse(user, sessionId, app);
  return {
    ...signed,
    refreshToken,
  };
}

export async function issueStaffAccessResponse(
  user: StaffAccessUser,
  sessionId: string,
  app: StaffApp,
): Promise<{
  accessExpiresAt: string;
  accessToken: string;
  user: ReturnType<typeof mapUser>;
}> {
  const signed = await signAccessToken({ app, role: user.role, sessionId, userId: user.id, ver: 1 });
  return { ...signed, user: mapUser(user) };
}

async function createSession(
  user: {
    email: string;
    id: string;
    name: string;
    role: StaffRole;
    status: 'ACTIVE' | 'DISABLED' | 'INVITED';
  },
  app: StaffApp,
  device: z.infer<typeof DeviceSchema>,
  db: Pick<DbTx, 'session'> = prisma,
): Promise<{
  accessExpiresAt: string;
  accessToken: string;
  refreshToken: string;
  user: ReturnType<typeof mapUser>;
}> {
  const refreshToken = newRefreshToken();
  const session = await db.session.create({
    data: {
      app: appToDb(app),
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      platform: devicePlatform(device.platform),
      appVersion: device.appVersion,
      expiresAt: app === 'admin' ? null : addDays(new Date(), REFRESH_DAYS),
      refreshTokenHash: refreshHash(refreshToken),
      userId: user.id,
    },
    select: { id: true },
  });
  return issueTokenResponse(user, session.id, app, refreshToken);
}

export async function loginStaffPassword(input: z.infer<typeof PasswordLoginRequestSchema>): Promise<{
  accessExpiresAt: string;
  accessToken: string;
  refreshToken: string;
  user: ReturnType<typeof mapUser>;
}> {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    select: { email: true, id: true, name: true, passwordHash: true, role: true, status: true },
  });
  const validPassword = await verifyStaffPassword(input.password, user?.passwordHash ?? null);
  if (!user || !validPassword || user.status === 'DISABLED' || !allowedRoleForApp(user.role, input.app)) {
    throw new AppError('UNAUTHORIZED', 'Invalid email or password.');
  }
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.updateMany({
      where: { id: user.id, passwordHash: user.passwordHash, role: user.role, status: user.status },
      data: { lastLoginAt: now, status: 'ACTIVE' },
    });
    if (updated.count !== 1) throw new AppError('UNAUTHORIZED', 'Invalid email or password.');
    return createSession({ ...user, status: 'ACTIVE' }, input.app, input.device, tx);
  });
}

export async function requestStaffOtp(input: z.infer<typeof OtpRequestSchema>): Promise<string | null> {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { email: true, id: true, name: true, role: true, status: true },
  });
  if (!user || user.status === 'DISABLED' || !allowedRoleForApp(user.role, input.app)) return null;

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.authOtp.updateMany({
      data: { consumedAt: now },
      where: { app: appToDb(input.app), consumedAt: null, email },
    });
    await tx.authOtp.create({
      data: {
        app: appToDb(input.app),
        codeHash: otpHash(email, code),
        email,
        expiresAt: addMinutes(now, OTP_MINUTES),
      },
    });
    const event = await enqueueOutbox(
      tx,
      'email.send',
      json({
        data: { role: input.app === 'admin' ? 'Admin' : 'Driver', signInCode: code },
        template: 'staff-login-code',
        to: [user.email],
      }),
      `staff-login-code:${email}:${input.app}:${now.toISOString()}`,
    );
    return event.id;
  });
}

async function assertOtpNotLocked(email: string, app: StaffApp, now: Date): Promise<void> {
  const rows = await prisma.authOtp.findMany({
    orderBy: { createdAt: 'desc' },
    select: { attempts: true, createdAt: true },
    where: {
      app: appToDb(app),
      createdAt: { gte: new Date(now.getTime() - 3_600_000) },
      email,
    },
  });
  const attempts = rows.reduce((total, row) => total + row.attempts, 0);
  const latest = rows[0]?.createdAt;
  if (attempts >= 10 && latest && latest.getTime() > now.getTime() - 900_000) {
    throw new AppError('RATE_LIMITED', 'Too many sign-in attempts. Try again shortly.', { retryAfter: 900 });
  }
}

export async function verifyStaffOtp(input: z.infer<typeof OtpVerifySchema>): Promise<{
  accessExpiresAt: string;
  accessToken: string;
  refreshToken: string;
  user: ReturnType<typeof mapUser>;
}> {
  const email = input.email.toLowerCase();
  const now = new Date();
  await assertOtpNotLocked(email, input.app, now);
  const otp = await prisma.authOtp.findFirst({
    orderBy: { createdAt: 'desc' },
    where: {
      app: appToDb(input.app),
      consumedAt: null,
      email,
      expiresAt: { gt: now },
    },
  });
  if (!otp) throw new AppError('UNAUTHORIZED', 'Invalid or expired code.');
  if (otp.attempts >= 5)
    throw new AppError('RATE_LIMITED', 'Too many sign-in attempts. Try again shortly.', { retryAfter: 900 });

  const matches = timingSafeHexEqual(otp.codeHash, otpHash(email, input.code));
  if (!matches) {
    await prisma.authOtp.update({ data: { attempts: { increment: 1 } }, where: { id: otp.id } });
    throw new AppError('UNAUTHORIZED', 'Invalid or expired code.');
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { email: true, id: true, name: true, role: true, status: true },
  });
  if (!user || user.status === 'DISABLED' || !allowedRoleForApp(user.role, input.app)) {
    throw new AppError('UNAUTHORIZED', 'Invalid or expired code.');
  }

  await prisma.user.update({
    data: { lastLoginAt: now, status: user.status === 'INVITED' ? 'ACTIVE' : user.status },
    where: { id: user.id },
  });
  await prisma.authOtp.update({ data: { consumedAt: now }, where: { id: otp.id } });

  return createSession(
    { ...user, status: user.status === 'INVITED' ? 'ACTIVE' : user.status },
    input.app,
    input.device,
  );
}

export async function refreshStaffSession(input: z.infer<typeof RefreshRequestSchema>): Promise<{
  accessExpiresAt: string;
  accessToken: string;
  refreshToken: string;
  user: ReturnType<typeof mapUser>;
}> {
  const tokenHash = refreshHash(input.refreshToken);
  const candidate = await prisma.session.findFirst({
    where: { OR: [{ refreshTokenHash: tokenHash }, { previousRefreshTokenHash: tokenHash }] },
    select: { id: true },
  });
  if (!candidate) throw new AppError('UNAUTHORIZED', 'Sign in again.');
  const result = await prisma.$transaction(async (tx) => {
    // Serialize rotations and exact retries before inspecting the current/previous token hashes.
    await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${candidate.id} FOR UPDATE`;
    const session = await tx.session.findUnique({
      where: { id: candidate.id },
      include: { user: { select: { email: true, id: true, name: true, role: true, status: true } } },
    });
    const now = new Date();
    if (
      !session ||
      session.revokedAt ||
      (session.expiresAt !== null && session.expiresAt <= now) ||
      (session.expiresAt === null && session.app !== 'ADMIN') ||
      (session.app === 'DRIVER' && addDays(session.createdAt, REFRESH_ABSOLUTE_DAYS) <= now) ||
      session.deviceId !== input.deviceId ||
      session.user.status !== 'ACTIVE' ||
      !allowedRoleForApp(session.user.role, dbToApp(session.app)) ||
      (session.app === 'ADMIN' && session.platform === 'WEB')
    ) {
      throw new AppError('UNAUTHORIZED', 'Sign in again.');
    }
    const deriveRefreshToken = (requestId: string): string =>
      createHmac('sha256', secret('OTP_PEPPER'))
        .update(JSON.stringify(['sv.native-refresh.v1', session.id, requestId, tokenHash]))
        .digest('base64url');
    if (session.previousRefreshTokenHash === tokenHash) {
      if (input.requestId && session.lastRefreshRequestId === input.requestId) {
        const refreshToken = deriveRefreshToken(input.requestId);
        if (timingSafeHexEqual(refreshHash(refreshToken), session.refreshTokenHash)) {
          return {
            revoked: false,
            response: await issueTokenResponse(session.user, session.id, dbToApp(session.app), refreshToken),
          } as const;
        }
      }
      await tx.session.update({
        data: { revokedAt: now, revokedReason: 'refresh-token-reuse' },
        where: { id: session.id },
      });
      await tx.pushDevice.updateMany({
        data: { enabled: false, lastError: 'session-revoked' },
        where: { sessionId: session.id },
      });
      await enqueueOutbox(
        tx,
        'email.send',
        json({
          data: { message: 'A reused sign-in token was detected. This session has been revoked.' },
          template: 'admin-system-alert',
          to: [session.user.email],
        }),
        `refresh-reuse-alert:${session.id}`,
      );
      // Commit revocation and the alert before returning the unauthorized outcome.
      return { revoked: true } as const;
    }
    if (!timingSafeHexEqual(session.refreshTokenHash, tokenHash))
      throw new AppError('UNAUTHORIZED', 'Sign in again.');
    const refreshToken = input.requestId ? deriveRefreshToken(input.requestId) : newRefreshToken();
    const expiresAt =
      session.app === 'ADMIN'
        ? null
        : minDate(addDays(now, REFRESH_DAYS), addDays(session.createdAt, REFRESH_ABSOLUTE_DAYS));
    const updated = await tx.session.updateMany({
      data: {
        expiresAt,
        lastUsedAt: now,
        lastRefreshRequestId: input.requestId ?? null,
        previousRefreshTokenHash: session.refreshTokenHash,
        refreshTokenHash: refreshHash(refreshToken),
      },
      where: {
        id: session.id,
        refreshTokenHash: tokenHash,
        revokedAt: null,
        user: { is: { status: 'ACTIVE', role: session.user.role } },
      },
    });
    if (updated.count !== 1) throw new AppError('UNAUTHORIZED', 'Sign in again.');
    return {
      revoked: false,
      response: await issueTokenResponse(session.user, session.id, dbToApp(session.app), refreshToken),
    } as const;
  });
  if (result.revoked) throw new AppError('UNAUTHORIZED', 'Sign in again.');
  return result.response;
}

export async function authenticateStaffRequest(
  request: Request,
  options: StaffAuthOptions,
): Promise<StaffContext> {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
  if (!token) throw new AppError('UNAUTHORIZED', 'Sign in required.');

  let claims: StaffClaims;
  try {
    const verified = await jwtVerify(token, accessKey(), { algorithms: ['HS256'] });
    const role = verified.payload.role;
    const app = verified.payload.app;
    const sid = verified.payload.sid;
    const sub = verified.payload.sub;
    const ver = verified.payload.ver;
    if (
      (role !== 'OWNER' && role !== 'ADMIN' && role !== 'DRIVER') ||
      (app !== 'admin' && app !== 'driver') ||
      typeof sid !== 'string' ||
      !sub ||
      ver !== 1
    ) {
      throw new Error('invalid claims');
    }
    claims = { app, role, sessionId: sid, userId: sub, ver };
  } catch {
    throw new AppError('UNAUTHORIZED', 'Sign in required.');
  }

  assertMinimumAppVersion(request, claims.app);
  if (options.app && options.app !== claims.app)
    throw new AppError('FORBIDDEN', 'This endpoint is not available in this app.');
  if (options.roles && !options.roles.includes(claims.role))
    throw new AppError('FORBIDDEN', 'You do not have permission to do that.');

  const session = await prisma.session.findUnique({
    where: { id: claims.sessionId },
    select: {
      app: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { role: true, status: true } },
      userId: true,
    },
  });
  if (
    !session ||
    session.userId !== claims.userId ||
    session.app !== appToDb(claims.app) ||
    session.revokedAt ||
    (session.expiresAt !== null && session.expiresAt.getTime() <= Date.now()) ||
    (session.expiresAt === null && session.app !== 'ADMIN') ||
    session.user.status !== 'ACTIVE' ||
    !allowedRoleForApp(session.user.role, claims.app)
  ) {
    throw new AppError('UNAUTHORIZED', 'Sign in required.');
  }
  if (session.user.role !== claims.role) throw new AppError('UNAUTHORIZED', 'Sign in required.');
  return { app: claims.app, role: claims.role, sessionId: claims.sessionId, userId: claims.userId };
}

export async function logoutStaffSession(staff: StaffContext): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.session.update({
      data: { revokedAt: new Date(), revokedReason: 'logout' },
      where: { id: staff.sessionId },
    });
    await tx.pushDevice.updateMany({ data: { enabled: false }, where: { sessionId: staff.sessionId } });
  });
}

export async function staffMe(staff: StaffContext): Promise<z.infer<typeof MeResponseSchema>> {
  const [user, settings] = await Promise.all([
    prisma.user.findUnique({
      include: { driver: true },
      where: { id: staff.userId },
    }),
    getPublicSettings(),
  ]);
  if (!user) throw new AppError('UNAUTHORIZED', 'Sign in required.');
  const env = serverEnv();
  return {
    appConfig: {
      featureFlags: {},
      minVersion:
        staff.app === 'admin'
          ? (env.MIN_ADMIN_APP_VERSION ?? '0.0.0')
          : (env.MIN_DRIVER_APP_VERSION ?? '0.0.0'),
      slotWindows: settings.operations.slotWindows,
      supportPhone: settings.contact.phoneE164 ?? settings.contact.phoneDisplay,
    },
    driverProfile: user.driver
      ? { homePostcode: user.driver.homePostcode, payoutPercent: user.driver.payoutPercent }
      : null,
    role: user.role,
    user: mapUser(user),
  };
}

export async function upsertPushDevice(
  staff: StaffContext,
  input: { expoPushToken: string; platform: 'android' | 'ios' },
): Promise<void> {
  await prisma.pushDevice.upsert({
    create: {
      app: appToDb(staff.app),
      enabled: true,
      expoPushToken: input.expoPushToken,
      platform: devicePlatform(input.platform),
      sessionId: staff.sessionId,
      userId: staff.userId,
    },
    update: {
      app: appToDb(staff.app),
      enabled: true,
      lastError: null,
      lastRegisteredAt: new Date(),
      platform: devicePlatform(input.platform),
      sessionId: staff.sessionId,
      userId: staff.userId,
    },
    where: { expoPushToken: input.expoPushToken },
  });
}

export async function disableCurrentPushDevices(staff: StaffContext): Promise<void> {
  await prisma.pushDevice.updateMany({
    data: { enabled: false },
    where: { sessionId: staff.sessionId, userId: staff.userId },
  });
}

export async function listOwnSessions(staff: StaffContext): Promise<{
  items: Array<{
    app: StaffApp;
    createdAt: string;
    current: boolean;
    deviceId: string;
    deviceName: string | null;
    id: string;
    lastUsedAt: string;
    platform: string;
    revokedAt: string | null;
  }>;
  nextCursor: null;
}> {
  const sessions = await prisma.session.findMany({
    orderBy: { lastUsedAt: 'desc' },
    select: {
      app: true,
      createdAt: true,
      deviceId: true,
      deviceName: true,
      id: true,
      lastUsedAt: true,
      platform: true,
      revokedAt: true,
    },
    where: { userId: staff.userId },
  });
  return {
    items: sessions.map((session) => ({
      ...session,
      app: dbToApp(session.app),
      createdAt: session.createdAt.toISOString(),
      current: session.id === staff.sessionId,
      lastUsedAt: session.lastUsedAt.toISOString(),
      revokedAt: session.revokedAt?.toISOString() ?? null,
    })),
    nextCursor: null,
  };
}

export async function revokeOwnSession(staff: StaffContext, sessionId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const result = await tx.session.updateMany({
      data: { revokedAt: new Date(), revokedReason: 'self-revoked' },
      where: { id: sessionId, userId: staff.userId },
    });
    if (result.count === 0) throw new AppError('NOT_FOUND', 'Session not found.');
    await tx.pushDevice.updateMany({ data: { enabled: false }, where: { sessionId } });
  });
}

export async function listNotifications(staff: StaffContext) {
  const notifications = await prisma.notification.findMany({
    orderBy: { createdAt: 'desc' },
    select: { body: true, createdAt: true, data: true, id: true, readAt: true, title: true, type: true },
    take: 50,
    where: { userId: staff.userId },
  });
  return {
    items: notifications.map((notification) => ({
      ...notification,
      createdAt: notification.createdAt.toISOString(),
      readAt: notification.readAt?.toISOString() ?? null,
    })),
    nextCursor: null,
  };
}

export async function markNotificationsRead(
  staff: StaffContext,
  input: { all: true } | { ids: string[] },
): Promise<void> {
  await prisma.notification.updateMany({
    data: { readAt: new Date() },
    where: {
      userId: staff.userId,
      ...('all' in input ? {} : { id: { in: input.ids } }),
    },
  });
}
