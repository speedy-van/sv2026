import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ booking: vi.fn(), quote: vi.fn() }));
vi.mock('@sv/db', () => ({ prisma: { booking: { findUnique: mocks.booking }, manualQuote: { findUnique: mocks.quote } } }));
vi.mock('../src/server/auth/customer-links', () => ({ contactEmailHash: (email: string) => `hash:${email}` }));
import { prisma } from '@sv/db';
import { actionEmailStillValid, readActionEmailGuard, type ActionEmailGuard } from '../src/server/notifications/action-email-guard';
const now = new Date('2031-01-01T12:00:00Z');
const booking = { version: 4, contactEmail: 'customer@example.test', status: 'PENDING_PAYMENT', deletedAt: null, holdExpiresAt: new Date('2031-01-01T13:00:00Z') };
const guard: ActionEmailGuard = { kind: 'booking', id: 'booking-one', version: 4, emailHash: 'hash:customer@example.test', template: 'PAYMENT_LINK' };
beforeEach(() => { vi.resetAllMocks(); mocks.booking.mockResolvedValue(booking); });
describe('queued administrative emails are rechecked at delivery', () => {
  it('allows the unchanged pending booking within its hold', async () => { expect(await actionEmailStillValid(prisma, guard, now)).toBe(true); });
  it.each([{ status: 'CANCELLED' }, { status: 'CONFIRMED' }, { version: 5 }, { contactEmail: 'replacement@example.test' }, { deletedAt: now }, { holdExpiresAt: now }, { holdExpiresAt: null }])('drops a stale payment email after %j', async (changed) => {
    mocks.booking.mockResolvedValue({ ...booking, ...changed }); expect(await actionEmailStillValid(prisma, guard, now)).toBe(false);
  });
  it('does not resend a confirmation for a cancelled booking', async () => {
    mocks.booking.mockResolvedValue({ ...booking, status: 'CANCELLED' });
    expect(await actionEmailStillValid(prisma, { ...guard, template: 'CONFIRMATION' }, now)).toBe(false);
  });
  it('keeps automatic confirmation across a notes edit but rejects cancellation or changed contact', async () => {
    const automatic: ActionEmailGuard = { kind: 'booking-confirmation', id: 'booking-one', emailHash: guard.emailHash };
    mocks.booking.mockResolvedValue({ ...booking, status: 'CONFIRMED', version: 5 });
    expect(await actionEmailStillValid(prisma, automatic, now)).toBe(true);
    mocks.booking.mockResolvedValue({ ...booking, status: 'CANCELLED' });
    expect(await actionEmailStillValid(prisma, automatic, now)).toBe(false);
    mocks.booking.mockResolvedValue({ ...booking, status: 'CONFIRMED', contactEmail: 'replacement@example.test' });
    expect(await actionEmailStillValid(prisma, automatic, now)).toBe(false);
  });
  it('accepts a current priced quote but rejects a replacement, decline, or expired price', async () => {
    const quote = { status: 'PRICED', updatedAt: now, validUntil: new Date('2031-01-01T13:00:00Z') };
    const quoteGuard: ActionEmailGuard = { kind: 'manual-quote', id: 'quote-one', expectedUpdatedAt: now.toISOString(), status: 'PRICED' };
    mocks.quote.mockResolvedValue(quote); expect(await actionEmailStillValid(prisma, quoteGuard, now)).toBe(true);
    for (const changed of [{ status: 'DECLINED' }, { status: 'ACCEPTED' }, { updatedAt: new Date(now.getTime() + 1) }, { validUntil: now }]) {
      mocks.quote.mockResolvedValue({ ...quote, ...changed }); expect(await actionEmailStillValid(prisma, quoteGuard, now)).toBe(false);
    }
  });
  it('fails closed for a malformed stored guard', () => { expect(() => readActionEmailGuard({ actionEmailGuard: { kind: 'booking' } })).toThrow(); });
});
