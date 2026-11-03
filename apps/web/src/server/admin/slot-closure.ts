import 'server-only';

import {
  AdminScheduleSlotSchema, AdminSlotClosureResponseSchema, AppError, fromDbDate,
  type AdminScheduleSlot, type AdminSlotClosureRequest, type AdminSlotClosureResponse,
} from '@sv/contracts';
import { capacityUnitsInSlot, configuredCapacitiesForSlots, lockSlot, ORDERED_SLOTS, prisma, slotsCovered, type DbTx, type Slot } from '@sv/db';
import { invalidateAvailabilityCache } from '../services/availability';

interface StaffAction { userId: string; requestId: string }

/** Shared by the schedule read and mutation acknowledgement; all capacity comes from persisted data. */
export async function readAdminScheduleWindows(tx: DbTx, moveDate: Date, now: Date, requestedSlots: readonly Slot[] = ORDERED_SLOTS): Promise<AdminScheduleSlot[]> {
  const [closures, bookings, holds, configuredCapacities] = await Promise.all([
    tx.capacityClosure.findMany({ where: { date: moveDate }, select: { id: true, slot: true, reason: true, createdAt: true } }),
    tx.booking.findMany({
      where: { moveDate, OR: [
        { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } },
        { status: 'PENDING_PAYMENT', OR: [
          { holdExpiresAt: { gt: now } },
          { payments: { some: { kind: { in: ['BOOKING', 'ADMIN_BOOKING', 'MANUAL_QUOTE'] }, status: 'SUCCEEDED' } } },
        ] },
        { payments: { some: { status: 'PROCESSING' } } },
      ] },
      select: {
        slot: true, blocksSlots: true, capacityUnits: true, status: true, holdExpiresAt: true,
        payments: { where: { status: { in: ['PROCESSING', 'SUCCEEDED'] } }, select: { kind: true, status: true } },
      },
    }),
    tx.slotHold.findMany({ where: { date: moveDate }, select: { slot: true, blocksSlots: true, capacityUnits: true, expiresAt: true, paymentId: true } }),
    configuredCapacitiesForSlots(tx, moveDate, requestedSlots),
  ]);
  const expiredPaymentIds = holds.filter((hold) => hold.expiresAt.getTime() <= now.getTime() && hold.paymentId).map((hold) => hold.paymentId).filter((id): id is string => id !== null);
  const unsettledHoldPayments = expiredPaymentIds.length > 0
    ? await tx.payment.findMany({ where: { id: { in: expiredPaymentIds }, status: { in: ['PROCESSING', 'SUCCEEDED'] } }, select: { id: true } })
    : [];
  const unsettledIds = new Set(unsettledHoldPayments.map((payment) => payment.id));

  const capacityBookings = bookings.filter((booking) => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(booking.status)
    || (booking.status === 'PENDING_PAYMENT' && booking.holdExpiresAt && booking.holdExpiresAt.getTime() > now.getTime()));
  const capacityHolds = holds.filter((hold) => hold.expiresAt.getTime() > now.getTime());
  return requestedSlots.map((slot) => {
    const configuredCapacity = configuredCapacities.get(slot);
    if (configuredCapacity === undefined) throw new AppError('INTERNAL', 'Capacity configuration could not be read.');
    const used = capacityUnitsInSlot(capacityBookings, slot) + capacityUnitsInSlot(capacityHolds, slot);
    const overlaps = (row: { slot: Slot; blocksSlots: number }): boolean => slotsCovered(row.slot, row.blocksSlots).includes(slot);
    const liveCheckouts = bookings.filter((booking) => booking.status === 'PENDING_PAYMENT' && booking.holdExpiresAt && booking.holdExpiresAt.getTime() > now.getTime() && overlaps(booking));
    const liveHolds = holds.filter((hold) => hold.expiresAt.getTime() > now.getTime() && overlaps(hold));
    const heldUnits = [...liveCheckouts, ...liveHolds].reduce((total, hold) => total + hold.capacityUnits, 0);
    const unsettled = bookings.some((booking) => overlaps(booking) && booking.payments.some((payment) =>
      payment.status === 'PROCESSING' || (booking.status === 'PENDING_PAYMENT' && payment.status === 'SUCCEEDED'
        && (payment.kind === 'BOOKING' || payment.kind === 'ADMIN_BOOKING' || payment.kind === 'MANUAL_QUOTE'))))
      || holds.some((hold) => overlaps(hold) && hold.paymentId !== null && unsettledIds.has(hold.paymentId));
    const closeBlockedReason = unsettled
      ? 'A payment for this period is awaiting confirmation. Wait for it to finish before closing the period.'
      : liveCheckouts.length > 0 || liveHolds.length > 0
        ? 'An active checkout or reschedule hold overlaps this period. Wait for it to finish before closing the period.'
        : configuredCapacity === 0 ? 'This period is already closed by its capacity settings.' : null;
    const closure = closures.find((candidate) => candidate.slot === slot);
    const capacity = closure ? 0 : configuredCapacity;
    return AdminScheduleSlotSchema.parse({
      slot, configuredCapacity, capacity, confirmedUnits: Math.max(0, used - heldUnits), heldUnits,
      availableUnits: Math.max(0, capacity - used),
      manualClosure: closure ? { id: closure.id, reason: closure.reason, createdAt: closure.createdAt.toISOString() } : null,
      closeAllowed: closeBlockedReason === null, closeBlockedReason,
    });
  });
}

