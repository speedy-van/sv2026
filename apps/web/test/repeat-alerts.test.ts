import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ settings: vi.fn(), cutoff: vi.fn(), candidates: vi.fn(), bookings: vi.fn(), admins: vi.fn(), transaction: vi.fn(), lock: vi.fn(), current: vi.fn(), notifications: vi.fn(), events: vi.fn(), enqueue: vi.fn() }));
vi.mock('@sv/db', () => ({ enqueueOutbox: mocks.enqueue, prisma: { booking: { findMany: mocks.bookings }, user: { findMany: mocks.admins }, $transaction: mocks.transaction, $queryRaw: mocks.candidates } }));
vi.mock('../src/server/settings', () => ({ getSetting: mocks.settings }));
vi.mock('../src/server/env', () => ({ outboxProcessFrom: mocks.cutoff }));
import { runRepeatAlerts } from '../src/server/notifications/repeat-alerts';

const now = new Date('2031-03-01T12:00:00.000Z');
const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000);
const booking = { id: 'booking-one', reference: 'SV-2031-0001', service: 'man-and-van', totalPence: 12345, moveDate: new Date('2031-03-02T00:00:00.000Z'), slot: 'MORNING', pickup: { town: 'Glasgow' }, dropoff: { town: 'Paisley' } };
const tx = { $queryRaw: mocks.lock, booking: { findUnique: mocks.current }, notification: { findMany: mocks.notifications }, outboxEvent: { findMany: mocks.events } };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({ newBookingRepeatUntilSeen: true });
  mocks.candidates.mockResolvedValue([{ id: 'booking-one' }]);
  mocks.bookings.mockResolvedValue([booking]);
  mocks.admins.mockResolvedValue([{ id: 'admin-one' }, { id: 'admin-two' }, { id: 'admin-three' }]);
  mocks.current.mockResolvedValue({ status: 'CONFIRMED', dispatchStatus: 'UNASSIGNED', deletedAt: null });
  mocks.notifications.mockResolvedValue([{ createdAt: fiveMinutesAgo, readAt: null }]);
  mocks.events.mockResolvedValue([]);
  mocks.transaction.mockImplementation((operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
});

