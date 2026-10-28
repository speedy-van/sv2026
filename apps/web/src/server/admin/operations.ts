import 'server-only';

import {
  AddressSchema, AdminBookingDetailResponseSchema, AdminBookingsReadQuerySchema, AdminBookingsResponseSchema,
  AdminDashboardResponseSchema, AdminDayQuerySchema, AdminDriverDetailResponseSchema, AdminDriversQuerySchema,
  AdminDriversResponseSchema, AdminScheduleQuerySchema, AdminScheduleResponseSchema, AppError, fromDbDate, londonToday,
  type AdminBookingSummary, type AdminDriverSummary,
} from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import type { z } from 'zod';
import { bookingCleanupSelect, bookingDeletionCapability, cleanupPaymentSelect } from './booking-cleanup';
import { readAdminScheduleWindows } from './slot-closure';
import { readAdminVisitorPresence } from '../visitor-presence';

const bookingSelect = {
  id: true, reference: true, contactName: true, service: true, variant: true, pickup: true, dropoff: true,
  pickupPostcode: true, dropoffPostcode: true, moveDate: true, createdAt: true, slot: true, status: true, dispatchStatus: true,
  jobStage: true, totalPence: true, paidPence: true, refundedPence: true, holdExpiresAt: true,
  capacityUnits: true, blocksSlots: true, deletedAt: true, driver: { select: { userId: true, user: { select: { name: true } } } },
} as const satisfies Prisma.BookingSelect;
const vanSelect = { id: true, label: true, registration: true } as const;
type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function parseQuery<T extends z.ZodType>(search: URLSearchParams, schema: T): z.infer<T> {
  const parsed = schema.safeParse(Object.fromEntries(search));
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Check the search filters and try again.');
  return parsed.data;
}

function dbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function bookingSummary(booking: BookingRow): AdminBookingSummary {
  const pickup = AddressSchema.safeParse(booking.pickup);
  const dropoff = AddressSchema.safeParse(booking.dropoff);
  const pickupTown = pickup.success ? pickup.data.town : null;
  const dropoffTown = dropoff.success ? dropoff.data.town : null;
  const from = pickupTown ?? booking.pickupPostcode;
  const to = dropoffTown ?? booking.dropoffPostcode;
  return {
    id: booking.id, reference: booking.reference, customerName: booking.contactName,
    service: booking.service, variant: booking.variant, routeLabel: to ? `${from} to ${to}` : from,
    pickupTown, dropoffTown, moveDate: fromDbDate(booking.moveDate), createdAt: booking.createdAt.toISOString(), slot: booking.slot,
    status: booking.status, dispatchStatus: booking.dispatchStatus, jobStage: booking.jobStage,
    totalPence: booking.totalPence, paidPence: booking.paidPence, refundedPence: booking.refundedPence,
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    driver: booking.driver ? { id: booking.driver.userId, name: booking.driver.user.name } : null,
    capacityUnits: booking.capacityUnits, blocksSlots: booking.blocksSlots,
  };
}

function operationalBookings(moveDate: Date, now: Date): Prisma.BookingWhereInput {
  return {
    moveDate,
    OR: [
      { status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } },
      { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: now } },
    ],
  };
}

async function dashboard(search: URLSearchParams, now: Date) {
  const date = parseQuery(search, AdminDayQuerySchema).date ?? londonToday(now);
  const rows = await prisma.booking.findMany({ where: operationalBookings(dbDate(date), now), select: bookingSelect, orderBy: [{ slot: 'asc' }, { id: 'asc' }] });
  const scheduled = rows.filter((row) => row.status !== 'PENDING_PAYMENT');
  return AdminDashboardResponseSchema.parse({
    date, generatedAt: now.toISOString(),
    counts: {
      scheduled: scheduled.length,
      needsDriver: scheduled.filter((row) => row.status !== 'COMPLETED' && row.driver === null).length,
      inProgress: rows.filter((row) => row.status === 'IN_PROGRESS').length,
      completed: rows.filter((row) => row.status === 'COMPLETED').length,
      pendingPayment: rows.filter((row) => row.status === 'PENDING_PAYMENT').length,
    },
    bookedValuePence: scheduled.reduce((total, row) => total + row.totalPence, 0),
    paidPence: scheduled.reduce((total, row) => total + row.paidPence, 0),
    // Hiding a completed row must not remove its recorded value from the selected-day totals.
    jobs: rows.filter((row) => row.deletedAt === null).map(bookingSummary),
  });
}

