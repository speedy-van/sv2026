import 'server-only';

import {
  AddressSchema,
  AppError,
  fromDbDate,
  londonToday,
  toDbDate,
  type SlotSchema,
} from '@sv/contracts';
import { assertSlotCapacity, enqueueOutbox, Prisma, prisma, type DbTx, type Slot } from '@sv/db';
import { priceForSlot, type PricingConfig, type PricingInput } from '@sv/pricing';
import { createHash, randomInt } from 'node:crypto';
import type { z } from 'zod';
import { createOrRetrievePaymentIntent } from '../integrations/stripe';
import { dbDateLabel, londonDateTimeToUtc, slotLabel } from '../london-time';
import { getOperationsSettings, getSetting } from '../settings';
import { bookingPurposeLink, contactEmailHash, manageLinkForBooking, signCustomerLink, verifyBookingLink, verifyCustomerLink } from '../auth/customer-links';
import { getActivePricingConfig } from './catalogue';
import { requestRefund } from './payments';

type SlotValue = z.infer<typeof SlotSchema>;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function dateOnly(date: string): Date {
  return new Date(`${toDbDate(date)}T00:00:00.000Z`);
}

function normaliseReference(value: string): string {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.startsWith('SV') ? `SV-${cleaned.slice(2)}` : `SV-${cleaned}`;
}

function routeLabel(pickup: unknown, dropoff: unknown): string {
  const from = AddressSchema.parse(pickup);
  if (!dropoff) return from.town;
  const to = AddressSchema.parse(dropoff);
  return `${from.town} to ${to.town}`;
}

function slotStart(booking: { moveDate: Date; slot: Slot }): Date {
  const start = booking.slot === 'MORNING' ? '08:00' : booking.slot === 'AFTERNOON' ? '12:00' : '17:00';
  return londonDateTimeToUtc(fromDbDate(booking.moveDate), start);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function firstName(name: string | null): string | null {
  return name?.trim().split(/\s+/)[0] ?? null;
}

const emailHits = new Map<string, number[]>();
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function enforceEmailLimit(email: string, now = new Date()): void {
  const key = createHash('sha256').update(email.toLowerCase()).digest('hex');
  const cutoff = now.getTime() - 3_600_000;
  const hits = (emailHits.get(key) ?? []).filter((hit) => hit > cutoff);
  if (hits.length >= 3) throw new AppError('RATE_LIMITED', 'Too many requests. Try again shortly.', { retryAfter: 3600 });
  hits.push(now.getTime());
  emailHits.set(key, hits);
}

async function uniqueReference(tx: DbTx): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) code += CROCKFORD.charAt(randomInt(CROCKFORD.length));
    const reference = `SV-${code}`;
    const existing = await tx.booking.findUnique({ where: { reference }, select: { id: true } });
    if (!existing) return reference;
  }
  throw new AppError('INTERNAL', 'Could not allocate a booking reference.');
}

async function emailDataBase(): Promise<{ canonicalOrigin: string; contactEmail: string | null; legalLine: string | null }> {
  const [web, contact, company] = await Promise.all([getSetting('web'), getSetting('contact'), getSetting('company')]);
  return {
    canonicalOrigin: web.canonicalOrigin,
    contactEmail: contact.emailBookings ?? contact.emailPublic,
    legalLine: company.legalName ? `${company.legalName}.` : null,
  };
}

export async function requestManageLink(input: { email: string; reference: string }, now = new Date()): Promise<void> {
  enforceEmailLimit(input.email, now);
  const booking = await prisma.booking.findFirst({
    where: {
      contactEmail: input.email.toLowerCase(),
      reference: normaliseReference(input.reference),
    },
    select: { contactEmail: true, id: true, moveDate: true, reference: true },
  });
  if (!booking) return;
  const base = await emailDataBase();
  const token = await manageLinkForBooking(booking, now);
  await enqueueOutbox(
    prisma,
    'email.send',
    json({
      data: {
        ...base,
        manageUrl: `/manage/session?token=${encodeURIComponent(token)}`,
        reference: booking.reference,
      },
      template: 'manage-link',
      to: [booking.contactEmail],
    }),
    `manage-link:${booking.id}:${contactEmailHash(booking.contactEmail)}:${String(Math.floor(now.getTime() / 3_600_000))}`,
  );
}

