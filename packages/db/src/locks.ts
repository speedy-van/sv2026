import { AppError } from '@sv/contracts';
import type { Prisma, Slot } from './generated/prisma/client';

export const ORDERED_SLOTS = ['MORNING', 'AFTERNOON', 'EVENING'] as const satisfies readonly Slot[];

export type DbTx = Prisma.TransactionClient;

export interface CapacityCheckInput {
  moveDate: Date;
  slot: Slot;
  capacityUnits?: number;
  blocksSlots?: number;
  now?: Date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function slotsCovered(slot: Slot, blocksSlots = 1): Slot[] {
  if (!Number.isInteger(blocksSlots) || blocksSlots < 1) {
    throw new AppError('SLOT_UNAVAILABLE', 'That slot has just been taken.');
  }
  const start = ORDERED_SLOTS.indexOf(slot);
  const endExclusive = start + blocksSlots;
  if (start === -1 || endExclusive > ORDERED_SLOTS.length) {
    throw new AppError('SLOT_UNAVAILABLE', 'That slot has just been taken.');
  }
  return ORDERED_SLOTS.slice(start, endExclusive);
}

export async function lockSlot(tx: DbTx, moveDate: Date, slot: Slot): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`slot:${isoDate(moveDate)}:${slot}`}))`;
}

export async function capacityFor(tx: DbTx, moveDate: Date, slot: Slot): Promise<number> {
  const closure = await tx.capacityClosure.findUnique({ where: { date_slot: { date: moveDate, slot } }, select: { id: true } });
  if (closure) return 0;
  return configuredCapacityFor(tx, moveDate, slot);
}

export async function configuredCapacityFor(tx: DbTx, moveDate: Date, slot: Slot): Promise<number> {
  const override = await tx.capacityOverride.findUnique({
    where: { date_slot: { date: moveDate, slot } },
    select: { capacity: true },
  });
  if (override) return override.capacity;

  const rule = await tx.capacityRule.findUnique({
    where: { weekday_slot: { weekday: moveDate.getUTCDay(), slot } },
    select: { capacity: true },
  });
  if (rule) return rule.capacity;

  const operations = await tx.setting.findUnique({
    where: { key: 'operations' },
    select: { value: true },
  });
  return defaultCapacityFromSettings(operations?.value);
}

function defaultCapacityFromSettings(value: unknown): number {
  const defaultCapacity = value && typeof value === 'object' && !Array.isArray(value)
    && 'defaultCapacityPerSlot' in value ? value.defaultCapacityPerSlot : undefined;
  return typeof defaultCapacity === 'number' ? defaultCapacity : 1;
}

/** Read a day's configuration once rather than repeating three lookups for each window. */
export async function configuredCapacitiesForSlots(
  tx: DbTx,
  moveDate: Date,
  slots: readonly Slot[] = ORDERED_SLOTS,
): Promise<Map<Slot, number>> {
  const [overrides, rules, operations] = await Promise.all([
    tx.capacityOverride.findMany({ where: { date: moveDate, slot: { in: [...slots] } }, select: { slot: true, capacity: true } }),
    tx.capacityRule.findMany({ where: { weekday: moveDate.getUTCDay(), slot: { in: [...slots] } }, select: { slot: true, capacity: true } }),
    tx.setting.findUnique({ where: { key: 'operations' }, select: { value: true } }),
  ]);
  const fallback = defaultCapacityFromSettings(operations?.value);
  return new Map(slots.map((slot) => [
    slot,
    overrides.find((row) => row.slot === slot)?.capacity
      ?? rules.find((row) => row.slot === slot)?.capacity ?? fallback,
  ]));
}

export function capacityUnitsInSlot(
  reservations: readonly { slot: Slot; blocksSlots: number; capacityUnits: number }[],
  target: Slot,
): number {
  return reservations.reduce((total, reservation) => slotsCovered(reservation.slot, reservation.blocksSlots).includes(target)
    ? total + reservation.capacityUnits : total, 0);
}

export async function countSlotUsage(tx: DbTx, moveDate: Date, slot: Slot, now = new Date()): Promise<number> {
  const bookings = await tx.booking.findMany({
    where: {
      moveDate,
      OR: [
        { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } },
        { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
      ],
    },
    select: { slot: true, capacityUnits: true, blocksSlots: true },
  });
  const holds = await tx.slotHold.findMany({
    where: { date: moveDate, expiresAt: { gt: now } },
    select: { slot: true, capacityUnits: true, blocksSlots: true },
  });
  return capacityUnitsInSlot(bookings, slot) + capacityUnitsInSlot(holds, slot);
}

export async function assertSlotCapacity(tx: DbTx, input: CapacityCheckInput): Promise<void> {
  const capacityUnits = input.capacityUnits ?? 1;
  const range = slotsCovered(input.slot, input.blocksSlots ?? 1);
  for (const lockedSlot of range) {
    await lockSlot(tx, input.moveDate, lockedSlot);
  }
  for (const coveredSlot of range) {
    const used = await countSlotUsage(tx, input.moveDate, coveredSlot, input.now);
    const capacity = await capacityFor(tx, input.moveDate, coveredSlot);
    if (used + capacityUnits > capacity) {
      throw new AppError('SLOT_UNAVAILABLE', 'That slot has just been taken.');
    }
  }
}
