import 'server-only';

import { AppError, addDays, fromDbDate, londonToday, toDbDate, weekdayOf } from '@sv/contracts';
import { prisma, slotsCovered } from '@sv/db';
import { SLOT_KEYS, type CalendarDay, type ServiceKey, type SlotKey } from '@sv/pricing';
import type { OperationsSettings } from '../settings';

export interface AvailabilityInput {
  calendar: CalendarDay[];
  service: ServiceKey;
  capacityUnits: number;
  blocksSlots: number;
  operations: OperationsSettings;
  now?: Date;
}

export interface AvailabilityOverlay {
  calendar: Array<{
    date: string;
    weekday: number;
    slots: Array<{
      slot: SlotKey;
      windowLabel: string;
      pricePence: number;
      available: boolean;
      reason?: 'FULL' | 'PAST_CUTOFF' | 'CLOSED' | 'SAME_DAY_ONLY';
      lastOne: boolean;
    }>;
  }>;
  cheapest: { date: string; slot: SlotKey; pricePence: number } | null;
  slotsOpen: number;
  slotsTotal: number;
}

interface CapacityState {
  capacity: number;
  used: number;
}

interface CapacityContext {
  operations: OperationsSettings;
  overrides: Map<string, number>;
  rules: Map<string, number>;
  usage: Map<string, number>;
}

function dateOnly(date: string): Date {
  return new Date(`${toDbDate(date)}T00:00:00.000Z`);
}

function londonParts(instant: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: 'Europe/London',
    year: 'numeric',
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));
  return {
    day: values.get('day') ?? 1,
    hour: values.get('hour') ?? 0,
    minute: values.get('minute') ?? 0,
    month: values.get('month') ?? 1,
    second: values.get('second') ?? 0,
    year: values.get('year') ?? 1970,
  };
}

function londonOffsetMinutes(instant: Date): number {
  const parts = londonParts(instant);
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((localAsUtc - instant.getTime()) / 60_000);
}

function londonDateTimeToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  if (!year || !month || !day || hour === undefined || minute === undefined) {
    throw new AppError('INTERNAL', 'Invalid slot window configuration.');
  }
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = new Date(localAsUtc - londonOffsetMinutes(new Date(localAsUtc)) * 60_000);
  return new Date(localAsUtc - londonOffsetMinutes(first) * 60_000);
}

function isPastCutoff(date: string, slot: SlotKey, operations: OperationsSettings, now: Date): boolean {
  const slotStart = operations.slotWindows[slot].start;
  const cutoff = new Date(londonDateTimeToUtc(date, slotStart).getTime() - operations.minLeadMinutes * 60_000);
  return now > cutoff;
}

function slotRange(slot: SlotKey, blocksSlots: number): SlotKey[] | null {
  try {
    return slotsCovered(slot, blocksSlots);
  } catch {
    return null;
  }
}

function capacityKey(date: string, slot: SlotKey): string {
  return `${date}:${slot}`;
}

function ruleKey(weekday: number, slot: SlotKey): string {
  return `${String(weekday)}:${slot}`;
}

function addUsage(usage: Map<string, number>, date: string, slot: SlotKey, capacityUnits: number, blocksSlots: number): void {
  const range = slotRange(slot, blocksSlots);
  if (!range) return;
  for (const coveredSlot of range) {
    const key = capacityKey(date, coveredSlot);
    usage.set(key, (usage.get(key) ?? 0) + capacityUnits);
  }
}

async function loadCapacityContext(input: AvailabilityInput, now: Date): Promise<CapacityContext> {
  const dates = input.calendar.map((day) => day.date);
  const dbDates = dates.map(dateOnly);
  const [overrides, rules, bookings, holds] = await Promise.all([
    prisma.capacityOverride.findMany({
      where: { date: { in: dbDates } },
      select: { capacity: true, date: true, slot: true },
    }),
    prisma.capacityRule.findMany({
      select: { capacity: true, slot: true, weekday: true },
    }),
    prisma.booking.findMany({
      where: {
        moveDate: { in: dbDates },
        OR: [
          { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } },
          { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
        ],
      },
      select: { blocksSlots: true, capacityUnits: true, moveDate: true, slot: true },
    }),
    prisma.slotHold.findMany({
      where: { date: { in: dbDates }, expiresAt: { gt: now } },
      select: { blocksSlots: true, capacityUnits: true, date: true, slot: true },
    }),
  ]);

  const usage = new Map<string, number>();
  for (const booking of bookings) {
    addUsage(usage, fromDbDate(booking.moveDate), booking.slot, booking.capacityUnits, booking.blocksSlots);
  }
  for (const hold of holds) {
    addUsage(usage, fromDbDate(hold.date), hold.slot, hold.capacityUnits, hold.blocksSlots);
  }

  return {
    operations: input.operations,
    overrides: new Map(overrides.map((override) => [capacityKey(fromDbDate(override.date), override.slot), override.capacity])),
    rules: new Map(rules.map((rule) => [ruleKey(rule.weekday, rule.slot), rule.capacity])),
    usage,
  };
}