async function bookings(search: URLSearchParams) {
  const query = parseQuery(search, AdminBookingsReadQuerySchema);
  const where: Prisma.BookingWhereInput = {
    deletedAt: query.deleted === 'only' ? { not: null } : null,
    ...(query.status ? { status: query.status } : {}),
    ...(query.dispatch ? { dispatchStatus: query.dispatch } : {}),
    ...(query.service ? { service: query.service } : {}),
    ...(query.driverId ? { driverId: query.driverId } : {}),
    ...(query.from || query.to ? { moveDate: { ...(query.from ? { gte: dbDate(query.from) } : {}), ...(query.to ? { lte: dbDate(query.to) } : {}) } } : {}),
    ...(query.q ? { OR: ['reference', 'contactName', 'contactEmail', 'contactPhone', 'pickupPostcode', 'dropoffPostcode'].map((field) => ({ [field]: { contains: query.q, mode: 'insensitive' } })) } : {}),
  };
  const rows = await prisma.booking.findMany({
    where, select: bookingSelect, orderBy: [{ moveDate: 'asc' }, { slot: 'asc' }, { id: 'asc' }],
    take: query.limit + 1, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return AdminBookingsResponseSchema.parse({ items: page.map(bookingSummary), nextCursor: rows.length > query.limit ? page.at(-1)?.id ?? null : null });
}

async function bookingDetail(id: string) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    select: {
      ...bookingCleanupSelect, ...bookingSelect, contactEmail: true, contactPhone: true, customerNotes: true, adminNotes: true,
      distanceMiles: true, durationMinutes: true, version: true, van: { select: vanSelect },
      payments: { orderBy: { createdAt: 'desc' }, select: { ...cleanupPaymentSelect, amountPence: true, currency: true, createdAt: true } },
    },
  });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  const pickup = AddressSchema.safeParse(booking.pickup);
  const dropoff = AddressSchema.safeParse(booking.dropoff);
  return AdminBookingDetailResponseSchema.parse({
    ...bookingSummary(booking), contactEmail: booking.contactEmail, contactPhone: booking.contactPhone,
    deletedAt: booking.deletedAt?.toISOString() ?? null, deletion: bookingDeletionCapability(booking),
    pickup: pickup.success ? pickup.data : null, dropoff: dropoff.success ? dropoff.data : null,
    customerNotes: booking.customerNotes, adminNotes: booking.adminNotes,
    distanceMiles: booking.distanceMiles, durationMinutes: booking.durationMinutes, version: booking.version, van: booking.van,
    payments: booking.payments.map((payment) => ({
      id: payment.id, kind: payment.kind, method: payment.method, status: payment.status,
      amountPence: payment.amountPence, currency: payment.currency, createdAt: payment.createdAt.toISOString(),
    })),
  });
}

async function schedule(search: URLSearchParams, now: Date) {
  const query = parseQuery(search, AdminScheduleQuerySchema);
  const date = query.date ?? query.from ?? query.to ?? londonToday(now);
  const moveDate = dbDate(date);
  return prisma.$transaction(async (tx) => {
    const [rows, slots] = await Promise.all([
      tx.booking.findMany({ where: { ...operationalBookings(moveDate, now), deletedAt: null }, select: bookingSelect, orderBy: [{ slot: 'asc' }, { id: 'asc' }] }),
      readAdminScheduleWindows(tx, moveDate, now),
    ]);
    return AdminScheduleResponseSchema.parse({ date, generatedAt: now.toISOString(), jobs: rows.map(bookingSummary), slots });
  }, { isolationLevel: 'RepeatableRead' });
}

