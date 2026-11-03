import 'server-only';

import {
  AdminBookingCalendarResponseSchema, AdminBookingReschedulePreviewSchema, AppError, BookingStoredPriceSchema, assertTransition,
  fromDbDate, londonToday, toDbDate, type AdminBookingCalendarResponse, type AdminBookingReschedulePreview,
  type AdminReschedulePreviewRequestSchema, type AdminRescheduleSchema,
} from '@sv/contracts';
import { enqueueOutbox, prisma, slotsCovered, type DbTx, type Prisma, type Slot } from '@sv/db';
import { computeQuote, priceForSlot, PricingError, type PricingInput } from '@sv/pricing';
import type { z } from 'zod';
import { londonDateTimeToUtc } from '../london-time';
import { getOperationsSettings, type OperationsSettings } from '../settings';
import { getActivePricingConfig } from '../services/catalogue';
import { invalidateAvailabilityCache } from '../services/availability';
import { assertAdminBookingCapacity } from './booking-capacity';
import { assertAdminBookingChangeReady } from './booking-change-guards';
import { parseBookingPricingInput } from './booking-edit-pricing';
import { previewAdminBookingSettlement, settleAdminBookingChange } from './booking-settlement';
import { withdrawAdminBookingAssignments, type BookingMutationResult, type DispatchActor } from './booking-dispatch';

const bookingSelect = {
  id: true, reference: true, version: true, deletedAt: true, status: true, jobStage: true, dispatchStatus: true,
  driverId: true, vanId: true, moveDate: true, slot: true, blocksSlots: true, capacityUnits: true, service: true, source: true,
  pricingInput: true, pricingVersionId: true, priceBreakdown: true, totalPence: true, paidPence: true, refundedPence: true,
} as const satisfies Prisma.BookingSelect;
type RescheduleBooking = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;
export type AdminRescheduleInput = z.infer<typeof AdminReschedulePreviewRequestSchema>;

function dbDate(value: string): Date { return new Date(`${toDbDate(value)}T00:00:00.000Z`); }
function asJson(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

async function readBooking(tx: DbTx, id: string): Promise<RescheduleBooking> {
  const booking = await tx.booking.findUnique({ where: { id }, select: bookingSelect });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  return booking;
}

function assertEditable(booking: RescheduleBooking, expectedVersion?: number): void {
  if (expectedVersion !== undefined && expectedVersion !== booking.version) throw new AppError('CONFLICT', 'This booking changed while you were editing. Reload to see the latest.');
  if (booking.deletedAt || booking.status !== 'CONFIRMED' || booking.jobStage !== 'NOT_STARTED') {
    throw new AppError('CONFLICT', 'Only confirmed bookings whose work has not started can be rescheduled.');
  }
}

function timeReason(booking: RescheduleBooking, date: string, slot: Slot, operations: OperationsSettings, now: Date): string | null {
  if (date < londonToday(now)) return 'Choose today or a future date.';
  if (booking.service === 'same-day' && date !== londonToday(now)) return 'This service can only be booked for today.';
  const cutoff = londonDateTimeToUtc(date, operations.slotWindows[slot].start).getTime() - operations.minLeadMinutes * 60_000;
  if (now.getTime() > cutoff) return 'This period is past its booking cutoff.';
  return null;
}

function pricingInput(booking: RescheduleBooking): PricingInput {
  try { return parseBookingPricingInput(booking.pricingInput); }
  catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('CONFLICT', 'The original booking details are not available for repricing. Keep its agreed price or repair its details first.');
  }
}

async function revisedPrice(booking: RescheduleBooking, input: AdminRescheduleInput, now: Date) {
  if (input.priceMode === 'KEEP_PRICE') return { totalPence: booking.totalPence, breakdown: booking.priceBreakdown, pricingVersionId: booking.pricingVersionId };
  if (booking.source === 'MANUAL_QUOTE' || !BookingStoredPriceSchema.safeParse(booking.priceBreakdown).success) {
    throw new AppError('CONFLICT', 'This booking has a manually agreed or incomplete price. Keep its agreed price when rescheduling.');
  }
  const active = await getActivePricingConfig();
  const original = pricingInput(booking);
  try {
    if (computeQuote(original, active.config, londonToday(now)).requiresManualQuote) throw new AppError('CONFLICT', 'This booking needs a manual price. Keep its agreed price when rescheduling.');
    const priced = priceForSlot(original, active.config, londonToday(now), input.date, input.slot);
    return { totalPence: priced.pricePence, breakdown: asJson({ breakdown: priced.breakdown, slot: { date: input.date, slot: input.slot, multipliers: priced.multipliers } }), pricingVersionId: active.id };
  } catch (error) {
    if (error instanceof PricingError) throw new AppError('VALIDATION_ERROR', 'A new price is not available for these booking details and date. Keep the agreed price or choose a date in the calendar.');
    throw error;
  }
}

