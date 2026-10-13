import 'server-only';

import {
  AddressSchema,
  AppError,
  BookingCreateResponseSchema,
  BookingStatusResponseSchema,
  fromDbDate,
  londonToday,
  toDbDate,
} from '@sv/contracts';
import type { BookingCreateSchema } from '@sv/contracts';
import { assertSlotCapacity, Prisma, prisma, type DbTx, type Slot } from '@sv/db';
import {
  computeQuote,
  priceForSlot,
  PricingError,
  type CalendarDay,
  type PricingConfig,
  type PricingInput,
  type StaticBreakdown,
} from '@sv/pricing';
import { randomInt } from 'node:crypto';
import type { z } from 'zod';
import { createOrRetrievePaymentIntent } from '../integrations/stripe';
import { bookingStatusToken, verifyBookingStatusToken } from '../status-token';
import { manageLinkForBooking } from '../auth/customer-links';
import { getSetting, getOperationsSettings } from '../settings';
import { dbDateLabel, slotLabel } from '../london-time';
import { overlayAvailability } from './availability';
import { getActivePricingConfig } from './catalogue';

type BookingCreateInput = z.infer<typeof BookingCreateSchema>;

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function dateOnly(date: string): Date {
  return new Date(`${toDbDate(date)}T00:00:00.000Z`);
}

async function uniqueReference(tx: DbTx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let code = '';
    for (let i = 0; i < 6; i += 1) code += CROCKFORD.charAt(randomInt(CROCKFORD.length));
    const reference = `SV-${code}`;
    const existing = await tx.booking.findUnique({ where: { reference }, select: { id: true } });
    if (!existing) return reference;
  }
  throw new AppError('INTERNAL', 'Could not allocate a booking reference.');
}

function pricingError(error: PricingError): AppError {
  return new AppError('VALIDATION_ERROR', error.message, { pricingCode: error.code });
}

interface PricedSlot {
  breakdown: StaticBreakdown;
  calendar: CalendarDay[];
  multipliers: CalendarDay['slots'][number]['multipliers'];
  pricingVersionId: string;
  totalPence: number;
}

async function priceSlot(quote: {
  calendar: Prisma.JsonValue;
  expiresAt: Date;
  input: Prisma.JsonValue;
  pricingVersion: { config: Prisma.JsonValue; id: string };
  today: Date;
}, date: string, slot: Slot, now: Date): Promise<PricedSlot> {
  const pricingInput = quote.input as unknown as PricingInput;
  const expired = quote.expiresAt.getTime() <= now.getTime();
  const today = expired ? londonToday(now) : fromDbDate(quote.today);
  const pricing = expired
    ? await getActivePricingConfig()
    : { config: quote.pricingVersion.config as unknown as PricingConfig, id: quote.pricingVersion.id };

  try {
    const quoted = priceForSlot(pricingInput, pricing.config, today, date, slot);
    const calendar = expired ? computeQuote(pricingInput, pricing.config, today).calendar : quote.calendar as unknown as CalendarDay[];
    return {
      breakdown: quoted.breakdown,
      calendar,
      multipliers: quoted.multipliers,
      pricingVersionId: pricing.id,
      totalPence: quoted.pricePence,
    };
  } catch (error) {
    if (error instanceof PricingError) throw pricingError(error);
    throw error;
  }
}

function routeLabel(pickup: unknown, dropoff: unknown): string {
  const pickupAddress = AddressSchema.parse(pickup);
  if (!dropoff) return pickupAddress.town;
  const dropoffAddress = AddressSchema.parse(dropoff);
  return `${pickupAddress.town} to ${dropoffAddress.town}`;
}

function postcode(value: unknown): string {
  return AddressSchema.parse(value).postcode;
}

async function assertChosenSlotAvailable(params: {
  blocksSlots: number;
  calendar: CalendarDay[];
  capacityUnits: number;
  date: string;
  service: string;
  slot: Slot;
  now: Date;
}): Promise<void> {
  const operations = await getOperationsSettings();
  const availability = await overlayAvailability({
    blocksSlots: params.blocksSlots,
    calendar: params.calendar,
    capacityUnits: params.capacityUnits,
    now: params.now,
    operations,
    service: params.service as never,
  });
  const day = availability.calendar.find((candidate) => candidate.date === params.date);
  const slot = day?.slots.find((candidate) => candidate.slot === params.slot);
  if (!slot?.available) {
    throw new AppError(slot?.reason === 'FULL' ? 'SLOT_UNAVAILABLE' : 'CONFLICT', 'That slot is no longer available.', {
      reason: slot?.reason ?? 'UNAVAILABLE',
    });
  }
}

