import 'server-only';
import type { z } from 'zod';
import {
  AddressSchema, AdminBookingActionsContextSchema, AdminBookingCreateContextSchema, AdminBookingMutationResponseSchema,
  AdminCancelPreviewResponseSchema, AdminPhoneBookingResponseSchema, AppError, assertTransition, fromDbDate,
  type AdminPhoneBookingCreate, type AdminCancelPreviewRequest, type AdminCancelApply, type AdminPaymentRefundRequest,
  type AdminOfflinePaymentRequest, type AdminExtraChargeRequest, type AdminResendEmailRequest,
} from '@sv/contracts';
import { assertSlotCapacity, enqueueOutbox, Prisma, prisma, type DbTx } from '@sv/db';
import { SERVICE_KEYS } from '@sv/pricing';
import type { AdminBookingEditActor } from './booking-edit';
import { parseBookingPricingConfig } from './booking-edit-pricing';
import { getActivePricingConfig } from '../services/catalogue';
import { assertChosenSlotAvailable, priceSlot, uniqueReference } from '../services/booking';
import { invalidateAvailabilityCache } from '../services/availability';
import { payLinkForBooking } from '../services/customer-self-service';
import { recomputeBookingMoney, requestRefund } from '../services/payments';
import { cancelPaymentIntentForCleanup } from '../integrations/stripe';
import { getOperationsSettings, getSetting } from '../settings';
import { londonDateTimeToUtc } from '../london-time';

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
export const actionBookingInclude = { payments: { include: { refunds: true } }, extraCharges: true, slotHolds: true } as const satisfies Prisma.BookingInclude;
type ActionBooking = Prisma.BookingGetPayload<{ include: typeof actionBookingInclude }>;
function conflict(message = 'This booking changed. Refresh it and try again.'): never { throw new AppError('CONFLICT', message); }
function transactionError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && (error.code === 'P2034' || error.code === 'P2002')) conflict();
  throw error;
}
function assertVersion(booking: ActionBooking, expectedVersion: number): void {
  if (booking.deletedAt) conflict('Restore this booking before changing it.');
  if (booking.version !== expectedVersion) conflict();
}
async function loadBooking(tx: DbTx, id: string): Promise<ActionBooking> {
  const booking = await tx.booking.findUnique({ where: { id }, include: actionBookingInclude });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  return booking;
}
export function refundablePayment(payment: Pick<ActionBooking['payments'][number], 'amountPence' | 'status' | 'method' | 'refunds'>): number {
  return payment.method === 'STRIPE' && payment.status === 'SUCCEEDED' ? Math.max(0, payment.amountPence - payment.refunds.reduce((sum, refund) => sum + (refund.status === 'SUCCEEDED' || refund.status === 'PENDING' ? refund.amountPence : 0), 0)) : 0;
}
function assertLedger(booking: ActionBooking): void {
  const paid = booking.payments.reduce((sum, payment) => sum + (payment.status === 'SUCCEEDED' ? payment.amountPence : 0), 0);
  const refunded = booking.payments.reduce((sum, payment) => sum + payment.refunds.reduce((s, refund) => s + (refund.status === 'SUCCEEDED' ? refund.amountPence : 0), 0), 0);
  if (paid !== booking.paidPence || refunded !== booking.refundedPence) conflict('Payments are being reconciled. Refresh before changing this booking.');
}
function unsettledReason(booking: ActionBooking): string | null {
  if (booking.deletedAt) return 'Restore this booking before changing it.';
  if (booking.payments.some((payment) => payment.status === 'PROCESSING')) return 'A payment is processing. Wait for its final status.';
  if (booking.payments.some((payment) => payment.refunds.some((refund) => refund.status === 'PENDING'))) return 'A refund is processing. Wait for its final status.';
  if (booking.slotHolds.length) return 'A reschedule payment is unresolved. Resolve it first.';
  if (booking.extraCharges.some((extra) => extra.status === 'REQUESTED' || extra.status === 'AWAITING_PAYMENT')) return 'An extra charge is unresolved. Resolve it first.';
  return null;
}
function cancelReason(booking: ActionBooking): string | null {
  return unsettledReason(booking) ?? (!['PENDING_PAYMENT','CONFIRMED','IN_PROGRESS'].includes(booking.status) ? 'Only active or unpaid bookings can be cancelled.' : null);
}
function offlineReason(booking: ActionBooking): string | null {
  return unsettledReason(booking) ?? (!['PENDING_PAYMENT','CONFIRMED'].includes(booking.status) ? 'Offline payments require an unpaid or confirmed booking.' : null)
    ?? (booking.totalPence <= booking.paidPence - booking.refundedPence ? 'This booking has no unpaid balance.' : null);
}
function snapshot(booking: ActionBooking): string {
  return JSON.stringify({ payments: booking.payments.sort((a, b) => a.id.localeCompare(b.id)), extras: booking.extraCharges, holds: booking.slotHolds });
}
async function closePendingIntents(booking: ActionBooking): Promise<void> {
  for (const payment of booking.payments) {
    if (payment.status === 'SUCCEEDED' || payment.status === 'CANCELED') continue;
    if (payment.stripeCheckoutSessionId) conflict('Close the outstanding checkout session before changing this booking.');
    if (payment.stripePaymentIntentId) await cancelPaymentIntentForCleanup(payment.stripePaymentIntentId, { bookingId: booking.id, paymentId: payment.id });
    else if (payment.kind !== 'ADMIN_BOOKING') conflict('A card payment is being prepared. Refresh and try again.');
  }
}
async function bump(tx: DbTx, booking: ActionBooking, data: Prisma.BookingUpdateManyMutationInput = {}): Promise<number> {
  const changed = await tx.booking.updateMany({ where: { id: booking.id, version: booking.version, status: booking.status, deletedAt: null }, data: { ...data, version: { increment: 1 } } });
  if (changed.count !== 1) conflict();
  return booking.version + 1;
}
async function audit(tx: DbTx, id: string, action: string, actor: AdminBookingEditActor, before: unknown, after: unknown, reason?: string): Promise<void> {
  await tx.auditLog.create({ data: { actorType: 'USER', actorUserId: actor.userId, requestId: actor.requestId, entityType: 'booking', entityId: id, action, before: before === null ? Prisma.JsonNull : json(before), after: json(after), reason: reason ?? null } });
}
function result(id: string, version: number) { return AdminBookingMutationResponseSchema.parse({ ok: true, id, version }); }
function prefix(id: string, version: number): string { return `admin-booking:${id}:${String(version)}`; }

