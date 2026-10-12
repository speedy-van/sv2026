import { z } from 'zod';

export type IsoDate = string;

export interface CivilDateParts {
  year: number;
  month: number;
  day: number;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(value: string): CivilDateParts {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new RangeError(`Invalid ISO date: ${value}`);
  }
  const [yearPart, monthPart, dayPart] = value.split('-');
  const year = Number(yearPart);
  const month = Number(monthPart);
  const day = Number(dayPart);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return { year, month, day };
}

export function isRealIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export const IsoDateSchema = z.string().regex(ISO_DATE_PATTERN).refine(isRealIsoDate, {
  message: 'Expected a real date in YYYY-MM-DD format',
});

export function formatIsoDate(parts: CivilDateParts): IsoDate {
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const parts = parseIsoDate(date);
  const utcDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return formatIsoDate({
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate(),
  });
}

export function toDbDate(date: IsoDate): IsoDate {
  parseIsoDate(date);
  return date;
}

export function fromDbDate(date: Date | IsoDate): IsoDate {
  if (typeof date === 'string') {
    return toDbDate(date);
  }
  return formatIsoDate({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

export function londonToday(now: Date = new Date()): IsoDate {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Europe/London',
    year: 'numeric',
  });
  const parts = formatter.formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  if (!year || !month || !day) {
    throw new Error('Intl did not return year, month and day for Europe/London');
  }
  return `${year}-${month}-${day}`;
}

export function weekdayOf(date: IsoDate): number {
  const parts = parseIsoDate(date);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function isMoveDateTodayOrTomorrow(moveDate: IsoDate, now: Date = new Date()): boolean {
  const today = londonToday(now);
  return moveDate === today || moveDate === addDays(today, 1);
}
