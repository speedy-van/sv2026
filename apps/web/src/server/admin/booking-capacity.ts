import 'server-only';

import { AppError, fromDbDate } from '@sv/contracts';
import { capacityFor, countSlotUsage, lockSlot, ORDERED_SLOTS, slotsCovered, type DbTx, type Slot } from '@sv/db';

export interface AdminBookingCapacity {
  moveDate: Date;
  slot: Slot;
  blocksSlots: number;
  capacityUnits: number;
}

/** Lock both reservations in one global order, then remove this booking's existing use. */
export async function assertAdminBookingCapacity(
  tx: DbTx,
  booking: AdminBookingCapacity & { id: string },
  target: AdminBookingCapacity,
  options: { now: Date; overrideCapacity?: boolean; actorRole: 'ADMIN' | 'OWNER' },
): Promise<void> {
  if (options.overrideCapacity && options.actorRole !== 'OWNER') {
    throw new AppError('FORBIDDEN', 'Only the owner can override slot capacity.');
  }
  const before = slotsCovered(booking.slot, booking.blocksSlots);
  const after = slotsCovered(target.slot, target.blocksSlots);
  const reservations = new Map<string, { date: Date; slot: Slot }>();
  for (const [date, slots] of [[booking.moveDate, before], [target.moveDate, after]] as const) {
    for (const slot of slots) reservations.set(`${fromDbDate(date)}:${slot}`, { date, slot });
  }
  const locks = [...reservations.values()].sort((a, b) =>
    a.date.getTime() - b.date.getTime() || ORDERED_SLOTS.indexOf(a.slot) - ORDERED_SLOTS.indexOf(b.slot));
  for (const entry of locks) await lockSlot(tx, entry.date, entry.slot);
  for (const slot of after) {
    const ownUse = fromDbDate(booking.moveDate) === fromDbDate(target.moveDate) && before.includes(slot) ? booking.capacityUnits : 0;
    // Closing a period stops additional reservations; it does not invalidate
    // the capacity already held by a confirmed booking, or prevent releasing it.
    if (target.capacityUnits <= ownUse) continue;
    const closure = await tx.capacityClosure.findUnique({ where: { date_slot: { date: target.moveDate, slot } }, select: { id: true } });
    if (closure) throw new AppError('SLOT_UNAVAILABLE', 'This period is closed. Reopen it before moving a booking into it.');
    const [used, capacity] = await Promise.all([
      countSlotUsage(tx, target.moveDate, slot, options.now), capacityFor(tx, target.moveDate, slot),
    ]);
    if (!options.overrideCapacity && used - ownUse + target.capacityUnits > capacity) {
      throw new AppError('SLOT_UNAVAILABLE', 'That slot has just been taken. Choose another time.');
    }
  }
}