function capacityState(date: string, slot: SlotKey, context: CapacityContext): CapacityState {
  const override = context.overrides.get(capacityKey(date, slot));
  const capacity = override ?? context.rules.get(ruleKey(weekdayOf(date), slot)) ?? context.operations.defaultCapacityPerSlot;
  return { capacity, used: context.usage.get(capacityKey(date, slot)) ?? 0 };
}

async function slotReason(
  date: string,
  slot: SlotKey,
  input: AvailabilityInput,
  context: CapacityContext,
  now: Date,
): Promise<{ available: boolean; reason?: 'FULL' | 'PAST_CUTOFF' | 'CLOSED' | 'SAME_DAY_ONLY'; lastOne: boolean }> {
  await Promise.resolve();
  const startState = capacityState(date, slot, context);
  if (startState.capacity === 0) {
    return { available: false, lastOne: false, reason: 'CLOSED' };
  }
  if (input.service === 'same-day' && date !== londonToday(now)) {
    return { available: false, lastOne: false, reason: 'SAME_DAY_ONLY' };
  }
  if (isPastCutoff(date, slot, input.operations, now)) {
    return { available: false, lastOne: false, reason: 'PAST_CUTOFF' };
  }

  const range = slotRange(slot, input.blocksSlots);
  if (!range) {
    return { available: false, lastOne: false, reason: 'FULL' };
  }
  for (const coveredSlot of range) {
    const state = coveredSlot === slot ? startState : capacityState(date, coveredSlot, context);
    if (state.capacity === 0) {
      return { available: false, lastOne: false, reason: 'CLOSED' };
    }
    if (state.used + input.capacityUnits > state.capacity) {
      return { available: false, lastOne: false, reason: 'FULL' };
    }
  }

  return {
    available: true,
    lastOne: startState.capacity - startState.used - input.capacityUnits <= 0,
  };
}

export async function overlayAvailability(input: AvailabilityInput): Promise<AvailabilityOverlay> {
  const now = input.now ?? new Date();
  const capacityContext = await loadCapacityContext(input, now);
  let cheapest: AvailabilityOverlay['cheapest'] = null;
  let slotsOpen = 0;
  let slotsTotal = 0;

  const calendar: AvailabilityOverlay['calendar'] = [];
  for (const day of input.calendar) {
    const slots = [];
    for (const pricedSlot of day.slots) {
      if (!(SLOT_KEYS as readonly string[]).includes(pricedSlot.slot)) continue;
      slotsTotal += 1;
      const state = await slotReason(day.date, pricedSlot.slot, input, capacityContext, now);
      if (state.available) {
        slotsOpen += 1;
        const candidate = { date: day.date, pricePence: pricedSlot.pricePence, slot: pricedSlot.slot };
        if (
          !cheapest ||
          candidate.pricePence < cheapest.pricePence ||
          (candidate.pricePence === cheapest.pricePence &&
            (candidate.date < cheapest.date ||
              (candidate.date === cheapest.date && SLOT_KEYS.indexOf(candidate.slot) < SLOT_KEYS.indexOf(cheapest.slot))))
        ) {
          cheapest = candidate;
        }
      }
      slots.push({
        available: state.available,
        lastOne: state.lastOne,
        pricePence: pricedSlot.pricePence,
        ...(state.reason ? { reason: state.reason } : {}),
        slot: pricedSlot.slot,
        windowLabel: input.operations.slotWindows[pricedSlot.slot].label,
      });
    }
    calendar.push({ date: day.date, slots, weekday: day.weekday });
  }

  return { calendar, cheapest, slotsOpen, slotsTotal };
}

export function calendarDateRange(today: string, days: number): { from: Date; to: Date } {
  return { from: dateOnly(today), to: dateOnly(addDays(today, days - 1)) };
}

export function dbDateToIso(date: Date | string): string {
  return fromDbDate(date);
}