function driverSelect(date: Date) {
  return {
    userId: true, homePostcode: true, licenceExpiry: true,
    user: { select: { name: true, email: true, phone: true, status: true } },
    defaultVan: { select: vanSelect },
    unavailabilities: { where: { date }, select: { slot: true } },
    _count: { select: { bookings: { where: { moveDate: date, status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } } } } },
  } as const satisfies Prisma.DriverProfileSelect;
}

type DriverRow = Prisma.DriverProfileGetPayload<{ select: ReturnType<typeof driverSelect> }>;
function driverSummary(driver: DriverRow): AdminDriverSummary {
  return {
    id: driver.userId, name: driver.user.name, email: driver.user.email, phone: driver.user.phone, status: driver.user.status,
    homePostcode: driver.homePostcode, licenceExpiry: driver.licenceExpiry ? fromDbDate(driver.licenceExpiry) : null,
    defaultVan: driver.defaultVan, jobsOnDate: driver._count.bookings, unavailableSlots: driver.unavailabilities.map((row) => row.slot),
  };
}

async function drivers(search: URLSearchParams, now: Date) {
  const query = parseQuery(search, AdminDriversQuerySchema);
  const rows = await prisma.driverProfile.findMany({
    where: {
      user: {
        role: 'DRIVER', ...(query.status ? { status: query.status } : {}),
        ...(query.q ? { OR: ['name', 'email', 'phone'].map((field) => ({ [field]: { contains: query.q, mode: 'insensitive' } })) } : {}),
      },
    },
    select: driverSelect(dbDate(query.date ?? londonToday(now))), orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
    take: query.limit + 1, ...(query.cursor ? { cursor: { userId: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, query.limit);
  return AdminDriversResponseSchema.parse({ items: page.map(driverSummary), nextCursor: rows.length > query.limit ? page.at(-1)?.userId ?? null : null });
}

async function driverDetail(id: string, search: URLSearchParams, now: Date) {
  const date = parseQuery(search, AdminDayQuerySchema).date ?? londonToday(now);
  const driver = await prisma.driverProfile.findUnique({ where: { userId: id }, select: { ...driverSelect(dbDate(date)), payoutPercent: true, notes: true, rightToWorkAt: true, user: { select: { name: true, email: true, phone: true, status: true, role: true } } } });
  if (!driver || driver.user.role !== 'DRIVER') throw new AppError('NOT_FOUND', 'Driver not found.');
  const [upcoming, earnings] = await Promise.all([
    prisma.booking.findMany({ where: { driverId: id, moveDate: { gte: dbDate(date) }, status: { in: ['CONFIRMED', 'IN_PROGRESS'] } }, select: bookingSelect, orderBy: [{ moveDate: 'asc' }, { slot: 'asc' }, { id: 'asc' }], take: 26 }),
    prisma.driverEarning.aggregate({ where: { driverId: id, payoutId: null }, _sum: { amountPence: true } }),
  ]);
  return AdminDriverDetailResponseSchema.parse({
    ...driverSummary(driver), payoutPercent: driver.payoutPercent, notes: driver.notes, rightToWorkAt: driver.rightToWorkAt?.toISOString() ?? null,
    upcomingBookings: upcoming.slice(0, 25).map(bookingSummary), hasMoreUpcomingBookings: upcoming.length > 25, unpaidEarningsPence: earnings._sum.amountPence ?? 0,
  });
}

export async function readAdminOperation(action: string, params: Record<string, string>, search: URLSearchParams, now = new Date()): Promise<unknown> {
  if (action === 'admin.visitors.presence') return readAdminVisitorPresence(now);
  if (action === 'admin.dashboard.view') return dashboard(search, now);
  if (action === 'admin.bookings.list') return bookings(search);
  if (action === 'admin.bookings.view' && params.id) return bookingDetail(params.id);
  if (action === 'admin.schedule.view') return schedule(search, now);
  if (action === 'admin.drivers.list') return drivers(search, now);
  if (action === 'admin.drivers.view' && params.id) return driverDetail(params.id, search, now);
  return undefined;
}
