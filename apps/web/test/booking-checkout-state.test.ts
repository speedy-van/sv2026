import { AppError, BookingStatusResponseSchema, type BookingCreateSchema } from '@sv/contracts';
import type { z } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bookingCreate: vi.fn(),
  bookingFindUnique: vi.fn(),
  createOrRetrievePaymentIntent: vi.fn(),
  getSetting: vi.fn(),
  manageLinkForBooking: vi.fn(),
  paymentUpdate: vi.fn(),
  quoteFindUnique: vi.fn(),
  transaction: vi.fn(),
  verifyBookingStatusToken: vi.fn(),
}));

vi.mock('@sv/db', () => ({
  assertSlotCapacity: vi.fn(),
  Prisma: { DbNull: null },
  prisma: {
    $transaction: mocks.transaction,
    booking: { create: mocks.bookingCreate, findUnique: mocks.bookingFindUnique },
    payment: { update: mocks.paymentUpdate },
    quote: { findUnique: mocks.quoteFindUnique },
  },
}));
vi.mock('../src/server/integrations/stripe', () => ({ createOrRetrievePaymentIntent: mocks.createOrRetrievePaymentIntent }));
vi.mock('../src/server/status-token', () => ({
  bookingStatusToken: () => 'signed-status-token-for-tests',
  verifyBookingStatusToken: mocks.verifyBookingStatusToken,
}));
vi.mock('../src/server/auth/customer-links', () => ({ manageLinkForBooking: mocks.manageLinkForBooking }));
vi.mock('../src/server/settings', () => ({ getSetting: mocks.getSetting, getOperationsSettings: vi.fn() }));
vi.mock('../src/server/services/availability', () => ({ overlayAvailability: vi.fn() }));
vi.mock('../src/server/services/catalogue', () => ({ getActivePricingConfig: vi.fn() }));

import { bookingStatusFromToken, createBookingFromQuote } from '../src/server/services/booking';

type PaymentStatus = 'REQUIRES_PAYMENT' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
type BookingStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED';

const now = new Date('2031-03-01T12:00:00.000Z');
const futureHold = new Date('2031-03-01T12:15:00.000Z');
const pickup = {
  label: '1 George Square, Glasgow G2 1DU',
  lat: 55.861,
  line1: '1 George Square',
  lng: -4.25,
  mapboxId: 'test:glasgow',
  postcode: 'G2 1DU',
  source: 'MAPBOX',
  town: 'Glasgow',
};

function payment(status: PaymentStatus = 'REQUIRES_PAYMENT') {
  return {
    amountPence: 15200,
    bookingId: 'booking-checkout',
    currency: 'gbp',
    id: 'payment-checkout',
    kind: 'BOOKING',
    status,
    stripePaymentIntentId: 'pi_existing_checkout',
  };
}

function booking(options: { hold?: Date | null; paymentStatus?: PaymentStatus | null; status?: BookingStatus } = {}) {
  const paymentStatus = options.paymentStatus === undefined ? 'REQUIRES_PAYMENT' : options.paymentStatus;
  return {
    contactEmail: 'checkout@example.test',
    dropoff: null,
    holdExpiresAt: options.hold === undefined ? futureHold : options.hold,
    id: 'booking-checkout',
    moveDate: new Date('2031-03-04T00:00:00.000Z'),
    payments: paymentStatus === null ? [] : [payment(paymentStatus)],
    pickup,
    reference: 'SV-ABC123',
    service: 'man-and-van',
    slot: 'MORNING',
    status: options.status ?? 'PENDING_PAYMENT',
    totalPence: 15200,
  };
}

const bookingInput: z.infer<typeof BookingCreateSchema> = {
  contact: { email: 'checkout@example.test', name: 'Checkout Test', phone: '+447700900111' },
  date: '2031-03-04',
  expectedTotalPence: 15200,
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  marketingOptIn: false,
  quotePublicId: 'test-quote-public-id',
  slot: 'MORNING',
  startWithinCancellationPeriodAck: true,
  termsAccepted: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  mocks.getSetting.mockImplementation((key: string) => Promise.resolve(
    key === 'legal' ? { requireExpressStartAck: false } : { canonicalOrigin: 'https://example.test' },
  ));
  mocks.verifyBookingStatusToken.mockReturnValue({ bookingId: 'booking-checkout', reference: 'SV-ABC123' });
  mocks.manageLinkForBooking.mockResolvedValue('signed-manage-link');
  mocks.createOrRetrievePaymentIntent.mockResolvedValue({ clientSecret: 'pi_existing_checkout_secret_test', id: 'pi_existing_checkout' });
});

afterEach(() => { vi.useRealTimers(); });

