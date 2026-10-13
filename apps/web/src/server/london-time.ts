import 'server-only';

import { AppError, fromDbDate, parseIsoDate, type IsoDate } from '@sv/contracts';
import type { Slot } from '@sv/db';

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/London',
  weekday: 'long',
  year: 'numeric',
});

export function dbDateLabel(date: Date | string): string {
  const iso = fromDbDate(date);
  const { day, month, year } = parseIsoDate(iso);
  return DATE_FORMATTER.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function slotLabel(slot: Slot): string {
  if (slot === 'MORNING') return '8am-12pm';
  if (slot === 'AFTERNOON') return '12pm-5pm';
  return '5pm-9pm';
}

function londonParts(instant: Date): { day: number; hour: number; minute: number; month: number; second: number; year: number } {
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

export function londonDateTimeToUtc(date: IsoDate, time: string): Date {
  const { day, month, year } = parseIsoDate(date);
  const [hour, minute] = time.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new AppError('INTERNAL', 'Invalid London time.');
  }
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const first = new Date(localAsUtc - londonOffsetMinutes(new Date(localAsUtc)) * 60_000);
  return new Date(localAsUtc - londonOffsetMinutes(first) * 60_000);
}
