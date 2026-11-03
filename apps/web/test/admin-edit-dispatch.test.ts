import * as Sentry from '@sentry/nextjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ roots: vi.fn(), completion: vi.fn(), process: vi.fn(), after: vi.fn<(run: () => Promise<void>) => void>() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: { outboxEvent: { findMany: mocks.roots, findUnique: mocks.completion } } }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('../src/server/outbox/processor', () => ({ processOutboxBatch: mocks.process }));
import { dispatchAdminBookingEdit, dispatchDriverBookingEdit, scheduleAdminBookingEdit, scheduleDriverBookingEdit } from '../src/server/admin/booking-edit-dispatch';

beforeEach(() => { vi.resetAllMocks(); mocks.roots.mockResolvedValue([]); mocks.process.mockResolvedValue({ done: 0, failed: 0 }); });
describe('committed booking edit side effects', () => {
  it('schedules delivery after the response without executing during the mutation', async () => {
    scheduleAdminBookingEdit('booking-one', 8);
    expect(mocks.roots).not.toHaveBeenCalled();
    const task = mocks.after.mock.calls[0]?.[0];
    if (!task) throw new Error('Expected a scheduled task.');
    await task();
    expect(mocks.roots).toHaveBeenCalledExactlyOnceWith({
      where: { dedupeKey: { startsWith: 'admin-booking:booking-one:8:' } },
      select: { id: true, type: true, payload: true }, orderBy: { createdAt: 'asc' }, take: 50,
    });
  });
  it('drains only this version’s roots and their derived channel jobs', async () => {
    mocks.roots.mockResolvedValue([{ id: 'root-edit', type: 'booking.updated', payload: {} }]);
    mocks.process.mockResolvedValueOnce({ done: 1, failed: 0 }).mockResolvedValueOnce({ done: 1, failed: 0 }).mockResolvedValueOnce({ done: 0, failed: 0 });
    await dispatchAdminBookingEdit('booking-one', 8);
    expect(mocks.process).toHaveBeenCalledTimes(3);
    for (const call of mocks.process.mock.calls) expect(call).toEqual([1, undefined, { rootEventId: 'root-edit' }]);
  });
  it('scopes driver accept and decline delivery to their committed booking version', async () => {
    mocks.roots.mockResolvedValue([{ id: 'driver-root', type: 'booking.driver_accepted', payload: { bookingId: 'booking-one' } }]);
    scheduleDriverBookingEdit('booking-one', 9);
    expect(mocks.roots).not.toHaveBeenCalled();
    const task = mocks.after.mock.calls[0]?.[0];
    if (!task) throw new Error('Expected a driver dispatch task.');
    await task();
    expect(mocks.roots).toHaveBeenCalledWith(expect.objectContaining({ where: { dedupeKey: { startsWith: 'driver-booking:booking-one:9:' } } }));
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith(1, undefined, { rootEventId: 'driver-root' });
    mocks.roots.mockClear();
    await dispatchDriverBookingEdit('booking-one', 10);
    expect(mocks.roots).toHaveBeenCalledWith(expect.objectContaining({ where: { dedupeKey: { startsWith: 'driver-booking:booking-one:10:' } } }));
  });
  it('follows only the completion of the refund created by this edit', async () => {
    mocks.roots.mockResolvedValue([{ id: 'root-refund', type: 'payment.refund', payload: { refundId: 'refund-edit' } }]);
    mocks.completion.mockResolvedValue({ id: 'root-refund-completed' });
    await dispatchAdminBookingEdit('booking-one', 8);
    expect(mocks.completion).toHaveBeenCalledExactlyOnceWith({ where: { dedupeKey: 'payment.refund.created:refund-edit' }, select: { id: true } });
    expect(mocks.process.mock.calls).toEqual([[1, undefined, { rootEventId: 'root-refund' }], [1, undefined, { rootEventId: 'root-refund-completed' }]]);
  });
  it('bounds work and leaves remaining durable events to the existing retry worker', async () => {
    mocks.roots.mockResolvedValue([{ id: 'root-edit', type: 'booking.updated', payload: {} }]);
    mocks.process.mockResolvedValue({ done: 1, failed: 0 });
    await dispatchAdminBookingEdit('booking-one', 8);
    expect(mocks.process).toHaveBeenCalledTimes(40);
  });
  it('reports a scheduling failure without turning a committed edit into a failed save', () => {
    mocks.after.mockImplementation(() => { throw new Error('Scheduling unavailable'); });
    expect(() => { scheduleAdminBookingEdit('booking-one', 8); }).not.toThrow();
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });
  it('reports dispatch errors while retaining durable retry eligibility', async () => {
    mocks.roots.mockRejectedValue(new Error('Temporary database failure'));
    await dispatchAdminBookingEdit('booking-one', 8);
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });
});
