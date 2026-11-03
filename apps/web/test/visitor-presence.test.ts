import { CONSENT_CLOCK_SKEW_SECONDS, CONSENT_MAX_AGE_SECONDS } from '@sv/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), transaction: vi.fn(), uuid: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: { websiteVisitorPresence: {
  upsert: mocks.upsert, updateMany: mocks.updateMany, findUnique: mocks.findUnique, deleteMany: mocks.deleteMany, count: mocks.count,
}, $transaction: mocks.transaction } }));
vi.mock('node:crypto', () => ({ randomUUID: mocks.uuid }));

import { heartbeatVisitorPresence, pruneVisitorPresence, readAdminVisitorPresence, withdrawVisitorPresence } from '../src/server/visitor-presence';

const now = new Date('2031-03-01T12:00:00.000Z');
const cutoff = new Date(now.getTime() - 90_000);
const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const rows = new Map<string, Date>();
const tx = { websiteVisitorPresence: { upsert: mocks.upsert, updateMany: mocks.updateMany, findUnique: mocks.findUnique, deleteMany: mocks.deleteMany } };
const consent = (changes: Record<string, unknown> = {}): string => encodeURIComponent(JSON.stringify({ analytics: true, advertising: false, version: 1, savedAt: new Date(now.getTime() - 1000).toISOString(), ...changes }));
function request(cookie = `sv_consent=${consent()}`, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/visitors/presence', { method: 'POST', headers: { origin: 'http://localhost', 'sec-fetch-site': 'same-origin', cookie, ...headers } });
}

beforeEach(() => {
  vi.resetAllMocks();
  rows.clear();
  mocks.uuid.mockReturnValue(id);
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
  mocks.upsert.mockImplementation(({ create }: { create: { id: string; lastSeenAt: Date } }) => { rows.set(create.id, create.lastSeenAt); return Promise.resolve(create); });
  mocks.updateMany.mockImplementation(({ where, data }: { where: { id: string; lastSeenAt: { gte: Date; lte: Date } }; data: { lastSeenAt: Date } }) => {
    const seen = rows.get(where.id);
    if (!seen || seen < where.lastSeenAt.gte || seen > where.lastSeenAt.lte) return Promise.resolve({ count: 0 });
    rows.set(where.id, data.lastSeenAt);
    return Promise.resolve({ count: 1 });
  });
  mocks.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(rows.has(where.id) ? { lastSeenAt: rows.get(where.id) } : null));
  mocks.deleteMany.mockImplementation(({ where }: { where: { id?: string; lastSeenAt?: { lt: Date } } }) => {
    let count = 0;
    for (const [key, seen] of rows) if (where.id ? key === where.id : where.lastSeenAt && seen < where.lastSeenAt.lt) { rows.delete(key); count += 1; }
    return Promise.resolve({ count });
  });
  mocks.count.mockImplementation(({ where }: { where: { lastSeenAt: { gte: Date } } }) => Promise.resolve([...rows.values()].filter((seen) => seen >= where.lastSeenAt.gte).length));
});
afterEach(() => vi.unstubAllEnvs());

