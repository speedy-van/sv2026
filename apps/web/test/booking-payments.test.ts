import { BookingCreateResponseSchema } from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST as postBooking } from '../src/app/api/v1/bookings/route';
import { POST as postStripeWebhook } from '../src/app/api/webhooks/stripe/route';
import { bookingIcs } from '../src/server/ics';
import { processOutboxEventNow } from '../src/server/outbox/processor';
import { createQuote, type QuoteRequest } from '../src/server/services/quote';

const createdQuoteIds: string[] = [];
const createdBookingIds: string[] = [];
const createdBookingRefs: string[] = [];
const createdCustomerEmails: string[] = [];
const createdStripeEvents: string[] = [];
const testStartedAt = new Date();

const pickupAccess: QuoteRequest['pickupAccess'] = {
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

const edinburgh: QuoteRequest['pickup'] = {
  label: '1 Princes Street, Edinburgh EH1 1BB',
  lat: 55.953,
  line1: '1 Princes Street',
  lng: -3.189,
  mapboxId: 'mock:edinburgh',
  postcode: 'EH1 1BB',
  source: 'MAPBOX',
  town: 'Edinburgh',
};

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function quoteRequest(): QuoteRequest {
  return {
    addons: { assembly: false, helpers: 0, packing: false },
    dropoff: edinburgh,
    dropoffAccess: pickupAccess,
    items: [{ itemSlug: 'sofa-2-seater', kind: 'catalogue', quantity: 1 }],
    pickup: glasgow,
    pickupAccess,
    service: 'man-and-van',
    variant: 'standard',
  };
}

async function activePricingVersionId(): Promise<string> {
  const version = await prisma.pricingConfigVersion.findFirst({
    orderBy: { version: 'desc' },
    select: { id: true },
    where: { status: 'ACTIVE' },
  });
  if (!version) throw new Error('Missing active pricing version');
  return version.id;
}

async function createPricedQuote(date: string, slot: 'MORNING' | 'AFTERNOON' | 'EVENING', now: Date) {
  const quote = await createQuote(quoteRequest(), { now });
  createdQuoteIds.push(quote.quote.publicId);
  const day = quote.quote.calendar.find((candidate) => candidate.date === date);
  const offer = day?.slots.find((candidate) => candidate.slot === slot);
  if (!offer) throw new Error(`Missing offer for ${date} ${slot}`);
  return { offer, quote: quote.quote };
}

async function postBookingRequest(body: unknown): Promise<Response> {
  return postBooking(new Request('http://localhost/api/v1/bookings', {
    body: JSON.stringify(body),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.100.${String(Math.floor(Math.random() * 100) + 1)}`,
    },
    method: 'POST',
  }));
}

async function createPendingBooking(params: { date: string; email: string; now: Date; slot?: 'MORNING' | 'AFTERNOON' | 'EVENING' }) {
  const slot = params.slot ?? 'MORNING';
  const priced = await createPricedQuote(params.date, slot, params.now);
  const idempotencyKey = randomUUID();
  const body = {
    contact: { email: params.email, name: 'Phase 7 Customer', phone: '+447700900111' },
    date: params.date,
    expectedTotalPence: priced.offer.pricePence,
    idempotencyKey,
    marketingOptIn: false,
    quotePublicId: priced.quote.publicId,
    slot,
    startWithinCancellationPeriodAck: true,
    termsAccepted: true,
  };
  const response = await postBookingRequest(body);
  const parsed = BookingCreateResponseSchema.parse(await response.json());
  const booking = await prisma.booking.findUnique({
    where: { reference: parsed.reference },
    select: { id: true, reference: true },
  });
  if (!booking) throw new Error('Booking missing after create');
  createdBookingIds.push(booking.id);
  createdBookingRefs.push(booking.reference);
  createdCustomerEmails.push(params.email);
  return { body, booking, response: parsed };
}

function stripeSucceededEvent(id: string, payment: { amountPence: number; bookingId: string; id: string; stripePaymentIntentId: string | null }) {
  createdStripeEvents.push(id);
  return {
    data: {
      object: {
        amount: payment.amountPence,
        amount_received: payment.amountPence,
        currency: 'gbp',
        id: payment.stripePaymentIntentId,
        latest_charge: 'ch_mock_phase7',
        metadata: { bookingId: payment.bookingId, paymentId: payment.id },
        object: 'payment_intent',
      },
    },
    id,
    object: 'event',
    type: 'payment_intent.succeeded',
  };
}

async function sendStripeEvent(event: unknown): Promise<Response> {
  return postStripeWebhook(new Request('http://localhost/api/webhooks/stripe', {
    body: JSON.stringify(event),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }));
}

beforeAll(async () => {
  process.env.MAPBOX_MODE = 'mock';
  await prisma.user.upsert({
    create: {
      email: 'phase7-admin@example.test',
      name: 'Phase 7 Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    update: { status: 'ACTIVE' },
    where: { email: 'phase7-admin@example.test' },
  });
});

afterAll(async () => {
  await prisma.outboxEvent.deleteMany({
    where: {
      OR: [
        { createdAt: { gte: testStartedAt } },
        { dedupeKey: { startsWith: 'phase7-' } },
      ],
    },
  });
  await prisma.stripeEvent.deleteMany({ where: { id: { in: createdStripeEvents } } });
  await prisma.refund.deleteMany({ where: { payment: { bookingId: { in: createdBookingIds } } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: createdBookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: createdBookingIds } } });
  await prisma.quote.deleteMany({ where: { publicId: { in: createdQuoteIds } } });
  await prisma.customer.deleteMany({ where: { email: { in: createdCustomerEmails } } });
  await prisma.capacityOverride.deleteMany({ where: { reason: { startsWith: 'Phase 7' } } });
  await prisma.user.deleteMany({ where: { email: 'phase7-admin@example.test' } });
  await prisma.$disconnect();
});

describe('Phase 7 booking and payments', () => {
  it('double-submits the same booking idempotently with one payment', async () => {
    const created = await createPendingBooking({
      date: '2031-03-04',
      email: 'phase7-idempotent@example.test',
      now: new Date('2031-03-01T00:00:00.000Z'),
    });
    const again = await postBookingRequest(created.body);
    expect(again.status).toBe(201);
    const repeated = BookingCreateResponseSchema.parse(await again.json());
    expect(repeated.reference).toBe(created.response.reference);
    expect(repeated.clientSecret).toBe(created.response.clientSecret);
    const payments = await prisma.payment.count({ where: { bookingId: created.booking.id, kind: 'BOOKING' } });
    expect(payments).toBe(1);
  });

  it('returns PRICE_CHANGED when the expected total is stale', async () => {
    const priced = await createPricedQuote('2031-03-05', 'MORNING', new Date('2031-03-01T00:00:00.000Z'));
    const response = await postBookingRequest({
      contact: { email: 'phase7-price@example.test', name: 'Phase 7 Customer', phone: '+447700900112' },
      date: '2031-03-05',
      expectedTotalPence: priced.offer.pricePence + 1,
      idempotencyKey: randomUUID(),
      marketingOptIn: false,
      quotePublicId: priced.quote.publicId,
      slot: 'MORNING',
      startWithinCancellationPeriodAck: true,
      termsAccepted: true,
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'PRICE_CHANGED' } });
  });

  it('treats webhook replay as a no-op', async () => {
    const created = await createPendingBooking({
      date: '2031-03-06',
      email: 'phase7-webhook@example.test',
      now: new Date('2031-03-01T00:00:00.000Z'),
    });
    const payment = await prisma.payment.findFirstOrThrow({
      where: { bookingId: created.booking.id, kind: 'BOOKING' },
      select: { amountPence: true, bookingId: true, id: true, stripePaymentIntentId: true },
    });
    const event = stripeSucceededEvent('evt_phase7_replay', payment);
    expect((await sendStripeEvent(event)).status).toBe(200);
    expect((await sendStripeEvent(event)).status).toBe(200);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: created.booking.id }, select: { status: true } });
    expect(booking.status).toBe('CONFIRMED');
    const confirmedEvents = await prisma.outboxEvent.count({
      where: { dedupeKey: `booking.confirmed:${created.booking.id}` },
    });
    expect(confirmedEvents).toBe(1);
  });

  it('auto-refunds a late payment when the expired slot has been taken', async () => {
    await prisma.capacityOverride.upsert({
      create: { capacity: 1, date: dateOnly('2031-03-07'), reason: 'Phase 7 late-payment test', slot: 'MORNING' },
      update: { capacity: 1, reason: 'Phase 7 late-payment test' },
      where: { date_slot: { date: dateOnly('2031-03-07'), slot: 'MORNING' } },
    });
    const created = await createPendingBooking({
      date: '2031-03-07',
      email: 'phase7-late@example.test',
      now: new Date('2031-03-01T00:00:00.000Z'),
    });
    await prisma.booking.update({
      data: { holdExpiresAt: null, status: 'EXPIRED' },
      where: { id: created.booking.id },
    });
    const blockerCustomer = await prisma.customer.upsert({
      create: { email: 'phase7-blocker@example.test', name: 'Phase 7 Blocker', phone: '+447700900113' },
      update: {},
      where: { email: 'phase7-blocker@example.test' },
    });
    createdCustomerEmails.push('phase7-blocker@example.test');
    const blocker = await prisma.booking.create({
      data: {
        accessDetail: json({ dropoff: pickupAccess, pickup: pickupAccess }),
        blocksSlots: 1,
        capacityUnits: 1,
        contactEmail: blockerCustomer.email,
        contactName: blockerCustomer.name,
        contactPhone: blockerCustomer.phone,
        customerId: blockerCustomer.id,
        distanceMiles: 47.3,
        dropoff: json(edinburgh),
        dropoffPostcode: edinburgh.postcode,
        durationMinutes: 69,
        moveDate: dateOnly('2031-03-07'),
        pickup: json(glasgow),
        pickupPostcode: glasgow.postcode,
        priceBreakdown: json({}),
        pricingInput: json({}),
        pricingVersionId: await activePricingVersionId(),
        reference: 'SV-P7RFD1',
        service: 'man-and-van',
        slot: 'MORNING',
        status: 'CONFIRMED',
        totalPence: 1000,
        variant: 'standard',
      },
      select: { id: true, reference: true },
    });
    createdBookingIds.push(blocker.id);
    createdBookingRefs.push(blocker.reference);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { bookingId: created.booking.id, kind: 'BOOKING' },
      select: { amountPence: true, bookingId: true, id: true, stripePaymentIntentId: true },
    });
    const response = await sendStripeEvent(stripeSucceededEvent('evt_phase7_late_refund', payment));
    expect(response.status).toBe(200);
    const [booking, refund, refundOutbox] = await Promise.all([
      prisma.booking.findUniqueOrThrow({ where: { id: created.booking.id }, select: { status: true } }),
      prisma.refund.findFirst({ where: { payment: { bookingId: created.booking.id } }, select: { amountPence: true, status: true } }),
      prisma.outboxEvent.findFirst({ where: { type: 'payment.refund', payload: { path: ['bookingId'], equals: created.booking.id } } }),
    ]);
    expect(booking.status).toBe('EXPIRED');
    expect(refund).toMatchObject({ amountPence: payment.amountPence, status: 'PENDING' });
    expect(refundOutbox).not.toBeNull();
  });

  it('expands booking.confirmed into the documented Phase 7 channels', async () => {
    const created = await createPendingBooking({
      date: '2031-03-08',
      email: 'phase7-matrix@example.test',
      now: new Date('2031-03-01T00:00:00.000Z'),
    });
    const event = await prisma.outboxEvent.create({
      data: {
        createdAt: new Date('2000-01-01T00:00:00.000Z'),
        dedupeKey: `phase7-matrix:${created.booking.id}`,
        payload: json({ bookingId: created.booking.id }),
        type: 'booking.confirmed',
      },
      select: { id: true },
    });
    const result = await processOutboxEventNow(event.id);
    expect(result).toEqual({ done: 1, failed: 0 });
    const channelJobs = await prisma.outboxEvent.findMany({
      where: { dedupeKey: { startsWith: `${event.id}:` } },
      select: { type: true },
    });
    expect(channelJobs.map((job) => job.type).sort()).toEqual(['email.send', 'email.send', 'notification.create', 'push.send']);
  });
});

describe('Phase 7 calendar files', () => {
  it('generates UTC calendar times across the BST boundary', () => {
    const bst = bookingIcs({
      bookingId: 'booking-bst',
      manageUrl: 'https://www.speedyvan.uk/manage/test',
      moveDate: '2026-03-29',
      pickupLabel: '1 George Square, Glasgow',
      reference: 'SV-BST001',
      slot: 'MORNING',
    });
    const gmt = bookingIcs({
      bookingId: 'booking-gmt',
      manageUrl: 'https://www.speedyvan.uk/manage/test',
      moveDate: '2026-12-01',
      pickupLabel: '1 George Square, Glasgow',
      reference: 'SV-GMT001',
      slot: 'MORNING',
    });
    expect(bst).toContain('DTSTART:20260329T070000Z');
    expect(gmt).toContain('DTSTART:20261201T080000Z');
    expect(bst).toContain('\r\n');
    expect(bst.split('\r\n').every((line) => Buffer.from(line, 'utf8').length <= 75)).toBe(true);
  });
});
