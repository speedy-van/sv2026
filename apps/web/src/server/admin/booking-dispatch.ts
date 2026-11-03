import 'server-only';

import { AdminBookingAssignmentOptionsSchema, AppError, assertTransition, fromDbDate, londonToday, type AdminBookingAssignmentOptions, type AssignBookingSchema } from '@sv/contracts';
import { enqueueOutbox, lockSlot, prisma, slotsCovered, type DbTx, type Prisma } from '@sv/db';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';

export interface DispatchActor { userId: string; requestId: string; role: 'ADMIN' | 'OWNER' }
export interface BookingMutationResult { ok: true; id: string; version: number }
const bookingSelect = {
  id: true, reference: true, version: true, deletedAt: true, status: true, jobStage: true, dispatchStatus: true,
  driverId: true, vanId: true, moveDate: true, slot: true, blocksSlots: true,
} as const satisfies Prisma.BookingSelect;
type DispatchBooking = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

export function dispatchEditingReason(booking: DispatchBooking, now: Date): string | null {
  if (booking.deletedAt) return 'Restore this booking before changing its driver.';
  if (booking.status !== 'CONFIRMED' || booking.jobStage !== 'NOT_STARTED') return 'Drivers can only be changed on confirmed bookings before the job starts.';
  if (fromDbDate(booking.moveDate) < londonToday(now)) return 'This booking is in the past. Reschedule it before assigning a driver.';
  return null;
}

function assertEditable(booking: DispatchBooking, expectedVersion: number, now: Date): void {
  if (booking.version !== expectedVersion) throw new AppError('CONFLICT', 'This booking changed while you were editing. Reload to see the latest.');
  const reason = dispatchEditingReason(booking, now);
  if (reason) throw new AppError('CONFLICT', reason);
}

async function readBooking(tx: DbTx, id: string): Promise<DispatchBooking> {
  const booking = await tx.booking.findUnique({ where: { id }, select: bookingSelect });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  return booking;
}

function expired(date: Date | null, moveDate: Date): boolean { return date !== null && fromDbDate(date) < fromDbDate(moveDate); }

