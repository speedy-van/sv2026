import { BookingCreateResponseSchema, CouponCheckResponseSchema } from '@sv/contracts';
import { couponCodeHash, prisma } from '@sv/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as postBooking } from '../src/app/api/v1/bookings/route';
import { POST as postCouponCheck } from '../src/app/api/v1/coupons/check/route';
import { constructStripeEvent } from '../src/server/integrations/stripe';
import { expireBookingHolds } from '../src/server/services/hold-expiry';
import { handleStripeEvent } from '../src/server/services/stripe-webhook';
import { createQuote, type QuoteRequest } from '../src/server/services/quote';

const CODE = 'SV-TEST-COUP-ON01-ABCD';
const SPENT_CODE = 'SV-TEST-COUP-ON02-ABCD';
const HIGH_CODE = 'SV-TEST-COUP-ON03-ABCD';
const createdQuoteIds: string[] = [];
const createdBookingIds: string[] = [];
const createdCustomerEmails: string[] = [];
const createdStripeEvents: string[] = [];
const testStartedAt = new Date();
const quoteNow = new Date('2031-04-01T00:00:00.000Z');
const originalStripeSecretKey = process.env.STRIPE_SECRET_KEY;
const originalStripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

const access: QuoteRequest['pickupAccess'] = {
  carryMetres: 10,
  floorChoice: 'GROUND',
  hasLift: false,
  narrowAccess: false,
  permitZone: false,
};

const glasgow: QuoteRequest['pickup'] = {
  label: '1 George Square, Glasgow G2 1DU',
  lat: 55.861,
  line1: '1 George Square',
  lng: -4.25,
  mapboxId: 'mock:glasgow',
  postcode: 'G2 1DU',
  source: 'MAPBOX',
  town: 'Glasgow',
};

const paisley: QuoteRequest['pickup'] = {
  label: '1 County Place, Paisley PA1 1BN',
  lat: 55.846,
  line1: '1 County Place',
  lng: -4.423,
  mapboxId: 'mock:paisley',
  postcode: 'PA1 1BN',
  source: 'MAPBOX',
  town: 'Paisley',
};

async function pricedOffer(date: string) {
  const quote = await createQuote({
    addons: { assembly: false, helpers: 0, packing: false },
    dropoff: paisley,
    dropoffAccess: access,
    items: [{ itemSlug: 'sofa-2-seater', kind: 'catalogue', quantity: 1 }],
    pickup: glasgow,
    pickupAccess: access,
    service: 'man-and-van',
    variant: 'standard',
  }, { now: quoteNow });
  createdQuoteIds.push(quote.quote.publicId);
  const offer = quote.quote.calendar.find((day) => day.date === date)?.slots.find((slot) => slot.slot === 'MORNING');
  if (!offer) throw new Error(`Missing offer for ${date}`);
  return { listPricePence: offer.pricePence, quotePublicId: quote.quote.publicId };
}

function post(handler: (request: Request) => Promise<Response>, url: string, body: unknown): Promise<Response> {
  return handler(new Request(url, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `203.0.113.${String(Math.floor(Math.random() * 200) + 1)}`,
    },
    method: 'POST',
  }));
}

function bookingBody(params: { couponCode?: string; date: string; email: string; listPricePence: number; quotePublicId: string }) {
  createdCustomerEmails.push(params.email);
  return {
    contact: { email: params.email, name: 'Coupon Customer', phone: '+447700900321' },
    ...(params.couponCode ? { couponCode: params.couponCode } : {}),
    date: params.date,
    expectedTotalPence: params.listPricePence,
    idempotencyKey: randomUUID(),
    marketingOptIn: false,
    quotePublicId: params.quotePublicId,
    slot: 'MORNING',
    startWithinCancellationPeriodAck: true,
    termsAccepted: true,
  };
}

async function couponState(code: string) {
  return prisma.coupon.findUniqueOrThrow({ where: { codeHash: couponCodeHash(code) }, select: { id: true, redemptionCount: true } });
}

beforeAll(async () => {
  process.env.MAPBOX_MODE = 'mock';
  process.env.STRIPE_SECRET_KEY = '';
  process.env.STRIPE_WEBHOOK_SECRET = '';
  const expiresAt = new Date(Date.now() + 86_400_000);
  await prisma.coupon.createMany({
    data: [
      { codeHash: couponCodeHash(CODE), expiresAt, fixedTotalPence: 100, note: 'coupon-checkout test' },
      { codeHash: couponCodeHash(SPENT_CODE), expiresAt, fixedTotalPence: 100, note: 'coupon-checkout test', redemptionCount: 1 },
      { codeHash: couponCodeHash(HIGH_CODE), expiresAt, fixedTotalPence: 9_999_999, note: 'coupon-checkout test' },
    ],
  });
});