export async function bookingIdFromManageToken(token: string): Promise<string> {
  return (await verifyBookingLink(token, 'manage')).bookingId;
}

async function bookingForManage(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      assignments: { orderBy: { offeredAt: 'desc' }, take: 1 },
      driver: { include: { user: true } },
      events: { orderBy: { occurredAt: 'asc' } },
      extraCharges: { orderBy: { createdAt: 'desc' } },
      payments: { include: { refunds: true }, orderBy: { createdAt: 'asc' } },
      photos: { orderBy: { createdAt: 'desc' } },
      review: true,
      signature: true,
      van: true,
    },
  });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  return booking;
}

export async function manageView(token: string): Promise<Record<string, unknown>> {
  const bookingId = await bookingIdFromManageToken(token);
  const booking = await bookingForManage(bookingId);
  const pickup = AddressSchema.parse(booking.pickup);
  const dropoff = booking.dropoff ? AddressSchema.parse(booking.dropoff) : null;
  const balancePence = booking.totalPence - (booking.paidPence - booking.refundedPence);
  const now = new Date();
  const moveIso = fromDbDate(booking.moveDate);
  const trackToken = await bookingPurposeLink(booking, 'track', addDays(booking.moveDate, 2));
  const reviewToken = booking.completedAt ? await bookingPurposeLink(booking, 'review', addDays(booking.completedAt, 60)) : null;
  return {
    actions: await manageActionState(booking, now),
    balancePence,
    bookingId: booking.id,
    contactEmail: booking.contactEmail,
    contactName: booking.contactName,
    customerNotes: booking.customerNotes,
    date: moveIso,
    dateLabel: dbDateLabel(booking.moveDate),
    dispatchStatus: booking.dispatchStatus,
    driver: booking.driver ? { firstName: firstName(booking.driver.user.name), vanRegistration: booking.van?.registration ?? null } : null,
    dropoff,
    events: booking.events.map((event) => ({
      at: event.occurredAt.toISOString(),
      fromStage: event.fromStage,
      toStage: event.toStage,
      type: event.type,
    })),
    extraCharges: booking.extraCharges,
    jobStage: booking.jobStage,
    paidPence: booking.paidPence,
    payments: booking.payments.map((payment) => ({
      amountPence: payment.amountPence,
      kind: payment.kind,
      refunds: payment.refunds.map((refund) => ({ amountPence: refund.amountPence, status: refund.status })),
      status: payment.status,
    })),
    photos: booking.photos.map((photo) => ({ id: photo.id, kind: photo.kind })),
    pickup,
    receiptUrl: '/manage/receipt',
    reference: booking.reference,
    refundedPence: booking.refundedPence,
    reviewUrl: reviewToken ? `/review/${encodeURIComponent(reviewToken)}` : null,
    routeLabel: routeLabel(booking.pickup, booking.dropoff),
    service: booking.service,
    signature: booking.signature ? { signedAt: booking.signature.signedAt.toISOString(), signedName: booking.signature.signedName } : null,
    slot: booking.slot,
    slotLabel: slotLabel(booking.slot),
    status: booking.status,
    totalPence: booking.totalPence,
    trackUrl: `/track/${encodeURIComponent(trackToken)}`,
    version: booking.version,
  };
}

async function manageActionState(booking: { jobStage: string; moveDate: Date; slot: Slot; status: string }, now: Date): Promise<Record<string, string | boolean>> {
  const cancellation = await getSetting('cancellation');
  const rescheduleHours = cancellation.selfServiceRescheduleHours ?? 48;
  const canBefore = new Date(slotStart(booking).getTime() - rescheduleHours * 3_600_000);
  const canReschedule = booking.status === 'CONFIRMED' && booking.jobStage === 'NOT_STARTED' && now <= canBefore;
  const canCancel = booking.status === 'CONFIRMED' && booking.jobStage === 'NOT_STARTED';
  return {
    canCancel,
    canReschedule,
    cancelReason: canCancel ? '' : 'Your move has started or is no longer confirmed. Call us for help.',
    rescheduleReason: canReschedule ? '' : `You can change your date online until ${String(rescheduleHours)} hours before your slot.`,
  };
}