export async function readAdminBookingCreateContext(): Promise<z.infer<typeof AdminBookingCreateContextSchema>> {
  const active = await getActivePricingConfig();
  const config = parseBookingPricingConfig(active.config);
  const operations = await getOperationsSettings();
  return AdminBookingCreateContextSchema.parse({ ready: !operations.bookingPaused, reason: operations.bookingPaused ? 'Bookings are currently paused.' : null,
    services: SERVICE_KEYS.map((key) => ({ key, ...config.services[key] })).map(({ key, label, requiresDropoff, variants }) => ({ key, label, requiresDropoff, variants: variants.map(({ key: variantKey, label: variantLabel, manualQuote }) => ({ key: variantKey, label: variantLabel, manualQuote })) })) });
}
async function phoneResponse(booking: { id: string; version: number; reference: string; status: ActionBooking['status']; totalPence: number; contactEmail: string; holdExpiresAt: Date | null }) {
  const web = await getSetting('web');
  const paymentUrl = booking.status === 'PENDING_PAYMENT' && booking.holdExpiresAt && booking.holdExpiresAt > new Date() ? `${web.canonicalOrigin}/pay/${await payLinkForBooking(booking)}` : null;
  return AdminPhoneBookingResponseSchema.parse({ ok: true, id: booking.id, version: booking.version, reference: booking.reference, status: booking.status, totalPence: booking.totalPence, paymentUrl });
}
export async function createAdminPhoneBooking(input: AdminPhoneBookingCreate, actor: AdminBookingEditActor, now = new Date()): Promise<z.infer<typeof AdminPhoneBookingResponseSchema>> {
  if (input.payment.mode === 'OFFLINE' && actor.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Only the owner can record offline payments.');
  const old = await prisma.booking.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { quote: { select: { publicId: true } }, payments: true } });
  if (old) {
    if (old.source !== 'ADMIN_PHONE' || old.quote?.publicId !== input.quotePublicId || old.contactEmail !== input.contact.email || old.contactName !== input.contact.name || old.contactPhone !== input.contact.phone || fromDbDate(old.moveDate) !== input.date || old.slot !== input.slot || old.totalPence !== input.expectedTotalPence || (old.payments.some((payment) => payment.method === 'OFFLINE') !== (input.payment.mode === 'OFFLINE'))) conflict('This request key belongs to different booking details. Start a new request.');
    return phoneResponse(old);
  }
  const quote = await prisma.quote.findUnique({ where: { publicId: input.quotePublicId }, include: { pricingVersion: true } });
  if (!quote) throw new AppError('NOT_FOUND', 'Quote not found.');
  if (quote.requiresManualQuote || quote.status !== 'ACTIVE') conflict('This quote cannot be booked instantly.');
  const priced = await priceSlot(quote, input.date, input.slot, now);
  if (priced.totalPence !== input.expectedTotalPence) throw new AppError('PRICE_CHANGED', 'The price changed. Review the latest quote.', { totalPence: priced.totalPence });
  if (priced.totalPence <= 0) throw new AppError('VALIDATION_ERROR', 'A booking must have a positive price.');
  await assertChosenSlotAvailable({ ...quote, calendar: priced.calendar, date: input.date, slot: input.slot, now });
  const operations = await getOperationsSettings();
  if (operations.bookingPaused) conflict('Bookings are currently paused.');
  const moveDate = new Date(`${input.date}T00:00:00.000Z`);
  const holdExpiresAt = input.payment.mode === 'LINK' ? new Date(Math.min(now.getTime() + operations.phoneBookingHoldHours * 3_600_000, londonDateTimeToUtc(input.date, operations.slotWindows[input.slot].start).getTime() - operations.minLeadMinutes * 60_000)) : null;
  try {
    const booking = await prisma.$transaction(async (tx) => {
      const used = await tx.booking.findFirst({ where: { quoteId: quote.id, status: { notIn: ['EXPIRED','CANCELLED'] } }, select: { id: true } });
      if (used) conflict('This quote already has a booking.');
      await assertSlotCapacity(tx, { blocksSlots: quote.blocksSlots, capacityUnits: quote.capacityUnits, moveDate, now, slot: input.slot });
      const customer = await tx.customer.upsert({ where: { email: input.contact.email }, create: { email: input.contact.email, name: input.contact.name, phone: input.contact.phone }, update: { name: input.contact.name, phone: input.contact.phone } });
      const created = await tx.booking.create({ data: {
        reference: await uniqueReference(tx), customerId: customer.id, contactName: input.contact.name, contactEmail: input.contact.email, contactPhone: input.contact.phone,
        quoteId: quote.id, service: quote.service, variant: quote.variant, pickup: json(quote.pickup), dropoff: quote.dropoff ?? Prisma.DbNull,
        pickupPostcode: AddressSchema.parse(quote.pickup).postcode, dropoffPostcode: quote.dropoff ? AddressSchema.parse(quote.dropoff).postcode : null,
        distanceMiles: quote.distanceMiles, durationMinutes: quote.durationMinutes, routeGeometry: quote.routeGeometry, pricingInput: json(quote.input), accessDetail: json(quote.accessDetail),
        priceBreakdown: json({ breakdown: priced.breakdown, slot: { date: input.date, multipliers: priced.multipliers, slot: input.slot } }), pricingVersionId: priced.pricingVersionId,
        moveDate, slot: input.slot, totalPence: priced.totalPence, paidPence: input.payment.mode === 'OFFLINE' ? priced.totalPence : 0, holdExpiresAt,
        capacityUnits: quote.capacityUnits, blocksSlots: quote.blocksSlots, source: 'ADMIN_PHONE', status: input.payment.mode === 'OFFLINE' ? 'CONFIRMED' : 'PENDING_PAYMENT', idempotencyKey: input.idempotencyKey, adminNotes: input.notes ?? null,
      } });
      await tx.payment.create({ data: { bookingId: created.id, kind: 'ADMIN_BOOKING', amountPence: priced.totalPence, method: input.payment.mode === 'OFFLINE' ? 'OFFLINE' : 'STRIPE', status: input.payment.mode === 'OFFLINE' ? 'SUCCEEDED' : 'REQUIRES_PAYMENT', ...(input.payment.mode === 'OFFLINE' ? { offlineReference: input.payment.reference, recordedById: actor.userId } : {}) } });
      if (input.payment.mode === 'OFFLINE') await tx.quote.update({ where: { id: quote.id }, data: { status: 'CONVERTED' } });
      await audit(tx, created.id, 'admin.bookings.phone.create', actor, null, { version: created.version, paymentMode: input.payment.mode, totalPence: priced.totalPence, quoteId: quote.id });
      await enqueueOutbox(tx, input.payment.mode === 'OFFLINE' ? 'booking.confirmed' : 'booking.payment_requested', { bookingId: created.id, bookingVersion: created.version }, `${prefix(created.id, created.version)}:created`);
      return created;
    }, { isolationLevel: 'Serializable' });
    invalidateAvailabilityCache();
    return await phoneResponse(booking);
  } catch (error) { return transactionError(error); }
}