async function assignmentOptions(tx: DbTx, booking: DispatchBooking, now: Date) {
  const range = slotsCovered(booking.slot, booking.blocksSlots);
  const [drivers, vans, bookings, offers] = await Promise.all([
    tx.driverProfile.findMany({
      where: { user: { role: 'DRIVER' } }, orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
      select: { userId: true, defaultVanId: true, licenceExpiry: true,
        user: { select: { name: true, status: true } },
        unavailabilities: { where: { date: booking.moveDate, slot: { in: range } }, select: { slot: true } } },
    }),
    tx.van.findMany({ orderBy: [{ label: 'asc' }, { id: 'asc' }], select: {
      id: true, registration: true, label: true, active: true, motExpiry: true, insuranceExpiry: true, taxExpiry: true,
    } }),
    tx.booking.findMany({ where: { id: { not: booking.id }, moveDate: booking.moveDate, status: { in: ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'] } },
      select: { driverId: true, vanId: true, slot: true, blocksSlots: true } }),
    tx.assignment.findMany({ where: { bookingId: { not: booking.id }, status: 'OFFERED', expiresAt: { gt: now },
      booking: { moveDate: booking.moveDate, status: 'CONFIRMED', deletedAt: null } },
      select: { driverId: true, booking: { select: { slot: true, blocksSlots: true } } } }),
  ]);
  const overlaps = (entry: { slot: DispatchBooking['slot']; blocksSlots: number }): boolean => slotsCovered(entry.slot, entry.blocksSlots).some((slot) => range.includes(slot));
  const busy = bookings.filter(overlaps);
  const reason = dispatchEditingReason(booking, now);
  return {
    bookingId: booking.id, version: booking.version, editable: reason === null, reason,
    drivers: drivers.map((driver) => {
      const unavailable = driver.user.status !== 'ACTIVE' ? 'This driver account is not active.'
        : expired(driver.licenceExpiry, booking.moveDate) ? 'The driver licence expires before this booking.'
          : driver.unavailabilities.length ? 'The driver is unavailable during this booking.'
            : busy.some((entry) => entry.driverId === driver.userId) ? 'The driver already has a job during this booking.'
              : offers.some((offer) => offer.driverId === driver.userId && overlaps(offer.booking)) ? 'The driver has another open offer during this booking.' : null;
      return { id: driver.userId, name: driver.user.name, status: driver.user.status, defaultVanId: driver.defaultVanId, available: unavailable === null, reason: unavailable };
    }),
    vans: vans.map((van) => {
      const unavailable = !van.active ? 'This vehicle is inactive.'
        : [van.motExpiry, van.insuranceExpiry, van.taxExpiry].some((date) => expired(date, booking.moveDate)) ? 'A vehicle document expires before this booking.'
          : busy.some((entry) => entry.vanId === van.id) ? 'The vehicle already has a job during this booking.' : null;
      return { id: van.id, label: van.label, registration: van.registration, available: unavailable === null, reason: unavailable };
    }),
  };
}

export async function readAdminAssignmentOptions(id: string, now = new Date()): Promise<AdminBookingAssignmentOptions> {
  const options = await prisma.$transaction(async (tx) => assignmentOptions(tx, await readBooking(tx, id), now), { isolationLevel: 'RepeatableRead' });
  return AdminBookingAssignmentOptionsSchema.parse(options);
}

export async function assertAdminBookingVanAvailable(tx: DbTx, bookingId: string, vanId: string, now = new Date()): Promise<void> {
  const booking = await readBooking(tx, bookingId);
  await lockDispatchSlots(tx, booking);
  const options = await assignmentOptions(tx, booking, now);
  const van = options.vans.find((entry) => entry.id === vanId);
  if (!van) throw new AppError('NOT_FOUND', 'Vehicle not found.');
  if (!van.available) throw new AppError('CONFLICT', van.reason ?? 'The vehicle is unavailable.');
}

export async function assertAdminBookingDriverAvailable(tx: DbTx, bookingId: string, driverId: string, now = new Date()): Promise<void> {
  const booking = await readBooking(tx, bookingId);
  await lockDispatchSlots(tx, booking);
  const options = await assignmentOptions(tx, booking, now);
  const driver = options.drivers.find((entry) => entry.id === driverId);
  if (!driver) throw new AppError('NOT_FOUND', 'Driver not found.');
  if (!driver.available) throw new AppError('CONFLICT', driver.reason ?? 'The driver is unavailable.');
}

async function assertResources(tx: DbTx, booking: DispatchBooking, now: Date): Promise<void> {
  await lockDispatchSlots(tx, booking);
  const options = await assignmentOptions(tx, booking, now);
  const driverIds = new Set(booking.driverId ? [booking.driverId] : []);
  const offers = await tx.assignment.findMany({ where: { bookingId: booking.id, status: 'OFFERED', expiresAt: { gt: now } }, select: { driverId: true } });
  for (const offer of offers) driverIds.add(offer.driverId);
  for (const driverId of driverIds) {
    const driver = options.drivers.find((entry) => entry.id === driverId);
    if (!driver?.available) throw new AppError('CONFLICT', driver?.reason ?? 'The selected driver is no longer available.');
  }
  if (booking.vanId) {
    const van = options.vans.find((entry) => entry.id === booking.vanId);
    if (!van?.available) throw new AppError('CONFLICT', van?.reason ?? 'The selected vehicle is no longer available.');
  }
}

export async function assertAdminBookingResourcesAvailable(tx: DbTx, bookingId: string, now = new Date()): Promise<void> {
  await assertResources(tx, await readBooking(tx, bookingId), now);
}

export async function assertAdminBookingResourcesForTarget(tx: DbTx, bookingId: string,
  target: Pick<DispatchBooking, 'moveDate' | 'slot' | 'blocksSlots'>, now = new Date()): Promise<void> {
  const booking = await readBooking(tx, bookingId);
  await assertResources(tx, { ...booking, ...target }, now);
}

function conflict(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
    throw new AppError('CONFLICT', 'The booking or driver availability changed. Refresh and try again.');
  }
  throw error;
}

async function lockDispatchSlots(tx: DbTx, booking: DispatchBooking): Promise<void> {
  for (const slot of slotsCovered(booking.slot, booking.blocksSlots)) await lockSlot(tx, booking.moveDate, slot);
}

function assertDispatchTransition(booking: DispatchBooking, next: 'ACCEPTED' | 'OFFERED' | 'UNASSIGNED', role: 'ADMIN' | 'OWNER'): void {
  if (booking.dispatchStatus !== 'UNASSIGNED') assertTransition('dispatch', booking.dispatchStatus, 'UNASSIGNED', role);
  if (next !== 'UNASSIGNED') assertTransition('dispatch', 'UNASSIGNED', next, role);
}

export async function withdrawAdminBookingAssignments(tx: DbTx, booking: DispatchBooking, nextDrivers: string[], now: Date, skipNotificationFor?: string | null): Promise<void> {
  const assignments = await tx.assignment.findMany({ where: { bookingId: booking.id, status: { in: ['ACCEPTED', 'OFFERED'] } }, select: { driverId: true } });
  const previous = new Set(assignments.map((assignment) => assignment.driverId));
  if (booking.driverId) previous.add(booking.driverId);
  await tx.assignment.updateMany({ where: { bookingId: booking.id, status: { in: ['ACCEPTED', 'OFFERED'] } }, data: { status: 'WITHDRAWN', respondedAt: now } });
  for (const driverId of previous) {
    if (nextDrivers.includes(driverId) || driverId === skipNotificationFor) continue;
    await enqueueOutbox(tx, 'push.send', {
      app: 'DRIVER', userId: driverId, title: 'Job withdrawn', body: `Booking ${booking.reference} is no longer assigned to you.`,
      sound: 'default', category: 'JOB_WITHDRAWN', timeSensitive: true,
      data: { type: 'JOB_WITHDRAWN', bookingId: booking.id, url: `speedyvan-driver://jobs/${booking.id}` },
    }, `admin-booking:${booking.id}:${String(booking.version + 1)}:withdrawn:${driverId}`);
  }
}

async function writeDispatchAudit(tx: DbTx, booking: DispatchBooking, staff: { userId: string; requestId: string }, action: string,
  after: { driverId: string | null; vanId: string | null; dispatchStatus: string; version: number; driverIds?: string[] }, reason: string | null): Promise<void> {
  await tx.auditLog.create({ data: { action, actorType: 'USER', actorUserId: staff.userId, requestId: staff.requestId,
    entityId: booking.id, entityType: 'booking', reason,
    before: { driverId: booking.driverId, vanId: booking.vanId, dispatchStatus: booking.dispatchStatus, version: booking.version }, after } });
}

type DispatchInput = { expectedVersion: number; driverIds: string[]; mode: 'DIRECT' | 'OFFER'; vanId?: string; expiresInMinutes: number };

async function changeDispatch(id: string, input: DispatchInput, staff: DispatchActor, now: Date): Promise<BookingMutationResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await readBooking(tx, id);
      assertEditable(booking, input.expectedVersion, now);
      await lockDispatchSlots(tx, booking);
      const options = await assignmentOptions(tx, booking, now);
      const driverIds = [...new Set(input.driverIds)];
      if (!driverIds.length) throw new AppError('VALIDATION_ERROR', 'Choose a driver.');
      for (const driverId of driverIds) {
        const driver = options.drivers.find((entry) => entry.id === driverId);
        if (!driver) throw new AppError('NOT_FOUND', 'Driver not found.');
        if (!driver.available) throw new AppError('CONFLICT', driver.reason ?? 'The driver is unavailable.');
      }
      const driverId = driverIds[0];
      if (!driverId) throw new AppError('VALIDATION_ERROR', 'Choose a driver.');
      const vanId = input.vanId ?? (driverIds.length === 1 ? options.drivers.find((entry) => entry.id === driverId)?.defaultVanId : null) ?? null;
      if (vanId) {
        const van = options.vans.find((entry) => entry.id === vanId);
        if (!van) throw new AppError('NOT_FOUND', 'Vehicle not found.');
        if (!van.available) throw new AppError('CONFLICT', van.reason ?? 'The vehicle is unavailable.');
      } else if (input.mode === 'DIRECT') throw new AppError('VALIDATION_ERROR', 'Choose an active vehicle for this driver.');
      const dispatchStatus = input.mode === 'DIRECT' ? 'ACCEPTED' : 'OFFERED';
      assertDispatchTransition(booking, dispatchStatus, staff.role);
      const after = { dispatchStatus, driverId: input.mode === 'DIRECT' ? driverId : null, vanId, version: booking.version + 1 } as const;
      const changed = await tx.booking.updateMany({ where: { id, version: input.expectedVersion, status: 'CONFIRMED', jobStage: 'NOT_STARTED', deletedAt: null },
        data: { ...after } });
      if (changed.count !== 1) throw new AppError('CONFLICT', 'This booking changed while you were editing. Reload to see the latest.');
      await withdrawAdminBookingAssignments(tx, booking, driverIds, now);
      const assignments = driverIds.map((selected) => ({ id: randomUUID(), bookingId: id, driverId: selected, offeredById: staff.userId,
        status: dispatchStatus === 'ACCEPTED' ? 'ACCEPTED' as const : 'OFFERED' as const,
        respondedAt: input.mode === 'DIRECT' ? now : null, expiresAt: input.mode === 'OFFER' ? new Date(now.getTime() + input.expiresInMinutes * 60_000) : null }));
      await tx.assignment.createMany({ data: assignments });
      await writeDispatchAudit(tx, booking, staff, input.mode === 'DIRECT' ? 'admin.bookings.assign' : 'admin.bookings.offer', { ...after, driverIds }, null);
      await enqueueOutbox(tx, input.mode === 'DIRECT' ? 'booking.assigned' : 'booking.offered', {
        bookingId: id, bookingVersion: after.version, driverIds, assignmentIds: assignments.map((assignment) => assignment.id),
      }, `admin-booking:${id}:${String(after.version)}:dispatch`);
      return { ok: true, id, version: after.version };
    }, { isolationLevel: 'Serializable' });
  } catch (error) { return conflict(error); }
}