describe('bounded five-minute admin repeat rounds', () => {
  it('queues one round for all admins and checks current state after obtaining the booking lock', async () => {
    expect(await runRepeatAlerts(now)).toEqual({ bookingsChecked: 1, pushesQueued: 3 });
    expect(mocks.enqueue).toHaveBeenCalledTimes(3);
    expect(mocks.enqueue.mock.calls.map((call) => call[3] as unknown)).toEqual(['repeat-alert:booking-one:1:admin-one', 'repeat-alert:booking-one:1:admin-two', 'repeat-alert:booking-one:1:admin-three']);
    expect(mocks.current.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.lock.mock.invocationCallOrder[0] ?? Infinity);
    expect(mocks.events.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.lock.mock.invocationCallOrder[0] ?? Infinity);
  });

  it('counts round numbers rather than recipients, allowing the second of three rounds', async () => {
    mocks.events.mockResolvedValue(['admin-one', 'admin-two', 'admin-three'].map((admin) => ({ dedupeKey: `repeat-alert:booking-one:1:${admin}`, createdAt: fiveMinutesAgo })));
    expect((await runRepeatAlerts(now)).pushesQueued).toBe(3);
    expect(mocks.enqueue.mock.calls.map((call) => call[3] as unknown)).toEqual(['repeat-alert:booking-one:2:admin-one', 'repeat-alert:booking-one:2:admin-two', 'repeat-alert:booking-one:2:admin-three']);
  });

  it('stops after round three even when only one admin received each round', async () => {
    mocks.events.mockResolvedValue([1, 2, 3].map((round) => ({ dedupeKey: `repeat-alert:booking-one:${String(round)}:admin-one`, createdAt: fiveMinutesAgo })));
    expect((await runRepeatAlerts(now)).pushesQueued).toBe(0);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('does not queue another round before five minutes after the preceding repeat', async () => {
    mocks.events.mockResolvedValue([{ dedupeKey: 'repeat-alert:booking-one:1:admin-one', createdAt: new Date(fiveMinutesAgo.getTime() + 1) }]);
    expect((await runRepeatAlerts(now)).pushesQueued).toBe(0);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('waits five minutes after the initial notification before sending the first repeat', async () => {
    mocks.notifications.mockResolvedValue([{ createdAt: new Date(fiveMinutesAgo.getTime() + 1), readAt: null }]);
    expect((await runRepeatAlerts(now)).pushesQueued).toBe(0);
  });

  it('makes a second invocation observe the first committed round rather than queue duplicate work', async () => {
    const events: { dedupeKey: string; createdAt: Date }[] = [];
    mocks.events.mockImplementation(() => Promise.resolve([...events]));
    mocks.enqueue.mockImplementation((_tx: unknown, _type: unknown, _payload: unknown, dedupeKey: string) => { events.push({ dedupeKey, createdAt: now }); return Promise.resolve({ id: dedupeKey }); });
    expect((await runRepeatAlerts(now)).pushesQueued).toBe(3);
    expect((await runRepeatAlerts(now)).pushesQueued).toBe(0);
    expect(mocks.lock).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(3);
  });

  it.each([{ notifications: [] }, { notifications: [{ createdAt: fiveMinutesAgo, readAt: now }] }])('does not repeat absent or already acknowledged initial notifications %#', async ({ notifications }) => {
    mocks.notifications.mockResolvedValue(notifications);
    expect((await runRepeatAlerts(now)).pushesQueued).toBe(0);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it.each([null, { status: 'CANCELLED', dispatchStatus: 'UNASSIGNED', deletedAt: null }, { status: 'CONFIRMED', dispatchStatus: 'ACCEPTED', deletedAt: null }, { status: 'CONFIRMED', dispatchStatus: 'UNASSIGNED', deletedAt: now }])('rechecks eligibility inside the transaction %#', async (current) => {
    mocks.current.mockResolvedValue(current);
    expect((await runRepeatAlerts(now)).pushesQueued).toBe(0);
    expect(mocks.notifications).not.toHaveBeenCalled();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it('preserves historical bookings and notification backlog before the production activation cutoff', async () => {
    const cutoff = new Date('2031-02-28T12:00:00.000Z');
    mocks.cutoff.mockReturnValue(cutoff);
    await runRepeatAlerts(now);
    const candidates: unknown = mocks.bookings.mock.calls[0]?.[0];
    const notifications: unknown = mocks.notifications.mock.calls[0]?.[0];
    expect(candidates).toMatchObject({ where: { createdAt: { gte: cutoff }, deletedAt: null } });
    expect(notifications).toMatchObject({ where: { createdAt: { gte: cutoff } } });
    expect(mocks.candidates.mock.calls[0]?.slice(1)).toEqual([cutoff, cutoff, fiveMinutesAgo, fiveMinutesAgo, fiveMinutesAgo]);
  });

  it('filters already-read, exhausted and not-yet-due candidates before the bounded oldest-first batch', async () => {
    mocks.candidates.mockResolvedValue([]);
    expect(await runRepeatAlerts(now)).toEqual({ bookingsChecked: 0, pushesQueued: 0 });
    const sqlParts: unknown = mocks.candidates.mock.calls[0]?.[0];
    expect(Array.isArray(sqlParts)).toBe(true);
    const sql = Array.isArray(sqlParts) ? sqlParts.join('?') : '';
    expect(sql).toContain('n."readAt" IS NOT NULL');
    expect(sql).toContain("split_part(e.\"dedupeKey\", ':', 3) = '3'");
    expect(sql).toContain('e."createdAt" > ?');
    expect(sql).toContain('ORDER BY b."createdAt" ASC, b."id" ASC LIMIT 25');
    expect(mocks.bookings).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('does no repeat work when the feature is disabled or the shared time budget has elapsed', async () => {
    mocks.settings.mockResolvedValueOnce({ newBookingRepeatUntilSeen: false });
    expect(await runRepeatAlerts(now)).toEqual({ bookingsChecked: 0, pushesQueued: 0 });
    expect(mocks.bookings).not.toHaveBeenCalled();
    expect(await runRepeatAlerts(now, 0)).toEqual({ bookingsChecked: 0, pushesQueued: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
