/**
 * Civil-date helpers. The engine itself never reads the clock: callers pass `today`.
 * Codex copies this file to packages/pricing/src/dates.ts unchanged.
 */
import type { IsoDate } from './types';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface CivilParts {
  year: number;
  month: number; // 1–12
  day: number; // 1–31
}

export function parseIsoDate(iso: IsoDate): CivilParts {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError(`Invalid ISO date: ${iso}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new RangeError(`Not a real calendar date: ${iso}`);
  }
  return { year, month, day };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

export function formatIsoDate(parts: CivilParts): IsoDate {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Pure civil-date arithmetic (UTC is used only as a calendar, never as a clock). */
export function addDays(iso: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(iso);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return formatIsoDate({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(iso: IsoDate): number {
  const { year, month, day } = parseIsoDate(iso);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * "Today" in Europe/London for a given instant. Server-side helper (Node has full ICU).
 * Mobile apps never call this for pricing — the server sends `today` with every quote.
 */
export function londonToday(now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): number => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new Error(`Intl did not return ${type}`);
    return Number(p.value);
  };
  return formatIsoDate({ year: get('year'), month: get('month'), day: get('day') });
}