export async function updateCustomerNotes(token: string, notes: string, now = new Date()): Promise<void> {
  const bookingId = await bookingIdFromManageToken(token);
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { moveDate: true, slot: true } });
  if (now.getTime() > slotStart(booking).getTime() - 24 * 3_600_000) {
    throw new AppError('CONFLICT', 'Notes can be edited until 24 hours before the slot.');
  }
  await prisma.booking.update({ data: { customerNotes: notes }, where: { id: bookingId } });
}

async function rescheduleQuote(booking: { pricingInput: Prisma.JsonValue }, config?: PricingConfig): Promise<{ config: PricingConfig; input: PricingInput }> {
  const active = config ? { config } : await getActivePricingConfig();
  return { config: active.config, input: booking.pricingInput as unknown as PricingInput };
}

async function rescheduleAllowed(booking: { jobStage: string; moveDate: Date; slot: Slot; status: string }, now: Date): Promise<void> {
  const actions = await manageActionState(booking, now);
  if (!actions.canReschedule) throw new AppError('CONFLICT', String(actions.rescheduleReason));
}

export async function previewReschedule(token: string, input: { date: string; slot: SlotValue }, now = new Date()): Promise<{ currentTotalPence: number; differencePence: number; newTotalPence: number }> {
  const bookingId = await bookingIdFromManageToken(token);
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { jobStage: true, moveDate: true, pricingInput: true, slot: true, status: true, totalPence: true },
  });
  await rescheduleAllowed(booking, now);
  const priced = await rescheduleQuote(booking);
  const slotPrice = priceForSlot(priced.input, priced.config, londonToday(now), input.date, input.slot);
  return {
    currentTotalPence: booking.totalPence,
    differencePence: slotPrice.pricePence - booking.totalPence,
    newTotalPence: slotPrice.pricePence,
  };
}

export async function applyReschedule(
  token: string,
  input: { date: string; expectedDifferencePence: number; idempotencyKey: string; slot: SlotValue },
  now = new Date(),
): Promise<{ clientSecret?: string; paymentId?: string; result: 'DONE' | 'PAYMENT_REQUIRED' }> {
  const bookingId = await bookingIdFromManageToken(token);
  const preview = await previewReschedule(token, { date: input.date, slot: input.slot }, now);
  if (preview.differencePence !== input.expectedDifferencePence) {
    throw new AppError('PRICE_CHANGED', 'The price has changed. Please review the new amount.', { differencePence: preview.differencePence });
  }
  const moveDate = dateOnly(input.date);
  if (preview.differencePence <= 0) {
    await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: { blocksSlots: true, capacityUnits: true, moveDate: true, slot: true },
      });
      if (fromDbDate(booking.moveDate) !== input.date || booking.slot !== input.slot) {
        await assertSlotCapacity(tx, { blocksSlots: booking.blocksSlots, capacityUnits: booking.capacityUnits, moveDate, now, slot: input.slot });
      }
      await tx.booking.update({
        data: {
          dispatchStatus: 'UNASSIGNED',
          driverId: null,
          moveDate,
          slot: input.slot,
          totalPence: preview.newTotalPence,
          vanId: null,
          version: { increment: 1 },
        },
        where: { id: bookingId },
      });
      await tx.assignment.updateMany({ data: { status: 'WITHDRAWN' }, where: { bookingId, status: { in: ['ACCEPTED', 'OFFERED'] } } });
      if (preview.differencePence < 0) {
        await requestRefund(tx, bookingId, -preview.differencePence, 'Customer self-service reschedule price reduction.', {
          dedupePrefix: `reschedule-refund:${input.idempotencyKey}`,
          notifyCustomer: false,
        });
      }
      await enqueueOutbox(tx, 'booking.rescheduled', json({ bookingId }), `booking.rescheduled:${bookingId}:${input.idempotencyKey}`);
    });
    return { result: 'DONE' };
  }

  const payment = await prisma.$transaction(async (tx) => {
    const booking = await tx.booking.findUniqueOrThrow({
      where: { id: bookingId },
      select: { blocksSlots: true, capacityUnits: true, contactEmail: true, reference: true },
    });
    await assertSlotCapacity(tx, { blocksSlots: booking.blocksSlots, capacityUnits: booking.capacityUnits, moveDate, now, slot: input.slot });
    const operations = await getOperationsSettings();
    const created = await tx.payment.create({
      data: {
        amountPence: preview.differencePence,
        bookingId,
        kind: 'RESCHEDULE_DIFFERENCE',
        status: 'REQUIRES_PAYMENT',
      },
      select: { amountPence: true, bookingId: true, currency: true, id: true, kind: true, stripePaymentIntentId: true },
    });
    await tx.slotHold.create({
      data: {
        bookingId,
        capacityUnits: booking.capacityUnits,
        date: moveDate,
        slot: input.slot,
        blocksSlots: booking.blocksSlots,
        expiresAt: new Date(now.getTime() + operations.paymentHoldMinutes * 60_000),
        paymentId: created.id,
        reason: 'RESCHEDULE_PAYMENT',
      },
    });
    return { ...created, booking: { contactEmail: booking.contactEmail, reference: booking.reference } };
  });
  const intent = await createOrRetrievePaymentIntent(payment);
  await prisma.payment.update({ data: { stripePaymentIntentId: intent.id }, where: { id: payment.id } });
  return { clientSecret: intent.clientSecret, paymentId: payment.id, result: 'PAYMENT_REQUIRED' };
}

