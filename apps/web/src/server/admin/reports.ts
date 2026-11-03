import 'server-only';
import type { z } from 'zod';
import { AddressSchema, AdminReportExportResponseSchema, AdminReportsQuerySchema, AdminReportsResponseSchema, AppError, addDays, fromDbDate, type AdminReportsQuery } from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import { londonDateTimeToUtc } from '../london-time';

const reportSelect = { id: true, reference: true, createdAt: true, moveDate: true, slot: true, status: true, source: true, service: true, pickup: true, contactName: true, contactEmail: true, totalPence: true, paidPence: true, refundedPence: true } as const satisfies Prisma.BookingSelect;
type ReportBooking = Prisma.BookingGetPayload<{ select: typeof reportSelect }>;
function bounds(query: AdminReportsQuery) { const input = AdminReportsQuerySchema.parse(query); return { gte: londonDateTimeToUtc(input.from, '00:00'), lt: londonDateTimeToUtc(addDays(input.to, 1), '00:00') }; }
function groups(rows: ReportBooking[], label: (row: ReportBooking) => string) {
  const grouped = new Map<string, { label: string; bookings: number; totalPence: number }>();
  for (const row of rows) { const key = label(row); const group = grouped.get(key) ?? { label: key, bookings: 0, totalPence: 0 }; group.bookings += 1; group.totalPence += row.totalPence; grouped.set(key, group); }
  return [...grouped.values()].sort((a, b) => b.bookings - a.bookings || a.label.localeCompare(b.label));
}
async function rows(query: AdminReportsQuery) {
  const found = await prisma.booking.findMany({ where: { createdAt: bounds(query) }, select: reportSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 20_001 });
  if (found.length > 20_000) throw new AppError('VALIDATION_ERROR', 'This report exceeds 20,000 bookings. Choose a shorter date range.');
  return found;
}
export async function readAdminReports(query: AdminReportsQuery): Promise<z.infer<typeof AdminReportsResponseSchema>> {
  const createdAt = bounds(query);
  const [bookings, quotes, manualQuotes] = await Promise.all([rows(query), prisma.quote.count({ where: { createdAt } }), prisma.manualQuote.count({ where: { createdAt } })]);
  const sum = (key: 'totalPence' | 'paidPence' | 'refundedPence') => bookings.reduce((total, row) => total + row[key], 0);
  const count = (status: string) => bookings.filter((row) => row.status === status).length;
  return AdminReportsResponseSchema.parse({ ...query, dateBasis: 'BOOKING_CREATED_AT', bookings: bookings.length, confirmed: count('CONFIRMED'), pending: count('PENDING_PAYMENT'), cancelled: count('CANCELLED'), completed: count('COMPLETED'), totalPence: sum('totalPence'), paidPence: sum('paidPence'), refundedPence: sum('refundedPence'), netPaidPence: sum('paidPence') - sum('refundedPence'), quotes, manualQuotes, byService: groups(bookings, (row) => row.service), bySource: groups(bookings, (row) => row.source), topTowns: groups(bookings, (row) => AddressSchema.parse(row.pickup).town).slice(0, 10) });
}
export function csvCell(value: string | number): string {
  const text = String(value); const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function exportAdminReports(query: AdminReportsQuery): Promise<z.infer<typeof AdminReportExportResponseSchema>> {
  const bookings = await rows(query);
  const header = ['Reference','Created at (UTC)','Move date','Slot','Status','Source','Service','Customer','Email','Total (pence)','Paid (pence)','Refunded (pence)'];
  const values = bookings.map((booking) => [booking.reference, booking.createdAt.toISOString(), fromDbDate(booking.moveDate), booking.slot, booking.status, booking.source, booking.service, booking.contactName, booking.contactEmail, booking.totalPence, booking.paidPence, booking.refundedPence]);
  return AdminReportExportResponseSchema.parse({ filename: `bookings-${query.from}-${query.to}.csv`, contentType: 'text/csv;charset=utf-8', content: '\uFEFF' + [header, ...values].map((row) => row.map(csvCell).join(',')).join('\r\n') });
}
