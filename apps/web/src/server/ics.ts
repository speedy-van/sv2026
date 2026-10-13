import 'server-only';

import { fromDbDate } from '@sv/contracts';
import type { Slot } from '@sv/db';
import { londonDateTimeToUtc } from './london-time';

interface CalendarBooking {
  bookingId: string;
  manageUrl: string;
  pickupLabel: string;
  reference: string;
  sequence?: number;
  slot: Slot;
  moveDate: Date | string;
}

const SLOT_TIMES: Record<Slot, { end: string; start: string }> = {
  AFTERNOON: { end: '17:00', start: '12:00' },
  EVENING: { end: '21:00', start: '17:00' },
  MORNING: { end: '12:00', start: '08:00' },
};

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    if (Buffer.from(`${current}${char}`, 'utf8').length > 75) {
      parts.push(current);
      current = ` ${char}`;
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts.join('\r\n');
}

export function bookingIcs(input: CalendarBooking): string {
  const isoDate = fromDbDate(input.moveDate);
  const times = SLOT_TIMES[input.slot];
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Speedy Van//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${input.bookingId}@speedyvan.uk`,
    `SEQUENCE:${String(input.sequence ?? 0)}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(londonDateTimeToUtc(isoDate, times.start))}`,
    `DTEND:${stamp(londonDateTimeToUtc(isoDate, times.end))}`,
    `SUMMARY:${escapeText(`Speedy Van move (${input.reference})`)}`,
    `LOCATION:${escapeText(input.pickupLabel)}`,
    `DESCRIPTION:${escapeText(`Manage your booking: ${input.manageUrl}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