export async function setAdminSlotClosure(input: AdminSlotClosureRequest, staff: StaffAction, now = new Date()): Promise<AdminSlotClosureResponse> {
  const moveDate = new Date(`${input.date}T00:00:00.000Z`);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockSlot(tx, moveDate, input.slot);
      const existing = await tx.capacityClosure.findUnique({ where: { date_slot: { date: moveDate, slot: input.slot } }, select: { id: true } });
      const currentClosed = existing !== null;
      const [before] = await readAdminScheduleWindows(tx, moveDate, now, [input.slot]);
      if (!before) throw new AppError('INTERNAL', 'The schedule period could not be loaded.');
      if (currentClosed === input.closed) {
        return AdminSlotClosureResponseSchema.parse({ date: input.date, generatedAt: now.toISOString(), window: before });
      }
      if ((existing?.id ?? null) !== input.expectedClosureId) {
        throw new AppError('CONFLICT', 'This period changed. Refresh the schedule and try again.');
      }
      if (input.closed && !before.closeAllowed) throw new AppError('CONFLICT', before.closeBlockedReason ?? 'This period cannot be closed yet.');
      let entityId: string;
      if (input.closed) {
        const created = await tx.capacityClosure.create({ data: {
          date: moveDate, slot: input.slot, reason: input.reason, createdById: staff.userId, createdAt: now,
        }, select: { id: true } });
        entityId = created.id;
      } else {
        if (!existing) throw new AppError('CONFLICT', 'This period changed. Refresh the schedule and try again.');
        const removed = await tx.capacityClosure.deleteMany({ where: { id: existing.id, date: moveDate, slot: input.slot } });
        if (removed.count !== 1) throw new AppError('CONFLICT', 'This period changed. Refresh the schedule and try again.');
        entityId = existing.id;
      }
      const [window] = await readAdminScheduleWindows(tx, moveDate, now, [input.slot]);
      if (!window) throw new AppError('INTERNAL', 'The schedule period could not be loaded.');
      await tx.auditLog.create({ data: {
        action: 'admin.capacity.closures.put', actorType: 'USER', actorUserId: staff.userId,
        entityType: 'capacityClosure', entityId, reason: input.reason, requestId: staff.requestId,
        before, after: window,
      } });
      return AdminSlotClosureResponseSchema.parse({ date: fromDbDate(moveDate), generatedAt: now.toISOString(), window });
    }, { timeout: 15_000 });
    invalidateAvailabilityCache();
    return result;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && (error.code === 'P2034' || error.code === 'P2002')) {
      throw new AppError('CONFLICT', 'This period changed. Refresh the schedule and try again.');
    }
    throw error;
  }
}