export async function assignAdminBooking(id: string, input: z.infer<typeof AssignBookingSchema>, staff: DispatchActor, now = new Date()): Promise<BookingMutationResult> {
  return changeDispatch(id, { expectedVersion: input.expectedVersion, mode: input.mode, driverIds: [input.driverId], expiresInMinutes: 30,
    ...(input.vanId === undefined ? {} : { vanId: input.vanId }) }, staff, now);
}

export async function offerAdminBooking(id: string, input: { expectedVersion: number; driverIds: string[]; expiresInMinutes: number }, staff: DispatchActor, now = new Date()): Promise<BookingMutationResult> {
  return changeDispatch(id, { ...input, mode: 'OFFER' }, staff, now);
}

export async function unassignAdminBooking(id: string, input: { expectedVersion: number; reason: string }, staff: DispatchActor, now = new Date()): Promise<BookingMutationResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await readBooking(tx, id);
      assertEditable(booking, input.expectedVersion, now);
      await lockDispatchSlots(tx, booking);
      assertDispatchTransition(booking, 'UNASSIGNED', staff.role);
      const after = { driverId: null, vanId: null, dispatchStatus: 'UNASSIGNED' as const, version: booking.version + 1 };
      const updated = await tx.booking.updateMany({ where: { id, version: input.expectedVersion, status: 'CONFIRMED', jobStage: 'NOT_STARTED', deletedAt: null }, data: after });
      if (updated.count !== 1) throw new AppError('CONFLICT', 'This booking changed. Refresh and try again.');
      await withdrawAdminBookingAssignments(tx, booking, [], now);
      await writeDispatchAudit(tx, booking, staff, 'admin.bookings.unassign', after, input.reason);
      await enqueueOutbox(tx, 'booking.updated', { bookingId: id }, `admin-booking:${id}:${String(after.version)}:unassigned`);
      return { ok: true, id, version: after.version };
    }, { isolationLevel: 'Serializable' });
  } catch (error) { return conflict(error); }
}