async function prepareReschedule(tx: DbTx, id: string, input: AdminRescheduleInput, actor: DispatchActor, now: Date) {
  const booking = await readBooking(tx, id);
  assertEditable(booking, input.expectedVersion);
  const operations = await getOperationsSettings();
  const reason = timeReason(booking, input.date, input.slot, operations, now);
  if (reason) throw new AppError('SLOT_UNAVAILABLE', reason);
  if (fromDbDate(booking.moveDate) === input.date && booking.slot === input.slot) throw new AppError('VALIDATION_ERROR', 'Choose a different date or time for this booking.');
  await assertAdminBookingChangeReady(tx, id);
  const target = { moveDate: dbDate(input.date), slot: input.slot, blocksSlots: booking.blocksSlots, capacityUnits: booking.capacityUnits };
  await assertAdminBookingCapacity(tx, booking, target, { now, actorRole: actor.role, ...(input.overrideCapacity === undefined ? {} : { overrideCapacity: input.overrideCapacity }) });
  const price = await revisedPrice(booking, input, now);
  const preview = AdminBookingReschedulePreviewSchema.parse({ id, expectedVersion: booking.version, date: input.date, slot: input.slot,
    currentTotalPence: booking.totalPence, newTotalPence: price.totalPence, differencePence: price.totalPence - booking.totalPence,
    willUnassignDriver: booking.dispatchStatus !== 'UNASSIGNED' || booking.driverId !== null,
    ...await previewAdminBookingSettlement(tx, booking, price.totalPence) });
  return { booking, target, price, preview };
}

function transactionError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') throw new AppError('CONFLICT', 'The booking, payment or available capacity changed. Refresh and try again.');
  throw error;
}

export async function previewAdminReschedule(id: string, input: AdminRescheduleInput, actor: DispatchActor, now = new Date()): Promise<AdminBookingReschedulePreview> {
  try {
    return await prisma.$transaction(async (tx) => (await prepareReschedule(tx, id, input, actor, now)).preview, { isolationLevel: 'Serializable' });
  } catch (error) { return transactionError(error); }
}

export async function rescheduleAdminBooking(id: string, input: z.infer<typeof AdminRescheduleSchema>, actor: DispatchActor, now = new Date()): Promise<BookingMutationResult> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const { booking, target, price, preview } = await prepareReschedule(tx, id, input, actor, now);
      if (price.totalPence !== input.expectedTotalPence) throw new AppError('PRICE_CHANGED', 'The new price changed. Review the preview again.', { newTotalPence: price.totalPence });
      if (booking.dispatchStatus !== 'UNASSIGNED') assertTransition('dispatch', booking.dispatchStatus, 'UNASSIGNED', actor.role);
      const changed = await tx.booking.updateMany({ where: { id, version: input.expectedVersion, status: 'CONFIRMED', jobStage: 'NOT_STARTED', deletedAt: null }, data: {
        moveDate: target.moveDate, slot: target.slot, totalPence: price.totalPence, pricingVersionId: price.pricingVersionId,
        priceBreakdown: asJson(price.breakdown), dispatchStatus: 'UNASSIGNED', driverId: null, vanId: null, reminderSentAt: null, version: { increment: 1 },
      } });
      if (changed.count !== 1) throw new AppError('CONFLICT', 'This booking changed while you were editing. Reload to see the latest.');
      await settleAdminBookingChange(tx, booking, { newTotalPence: price.totalPence, expectedSettlementPence: input.expectedSettlementPence,
        settle: input.settle, reason: input.reason, actorUserId: actor.userId }, now);
      await withdrawAdminBookingAssignments(tx, booking, [], now, booking.driverId);
      await tx.auditLog.create({ data: { action: 'admin.bookings.reschedule', actorType: 'USER', actorUserId: actor.userId,
        entityType: 'booking', entityId: id, requestId: actor.requestId, reason: input.reason,
        before: { date: fromDbDate(booking.moveDate), slot: booking.slot, totalPence: booking.totalPence, driverId: booking.driverId, vanId: booking.vanId, version: booking.version },
        after: { date: input.date, slot: input.slot, totalPence: price.totalPence, driverId: null, vanId: null, version: booking.version + 1,
          priceMode: input.priceMode, settle: preview.settle, settlementAmountPence: preview.settlementAmountPence, overrideCapacity: input.overrideCapacity ?? false } } });
      await enqueueOutbox(tx, 'booking.rescheduled', { bookingId: id, previousDriverId: booking.driverId }, `admin-booking:${id}:${String(booking.version + 1)}:rescheduled`);
      return { ok: true as const, id, version: booking.version + 1 };
    }, { isolationLevel: 'Serializable' });
    invalidateAvailabilityCache();
    return result;
  } catch (error) { return transactionError(error); }
}

