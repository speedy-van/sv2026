import { AppError, BrowserAuthTokenResponseSchema, BrowserSessionLogoutResponseSchema, EmptyBrowserSessionSchema } from '@sv/contracts';
import type { Prisma } from '@sv/db';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), updateMany: vi.fn<(input: Prisma.SessionUpdateManyArgs) => Promise<{ count: number }>>(), pushUpdate: vi.fn(), transaction: vi.fn(),
  issue: vi.fn(), login: vi.fn(), otp: vi.fn(), authenticate: vi.fn(), limit: vi.fn(), accountLimit: vi.fn(),
}));
vi.mock('@sv/db', () => ({ prisma: {
  session: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
  $transaction: mocks.transaction,
} }));
vi.mock('../src/server/auth/staff', () => ({
  issueStaffAccessResponse: mocks.issue, loginStaffPassword: mocks.login, verifyStaffOtp: mocks.otp,
  authenticateStaffRequest: mocks.authenticate,
}));
vi.mock('../src/server/rate-limit', () => ({ enforceRateLimit: mocks.limit, enforcePasswordAccountRateLimit: mocks.accountLimit }));

import {
  assertBrowserSessionOrigin, browserLoginResult, browserSessionCookie, clearBrowserSessionCookie,
  logoutBrowserSession, restoreBrowserSession,
} from '../src/server/auth/browser-session';
import { POST as restore } from '../src/app/api/v1/auth/browser/session/route';
import { POST as logout } from '../src/app/api/v1/auth/browser/logout/route';
import { POST as password } from '../src/app/api/v1/auth/password/login/route';
import { POST as otp } from '../src/app/api/v1/auth/otp/verify/route';