export async function acceptAdminBookingOffer(driverId: string, id: string, now = new Date()): Promise<BookingMutationResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await readBooking(tx, id);
      const reason = dispatchEditingReason(booking, now);
      if (reason || booking.dispatchStatus !== 'OFFERED') throw new AppError('OFFER_TAKEN', reason ?? 'This offer is no longer available.');
      await lockDispatchSlots(tx, booking);
      const offer = await tx.assignment.findFirst({ where: { bookingId: id, driverId, status: 'OFFERED', expiresAt: { gt: now } }, select: { id: true } });
      if (!offer) throw new AppError('OFFER_TAKEN', 'This offer has expired or was withdrawn.');
      const options = await assignmentOptions(tx, booking, now);
      const driver = options.drivers.find((entry) => entry.id === driverId);
      if (!driver?.available) throw new AppError('CONFLICT', driver?.reason ?? 'The driver is unavailable.');
      const vanId = booking.vanId ?? driver.defaultVanId;
      const van = options.vans.find((entry) => entry.id === vanId);
      if (!van?.available) throw new AppError('CONFLICT', van?.reason ?? 'Ask the office to assign an available vehicle.');
      assertTransition('dispatch', 'OFFERED', 'ACCEPTED', 'DRIVER');
      const after = { dispatchStatus: 'ACCEPTED' as const, driverId, vanId: van.id, version: booking.version + 1 };
      const updated = await tx.booking.updateMany({ where: { id, version: booking.version, dispatchStatus: 'OFFERED', status: 'CONFIRMED', jobStage: 'NOT_STARTED', deletedAt: null }, data: after });
      if (updated.count !== 1) throw new AppError('OFFER_TAKEN', 'This offer changed or another driver took the job.');
      const accepted = await tx.assignment.updateMany({ where: { id: offer.id, status: 'OFFERED', expiresAt: { gt: now } }, data: { status: 'ACCEPTED', respondedAt: now } });
      if (accepted.count !== 1) throw new AppError('OFFER_TAKEN', 'This offer has expired or was withdrawn.');
      await tx.assignment.updateMany({ where: { bookingId: id, id: { not: offer.id }, status: 'OFFERED' }, data: { status: 'WITHDRAWN', respondedAt: now } });
      await writeDispatchAudit(tx, booking, { userId: driverId, requestId: `offer-accept:${offer.id}` }, 'driver.offers.accept', after, null);
      await enqueueOutbox(tx, 'booking.driver_accepted', {
        bookingId: id, driverId, driverIds: [driverId], assignmentIds: [offer.id], bookingVersion: after.version,
      }, `driver-booking:${id}:${String(after.version)}:accepted`);
      return { ok: true, id, version: after.version };
    }, { isolationLevel: 'Serializable' });
  } catch (error) { return conflict(error); }
}