afterAll(async () => {
  process.env.STRIPE_SECRET_KEY = originalStripeSecretKey;
  process.env.STRIPE_WEBHOOK_SECRET = originalStripeWebhookSecret;
  if (createdBookingIds.length > 0) {
    await prisma.outboxEvent.deleteMany({
      where: { createdAt: { gte: testStartedAt }, OR: createdBookingIds.map((id) => ({ dedupeKey: { contains: id } })) },
    });
  }
  await prisma.stripeEvent.deleteMany({ where: { id: { in: createdStripeEvents } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
  await prisma.quote.deleteMany({ where: { publicId: { in: createdQuoteIds } } });
  await prisma.customer.deleteMany({ where: { email: { in: createdCustomerEmails } } });
  await prisma.coupon.deleteMany({ where: { note: 'coupon-checkout test' } });
  await prisma.$disconnect();
});

describe('one-time checkout coupons', () => {
  it('previews the coupon price without reserving it', async () => {
    const offer = await pricedOffer('2031-04-08');
    const response = await post(postCouponCheck, 'http://localhost/api/v1/coupons/check', {
      couponCode: CODE.toLowerCase(),
      date: '2031-04-08',
      expectedTotalPence: offer.listPricePence,
      quotePublicId: offer.quotePublicId,
      slot: 'MORNING',
    });
    expect(response.status).toBe(200);
    expect(CouponCheckResponseSchema.parse(await response.json())).toEqual({ listPricePence: offer.listPricePence, totalPence: 100 });
    expect((await couponState(CODE)).redemptionCount).toBe(0);
  });

  it('rejects unknown, spent and price-raising codes with the same message', async () => {
    const offer = await pricedOffer('2031-04-09');
    const messages: string[] = [];
    for (const couponCode of ['SV-NOPE-NOPE-NOPE-NOPE', SPENT_CODE, HIGH_CODE]) {
      const response = await post(postCouponCheck, 'http://localhost/api/v1/coupons/check', {
        couponCode,
        date: '2031-04-09',
        expectedTotalPence: offer.listPricePence,
        quotePublicId: offer.quotePublicId,
        slot: 'MORNING',
      });
      expect(response.status).toBe(400);
      const body = await response.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
      messages.push(body.error.message);
    }
    expect(new Set(messages).size).toBe(1);
  });

  it('charges the coupon total, records the list price and confirms on the matching Stripe amount', async () => {
    const offer = await pricedOffer('2031-04-10');
    const response = await post(postBooking, 'http://localhost/api/v1/bookings', bookingBody({
      couponCode: CODE,
      date: '2031-04-10',
      email: 'coupon-paid@example.test',
      ...offer,
    }));
    expect(response.status).toBe(201);
    const created = BookingCreateResponseSchema.parse(await response.json());
    expect(created.totalPence).toBe(100);
    const booking = await prisma.booking.findUniqueOrThrow({
      where: { reference: created.reference },
      select: { couponId: true, id: true, payments: { select: { amountPence: true, bookingId: true, id: true, stripePaymentIntentId: true } }, priceBreakdown: true, totalPence: true },
    });
    createdBookingIds.push(booking.id);
    const coupon = await couponState(CODE);
    expect(booking.couponId).toBe(coupon.id);
    expect(coupon.redemptionCount).toBe(1);
    expect(booking.totalPence).toBe(100);
    expect(booking.payments).toHaveLength(1);
    expect(booking.payments[0]?.amountPence).toBe(100);
    expect(booking.priceBreakdown).toMatchObject({ coupon: { listPricePence: offer.listPricePence } });

    const payment = booking.payments[0];
    if (!payment) throw new Error('Payment missing');
    const eventId = `evt_coupon_${randomUUID()}`;
    createdStripeEvents.push(eventId);
    // Call the webhook service directly: the route's next/server after() needs a live request scope.
    const result = await handleStripeEvent(constructStripeEvent(JSON.stringify({
      data: {
        object: {
          amount: 100,
          amount_received: 100,
          currency: 'gbp',
          id: payment.stripePaymentIntentId,
          latest_charge: 'ch_mock_coupon',
          metadata: { bookingId: payment.bookingId, paymentId: payment.id },
          object: 'payment_intent',
        },
      },
      id: eventId,
      object: 'event',
      type: 'payment_intent.succeeded',
    }), null));
    expect(result).toBe('processed');
    const confirmed = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { paidPence: true, status: true } });
    expect(confirmed).toEqual({ paidPence: 100, status: 'CONFIRMED' });
  });

  it('refuses a second redemption of a one-time code', async () => {
    const offer = await pricedOffer('2031-04-11');
    const response = await post(postBooking, 'http://localhost/api/v1/bookings', bookingBody({
      couponCode: CODE,
      date: '2031-04-11',
      email: 'coupon-second@example.test',
      ...offer,
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect((await couponState(CODE)).redemptionCount).toBe(1);
  });

  it('releases the coupon when an unpaid hold expires', async () => {
    await prisma.coupon.update({ data: { redemptionCount: 0 }, where: { codeHash: couponCodeHash(SPENT_CODE) } });
    const offer = await pricedOffer('2031-04-12');
    const response = await post(postBooking, 'http://localhost/api/v1/bookings', bookingBody({
      couponCode: SPENT_CODE,
      date: '2031-04-12',
      email: 'coupon-abandoned@example.test',
      ...offer,
    }));
    expect(response.status).toBe(201);
    const created = BookingCreateResponseSchema.parse(await response.json());
    const booking = await prisma.booking.findUniqueOrThrow({ where: { reference: created.reference }, select: { id: true } });
    createdBookingIds.push(booking.id);
    expect((await couponState(SPENT_CODE)).redemptionCount).toBe(1);

    await prisma.booking.update({ data: { holdExpiresAt: new Date(Date.now() - 60_000) }, where: { id: booking.id } });
    await expireBookingHolds(new Date());
    const expired = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, select: { status: true } });
    expect(expired.status).toBe('EXPIRED');
    expect((await couponState(SPENT_CODE)).redemptionCount).toBe(0);
  });
});