export async function previewCancel(token: string, now = new Date()): Promise<{ allowed: boolean; policySummary: string; refundPence: number }> {
  const bookingId = await bookingIdFromManageToken(token);
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { jobStage: true, moveDate: true, paidPence: true, refundedPence: true, slot: true, status: true },
  });
  if (booking.status !== 'CONFIRMED' || booking.jobStage !== 'NOT_STARTED') {
    return { allowed: false, policySummary: 'Your move has started or is no longer confirmed. Call us for help.', refundPence: 0 };
  }
  const policy = await getSetting('cancellation');
  if (policy.freeCancellationHours === null || policy.noRefundHours === null || policy.lateCancellationRefundPercent === null) {
    return { allowed: false, policySummary: 'Online cancellation policy is not configured yet. Call us for help.', refundPence: 0 };
  }
  const hours = Math.floor((slotStart(booking).getTime() - now.getTime()) / 3_600_000);
  const paidNet = Math.max(0, booking.paidPence - booking.refundedPence);
  const refundPence = hours >= policy.freeCancellationHours
    ? paidNet
    : hours >= policy.noRefundHours
      ? Math.floor((paidNet * policy.lateCancellationRefundPercent) / 100)
      : 0;
  return {
    allowed: true,
    policySummary: `Free cancellation until ${String(policy.freeCancellationHours)} hours before. Late cancellation refund: ${String(policy.lateCancellationRefundPercent)}%. No refund inside ${String(policy.noRefundHours)} hours.`,
    refundPence,
  };
}

export async function applyCancel(token: string, input: { expectedRefundPence: number; reason?: string }, now = new Date()): Promise<{ refundPence: number }> {
  const bookingId = await bookingIdFromManageToken(token);
  const preview = await previewCancel(token, now);
  if (!preview.allowed) throw new AppError('CONFLICT', preview.policySummary);
  if (preview.refundPence !== input.expectedRefundPence) throw new AppError('PRICE_CHANGED', 'The refund amount changed. Please review it.', { refundPence: preview.refundPence });
  await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      data: {
        cancelledAt: now,
        cancelledBy: 'CUSTOMER',
        cancelReason: input.reason ?? null,
        status: 'CANCELLED',
        version: { increment: 1 },
      },
      where: { id: bookingId },
    });
    await requestRefund(tx, bookingId, preview.refundPence, 'Customer cancellation.', {
      dedupePrefix: `cancel:${bookingId}`,
      notifyCustomer: false,
    });
    await enqueueOutbox(tx, 'booking.cancelled', json({ bookingId, refundPence: preview.refundPence }), `booking.cancelled:${bookingId}`);
  });
  return { refundPence: preview.refundPence };
}

export async function trackingView(token: string): Promise<Record<string, unknown>> {
  const { bookingId } = await verifyBookingLink(token, 'track');
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: {
      driver: { include: { user: true } },
      locations: { orderBy: { recordedAt: 'desc' }, take: 1 },
      photos: true,
      review: true,
      van: true,
    },
  });
  const latest = booking.locations[0] ?? null;
  const enRoute = booking.jobStage === 'EN_ROUTE_TO_PICKUP' || booking.jobStage === 'EN_ROUTE_TO_DROPOFF';
  const fresh = latest ? Date.now() - latest.recordedAt.getTime() <= 5 * 60_000 : false;
  const reviewToken = booking.completedAt ? await bookingPurposeLink(booking, 'review', addDays(booking.completedAt, 60)) : null;
  return {
    dateLabel: dbDateLabel(booking.moveDate),
    driverFirstName: firstName(booking.driver?.user.name ?? null),
    jobStage: booking.jobStage,
    liveLocation: enRoute && latest ? { fresh, lat: latest.lat, lng: latest.lng, recordedAt: latest.recordedAt.toISOString() } : null,
    photos: booking.photos.map((photo) => ({ id: photo.id, kind: photo.kind })),
    reference: booking.reference,
    reviewUrl: reviewToken ? `/review/${encodeURIComponent(reviewToken)}` : null,
    slotLabel: slotLabel(booking.slot),
    status: booking.status,
    vanRegistration: booking.van?.registration ?? null,
  };
}

