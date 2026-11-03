import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn(), transaction: vi.fn(), uuid: vi.fn(), quote: vi.fn(), booking: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: {
  bookingActivity: { create: mocks.create, updateMany: mocks.updateMany, findUnique: mocks.findUnique, deleteMany: mocks.deleteMany },
  quote: { findUnique: mocks.quote }, booking: { findUnique: mocks.booking }, $transaction: mocks.transaction,
} }));
vi.mock('node:crypto', () => ({ randomUUID: mocks.uuid }));

import { heartbeatBookingActivity, linkBookingActivityBooking, linkBookingActivityQuote, pruneBookingActivity, withdrawBookingActivity } from '../src/server/booking-activity';

const now = new Date('2031-03-01T12:00:00.000Z');
const cutoff = new Date(now.getTime() - 86_400_000);
const id = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const consent = (analytics = true): string => encodeURIComponent(JSON.stringify({ analytics, advertising: false, version: 1, savedAt: new Date(now.getTime() - 1000).toISOString() }));
const session = `sv_consent=${consent()}; sv_booking_activity=${id}`;
function request(cookie = `sv_consent=${consent()}`, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/v1/bookings/activity', { method: 'POST', headers: { origin: 'http://localhost', 'sec-fetch-site': 'same-origin', cookie, ...headers } });
}
const rows = new Map<string, { stage: string; lastSeenAt: Date }>();
const tx = { bookingActivity: { create: mocks.create, updateMany: mocks.updateMany, findUnique: mocks.findUnique, deleteMany: mocks.deleteMany } };
beforeEach(() => {
  vi.resetAllMocks();
  rows.clear();
  mocks.uuid.mockReturnValue(id);
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
  mocks.create.mockImplementation(({ data }: { data: { id: string; stage: string; lastSeenAt: Date } }) => { rows.set(data.id, data); return Promise.resolve(data); });
  mocks.updateMany.mockImplementation(({ where, data }: { where: { id: string; lastSeenAt: { gte: Date; lte: Date } }; data: { stage: string; lastSeenAt: Date } }) => {
    const row = rows.get(where.id);
    if (!row || row.lastSeenAt < where.lastSeenAt.gte || row.lastSeenAt > where.lastSeenAt.lte) return Promise.resolve({ count: 0 });
    rows.set(where.id, { ...row, ...data });
    return Promise.resolve({ count: 1 });
  });
  mocks.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(rows.has(where.id) ? { id: where.id } : null));
  mocks.deleteMany.mockImplementation(({ where }: { where: { id?: string; lastSeenAt?: { lt: Date } } }) => {
    let count = 0;
    for (const [key, row] of rows) if (where.id ? key === where.id : where.lastSeenAt && row.lastSeenAt < where.lastSeenAt.lt) { rows.delete(key); count += 1; }
    return Promise.resolve({ count });
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('consented booking activity using isolated storage', () => {
  it('creates anonymous stage data with only a server-issued HttpOnly capability', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const result = await heartbeatBookingActivity(request(), { stage: 'SERVICE', service: null }, now);
    expect(result.body).toEqual({ tracked: true, activeWindowSeconds: 90, retentionHours: 24 });
    expect(result.cookie).toBe(`sv_booking_activity=${id}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400`);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ data: { id, stage: 'SERVICE', service: null, startedAt: now, lastSeenAt: now } });
  });

  it.each(['', 'sv_consent=%bad', `sv_consent=${consent(false)}`])('does not query or write storage without analytics consent %#', async (cookie) => {
    expect(await heartbeatBookingActivity(request(cookie), { stage: 'MOVE', service: null }, now)).toEqual({ body: { tracked: false, activeWindowSeconds: 90, retentionHours: 24 }, cookie: null });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.uuid).not.toHaveBeenCalled();
  });

  it('updates only its existing session without creating another visitor', async () => {
    rows.set(id, { stage: 'SERVICE', lastSeenAt: now });
    rows.set(otherId, { stage: 'MOVE', lastSeenAt: now });
    const next = new Date(now.getTime() + 30_000);
    const result = await heartbeatBookingActivity(request(session), { stage: 'ITEMS', service: null }, next);
    expect(rows.get(id)).toEqual({ stage: 'ITEMS', service: null, lastSeenAt: next });
    expect(rows.get(otherId)?.stage).toBe('MOVE');
    expect(result.body.tracked).toBe(true);
    expect(result.cookie).toBeNull();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each([id, 'client-chosen', `${id}; sv_booking_activity=${otherId}`])('does not mint or revive a client-selected/unknown session %#', async (value) => {
    const result = await heartbeatBookingActivity(request(`sv_consent=${consent()}; sv_booking_activity=${value}`), { stage: 'DATE', service: null }, now);
    expect(result.body.tracked).toBe(false);
    expect(result.cookie).toContain('Max-Age=0');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.uuid).not.toHaveBeenCalled();
  });

  it('does not revive a session deleted by consent withdrawal during an in-flight heartbeat', async () => {
    rows.set(id, { stage: 'SERVICE', lastSeenAt: now });
    mocks.updateMany.mockImplementationOnce(() => { rows.delete(id); return Promise.resolve({ count: 0 }); });
    expect((await heartbeatBookingActivity(request(session), { stage: 'MOVE', service: null }, now)).body.tracked).toBe(false);
    expect(rows.size).toBe(0);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('preserves a newer stage when an earlier heartbeat completes later', async () => {
    const later = new Date(now.getTime() + 1000);
    rows.set(id, { stage: 'PAYMENT', lastSeenAt: later });
    expect((await heartbeatBookingActivity(request(session), { stage: 'DATE', service: null }, now)).body.tracked).toBe(true);
    expect(rows.get(id)).toEqual({ stage: 'PAYMENT', lastSeenAt: later });
  });

  it('retains the exact 24-hour boundary and purges older activity without reviving it', async () => {
    rows.set(id, { stage: 'MOVE', lastSeenAt: cutoff });
    rows.set(otherId, { stage: 'DATE', lastSeenAt: new Date(cutoff.getTime() - 1) });
    expect(await pruneBookingActivity(now)).toBe(1);
    expect([...rows.keys()]).toEqual([id]);
    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { lastSeenAt: { lt: cutoff } } });
  });

  it('withdraws only the caller session even when consent has already been removed', async () => {
    rows.set(id, { stage: 'DATE', lastSeenAt: now });
    rows.set(otherId, { stage: 'PAYMENT', lastSeenAt: now });
    const result = await withdrawBookingActivity(request(`sv_booking_activity=${id}`));
    expect(mocks.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { id } });
    expect([...rows.keys()]).toEqual([otherId]);
    expect(result.cookie).toContain('Max-Age=0');
  });

  it('cleans its previous activity when a heartbeat arrives after consent was revoked', async () => {
    rows.set(id, { stage: 'DATE', lastSeenAt: now });
    const result = await heartbeatBookingActivity(request(`sv_consent=${consent(false)}; sv_booking_activity=${id}`), { stage: 'DATE', service: null }, now);
    expect(result.body.tracked).toBe(false);
    expect(rows.size).toBe(0);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([{ origin: 'https://other.example.test' }, { origin: 'null' }, { origin: '' }, { 'sec-fetch-site': 'cross-site' }])('rejects a non-browser or cross-origin heartbeat before any persistence %#', async (headers) => {
    await expect(heartbeatBookingActivity(request(session, headers), { stage: 'MOVE', service: null }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(withdrawBookingActivity(request(session, headers))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe('server-owned quote and booking associations', () => {
  it('binds a newly created quote only to a consented existing session', async () => {
    mocks.quote.mockResolvedValue({ id: 'quote-internal', service: 'man-and-van' });
    await linkBookingActivityQuote(request(session), 'quote-public', now);
    expect(mocks.quote).toHaveBeenCalledExactlyOnceWith({ where: { publicId: 'quote-public' }, select: { id: true, service: true } });
    expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id, bookingId: null, lastSeenAt: { gte: cutoff, lte: now } },
      data: { quoteId: 'quote-internal', service: 'man-and-van', lastSeenAt: now },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('requires the booking quote to match the session quote and prevents replacing another booking', async () => {
    mocks.booking.mockResolvedValue({ id: 'booking-created', quoteId: 'quote-owned' });
    await linkBookingActivityBooking(request(session), 'booking-created', now);
    expect(mocks.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id, quoteId: 'quote-owned', OR: [{ bookingId: null }, { bookingId: 'booking-created' }], lastSeenAt: { gte: cutoff, lte: now } },
      data: { bookingId: 'booking-created', stage: 'PAYMENT', lastSeenAt: now },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it.each(['', `sv_consent=${consent()}`, `sv_consent=${consent(false)}; sv_booking_activity=${id}`])('never reads a resource or writes associations without consent and a server session %#', async (cookie) => {
    await linkBookingActivityQuote(request(cookie), 'quote-public', now);
    await linkBookingActivityBooking(request(cookie), 'booking-created', now);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.booking).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('ignores foreign-origin linking without failing the unrelated booking operation', async () => {
    await linkBookingActivityQuote(request(session, { origin: 'https://other.example.test' }), 'quote-public', now);
    await linkBookingActivityBooking(request(session, { 'sec-fetch-site': 'cross-site' }), 'booking-created', now);
    expect(mocks.quote).not.toHaveBeenCalled();
    expect(mocks.booking).not.toHaveBeenCalled();
  });

  it('does not link a missing quote or booking without a quote', async () => {
    mocks.quote.mockResolvedValue(null);
    mocks.booking.mockResolvedValue({ id: 'booking-created', quoteId: null });
    await linkBookingActivityQuote(request(session), 'quote-public', now);
    await linkBookingActivityBooking(request(session), 'booking-created', now);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