export async function readAdminBookingActionsContext(id: string, actor: AdminBookingEditActor): Promise<z.infer<typeof AdminBookingActionsContextSchema>> {
  const booking = await loadBooking(prisma, id);
  assertLedger(booking);
  const capability = (reason: string | null) => ({ allowed: reason === null, reason });
  const refundable = booking.payments.reduce((sum, payment) => sum + refundablePayment(payment), 0);
  return AdminBookingActionsContextSchema.parse({ id, version: booking.version, status: booking.status, totalPence: booking.totalPence, paidPence: booking.paidPence, refundedPence: booking.refundedPence,
    balancePence: Math.max(0, booking.totalPence - booking.paidPence + booking.refundedPence), cancellation: capability(cancelReason(booking)),
    refund: capability(unsettledReason(booking) ?? (refundable > 0 ? null : 'No captured Stripe payment is available to refund.')),
    offlinePayment: capability(actor.role !== 'OWNER' ? 'Only the owner can record offline payments.' : offlineReason(booking)),
    extraCharge: capability(unsettledReason(booking) ?? (['CONFIRMED','IN_PROGRESS'].includes(booking.status) ? null : 'Extra charges require an active confirmed booking.')),
    payments: booking.payments.map((payment) => ({ id: payment.id, method: payment.method, status: payment.status, amountPence: payment.amountPence, refundablePence: refundablePayment(payment), createdAt: payment.createdAt.toISOString() })) });
}
export function cancellationRefund(input: AdminCancelPreviewRequest['refund'], netPaid: number, hours: number, policy: { freeCancellationHours: number | null; noRefundHours: number | null; lateCancellationRefundPercent: number | null }): { refundPence: number; policySummary: string } {
  if (input.mode === 'NONE') return { refundPence: 0, policySummary: 'Cancel without issuing a refund.' };
  if (input.mode === 'FULL') return { refundPence: netPaid, policySummary: 'Refund the full remaining payment.' };
  if (input.mode === 'CUSTOM') {
    if (input.amountPence > netPaid) throw new AppError('VALIDATION_ERROR', 'The refund exceeds the net payment.');
    return { refundPence: input.amountPence, policySummary: 'Use the explicitly entered refund amount.' };
  }
  if (policy.freeCancellationHours === null || policy.noRefundHours === null || policy.lateCancellationRefundPercent === null) conflict('The cancellation policy is not configured. Choose an explicit full, custom or no-refund decision.');
  const percent = hours >= policy.freeCancellationHours ? 100 : hours >= policy.noRefundHours ? policy.lateCancellationRefundPercent : 0;
  return { refundPence: Math.floor(netPaid * percent / 100), policySummary: `Configured cancellation policy: ${String(percent)}% of the remaining payment.` };
}
async function cancellationPreview(booking: ActionBooking, input: AdminCancelPreviewRequest, now: Date) {
  assertVersion(booking, input.expectedVersion); assertLedger(booking);
  const reason = cancelReason(booking); if (reason) conflict(reason);
  const [operations, policy] = await Promise.all([getOperationsSettings(), getSetting('cancellation')]);
  const hours = Math.floor((londonDateTimeToUtc(fromDbDate(booking.moveDate), operations.slotWindows[booking.slot].start).getTime() - now.getTime()) / 3_600_000);
  const paidNetPence = booking.paidPence - booking.refundedPence;
  const refund = cancellationRefund(input.refund, paidNetPence, hours, policy);
  if (refund.refundPence > booking.payments.reduce((sum, payment) => sum + refundablePayment(payment), 0)) conflict('This decision requires an offline refund. Reconcile the offline payment before requesting this refund.');
  return AdminCancelPreviewResponseSchema.parse({ id: booking.id, expectedVersion: booking.version, ...refund, paidNetPence, willUnassignDriver: booking.driverId !== null || booking.dispatchStatus !== 'UNASSIGNED' });
}
export async function previewAdminBookingCancellation(id: string, input: AdminCancelPreviewRequest, now = new Date()): Promise<z.infer<typeof AdminCancelPreviewResponseSchema>> { return cancellationPreview(await loadBooking(prisma, id), input, now); }
export async function cancelAdminBooking(id: string, input: AdminCancelApply, actor: AdminBookingEditActor, now = new Date()): Promise<z.infer<typeof AdminBookingMutationResponseSchema>> {
  const before = await loadBooking(prisma, id);
  const preview = await cancellationPreview(before, input, now);
  if (preview.refundPence !== input.expectedRefundPence) throw new AppError('PRICE_CHANGED', 'The refund changed. Review the cancellation again.');
  await closePendingIntents(before);
  try {
    const changed = await prisma.$transaction(async (tx) => {
      const booking = await loadBooking(tx, id);
      const latest = await cancellationPreview(booking, input, now);
      if (snapshot(booking) !== snapshot(before) || latest.refundPence !== input.expectedRefundPence) conflict();
      assertTransition('booking', booking.status, 'CANCELLED', actor.role);
      if (booking.dispatchStatus !== 'UNASSIGNED') assertTransition('dispatch', booking.dispatchStatus, 'UNASSIGNED', actor.role);
      const version = await bump(tx, booking, { status: 'CANCELLED', cancelledAt: now, cancelledBy: 'ADMIN', cancelReason: input.reason, holdExpiresAt: null, dispatchStatus: 'UNASSIGNED' });
      await tx.assignment.updateMany({ where: { bookingId: id, status: { in: ['OFFERED','ACCEPTED'] } }, data: { status: 'WITHDRAWN', respondedAt: now } });
      await tx.payment.updateMany({ where: { bookingId: id, status: { in: ['REQUIRES_PAYMENT','FAILED'] } }, data: { status: 'CANCELED' } });
      await tx.slotHold.deleteMany({ where: { bookingId: id } });
      await requestRefund(tx, id, latest.refundPence, input.reason, { dedupePrefix: `${prefix(id, version)}:refund`, notifyCustomer: input.notifyCustomer });
      await audit(tx, id, 'admin.bookings.cancel', actor, { version: booking.version, status: booking.status }, { version, status: 'CANCELLED', refundPence: latest.refundPence, refundMode: input.refund.mode }, input.reason);
      await enqueueOutbox(tx, 'booking.cancelled', { bookingId: id, notifyCustomer: input.notifyCustomer }, `${prefix(id, version)}:cancelled`);
      return result(id, version);
    }, { isolationLevel: 'Serializable' });
    invalidateAvailabilityCache(); return changed;
  } catch (error) { return transactionError(error); }
}
export async function refundAdminBookingPayment(id: string, input: AdminPaymentRefundRequest, actor: AdminBookingEditActor): Promise<z.infer<typeof AdminBookingMutationResponseSchema>> {
  try { return await prisma.$transaction(async (tx) => {
    const booking = await loadBooking(tx, id); assertVersion(booking, input.expectedVersion); assertLedger(booking);
    const reason = unsettledReason(booking); if (reason) conflict(reason);
    const payment = booking.payments.find((item) => item.id === input.paymentId);
    if (!payment || input.amountPence <= 0 || refundablePayment(payment) < input.amountPence) throw new AppError('VALIDATION_ERROR', 'Choose a captured card payment and an available refund amount.');
    const version = await bump(tx, booking);
    await requestRefund(tx, id, input.amountPence, input.reason, { paymentId: input.paymentId, dedupePrefix: `${prefix(id, version)}:refund` });
    await audit(tx, id, 'admin.bookings.refund', actor, { version: booking.version }, { version, paymentId: input.paymentId, amountPence: input.amountPence }, input.reason);
    return result(id, version);
  }, { isolationLevel: 'Serializable' }); } catch (error) { return transactionError(error); }
}
export async function recordAdminOfflinePayment(id: string, input: AdminOfflinePaymentRequest, actor: AdminBookingEditActor, now = new Date()): Promise<z.infer<typeof AdminBookingMutationResponseSchema>> {
  if (actor.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Only the owner can record offline payments.');
  if (new Date(input.paidAt) > now) throw new AppError('VALIDATION_ERROR', 'Payment time cannot be in the future.');
  const before = await loadBooking(prisma, id); assertVersion(before, input.expectedVersion); assertLedger(before);
  const reason = offlineReason(before); if (reason) conflict(reason);
  if (before.status === 'PENDING_PAYMENT' && (!before.holdExpiresAt || before.holdExpiresAt <= now)) conflict('The payment hold expired. Create a fresh booking to recheck availability.');
  if (input.amountPence !== before.totalPence - before.paidPence + before.refundedPence) throw new AppError('VALIDATION_ERROR', 'Record the full outstanding balance to close the pending card payment safely.');
  await closePendingIntents(before);
  try {
    const changed = await prisma.$transaction(async (tx) => {
      const booking = await loadBooking(tx, id); assertVersion(booking, input.expectedVersion); assertLedger(booking);
      if (snapshot(booking) !== snapshot(before)) conflict();
      const pending = booking.status === 'PENDING_PAYMENT';
      if (pending) {
        if (!booking.holdExpiresAt || booking.holdExpiresAt <= now) conflict('The payment hold expired. Create a fresh booking to recheck availability.');
        assertTransition('booking', booking.status, 'CONFIRMED', actor.role);
      }
      const version = await bump(tx, booking, pending ? { status: 'CONFIRMED', holdExpiresAt: null } : {});
      await tx.payment.updateMany({ where: { bookingId: id, status: { in: ['REQUIRES_PAYMENT','FAILED'] } }, data: { status: 'CANCELED' } });
      const payment = await tx.payment.create({ data: { bookingId: id, kind: 'ADMIN_BOOKING', method: 'OFFLINE', status: 'SUCCEEDED', amountPence: input.amountPence, offlineReference: input.reference, recordedById: actor.userId, createdAt: new Date(input.paidAt) } });
      await recomputeBookingMoney(tx, id);
      if (pending && booking.quoteId) await tx.quote.update({ where: { id: booking.quoteId }, data: { status: 'CONVERTED' } });
      await audit(tx, id, 'admin.bookings.offline-payment', actor, { version: booking.version, paidPence: booking.paidPence }, { version, paymentId: payment.id, amountPence: input.amountPence, reference: input.reference, paidAt: input.paidAt });
      if (pending) await enqueueOutbox(tx, 'booking.confirmed', { bookingId: id }, `${prefix(id, version)}:confirmed`);
      return result(id, version);
    }, { isolationLevel: 'Serializable' }); invalidateAvailabilityCache(); return changed;
  } catch (error) { return transactionError(error); }
}
export async function createAdminExtraCharge(id: string, input: AdminExtraChargeRequest, actor: AdminBookingEditActor, now = new Date()): Promise<z.infer<typeof AdminBookingMutationResponseSchema>> {
  try { return await prisma.$transaction(async (tx) => {
    const booking = await loadBooking(tx, id); assertVersion(booking, input.expectedVersion); assertLedger(booking);
    const reason = unsettledReason(booking); if (reason) conflict(reason);
    if (!['CONFIRMED','IN_PROGRESS'].includes(booking.status)) conflict('Extra charges require an active confirmed booking.');
    const version = await bump(tx, booking, { totalPence: { increment: input.amountPence } });
    const extra = await tx.extraCharge.create({ data: { bookingId: id, amountPence: input.amountPence, description: input.description, status: 'AWAITING_PAYMENT', includedInBookingTotal: true, requestedById: actor.userId, decidedById: actor.userId, decidedAt: now } });
    await audit(tx, id, 'admin.bookings.extra-charge', actor, { version: booking.version, totalPence: booking.totalPence }, { version, extraChargeId: extra.id, amountPence: input.amountPence }, input.description);
    await enqueueOutbox(tx, 'extra_charge.awaiting_payment', { bookingId: id, extraChargeId: extra.id }, `${prefix(id, version)}:extra`);
    return result(id, version);
  }, { isolationLevel: 'Serializable' }); } catch (error) { return transactionError(error); }
}
export async function resendAdminBookingEmail(id: string, input: AdminResendEmailRequest, actor: AdminBookingEditActor, now = new Date()): Promise<z.infer<typeof AdminBookingMutationResponseSchema>> {
  try { return await prisma.$transaction(async (tx) => {
    const booking = await loadBooking(tx, id); assertVersion(booking, input.expectedVersion);
    if (input.template === 'PAYMENT_LINK' && (booking.status !== 'PENDING_PAYMENT' || !booking.holdExpiresAt || booking.holdExpiresAt <= now)) conflict('This booking has no active payment link.');
    if (input.template === 'CONFIRMATION' && !['CONFIRMED','IN_PROGRESS','COMPLETED'].includes(booking.status)) conflict('Only confirmed bookings have a confirmation email.');
    const version = await bump(tx, booking);
    await audit(tx, id, 'admin.bookings.resend-email', actor, { version: booking.version }, { version, template: input.template });
    await enqueueOutbox(tx, 'booking.email_resent', { bookingId: id, bookingVersion: version, template: input.template, ...(input.template === 'PAYMENT_LINK' ? { paymentId: booking.payments.find((payment) => payment.kind === 'ADMIN_BOOKING' && payment.status === 'REQUIRES_PAYMENT')?.id ?? null } : {}) }, `${prefix(id, version)}:email`);
    return result(id, version);
  }, { isolationLevel: 'Serializable' }); } catch (error) { return transactionError(error); }
}