describe('booking checkout status without database or Stripe access', () => {
  it.each([
    ['REQUIRES_PAYMENT', true],
    ['FAILED', true],
    ['PROCESSING', false],
    ['SUCCEEDED', false],
    ['CANCELED', false],
    [null, false],
  ] as const)('reports payment %s with canRetry=%s', async (paymentStatus, canRetry) => {
    mocks.bookingFindUnique.mockResolvedValue(booking({ paymentStatus }));
    const result = await bookingStatusFromToken('signed-token');
    expect(result.checkout).toEqual({ canRetry, holdExpiresAt: futureHold.toISOString(), paymentStatus });
    expect(mocks.bookingFindUnique.mock.calls[0]?.[0]).toMatchObject({
      select: {
        holdExpiresAt: true,
        payments: {
          orderBy: { createdAt: 'desc' },
          select: { status: true },
          take: 1,
          where: { kind: { in: ['BOOKING', 'ADMIN_BOOKING', 'MANUAL_QUOTE'] } },
        },
      },
    });
    expect(mocks.createOrRetrievePaymentIntent).not.toHaveBeenCalled();
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/clientSecret|stripePaymentIntentId|pi_existing_checkout|checkout@example/);
  });

  it.each([null, now, new Date(now.getTime() - 1)])('never permits retry when hold is %s', async (hold) => {
    mocks.bookingFindUnique.mockResolvedValue(booking({ hold }));
    expect((await bookingStatusFromToken('signed-token')).checkout?.canRetry).toBe(false);
  });

  it.each(['CONFIRMED', 'EXPIRED', 'CANCELLED'] as const)('never permits retry for booking %s', async (status) => {
    mocks.bookingFindUnique.mockResolvedValue(booking({ status }));
    const result = await bookingStatusFromToken('signed-token');
    expect(result.checkout?.canRetry).toBe(false);
    expect(mocks.manageLinkForBooking).toHaveBeenCalledTimes(status === 'CONFIRMED' ? 1 : 0);
  });

  it('preserves token validation before fetching a booking', async () => {
    mocks.verifyBookingStatusToken.mockImplementation(() => { throw new AppError('UNAUTHORIZED', 'Invalid booking status token.'); });
    await expect(bookingStatusFromToken('invalid-token')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mocks.bookingFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a valid token whose reference does not match the booking', async () => {
    mocks.bookingFindUnique.mockResolvedValue({ ...booking(), reference: 'SV-DEF456' });
    await expect(bookingStatusFromToken('signed-token')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.manageLinkForBooking).not.toHaveBeenCalled();
  });

  it('keeps checkout optional for existing responses while validating all checkout fields', () => {
    const legacy = { manageUrl: 'https://example.test/manage', reference: 'SV-ABC123', status: 'PENDING_PAYMENT', summary: null };
    expect(BookingStatusResponseSchema.safeParse(legacy).success).toBe(true);
    expect(BookingStatusResponseSchema.safeParse({ ...legacy, checkout: { canRetry: false, holdExpiresAt: null, paymentStatus: null } }).success).toBe(true);
    expect(BookingStatusResponseSchema.safeParse({ ...legacy, checkout: { canRetry: true, holdExpiresAt: null, paymentStatus: 'UNKNOWN' } }).success).toBe(false);
  });
});

describe('idempotent checkout retries', () => {
  it.each(['REQUIRES_PAYMENT', 'FAILED'] as const)('reuses the same booking and payment for %s', async (paymentStatus) => {
    mocks.bookingFindUnique.mockResolvedValue(booking({ paymentStatus }));
    const first = await createBookingFromQuote(bookingInput, now);
    const second = await createBookingFromQuote(bookingInput, now);
    expect(first).toEqual(second);
    expect(first.reference).toBe('SV-ABC123');
    expect(first.totalPence).toBe(15200);
    expect(first.clientSecret).toBe('pi_existing_checkout_secret_test');
    expect(mocks.createOrRetrievePaymentIntent).toHaveBeenCalledTimes(2);
    expect(mocks.createOrRetrievePaymentIntent).toHaveBeenCalledWith(expect.objectContaining({
      amountPence: 15200,
      id: 'payment-checkout',
      stripePaymentIntentId: 'pi_existing_checkout',
    }));
    expect(mocks.bookingFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { idempotencyKey: bookingInput.idempotencyKey } }));
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.quoteFindUnique).not.toHaveBeenCalled();
    expect(mocks.paymentUpdate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each(['PROCESSING', 'SUCCEEDED', 'CANCELED'] as const)('rejects payment %s before retrieving its intent', async (paymentStatus) => {
    mocks.bookingFindUnique.mockResolvedValue(booking({ paymentStatus }));
    await expect(createBookingFromQuote(bookingInput, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.createOrRetrievePaymentIntent).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([null, now, new Date(now.getTime() - 1)])('rejects an absent or elapsed hold %s before retrieving its intent', async (hold) => {
    mocks.bookingFindUnique.mockResolvedValue(booking({ hold }));
    await expect(createBookingFromQuote(bookingInput, now)).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    expect(mocks.createOrRetrievePaymentIntent).not.toHaveBeenCalled();
  });

  it.each(['CONFIRMED', 'EXPIRED', 'CANCELLED'] as const)('rejects booking %s before retrieving its intent', async (status) => {
    mocks.bookingFindUnique.mockResolvedValue(booking({ status }));
    await expect(createBookingFromQuote(bookingInput, now)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(mocks.createOrRetrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('reports a missing initial payment without creating a replacement', async () => {
    mocks.bookingFindUnique.mockResolvedValue(booking({ paymentStatus: null }));
    await expect(createBookingFromQuote(bookingInput, now)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(mocks.createOrRetrievePaymentIntent).not.toHaveBeenCalled();
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
