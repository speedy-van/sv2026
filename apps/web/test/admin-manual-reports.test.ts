import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbTx } from '@sv/db';
const mocks = vi.hoisted(() => ({ manual: vi.fn(), manuals: vi.fn(), update: vi.fn(), audit: vi.fn(), enqueue: vi.fn(), capacity: vi.fn(), transaction: vi.fn(), operations: vi.fn(), bookings: vi.fn(), quotesCount: vi.fn(), manualCount: vi.fn() }));
vi.mock('@sv/db', () => ({ assertSlotCapacity: mocks.capacity, enqueueOutbox: mocks.enqueue, prisma: { manualQuote: { findUnique: mocks.manual, findMany: mocks.manuals, updateMany: mocks.update, count: mocks.manualCount }, booking: { findMany: mocks.bookings }, quote: { count: mocks.quotesCount }, auditLog: { create: mocks.audit }, $transaction: mocks.transaction } }));
vi.mock('../src/server/settings', () => ({ getOperationsSettings: mocks.operations }));
import { prisma } from '@sv/db';
import { declineAdminManualQuote, listAdminManualQuotes, priceAdminManualQuote, readAdminManualQuote } from '../src/server/admin/manual-quotes';
import { csvCell, exportAdminReports, readAdminReports } from '../src/server/admin/reports';
const now = new Date('2031-01-01T12:00:00Z'); const actor = { userId: 'admin-1', requestId: 'request-1', role: 'ADMIN' as const };
const address = { line1: '12 Byres Road', town: 'Glasgow', postcode: 'G11 5JY', lat: 55.87, lng: -4.29, label: '12 Byres Road, Glasgow', source: 'MANUAL' };
function manual() { return { id: 'manual-1', status: 'REQUESTED', contactName: 'Test Customer', contactEmail: 'test@example.test', contactPhone: '+447700900123', createdAt: now, updatedAt: now, preferredDate: null, preferredSlot: null, pricePence: null, adminMessage: null, validUntil: null, bookingId: null, details: 'Large move', reasons: ['LONG_DISTANCE'], quote: { distanceMiles: 20, durationMinutes: 35, input: {}, accessDetail: {}, service: 'man-and-van', variant: 'standard', pickup: address, dropoff: null, capacityUnits: 1, blocksSlots: 1 } }; }
beforeEach(() => { vi.resetAllMocks(); mocks.manual.mockResolvedValue(manual()); mocks.manuals.mockResolvedValue([manual()]); mocks.update.mockResolvedValue({ count: 1 }); mocks.transaction.mockImplementation((run: (tx: DbTx) => Promise<unknown>) => run(prisma)); mocks.operations.mockResolvedValue({ minLeadMinutes: 60, bookingPaused: false, slotWindows: { MORNING: { start: '08:00' } } }); });
describe('manual quote administration', () => {
  const input = { expectedUpdatedAt: now.toISOString(), date: '2031-01-02', slot: 'MORNING' as const, pricePence: 45000, message: 'Agreed price', validForHours: 48 };
  it('returns the persisted customer request and paginates without exposing raw quote JSON', async () => {
    expect(await readAdminManualQuote('manual-1')).toMatchObject({ contact: { email: 'test@example.test' }, pickupLabel: address.label, details: 'Large move' });
    expect(await listAdminManualQuotes({ limit: 25 })).toMatchObject({ items: [{ id: 'manual-1' }], nextCursor: null });
  });
  it('checks capacity and clamps validity to the move cutoff', async () => {
    const changed = await priceAdminManualQuote('manual-1', input, actor, now);
    expect(changed.updatedAt).not.toBe(now.toISOString());
    expect(mocks.capacity).toHaveBeenCalledOnce();
    expect(mocks.update).toHaveBeenCalledWith(contains({ where: { id: 'manual-1', updatedAt: now, bookingId: null, status: 'REQUESTED' }, data: contains({ pricePence: 45000, validUntil: new Date('2031-01-02T07:00:00Z'), adminMessage: 'Agreed price' }) }));
    expect(mocks.enqueue).toHaveBeenCalledWith(prisma, 'manual_quote.priced', { manualQuoteId: 'manual-1', expectedUpdatedAt: changed.updatedAt }, `manual-quote:manual-1:${changed.updatedAt}:priced`);
  });
  it('rejects past slots, stale edits and already booked requests', async () => {
    await expect(priceAdminManualQuote('manual-1', { ...input, date: '2031-01-01' }, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(priceAdminManualQuote('manual-1', { ...input, expectedUpdatedAt: '2030-01-01T00:00:00.000Z' }, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    mocks.manual.mockResolvedValue({ ...manual(), bookingId: 'booking-1' });
    await expect(priceAdminManualQuote('manual-1', input, actor, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('declines with the admin reason and invalidates the payment link', async () => {
    await declineAdminManualQuote('manual-1', { expectedUpdatedAt: now.toISOString(), message: 'No suitable vehicle' }, actor, now);
    expect(mocks.update).toHaveBeenCalledWith(contains({ data: contains({ status: 'DECLINED', validUntil: null, adminMessage: 'No suitable vehicle' }) })); expect(mocks.audit).toHaveBeenCalledOnce();
  });
});
describe('actual booking reports and CSV export', () => {
  const range = { from: '2031-03-29', to: '2031-03-30' };
  beforeEach(() => { mocks.bookings.mockResolvedValue([{ id: 'booking-1', reference: 'SV-TEST12', createdAt: now, moveDate: now, slot: 'MORNING', status: 'CANCELLED', source: 'WEB', service: 'man-and-van', pickup: address, contactName: '=HYPERLINK("bad")', contactEmail: 'customer@example.test', totalPence: 10000, paidPence: 10000, refundedPence: 5000 }]); mocks.quotesCount.mockResolvedValue(5); mocks.manualCount.mockResolvedValue(2); });
  it('uses persisted amounts including refunded and cancelled records and London date boundaries', async () => {
    expect(await readAdminReports(range)).toMatchObject({ bookings: 1, cancelled: 1, paidPence: 10000, refundedPence: 5000, netPaidPence: 5000, quotes: 5, manualQuotes: 2, topTowns: [{ label: 'Glasgow', bookings: 1 }] });
    expect(mocks.bookings).toHaveBeenCalledWith(contains({ where: { createdAt: { gte: new Date('2031-03-29T00:00:00Z'), lt: new Date('2031-03-30T23:00:00Z') } } }));
  });
  it('escapes CSV content and neutralises spreadsheet formulas', async () => {
    const csv = await exportAdminReports(range); expect(csv.content).toContain("'=HYPERLINK"); expect(csv.content).toContain('10000');
    expect(csvCell('a,"b"')).toBe('"a,""b"""'); expect(csvCell('  +SUM(A1)')).toBe('"\'  +SUM(A1)"');
  });
  it('refuses oversized ranges and oversized reports instead of silently truncating', async () => {
    await expect(readAdminReports({ from: '2030-01-01', to: '2032-01-01' })).rejects.toThrow();
    mocks.bookings.mockResolvedValue(Array.from({ length: 20001 }, () => ({})));
    await expect(exportAdminReports(range)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

function contains(value: unknown): unknown { return expect.objectContaining(value); }