async function assertLegalAck(input: BookingCreateInput, now: Date): Promise<void> {
  const legal = await getSetting('legal');
  if (!legal.requireExpressStartAck) return;
  const daysUntilMove = Math.floor((dateOnly(input.date).getTime() - dateOnly(londonToday(now)).getTime()) / 86_400_000);
  if (daysUntilMove < 14 && !input.startWithinCancellationPeriodAck) {
    throw new AppError('VALIDATION_ERROR', 'Please confirm the short-notice cancellation acknowledgement.');
  }
}

async function intentForBooking(booking: {
  contactEmail: string;
  id: string;
  payments: Array<{
    amountPence: number;
    bookingId: string;
    currency: string;
    id: string;
    kind: string;
    stripePaymentIntentId: string | null;
  }>;
  reference: string;
}): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const payment = booking.payments.find((candidate) => candidate.kind === 'BOOKING' || candidate.kind === 'ADMIN_BOOKING' || candidate.kind === 'MANUAL_QUOTE');
  if (!payment) throw new AppError('INTERNAL', 'Booking payment is missing.');
  const intent = await createOrRetrievePaymentIntent({
    ...payment,
    booking: { contactEmail: booking.contactEmail, reference: booking.reference },
  });
  if (payment.stripePaymentIntentId !== intent.id) {
    await prisma.payment.update({ data: { stripePaymentIntentId: intent.id }, where: { id: payment.id } });
  }
  return { clientSecret: intent.clientSecret, paymentIntentId: intent.id };
}

async function existingBookingResponse(idempotencyKey: string) {
  const booking = await prisma.booking.findUnique({
    where: { idempotencyKey },
    select: {
      contactEmail: true,
      holdExpiresAt: true,
      id: true,
      payments: {
        where: { kind: 'BOOKING' },
        select: { amountPence: true, bookingId: true, currency: true, id: true, kind: true, stripePaymentIntentId: true },
      },
      reference: true,
      totalPence: true,
    },
  });
  if (!booking) return null;
  if (!booking.holdExpiresAt) throw new AppError('CONFLICT', 'This booking is no longer awaiting payment.');
  const intent = await intentForBooking(booking);
  return BookingCreateResponseSchema.parse({
    clientSecret: intent.clientSecret,
    holdExpiresAt: booking.holdExpiresAt.toISOString(),
    reference: booking.reference,
    statusToken: bookingStatusToken({ bookingId: booking.id, reference: booking.reference }),
    totalPence: booking.totalPence,
  });
}

