import { addDays, londonToday } from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processOutboxEventNow } from '../src/server/outbox/processor';

const emailPrefix = 'phase15-';
const referencePrefix = 'SV-P15';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function sampleAddress(label: string): Prisma.InputJsonValue {
  return json({
    label,
    lat: 55.861,
    line1: label,
    lng: -4.25,
    postcode: 'G2 1DU',
    source: 'MANUAL',
    town: label.includes('Dropoff') ? 'Edinburgh' : 'Glasgow',
  });
}

async function activePricingVersionId(): Promise<string> {
  const version = await prisma.pricingConfigVersion.findFirst({
    orderBy: { version: 'desc' },
    select: { id: true },
    where: { status: 'ACTIVE' },
  });
  if (!version) throw new Error('Missing active pricing version.');
  return version.id;
}

async function cleanup(): Promise<void> {
  const phaseEvents = await prisma.outboxEvent.findMany({
    select: { id: true },
    where: { dedupeKey: { startsWith: 'phase15:' } },
  });
  for (const event of phaseEvents) {
    await prisma.outboxEvent.deleteMany({ where: { dedupeKey: { startsWith: `${event.id}:` } } });
  }
  await prisma.pushTicket.deleteMany({ where: { pushDevice: { user: { email: { startsWith: emailPrefix } } } } });
  await prisma.pushDevice.deleteMany({ where: { user: { email: { startsWith: emailPrefix } } } });
  await prisma.notification.deleteMany({ where: { user: { email: { startsWith: emailPrefix } } } });
  await prisma.outboxEvent.deleteMany({
    where: {
      OR: [
        { dedupeKey: { startsWith: 'phase15:' } },
        { dedupeKey: { startsWith: 'repeat-alert:' } },
        { dedupeKey: { startsWith: 'cron.reminder:' } },
      ],
    },
  });
  await prisma.review.deleteMany({ where: { booking: { reference: { startsWith: referencePrefix } } } });
  await prisma.refund.deleteMany({ where: { payment: { booking: { reference: { startsWith: referencePrefix } } } } });
  await prisma.extraCharge.deleteMany({ where: { booking: { reference: { startsWith: referencePrefix } } } });
  await prisma.payment.deleteMany({ where: { booking: { reference: { startsWith: referencePrefix } } } });
  await prisma.assignment.deleteMany({ where: { booking: { reference: { startsWith: referencePrefix } } } });
  await prisma.manualQuote.deleteMany({ where: { contactEmail: { startsWith: emailPrefix } } });
  await prisma.booking.deleteMany({ where: { reference: { startsWith: referencePrefix } } });
  await prisma.quote.deleteMany({ where: { publicId: { startsWith: 'phase15' } } });
  await prisma.contactMessage.deleteMany({ where: { email: { startsWith: emailPrefix } } });
  await prisma.customer.deleteMany({ where: { email: { startsWith: emailPrefix } } });
  await prisma.driverProfile.deleteMany({ where: { user: { email: { startsWith: emailPrefix } } } });
  await prisma.session.deleteMany({ where: { user: { email: { startsWith: emailPrefix } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: emailPrefix } } });
}

interface Fixture {
  adminIds: string[];
  bookingId: string;
  contactMessageId: string;
  driverId: string;
  extraChargeId: string;
  manualQuoteId: string;
  offeredDriverId: string;
  ownerId: string;
  paymentId: string;
  quoteId: string;
  refundId: string;
}