const now = new Date('2031-10-15T12:00:00.000Z');
const token = 'unit_test_browser_credential_0000000000000000';
const deviceId = 'unit-browser-device';
const user = { id: 'admin-unit', email: 'admin@example.test', name: 'Unit Admin', role: 'ADMIN' as const, status: 'ACTIVE' as const };
const access = { accessToken: 'unit-access-token-0000000000000000', accessExpiresAt: '2031-10-15T12:15:00.000Z', user };
const nativeResponse = { ...access, refreshToken: token };
const validSession = { id: 'session-unit', app: 'ADMIN', platform: 'WEB', deviceId, expiresAt: null, revokedAt: null, user };
const encoded = encodeURIComponent(JSON.stringify({ token, deviceId }));
const cookie = `sv_admin_session=${encoded}`;
const tx = { session: { updateMany: mocks.updateMany }, pushDevice: { updateMany: mocks.pushUpdate } };
const loginInput = { app: 'admin', email: user.email, password: 'unit-password-not-real', device: { deviceId, deviceName: 'Unit browser', platform: 'web', appVersion: '1.0.0' } };
function request({ path = 'browser/session', origin = 'http://localhost:8081', destination = 'http://localhost:3000', body = {}, credential = cookie, host, fetchSite }: {
  path?: string; origin?: string | null; destination?: string; body?: unknown; credential?: string; host?: string; fetchSite?: string;
} = {}): Request {
  const headers = new Headers({ 'content-type': 'application/json', cookie: credential, 'x-request-id': 'browser-test' });
  if (origin !== null) headers.set('origin', origin);
  if (host) headers.set('host', host);
  if (fetchSite) headers.set('sec-fetch-site', fetchSite);
  return new Request(`${destination}/api/v1/auth/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('NODE_ENV', 'development');
  mocks.findUnique.mockResolvedValue(validSession);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.issue.mockResolvedValue(access); mocks.login.mockResolvedValue(nativeResponse); mocks.otp.mockResolvedValue(nativeResponse);
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('browser auth contracts and opaque cookie', () => {
  it('excludes refresh credentials from web responses and rejects unknown restore fields', () => {
    expect(BrowserAuthTokenResponseSchema.safeParse(nativeResponse).success).toBe(false);
    expect(BrowserAuthTokenResponseSchema.parse(access)).toEqual(access);
    expect(EmptyBrowserSessionSchema.safeParse({ refreshToken: token }).success).toBe(false);
    expect(EmptyBrowserSessionSchema.safeParse({ deviceId }).success).toBe(false);
    expect(BrowserSessionLogoutResponseSchema.safeParse({ ok: false }).success).toBe(false);
    expect(BrowserSessionLogoutResponseSchema.safeParse({ ok: true, extra: true }).success).toBe(false);
  });
  it.each(['development', 'production'] as const)('uses a persistent host-only HttpOnly cookie in %s', (environment) => {
    vi.stubEnv('NODE_ENV', environment);
    const header = browserSessionCookie(token, deviceId);
    expect(header).toContain(`sv_admin_session=${encoded};`);
    expect(header).toContain('Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=34560000');
    expect(header.includes('; Secure')).toBe(environment === 'production');
    expect(header).not.toMatch(/Domain=/iu);
    expect(clearBrowserSessionCookie()).toContain('Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0');
  });
  it('maps login fields explicitly so the refresh credential appears only in the HttpOnly cookie', () => {
    const result = browserLoginResult(nativeResponse, deviceId);
    expect(result.body).toEqual(access);
    expect(JSON.stringify(result.body)).not.toContain(token);
    expect(result.cookie).toContain(encoded);
  });
});

describe('browser cookie origin guard', () => {
  it.each([
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://localhost:8081', 'http://localhost:3000'],
    ['http://127.0.0.1:8081', 'http://127.0.0.1:3000'],
  ])('permits %s against %s in development', (origin, destination) => {
    expect(() => { assertBrowserSessionOrigin(request({ origin, destination })); }).not.toThrow();
  });
  it('uses the actual Host instead of Next’s all-interface bind URL', () => {
    expect(() => { assertBrowserSessionOrigin(request({ destination: 'http://0.0.0.0:3000', host: 'localhost:3000' })); }).not.toThrow();
  });
  it('permits exact HTTPS same-origin production and rejects preview-port access in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => { assertBrowserSessionOrigin(request({ origin: 'https://admin.example.test', destination: 'https://admin.example.test' })); }).not.toThrow();
    expect(() => { assertBrowserSessionOrigin(request()); }).toThrow(AppError);
  });
  it.each([
    { origin: null }, { origin: 'null' }, { origin: 'https://other.example.test' },
    { origin: 'http://localhost:8082' }, { origin: 'https://localhost:8081' },
    { origin: 'http://localhost:8081/' }, { origin: 'http://staff@localhost:8081' },
    { origin: 'http://localhost:8081.evil.test' },
    { origin: 'http://127.0.0.1:8081' },
    { destination: 'http://127.0.0.1:3000' },
    { destination: 'http://localhost:3001' },
    { host: 'localhost:3000,other.example.test' }, { host: 'localhost:3000/other' },
    { fetchSite: 'cross-site' },
  ])('rejects untrusted browser origin/host metadata %# before touching a session', async (options) => {
    await expect(restoreBrowserSession(request(options), now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});

describe('verified browser restore', () => {
  it('issues access only from the current opaque hash and renews the same credential without rotation', async () => {
    expect(await restoreBrowserSession(request(), now)).toEqual({ body: access, cookie: browserSessionCookie(token, deviceId) });
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { refreshTokenHash: createHash('sha256').update(token).digest('hex') } }));
    expect(mocks.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { app: 'ADMIN', platform: 'WEB', deviceId, revokedAt: null },
      data: { lastUsedAt: now, expiresAt: null },
    });
    expect(mocks.issue).toHaveBeenCalledExactlyOnceWith(user, 'session-unit', 'admin');
    expect(mocks.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('refreshTokenHash');
    expect(mocks.updateMany.mock.calls[0]?.[0].data).not.toHaveProperty('previousRefreshTokenHash');
  });
  it('upgrades only a still-valid legacy finite browser session to persistent', async () => {
    mocks.findUnique.mockResolvedValue({ ...validSession, expiresAt: new Date(now.getTime() + 60_000) });
    await restoreBrowserSession(request(), now);
    expect(mocks.updateMany.mock.calls[0]?.[0]).toMatchObject({ data: { expiresAt: null }, where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } });
  });
  it('lets concurrent browser restores and response-loss retries retain the same opaque credential', async () => {
    const [first, second] = await Promise.all([restoreBrowserSession(request(), now), restoreBrowserSession(request(), now)]);
    const retry = await restoreBrowserSession(request(), now);
    expect(first.cookie).toBe(second.cookie);
    expect(retry.cookie).toBe(first.cookie);
    expect(mocks.issue).toHaveBeenCalledTimes(3);
    for (const [operation] of mocks.updateMany.mock.calls) {
      expect(operation.data).not.toHaveProperty('refreshTokenHash');
      expect(operation.data).not.toHaveProperty('previousRefreshTokenHash');
      expect(operation.data).not.toHaveProperty('revokedAt');
    }
  });
  it.each([
    null, { ...validSession, app: 'DRIVER' }, { ...validSession, platform: 'IOS' },
    { ...validSession, deviceId: 'another-device' }, { ...validSession, revokedAt: now },
    { ...validSession, expiresAt: new Date(now.getTime() - 1) }, { ...validSession, expiresAt: now },
    { ...validSession, user: { ...user, status: 'DISABLED' } },
    { ...validSession, user: { ...user, status: 'INVITED' } },
    { ...validSession, user: { ...user, role: 'DRIVER' } },
  ])('rejects an invalid/revoked/expired/wrong-app session %# without issuing new tokens', async (session) => {
    mocks.findUnique.mockResolvedValue(session);
    await expect(restoreBrowserSession(request(), now)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.issue).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it.each([
    '', 'sv_admin_session=%', 'sv_admin_session=%7B', 'sv_admin_session=null',
    `sv_admin_session=${encodeURIComponent(JSON.stringify({ token, deviceId, role: 'OWNER' }))}`,
    `sv_admin_session=${encodeURIComponent(JSON.stringify({ token, deviceId: '' }))}`,
    `sv_admin_session=${encodeURIComponent(JSON.stringify({ token: 'short', deviceId }))}`,
    `${cookie}; ${cookie}`, `sv_admin_session=${'x'.repeat(2049)}`,
  ])('rejects malformed, oversized or duplicate cookies %# without a database lookup', async (credential) => {
    await expect(restoreBrowserSession(request({ credential }), now)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it('does not issue an access token if revocation or account eligibility changes during restore', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await expect(restoreBrowserSession(request(), now)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.issue).not.toHaveBeenCalled();
  });
  it('preserves transient database errors rather than treating them as invalid credentials', async () => {
    mocks.findUnique.mockRejectedValue(new Error('Unit database unavailable'));
    await expect(restoreBrowserSession(request(), now)).rejects.toThrow('Unit database unavailable');
    expect(mocks.issue).not.toHaveBeenCalled();
  });
});

describe('browser routes and native compatibility', () => {
  it('restores with strict empty JSON, no bearer JWT and a no-store response', async () => {
    const response = await restore(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(access);
    expect(response.headers.get('set-cookie')).toBe(browserSessionCookie(token, deviceId));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe('browser-test');
    expect(mocks.limit).toHaveBeenCalledWith(expect.any(Request), 'authRefresh');
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
  it('clears an invalid cookie on definitive401 but never on CSRF403 or transient500', async () => {
    mocks.findUnique.mockResolvedValue(null);
    const invalid = await restore(request());
    expect(invalid.status).toBe(401); expect(invalid.headers.get('set-cookie')).toContain('Max-Age=0');
    const forbidden = await restore(request({ origin: 'https://untrusted.example.test' }));
    expect(forbidden.status).toBe(403); expect(forbidden.headers.get('set-cookie')).toBeNull();
    mocks.findUnique.mockRejectedValue(new Error('Unit outage'));
    const transient = await restore(request());
    expect(transient.status).toBe(500); expect(transient.headers.get('set-cookie')).toBeNull();
  });
  it.each([restore, logout])('rejects unexpected restore/logout fields before consulting credentials', async (route) => {
    const response = await route(request({ body: { deviceId } }));
    expect(response.status).toBe(400); expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it('logs out a matching browser session even if its former access token/session expiry is old', async () => {
    mocks.findUnique.mockResolvedValue({ ...validSession, expiresAt: new Date('2030-01-01T00:00:00Z') });
    const response = await logout(request({ path: 'browser/logout' }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.updateMany.mock.calls[0]?.[0]).toMatchObject({ data: { revokedReason: 'logout' }, where: { id: 'session-unit', platform: 'WEB', app: 'ADMIN', deviceId } });
    expect(mocks.updateMany.mock.calls[0]?.[0].data.revokedAt).toBeInstanceOf(Date);
    expect(mocks.pushUpdate).toHaveBeenCalledWith({ where: { sessionId: 'session-unit' }, data: { enabled: false } });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });
  it.each([null, { ...validSession, app: 'DRIVER' }, { ...validSession, platform: 'IOS' }, { ...validSession, deviceId: 'other' }])('clears a missing/mismatched cookie without revoking another session %#', async (session) => {
    mocks.findUnique.mockResolvedValue(session);
    await logoutBrowserSession(request(), now);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it('treats logout with an invalid or absent cookie as an idempotent cookie-clear acknowledgement', async () => {
    const response = await logout(request({ credential: '' }));
    expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
  it.each([['password/login', password], ['otp/verify', otp]] as const)('sets cookie and returns no refreshToken for browser %s', async (path, route) => {
    const body = path === 'password/login' ? loginInput : { ...loginInput, password: undefined, code: '123456' };
    const response = await route(request({ path, body }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(access);
    expect(response.headers.get('set-cookie')).toBe(browserSessionCookie(token, deviceId));
  });
  it.each([['password/login', password], ['otp/verify', otp]] as const)('blocks browser login CSRF before credential verification for %s', async (path, route) => {
    const body = path === 'password/login' ? loginInput : { ...loginInput, password: undefined, code: '123456' };
    const response = await route(request({ path, body, origin: 'https://untrusted.example.test' }));
    expect(response.status).toBe(403); expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.login).not.toHaveBeenCalled(); expect(mocks.otp).not.toHaveBeenCalled();
  });
  it.each([['password/login', password], ['otp/verify', otp]] as const)('preserves native token JSON and does not set a cookie for %s', async (path, route) => {
    const nativeInput = { ...loginInput, device: { ...loginInput.device, platform: 'ios' } };
    const body = path === 'password/login' ? nativeInput : { ...nativeInput, password: undefined, code: '123456' };
    const response = await route(request({ path, body, origin: null }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(nativeResponse);
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