export async function createBookingFromQuote(input: BookingCreateInput, now = new Date()) {
  await assertLegalAck(input, now);
  const idempotent = await existingBookingResponse(input.idempotencyKey);
  if (idempotent) return idempotent;

  const quote = await prisma.quote.findUnique({
    where: { publicId: input.quotePublicId },
    select: {
      accessDetail: true,
      blocksSlots: true,
      calendar: true,
      capacityUnits: true,
      distanceMiles: true,
      dropoff: true,
      durationMinutes: true,
      expiresAt: true,
      id: true,
      input: true,
      pickup: true,
      pricingVersion: { select: { config: true, id: true } },
      publicId: true,
      requiresManualQuote: true,
      routeGeometry: true,
      service: true,
      status: true,
      today: true,
      variant: true,
    },
  });
  if (!quote) throw new AppError('NOT_FOUND', 'Quote not found.');
  if (quote.status !== 'ACTIVE') throw new AppError('QUOTE_EXPIRED', 'This quote is no longer available.');
  if (quote.requiresManualQuote) throw new AppError('MANUAL_QUOTE_REQUIRED', 'This move needs a manual quote.');

  const existingForQuote = await prisma.booking.findFirst({
    where: { quoteId: quote.id, status: { not: 'EXPIRED' } },
    select: { id: true },
  });
  if (existingForQuote) throw new AppError('CONFLICT', 'This quote has already been used for a booking.');

  const priced = await priceSlot(quote, input.date, input.slot, now);
  if (priced.totalPence !== input.expectedTotalPence) {
    throw new AppError('PRICE_CHANGED', 'The price has changed. Please review the new price.', { newTotalPence: priced.totalPence });
  }

  await assertChosenSlotAvailable({
    blocksSlots: quote.blocksSlots,
    calendar: priced.calendar,
    capacityUnits: quote.capacityUnits,
    date: input.date,
    now,
    service: quote.service,
    slot: input.slot,
  });

  const operations = await getOperationsSettings();
  const holdExpiresAt = new Date(now.getTime() + operations.paymentHoldMinutes * 60_000);
  const moveDate = dateOnly(input.date);
  const email = input.contact.email.toLowerCase();
  const customer = await prisma.$transaction(async (tx) => {
    await assertSlotCapacity(tx, {
      blocksSlots: quote.blocksSlots,
      capacityUnits: quote.capacityUnits,
      moveDate,
      now,
      slot: input.slot,
    });
    const reference = await uniqueReference(tx);
    const savedCustomer = await tx.customer.upsert({
      create: {
        email,
        marketingOptIn: input.marketingOptIn,
        ...(input.marketingOptIn ? { marketingOptInAt: now } : {}),
        name: input.contact.name,
        phone: input.contact.phone,
      },
      update: {
        ...(input.marketingOptIn ? { marketingOptIn: true, marketingOptInAt: now } : {}),
        name: input.contact.name,
        phone: input.contact.phone,
      },
      where: { email },
    });
    const booking = await tx.booking.create({
      data: {
        accessDetail: json(quote.accessDetail),
        blocksSlots: quote.blocksSlots,
        capacityUnits: quote.capacityUnits,
        contactEmail: email,
        contactName: input.contact.name,
        contactPhone: input.contact.phone,
        customerId: savedCustomer.id,
        customerNotes: input.customerNotes ?? null,
        distanceMiles: quote.distanceMiles,
        dropoff: quote.dropoff ?? Prisma.DbNull,
        dropoffPostcode: quote.dropoff ? postcode(quote.dropoff) : null,
        durationMinutes: quote.durationMinutes,
        holdExpiresAt,
        idempotencyKey: input.idempotencyKey,
        marketingOptIn: input.marketingOptIn,
        moveDate,
        pickup: json(quote.pickup),
        pickupPostcode: postcode(quote.pickup),
        priceBreakdown: json({ breakdown: priced.breakdown, slot: { date: input.date, multipliers: priced.multipliers, slot: input.slot } }),
        pricingInput: json(quote.input),
        pricingVersionId: priced.pricingVersionId,
        quoteId: quote.id,
        reference,
        routeGeometry: quote.routeGeometry,
        service: quote.service,
        slot: input.slot,
        source: 'WEB',
        startWithinCancellationAck: input.startWithinCancellationPeriodAck ? now : null,
        status: 'PENDING_PAYMENT',
        termsAcceptedAt: now,
        totalPence: priced.totalPence,
        variant: quote.variant,
      },
      select: {
        contactEmail: true,
        holdExpiresAt: true,
        id: true,
        payments: true,
        reference: true,
        totalPence: true,
      },
    });
    const payment = await tx.payment.create({
      data: {
        amountPence: priced.totalPence,
        bookingId: booking.id,
        kind: 'BOOKING',
        status: 'REQUIRES_PAYMENT',
      },
      select: { amountPence: true, bookingId: true, currency: true, id: true, kind: true, stripePaymentIntentId: true },
    });
    return { ...booking, payments: [payment] };
  });

  try {
    const intent = await intentForBooking(customer);
    return BookingCreateResponseSchema.parse({
      clientSecret: intent.clientSecret,
      holdExpiresAt: holdExpiresAt.toISOString(),
      reference: customer.reference,
      statusToken: bookingStatusToken({ bookingId: customer.id, reference: customer.reference }),
      totalPence: customer.totalPence,
    });
  } catch (error) {
    await prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({ data: { status: 'CANCELED' }, where: { bookingId: customer.id, status: 'REQUIRES_PAYMENT' } });
      await tx.booking.update({ data: { holdExpiresAt: null, status: 'EXPIRED' }, where: { id: customer.id } });
    });
    if (error instanceof AppError) throw error;
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Payment could not be started.');
  }
}

export async function bookingStatusFromToken(token: string) {
  const payload = verifyBookingStatusToken(token);
  const booking = await prisma.booking.findUnique({
    where: { id: payload.bookingId },
    select: {
      dropoff: true,
      contactEmail: true,
      id: true,
      moveDate: true,
      pickup: true,
      reference: true,
      service: true,
      slot: true,
      status: true,
      totalPence: true,
    },
  });
  if (!booking || booking.reference !== payload.reference) {
    throw new AppError('NOT_FOUND', 'Booking not found.');
  }
  const web = await getSetting('web');
  const manageToken = booking.status === 'CONFIRMED' ? await manageLinkForBooking(booking) : null;
  const manageUrl = manageToken ? new URL(`/manage/session?token=${encodeURIComponent(manageToken)}`, web.canonicalOrigin).toString() : undefined;
  return BookingStatusResponseSchema.parse({
    manageUrl,
    reference: booking.reference,
    status: booking.status,
    summary: {
      date: fromDbDate(booking.moveDate),
      dateLabel: dbDateLabel(booking.moveDate),
      routeLabel: routeLabel(booking.pickup, booking.dropoff),
      service: booking.service,
      slot: booking.slot,
      slotLabel: slotLabel(booking.slot),
      totalPence: booking.totalPence,
    },
  });
}