describe('consent-gated anonymous presence with isolated storage', () => {
  it('creates only a server UUID and server timestamp after consent, with a secure HttpOnly session cookie', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await heartbeatVisitorPresence(request(), now);
    expect(result.body).toEqual({ activeWindowSeconds: 90 });
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith({ where: { id }, create: { id, lastSeenAt: now }, update: { lastSeenAt: now } });
    expect(result.cookie).toBe(`sv_visitor=${id}; Path=/; HttpOnly; SameSite=Lax; Secure`);
    expect(result.cookie).not.toMatch(/Max-Age|Expires|Domain/);
    expect([...rows.keys()]).toEqual([id]);
  });

  it('records a fresh consented visit immediately despite a small browser/server clock difference', async () => {
    const browserAhead = `sv_consent=${consent({ savedAt: new Date(now.getTime() + 1500).toISOString() })}`;
    const result = await heartbeatVisitorPresence(request(browserAhead), now);
    expect(result.cookie).toContain(`sv_visitor=${id};`);
    expect(rows.get(id)).toEqual(now);
    expect((await readAdminVisitorPresence(now)).activeVisitors).toBe(1);
  });

  it.each(['', 'sv_consent=%bad', `sv_consent=${consent({ analytics: false })}`, `sv_consent=${consent({ version: 2 })}`, `sv_consent=${consent({ savedAt: new Date(now.getTime() + CONSENT_CLOCK_SKEW_SECONDS * 1000 + 1).toISOString() })}`, `sv_consent=${consent({ savedAt: new Date(now.getTime() - CONSENT_MAX_AGE_SECONDS * 1000).toISOString() })}`])('does not query or write presence or issue any cookie without valid current analytics consent %#', async (cookie) => {
    expect(await heartbeatVisitorPresence(request(cookie), now)).toEqual({ body: { activeWindowSeconds: 90 }, cookie: null });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.uuid).not.toHaveBeenCalled();
  });

  it('deduplicates repeat heartbeats and tabs sharing the same valid visitor cookie', async () => {
    await heartbeatVisitorPresence(request(), now);
    const next = new Date(now.getTime() + 30_000);
    const result = await heartbeatVisitorPresence(request(`sv_consent=${consent()}; sv_visitor=${id}`), next);
    expect(result.cookie).toBeNull();
    expect(rows.size).toBe(1);
    expect(rows.get(id)).toEqual(next);
    expect(mocks.uuid).toHaveBeenCalledOnce();
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect((await readAdminVisitorPresence(next)).activeVisitors).toBe(1);
  });

  it('counts exact active-window boundaries and excludes stale rows using server time only', async () => {
    rows.set(id, cutoff);
    rows.set(otherId, new Date(cutoff.getTime() - 1));
    const result = await readAdminVisitorPresence(now);
    expect(result).toEqual({ activeVisitors: 1, generatedAt: now.toISOString(), activeWindowSeconds: 90, measurement: 'consenting-browsers' });
    expect(mocks.count).toHaveBeenCalledExactlyOnceWith({ where: { lastSeenAt: { gte: cutoff } } });
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('prunes stale rows but preserves the exact90-second boundary', async () => {
    rows.set(id, cutoff);
    rows.set(otherId, new Date(cutoff.getTime() - 1));
    expect(await pruneVisitorPresence(now)).toBe(1);
    expect([...rows.keys()]).toEqual([id]);
  });

  it('withdrawal deletes only its own presence and cookie without needing consent', async () => {
    rows.set(id, now);
    rows.set(otherId, now);
    const result = await withdrawVisitorPresence(request(`sv_visitor=${id}`));
    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id } });
    expect([...rows.keys()]).toEqual([otherId]);
    expect(result.cookie).toContain('sv_visitor=; Path=/; HttpOnly; SameSite=Lax');
    expect(result.cookie).toContain('Max-Age=0');
  });

  it.each([id, 'client-chosen', `${id}; sv_visitor=${otherId}`])('never recreates an unknown or ambiguous client visitor identifier %#', async (value) => {
    const result = await heartbeatVisitorPresence(request(`sv_consent=${consent()}; sv_visitor=${value}`), now);
    expect(result.cookie).toContain('Max-Age=0');
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.uuid).not.toHaveBeenCalled();
    expect(rows.size).toBe(0);
  });

  it('does not resurrect an old visitor when withdrawal completes before its in-flight heartbeat update', async () => {
    rows.set(id, now);
    mocks.updateMany.mockImplementationOnce(() => { rows.delete(id); return Promise.resolve({ count: 0 }); });
    const result = await heartbeatVisitorPresence(request(`sv_consent=${consent()}; sv_visitor=${id}`), now);
    expect(result.cookie).toContain('Max-Age=0');
    expect(rows.size).toBe(0);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('never moves a newer server heartbeat backwards when an earlier request arrives later', async () => {
    const later = new Date(now.getTime() + 1000);
    rows.set(id, later);
    const result = await heartbeatVisitorPresence(request(`sv_consent=${consent()}; sv_visitor=${id}`), now);
    expect(rows.get(id)).toEqual(later);
    expect(result.cookie).toBeNull();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it.each([{ origin: 'https://other.example.test' }, { origin: 'null' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }])('rejects cross-origin cookie mutation %# before any database operation', async (headers) => {
    await expect(heartbeatVisitorPresence(request(undefined, headers), now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(withdrawVisitorPresence(request(`sv_visitor=${id}`, headers))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });

  it('accepts the real public Host when Next dev exposes its internal listening URL', async () => {
    const internal = new Request('http://0.0.0.0:3000/api/v1/visitors/presence', {
      method: 'POST', headers: { origin: 'http://localhost:3000', host: 'localhost:3000', 'sec-fetch-site': 'same-origin' },
    });
    expect(await heartbeatVisitorPresence(internal, now)).toEqual({ body: { activeWindowSeconds: 90 }, cookie: null });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    { host: 'localhost:3000', origin: 'http://other.example.test' },
    { host: 'localhost:3000/forged', origin: 'http://localhost:3000' },
    { host: 'localhost:3000', origin: 'http://localhost:3000/forged' },
    { host: 'localhost:3000', origin: 'http://user@localhost:3000' },
  ])('still rejects mismatched or malformed public origins %#', async (headers) => {
    const internal = new Request('http://0.0.0.0:3000/api/v1/visitors/presence', { method: 'POST', headers });
    await expect(heartbeatVisitorPresence(internal, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
