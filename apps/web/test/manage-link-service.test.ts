import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findBooking: vi.fn(), enqueue: vi.fn(), getSetting: vi.fn(), signLink: vi.fn() }));
vi.mock('@sv/db', () => ({
  assertSlotCapacity: vi.fn(),
  enqueueOutbox: mocks.enqueue,
  Prisma: {},
  prisma: { booking: { findFirst: mocks.findBooking } },
}));
vi.mock('../src/server/integrations/stripe', () => ({ createOrRetrievePaymentIntent: vi.fn() }));
vi.mock('../src/server/settings', () => ({ getOperationsSettings: vi.fn(), getSetting: mocks.getSetting }));
vi.mock('../src/server/services/catalogue', () => ({ getActivePricingConfig: vi.fn() }));
vi.mock('../src/server/services/payments', () => ({ requestRefund: vi.fn() }));
vi.mock('../src/server/auth/customer-links', () => ({
  bookingPurposeLink: vi.fn(), contactEmailHash: () => 'hashed-test-email', manageLinkForBooking: mocks.signLink,
  signCustomerLink: vi.fn(), verifyBookingLink: vi.fn(), verifyCustomerLink: vi.fn(),
}));

import { requestManageLink } from '../src/server/services/customer-self-service';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signLink.mockResolvedValue('signed-test-link');
  mocks.enqueue.mockResolvedValue({ id: 'scoped-manage-email' });
  mocks.getSetting.mockImplementation((key: string) => Promise.resolve(
    key === 'web' ? { canonicalOrigin: 'https://example.test' }
      : key === 'contact' ? { emailBookings: 'bookings@example.test', emailPublic: null }
        : { legalName: null },
  ));
});

describe('private manage-link delivery reference', () => {
  it('returns only the queued email id to the route while retaining the intended recipient and signed link', async () => {
    const now = new Date('2031-01-01T12:00:00.000Z');
    const booking = { contactEmail: 'matched@example.test', id: 'booking-test', moveDate: now, reference: 'SV-ABC123' };
    mocks.findBooking.mockResolvedValue(booking);
    expect(await requestManageLink({ email: 'matched@example.test', reference: 'sv abc123' }, now)).toBe('scoped-manage-email');
    expect(mocks.findBooking).toHaveBeenCalledWith({
      where: { contactEmail: 'matched@example.test', reference: 'SV-ABC123' },
      select: { contactEmail: true, id: true, moveDate: true, reference: true },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.anything(), 'email.send', expect.objectContaining({
      template: 'manage-link', to: ['matched@example.test'],
      data: { canonicalOrigin: 'https://example.test', contactEmail: 'bookings@example.test', legalLine: null, manageUrl: '/manage/session?token=signed-test-link', reference: 'SV-ABC123' },
    }), expect.stringMatching(/^manage-link:booking-test:hashed-test-email:/u));
  });

  it('returns no delivery id and creates no email when the booking does not match', async () => {
    mocks.findBooking.mockResolvedValue(null);
    expect(await requestManageLink({ email: 'unmatched@example.test', reference: 'SV-UNKNOWN' })).toBeNull();
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.signLink).not.toHaveBeenCalled();
  });
});