async function createFixture(): Promise<Fixture> {
  const [owner, admin, driver, offeredDriver] = await Promise.all([
    prisma.user.create({ data: { email: `${emailPrefix}owner@example.test`, name: 'Phase 15 Owner', role: 'OWNER', status: 'ACTIVE' } }),
    prisma.user.create({ data: { email: `${emailPrefix}admin@example.test`, name: 'Phase 15 Admin', role: 'ADMIN', status: 'ACTIVE' } }),
    prisma.user.create({ data: { email: `${emailPrefix}driver@example.test`, name: 'Phase 15 Driver', role: 'DRIVER', status: 'ACTIVE' } }),
    prisma.user.create({ data: { email: `${emailPrefix}offered@example.test`, name: 'Phase 15 Offered', role: 'DRIVER', status: 'ACTIVE' } }),
  ]);
  await Promise.all([
    prisma.driverProfile.create({ data: { payoutPercent: 40, userId: driver.id } }),
    prisma.driverProfile.create({ data: { payoutPercent: 40, userId: offeredDriver.id } }),
    prisma.pushDevice.create({ data: { app: 'ADMIN', enabled: true, expoPushToken: 'ExpoPushToken[phase15-owner]', platform: 'IOS', userId: owner.id } }),
    prisma.pushDevice.create({ data: { app: 'ADMIN', enabled: true, expoPushToken: 'ExpoPushToken[phase15-admin]', platform: 'IOS', userId: admin.id } }),
    prisma.pushDevice.create({ data: { app: 'DRIVER', enabled: true, expoPushToken: 'ExpoPushToken[phase15-driver]', platform: 'IOS', userId: driver.id } }),
    prisma.pushDevice.create({ data: { app: 'DRIVER', enabled: true, expoPushToken: 'ExpoPushToken[phase15-offered]', platform: 'IOS', userId: offeredDriver.id } }),
  ]);
  const customer = await prisma.customer.create({
    data: { email: `${emailPrefix}customer@example.test`, name: 'Phase 15 Customer', phone: '+447700900150' },
  });
  const pricingVersionId = await activePricingVersionId();
  const moveDate = dateOnly(addDays(londonToday(), 1));
  const quote = await prisma.quote.create({
    data: {
      accessDetail: json({}),
      breakdown: json({}),
      calendar: json([]),
      capacityUnits: 1,
      blocksSlots: 1,
      distanceMiles: 47.3,
      dropoff: sampleAddress('Dropoff Street'),
      durationMinutes: 70,
      expiresAt: new Date(Date.now() + 86_400_000),
      input: json({}),
      manualReasons: [],
      pickup: sampleAddress('Pickup Street'),
      pricingVersionId,
      publicId: 'phase15quote',
      service: 'man-and-van',
      staticSubtotalPence: 15890,
      today: dateOnly(londonToday()),
      variant: 'standard',
    },
    select: { id: true },
  });
  const booking = await prisma.booking.create({
    data: {
      accessDetail: json({ pickup: {}, dropoff: {} }),
      blocksSlots: 1,
      capacityUnits: 1,
      completedAt: new Date(),
      contactEmail: customer.email,
      contactName: customer.name,
      contactPhone: customer.phone,
      customerId: customer.id,
      dispatchStatus: 'ACCEPTED',
      distanceMiles: 47.3,
      driverId: driver.id,
      dropoff: sampleAddress('Dropoff Street'),
      dropoffPostcode: 'G2 1DU',
      durationMinutes: 70,
      jobStage: 'EN_ROUTE_TO_PICKUP',
      moveDate,
      pickup: sampleAddress('Pickup Street'),
      pickupPostcode: 'G2 1DU',
      priceBreakdown: json({}),
      pricingInput: json({}),
      pricingVersionId,
      quoteId: quote.id,
      reference: `${referencePrefix}001`,
      service: 'man-and-van',
      slot: 'MORNING',
      status: 'CONFIRMED',
      totalPence: 15890,
      variant: 'standard',
    },
    select: { id: true },
  });
  await Promise.all([
    prisma.assignment.create({ data: { bookingId: booking.id, driverId: driver.id, offeredById: owner.id, status: 'ACCEPTED' } }),
    prisma.assignment.create({ data: { bookingId: booking.id, driverId: offeredDriver.id, offeredById: owner.id, status: 'OFFERED' } }),
  ]);
  const manualQuote = await prisma.manualQuote.create({
    data: {
      contactEmail: `${emailPrefix}manual@example.test`,
      contactName: 'Manual Customer',
      contactPhone: '+447700900151',
      details: 'Ferry move',
      preferredDate: moveDate,
      preferredSlot: 'MORNING',
      pricePence: 22000,
      quoteId: quote.id,
      reasons: ['FERRY_ROUTE'],
      status: 'PRICED',
      validUntil: new Date(Date.now() + 86_400_000),
    },
    select: { id: true },
  });
  const payment = await prisma.payment.create({
    data: { amountPence: 15890, bookingId: booking.id, kind: 'BOOKING', status: 'SUCCEEDED', stripePaymentIntentId: 'pi_phase15' },
    select: { id: true },
  });
  const refund = await prisma.refund.create({
    data: { amountPence: 500, paymentId: payment.id, reason: 'Phase 15 test', status: 'SUCCEEDED' },
    select: { id: true },
  });
  const extraCharge = await prisma.extraCharge.create({
    data: { amountPence: 1200, bookingId: booking.id, description: 'Extra item', requestedById: driver.id, status: 'AWAITING_PAYMENT' },
    select: { id: true },
  });
  const contact = await prisma.contactMessage.create({
    data: { email: `${emailPrefix}contact@example.test`, message: 'Can you help?', name: 'Contact Customer' },
    select: { id: true },
  });
  return {
    adminIds: [owner.id, admin.id],
    bookingId: booking.id,
    contactMessageId: contact.id,
    driverId: driver.id,
    extraChargeId: extraCharge.id,
    manualQuoteId: manualQuote.id,
    offeredDriverId: offeredDriver.id,
    ownerId: owner.id,
    paymentId: payment.id,
    quoteId: quote.id,
    refundId: refund.id,
  };
}