export async function readAdminBookingCalendar(id: string, now = new Date()): Promise<AdminBookingCalendarResponse> {
  const booking = await readBooking(prisma, id);
  assertEditable(booking);
  const [active, operations] = await Promise.all([getActivePricingConfig(), getOperationsSettings()]);
  let calendar;
  try { calendar = computeQuote(pricingInput(booking), active.config, londonToday(now)).calendar; }
  catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof PricingError) throw new AppError('CONFLICT', 'A price calendar is not available for these original booking details. Keep the agreed price and enter a new date.');
    throw error;
  }
  const dates = calendar.map((day) => dbDate(day.date));
  const [overrides, rules, closures, bookings, holds] = await prisma.$transaction(async (tx) => Promise.all([
    tx.capacityOverride.findMany({ where: { date: { in: dates } }, select: { date: true, slot: true, capacity: true } }),
    tx.capacityRule.findMany({ select: { weekday: true, slot: true, capacity: true } }),
    tx.capacityClosure.findMany({ where: { date: { in: dates } }, select: { date: true, slot: true } }),
    tx.booking.findMany({ where: { id: { not: id }, moveDate: { in: dates }, OR: [{ status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } }, { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } }] },
      select: { moveDate: true, slot: true, capacityUnits: true, blocksSlots: true } }),
    tx.slotHold.findMany({ where: { date: { in: dates }, expiresAt: { gt: now } }, select: { date: true, slot: true, capacityUnits: true, blocksSlots: true } }),
  ]), { isolationLevel: 'RepeatableRead' });
  const days = calendar.map((day) => ({ date: day.date, slots: day.slots.map((entry) => {
    let reason = timeReason(booking, day.date, entry.slot, operations, now);
    let range: Slot[] = [];
    try { range = slotsCovered(entry.slot, booking.blocksSlots); }
    catch (error) { if (!(error instanceof AppError)) throw error; reason ??= 'This job extends past the final period of the day.'; }
    for (const slot of range) {
      const ownUse = day.date === fromDbDate(booking.moveDate) && slotsCovered(booking.slot, booking.blocksSlots).includes(slot) ? booking.capacityUnits : 0;
      if (booking.capacityUnits <= ownUse) continue;
      const closed = closures.some((closure) => fromDbDate(closure.date) === day.date && closure.slot === slot);
      const capacity = overrides.find((row) => fromDbDate(row.date) === day.date && row.slot === slot)?.capacity
        ?? rules.find((row) => row.weekday === day.weekday && row.slot === slot)?.capacity ?? operations.defaultCapacityPerSlot;
      const used = bookings.filter((row) => fromDbDate(row.moveDate) === day.date && slotsCovered(row.slot, row.blocksSlots).includes(slot)).reduce((sum, row) => sum + row.capacityUnits, 0)
        + holds.filter((row) => fromDbDate(row.date) === day.date && slotsCovered(row.slot, row.blocksSlots).includes(slot)).reduce((sum, row) => sum + row.capacityUnits, 0);
      if (closed) reason ??= 'This period is closed.';
      else if (used + booking.capacityUnits > capacity) reason ??= 'This period is full.';
    }
    return { slot: entry.slot, windowLabel: operations.slotWindows[entry.slot].label, pricePence: entry.pricePence,
      available: reason === null, reason, current: day.date === fromDbDate(booking.moveDate) && entry.slot === booking.slot };
  }) }));
  return AdminBookingCalendarResponseSchema.parse({ bookingId: id, version: booking.version, currentDate: fromDbDate(booking.moveDate), currentSlot: booking.slot, currentTotalPence: booking.totalPence, days });
}