export async function reviewView(token: string): Promise<Record<string, unknown>> {
  const { bookingId } = await verifyBookingLink(token, 'review');
  const booking = await prisma.booking.findUniqueOrThrow({
    where: { id: bookingId },
    include: { review: true },
  });
  const pickup = AddressSchema.parse(booking.pickup);
  const parts = booking.contactName.trim().split(/\s+/);
  const first = parts[0] ?? booking.contactName;
  const lastInitial = parts.at(-1)?.charAt(0) ?? '';
  const displayName = parts.length > 1 ? `${first} ${lastInitial}.` : booking.contactName;
  const web = await getSetting('web');
  return {
    alreadyReviewed: Boolean(booking.review),
    displayName,
    googleBusinessProfileUrl: web.googleBusinessProfileUrl,
    reference: booking.reference,
    town: pickup.town,
  };
}

export async function submitReview(token: string, input: { comment?: string; displayName: string; rating: number; town?: string }): Promise<'created' | 'exists'> {
  const { bookingId } = await verifyBookingLink(token, 'review');
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { id: true, review: { select: { id: true } } } });
  if (booking.review) return 'exists';
  await prisma.review.create({
    data: {
      bookingId,
      comment: input.comment ?? null,
      displayName: input.displayName,
      rating: input.rating,
      status: 'PENDING',
      town: input.town ?? null,
    },
  });
  return 'created';
}

export async function payRequestView(token: string, now = new Date()): Promise<Record<string, unknown>> {
  const payload = await verifyCustomerLink(token, 'pay');
  const manualQuote = await prisma.manualQuote.findUnique({
    where: { id: payload.subject },
    include: { booking: true, quote: true },
  });
  if (manualQuote) {
    if (contactEmailHash(manualQuote.contactEmail) !== payload.emailHash) throw new AppError('UNAUTHORIZED', 'Invalid payment link.');
    return {
      amountPence: manualQuote.pricePence ?? 0,
      description: 'Manual quote',
      expired: !manualQuote.validUntil || manualQuote.validUntil.getTime() <= now.getTime(),
      kind: 'MANUAL_QUOTE',
      paid: manualQuote.status === 'ACCEPTED',
      reference: `MQ-${manualQuote.id.slice(-8).toUpperCase()}`,
      summary: manualQuote.adminMessage ?? manualQuote.details ?? 'Manual quote ready.',
      validUntil: manualQuote.validUntil?.toISOString() ?? null,
    };
  }
  const extra = await prisma.extraCharge.findUnique({
    where: { id: payload.subject },
    include: { booking: true },
  });
  if (extra) {
    if (contactEmailHash(extra.booking.contactEmail) !== payload.emailHash) throw new AppError('UNAUTHORIZED', 'Invalid payment link.');
    return {
      amountPence: extra.amountPence,
      description: extra.description,
      expired: false,
      kind: 'EXTRA_CHARGE',
      paid: extra.status === 'PAID',
      reference: extra.booking.reference,
      summary: `Extra charge for ${extra.booking.reference}.`,
      validUntil: null,
    };
  }
  const booking = await prisma.booking.findUnique({ where: { id: payload.subject } });
  if (!booking || contactEmailHash(booking.contactEmail) !== payload.emailHash) throw new AppError('UNAUTHORIZED', 'Invalid payment link.');
  return {
    amountPence: booking.totalPence,
    description: 'Phone booking payment',
    expired: booking.holdExpiresAt ? booking.holdExpiresAt.getTime() <= now.getTime() : false,
    kind: 'ADMIN_BOOKING',
    paid: booking.status === 'CONFIRMED' || booking.paidPence >= booking.totalPence,
    reference: booking.reference,
    summary: `${routeLabel(booking.pickup, booking.dropoff)} on ${dbDateLabel(booking.moveDate)}, ${slotLabel(booking.slot)}.`,
    validUntil: booking.holdExpiresAt?.toISOString() ?? null,
  };
}