type Expected = {
  emails?: string[];
  notifications: number;
  pushes?: string[];
};

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function expandAndCollect(type: string, payload: Prisma.InputJsonValue, users: string[]): Promise<{ emails: string[]; notifications: number; pushes: string[]; tickets: number }> {
  const beforeNotifications = await prisma.notification.count({ where: { userId: { in: users } } });
  const event = await prisma.outboxEvent.create({
    data: {
      dedupeKey: `phase15:${type}:${randomUUID()}`,
      payload,
      type,
    },
    select: { id: true },
  });
  expect(await processOutboxEventNow(event.id)).toEqual({ done: 1, failed: 0 });
  const jobs = await prisma.outboxEvent.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, payload: true, type: true },
    where: { dedupeKey: { startsWith: `${event.id}:` } },
  });
  const emails = jobs
    .filter((job) => job.type === 'email.send')
    .map((job) => String(payloadRecord(job.payload).template))
    .sort();
  const pushes = jobs
    .filter((job) => job.type === 'push.send')
    .filter((job) => users.includes(String(payloadRecord(job.payload).userId)))
    .map((job) => {
      const payloadData = payloadRecord(job.payload);
      return `${String(payloadData.app)}:${String(payloadData.category)}`;
    })
    .sort();
  for (const job of jobs.filter((child) => (child.type === 'notification.create' || child.type === 'push.send') && users.includes(String(payloadRecord(child.payload).userId)))) {
    expect(await processOutboxEventNow(job.id)).toEqual({ done: 1, failed: 0 });
  }
  const afterNotifications = await prisma.notification.count({ where: { userId: { in: users } } });
  const ticketJobIds = jobs
    .filter((job) => job.type === 'push.send')
    .filter((job) => users.includes(String(payloadRecord(job.payload).userId)))
    .map((job) => job.id);
  const tickets = await prisma.pushTicket.count({ where: { outboxEventId: { in: ticketJobIds } } });
  return { emails, notifications: afterNotifications - beforeNotifications, pushes, tickets };
}