export async function declineAdminBookingOffer(driverId: string, id: string, reason: string | undefined, now = new Date()): Promise<BookingMutationResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await readBooking(tx, id);
      if (dispatchEditingReason(booking, now) || booking.dispatchStatus !== 'OFFERED') throw new AppError('OFFER_TAKEN', 'This offer is no longer available.');
      await lockDispatchSlots(tx, booking);
      const offer = await tx.assignment.findFirst({ where: { bookingId: id, driverId, status: 'OFFERED', expiresAt: { gt: now } }, select: { id: true } });
      if (!offer) throw new AppError('OFFER_TAKEN', 'This offer has expired or was withdrawn.');
      const declined = await tx.assignment.updateMany({ where: { id: offer.id, status: 'OFFERED', expiresAt: { gt: now } },
        data: { status: 'DECLINED', respondedAt: now, declineReason: reason ?? null } });
      if (declined.count !== 1) throw new AppError('OFFER_TAKEN', 'This offer changed. Refresh and try again.');
      const remaining = await tx.assignment.count({ where: { bookingId: id, status: 'OFFERED', expiresAt: { gt: now } } });
      if (remaining === 0) assertTransition('dispatch', 'OFFERED', 'UNASSIGNED', 'SYSTEM');
      const after = { dispatchStatus: remaining ? 'OFFERED' as const : 'UNASSIGNED' as const,
        driverId: null, vanId: remaining ? booking.vanId : null, version: booking.version + 1 };
      const changed = await tx.booking.updateMany({ where: { id, version: booking.version, dispatchStatus: 'OFFERED', status: 'CONFIRMED', jobStage: 'NOT_STARTED', deletedAt: null }, data: after });
      if (changed.count !== 1) throw new AppError('OFFER_TAKEN', 'This offer changed. Refresh and try again.');
      await writeDispatchAudit(tx, booking, { userId: driverId, requestId: `offer-decline:${offer.id}` }, 'driver.offers.decline', after, reason ?? null);
      await enqueueOutbox(tx, 'booking.driver_declined', {
        bookingId: id, driverId, driverIds: [driverId], assignmentIds: [offer.id], bookingVersion: after.version,
      }, `driver-booking:${id}:${String(after.version)}:declined`);
      return { ok: true, id, version: after.version };
    }, { isolationLevel: 'Serializable' });
  } catch (error) { return conflict(error); }
}