async function intentForPayment(payment: {
  amountPence: number;
  booking: { contactEmail: string; reference: string };
  bookingId: string;
  currency: string;
  id: string;
  kind: string;
  stripePaymentIntentId: string | null;
}): Promise<{ clientSecret: string; paymentId: string }> {
  const intent = await createOrRetrievePaymentIntent(payment);
  if (payment.stripePaymentIntentId !== intent.id) {
    await prisma.payment.update({ data: { stripePaymentIntentId: intent.id }, where: { id: payment.id } });
  }
  return { clientSecret: intent.clientSecret, paymentId: payment.id };
}

export async function startPayRequest(token: string, now = new Date()): Promise<{ amountPence: number; clientSecret: string; paymentId: string }> {
  const payload = await verifyCustomerLink(token, 'pay');
  const manualQuote = await prisma.manualQuote.findUnique({
    where: { id: payload.subject },
    include: { quote: true },
  });
  if (manualQuote) {
    if (contactEmailHash(manualQuote.contactEmail) !== payload.emailHash) throw new AppError('UNAUTHORIZED', 'Invalid payment link.');
    if (manualQuote.status === 'ACCEPTED') throw new AppError('CONFLICT', 'This payment has already been made.');
    if (!manualQuote.pricePence || !manualQuote.preferredDate || !manualQuote.preferredSlot || !manualQuote.validUntil || manualQuote.validUntil <= now) {
      throw new AppError('CONFLICT', 'This payment link has expired.');
    }
    const result = await prisma.$transaction(async (tx) => createManualQuoteBooking(tx, manualQuote, now));
    const intent = await intentForPayment(result.payment);
    return { amountPence: result.payment.amountPence, ...intent };
  }
  const extra = await prisma.extraCharge.findUnique({ where: { id: payload.subject }, include: { booking: true, payment: true } });
  if (extra) {
    if (contactEmailHash(extra.booking.contactEmail) !== payload.emailHash) throw new AppError('UNAUTHORIZED', 'Invalid payment link.');
    if (extra.status === 'PAID') throw new AppError('CONFLICT', 'This payment has already been made.');
    const payment = extra.payment ?? await prisma.payment.create({
      data: { amountPence: extra.amountPence, bookingId: extra.bookingId, extraCharge: { connect: { id: extra.id } }, kind: 'EXTRA_CHARGE' },
      select: { amountPence: true, bookingId: true, currency: true, id: true, kind: true, stripePaymentIntentId: true },
    });
    const intent = await intentForPayment({ ...payment, booking: { contactEmail: extra.booking.contactEmail, reference: extra.booking.reference } });
    return { amountPence: payment.amountPence, ...intent };
  }
  const booking = await prisma.booking.findUnique({ where: { id: payload.subject }, include: { payments: true } });
  if (!booking || contactEmailHash(booking.contactEmail) !== payload.emailHash) throw new AppError('UNAUTHORIZED', 'Invalid payment link.');
  if (booking.status !== 'PENDING_PAYMENT') throw new AppError('CONFLICT', 'This payment has already been made.');
  const existing = booking.payments.find((payment) => payment.kind === 'ADMIN_BOOKING') ?? await prisma.payment.create({
    data: { amountPence: booking.totalPence, bookingId: booking.id, kind: 'ADMIN_BOOKING' },
    select: { amountPence: true, bookingId: true, currency: true, id: true, kind: true, stripePaymentIntentId: true },
  });
  const intent = await intentForPayment({ ...existing, booking: { contactEmail: booking.contactEmail, reference: booking.reference } });
  return { amountPence: existing.amountPence, ...intent };
}

type ManualQuoteWithQuote = Prisma.ManualQuoteGetPayload<{ include: { quote: true } }>;