beforeAll(async () => {
  process.env.PUSH_MODE = 'capture';
  process.env.CUSTOMER_LINK_SECRET = 'phase15-customer-link-secret';
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('Phase 15 event matrix', () => {
  it('fans out every documented domain event to the exact email, push and in-app channels', async () => {
    const fixture = await createFixture();
    const allUsers = [...fixture.adminIds, fixture.driverId, fixture.offeredDriverId];
    const cases: Array<{ expected: Expected; payload: Prisma.InputJsonValue; type: string }> = [
      { type: 'booking.confirmed', payload: json({ bookingId: fixture.bookingId }), expected: { emails: ['admin-new-booking', 'booking-confirmed'], notifications: 2, pushes: ['ADMIN:NEW_BOOKING', 'ADMIN:NEW_BOOKING'] } },
      { type: 'booking.checkout_abandoned', payload: json({ bookingId: fixture.bookingId }), expected: { notifications: 2 } },
      { type: 'manual_quote.requested', payload: json({ manualQuoteId: fixture.manualQuoteId }), expected: { emails: ['admin-manual-quote', 'manual-quote-received'], notifications: 2, pushes: ['ADMIN:QUOTE_REQUEST', 'ADMIN:QUOTE_REQUEST'] } },
      { type: 'manual_quote.priced', payload: json({ manualQuoteId: fixture.manualQuoteId }), expected: { emails: ['manual-quote-ready'], notifications: 2 } },
      { type: 'manual_quote.declined', payload: json({ manualQuoteId: fixture.manualQuoteId }), expected: { emails: ['manual-quote-declined'], notifications: 2 } },
      { type: 'booking.offered', payload: json({ bookingId: fixture.bookingId }), expected: { notifications: 2, pushes: ['DRIVER:JOB_OFFER'] } },
      { type: 'booking.assigned', payload: json({ bookingId: fixture.bookingId }), expected: { notifications: 2, pushes: ['DRIVER:JOB_ASSIGNED'] } },
      { type: 'booking.driver_accepted', payload: json({ bookingId: fixture.bookingId }), expected: { emails: ['driver-assigned'], notifications: 2 } },
      { type: 'booking.driver_declined', payload: json({ bookingId: fixture.bookingId }), expected: { notifications: 2, pushes: ['ADMIN:DISPATCH', 'ADMIN:DISPATCH'] } },
      { type: 'booking.offer_expired', payload: json({ bookingId: fixture.bookingId }), expected: { notifications: 2, pushes: ['ADMIN:DISPATCH', 'ADMIN:DISPATCH'] } },
      { type: 'booking.rescheduled', payload: json({ bookingId: fixture.bookingId, previousDriverId: fixture.driverId }), expected: { emails: ['rescheduled'], notifications: 2, pushes: ['ADMIN:CHANGE', 'ADMIN:CHANGE', 'DRIVER:JOB_WITHDRAWN'] } },
      { type: 'booking.cancelled', payload: json({ bookingId: fixture.bookingId, refundPence: 500 }), expected: { emails: ['cancelled'], notifications: 2, pushes: ['ADMIN:CHANGE', 'ADMIN:CHANGE', 'DRIVER:JOB_CANCELLED'] } },
      { type: 'booking.updated', payload: json({ bookingId: fixture.bookingId }), expected: { notifications: 2, pushes: ['DRIVER:JOB_CHANGED'] } },
      { type: 'job.stage_changed', payload: json({ bookingId: fixture.bookingId, toStage: 'EN_ROUTE_TO_PICKUP' }), expected: { emails: ['on-the-way'], notifications: 2 } },
      { type: 'job.issue_reported', payload: json({ bookingId: fixture.bookingId, issue: 'Customer not in' }), expected: { notifications: 2, pushes: ['ADMIN:JOB_ISSUE', 'ADMIN:JOB_ISSUE'] } },
      { type: 'extra_charge.requested', payload: json({ bookingId: fixture.bookingId, extraChargeId: fixture.extraChargeId }), expected: { notifications: 2, pushes: ['ADMIN:EXTRA_REQUEST', 'ADMIN:EXTRA_REQUEST'] } },
      { type: 'extra_charge.awaiting_payment', payload: json({ bookingId: fixture.bookingId, extraChargeId: fixture.extraChargeId }), expected: { emails: ['extra-charge-request'], notifications: 2 } },
      { type: 'booking.extra_paid', payload: json({ bookingId: fixture.bookingId, paymentId: fixture.paymentId }), expected: { emails: ['payment-received'], notifications: 2, pushes: ['DRIVER:EXTRA_PAID'] } },
      { type: 'booking.completed', payload: json({ bookingId: fixture.bookingId }), expected: { emails: ['move-completed'], notifications: 2 } },
      { type: 'payment.refund.created', payload: json({ bookingId: fixture.bookingId, refundId: fixture.refundId }), expected: { emails: ['refund-issued'], notifications: 2 } },
      { type: 'payment.dispute.created', payload: json({ paymentId: fixture.paymentId }), expected: { emails: ['admin-dispute'], notifications: 2, pushes: ['ADMIN:DISPUTE', 'ADMIN:DISPUTE'] } },
      { type: 'review.submitted', payload: json({ bookingId: fixture.bookingId }), expected: { notifications: 2 } },
      { type: 'contact.received', payload: json({ contactMessageId: fixture.contactMessageId }), expected: { emails: ['contact-received'], notifications: 2 } },
      { type: 'system.alert', payload: json({ issue: 'Phase 15 system alert' }), expected: { emails: ['admin-system-alert'], notifications: 1, pushes: ['ADMIN:SYSTEM'] } },
      { type: 'payout.recorded', payload: json({ driverId: fixture.driverId }), expected: { notifications: 0, pushes: ['DRIVER:PAYOUT'] } },
    ];

    for (const testCase of cases) {
      const result = await expandAndCollect(testCase.type, testCase.payload, allUsers);
      expect(result.emails, `${testCase.type} emails`).toEqual((testCase.expected.emails ?? []).sort());
      expect(result.pushes, `${testCase.type} pushes`).toEqual((testCase.expected.pushes ?? []).sort());
      expect(result.notifications, `${testCase.type} notifications`).toBe(testCase.expected.notifications);
      expect(result.tickets, `${testCase.type} tickets`).toBe(testCase.expected.pushes?.length ?? 0);
    }
  }, 180_000);
});