async function createManualQuoteBooking(tx: DbTx, manualQuote: ManualQuoteWithQuote, now: Date) {
  if (manualQuote.bookingId) {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: manualQuote.bookingId }, include: { payments: true } });
    const payment = booking.payments.find((candidate) => candidate.kind === 'MANUAL_QUOTE') ?? await tx.payment.create({
      data: { amountPence: manualQuote.pricePence ?? 0, bookingId: booking.id, kind: 'MANUAL_QUOTE' },
      select: { amountPence: true, bookingId: true, currency: true, id: true, kind: true, stripePaymentIntentId: true },
    });
    return { payment: { ...payment, booking: { contactEmail: booking.contactEmail, reference: booking.reference } } };
  }
  if (!manualQuote.preferredDate || !manualQuote.preferredSlot || !manualQuote.pricePence) throw new AppError('CONFLICT', 'This quote is not ready for payment.');
  const quote = manualQuote.quote;
  await assertSlotCapacity(tx, {
    blocksSlots: quote.blocksSlots,
    capacityUnits: quote.capacityUnits,
    moveDate: manualQuote.preferredDate,
    now,
    slot: manualQuote.preferredSlot,
  });
  const customer = await tx.customer.upsert({
    create: { email: manualQuote.contactEmail.toLowerCase(), name: manualQuote.contactName, phone: manualQuote.contactPhone },
    update: { name: manualQuote.contactName, phone: manualQuote.contactPhone },
    where: { email: manualQuote.contactEmail.toLowerCase() },
  });
  const reference = await uniqueReference(tx);
  const operations = await getOperationsSettings();
  const booking = await tx.booking.create({
    data: {
      accessDetail: quote.accessDetail as Prisma.InputJsonValue,
      blocksSlots: quote.blocksSlots,
      capacityUnits: quote.capacityUnits,
      contactEmail: manualQuote.contactEmail.toLowerCase(),
      contactName: manualQuote.contactName,
      contactPhone: manualQuote.contactPhone,
      customerId: customer.id,
      distanceMiles: quote.distanceMiles,
      dropoff: quote.dropoff ?? Prisma.DbNull,
      dropoffPostcode: quote.dropoff ? AddressSchema.parse(quote.dropoff).postcode : null,
      durationMinutes: quote.durationMinutes,
      holdExpiresAt: new Date(now.getTime() + operations.paymentHoldMinutes * 60_000),
      moveDate: manualQuote.preferredDate,
      pickup: quote.pickup as Prisma.InputJsonValue,
      pickupPostcode: AddressSchema.parse(quote.pickup).postcode,
      priceBreakdown: json({ manual: true, pricePence: manualQuote.pricePence }),
      pricingInput: quote.input as Prisma.InputJsonValue,
      pricingVersionId: quote.pricingVersionId,
      quoteId: quote.id,
      reference,
      routeGeometry: quote.routeGeometry,
      service: quote.service,
      slot: manualQuote.preferredSlot,
      source: 'MANUAL_QUOTE',
      status: 'PENDING_PAYMENT',
      totalPence: manualQuote.pricePence,
      variant: quote.variant,
    },
  });
  await tx.manualQuote.update({ data: { bookingId: booking.id }, where: { id: manualQuote.id } });
  const payment = await tx.payment.create({
    data: { amountPence: manualQuote.pricePence, bookingId: booking.id, kind: 'MANUAL_QUOTE' },
    select: { amountPence: true, bookingId: true, currency: true, id: true, kind: true, stripePaymentIntentId: true },
  });
  return { payment: { ...payment, booking: { contactEmail: booking.contactEmail, reference: booking.reference } } };
}

export async function payLinkForManualQuote(manualQuote: { contactEmail: string; id: string; validUntil: Date | null }): Promise<string> {
  if (!manualQuote.validUntil) throw new AppError('CONFLICT', 'Manual quote has no expiry.');
  return signCustomerLink({ email: manualQuote.contactEmail, expiresAt: manualQuote.validUntil, purpose: 'pay', subject: manualQuote.id });
}

export async function payLinkForExtraCharge(extra: { booking: { contactEmail: string }; id: string }, now = new Date()): Promise<string> {
  return signCustomerLink({ email: extra.booking.contactEmail, expiresAt: addDays(now, 14), purpose: 'pay', subject: extra.id });
}

export async function payLinkForBooking(booking: { contactEmail: string; holdExpiresAt: Date | null; id: string }, now = new Date()): Promise<string> {
  return signCustomerLink({ email: booking.contactEmail, expiresAt: booking.holdExpiresAt ?? addDays(now, 1), purpose: 'pay', subject: booking.id });
}
