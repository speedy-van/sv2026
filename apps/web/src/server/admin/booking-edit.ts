import 'server-only';
import {
  AdminBookingEditContextSchema, AdminBookingMutationResponseSchema, AdminBookingRepricePreviewSchema,
  AppError, type AdminBookingEditContext, type AdminBookingMutationResponse, type AdminBookingRepricePreview,
  type AdminBookingPatchSchema, type RepriceApplySchema, type RepricePreviewSchema,
} from '@sv/contracts';
import { Prisma, enqueueOutbox, prisma, type DbTx } from '@sv/db';
import { formatPriceBreakdownLines, SERVICE_KEYS } from '@sv/pricing';
import { ZodError, type z } from 'zod';
import { assertAdminBookingCapacity } from './booking-capacity';
import { assertAdminBookingChangeReady } from './booking-change-guards';
import { assertAdminBookingResourcesAvailable, assertAdminBookingResourcesForTarget, assertAdminBookingVanAvailable } from './booking-dispatch';
import {
  assertBookingEditVersion, assertBookingRepriceAllowed, assertBookingRepriceSnapshot, bookingChangesFromSnapshot, bookingDetailsEditReason,
  bookingEditSelect, calculateAdminBookingReprice, parseBookingPricingConfig, readEditableBooking, type EditableBooking,
} from './booking-edit-pricing';
import { previewAdminBookingSettlement, settleAdminBookingChange } from './booking-settlement';
import { invalidateAvailabilityCache } from '../services/availability';

export interface AdminBookingEditActor { userId: string; requestId: string; role: 'ADMIN' | 'OWNER' }
function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }
function transactionError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') throw new AppError('CONFLICT', 'This booking changed while you were editing. Reload to see the latest.');
  throw error;
}
async function currentBooking(tx: DbTx, id: string): Promise<EditableBooking> {
  const booking = await tx.booking.findUnique({ where: { id }, select: bookingEditSelect });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  return booking;
}
export async function readAdminBookingEditContext(id: string): Promise<AdminBookingEditContext> {
  const booking = await readEditableBooking(id);
  const reason = bookingDetailsEditReason(booking);
  let changes: AdminBookingEditContext['changes'] = null;
  let services: AdminBookingEditContext['services'] = [];
  let repriceReason: string | null = null;
  try {
    const config = parseBookingPricingConfig(booking.pricingVersion.config);
    services = SERVICE_KEYS.map((key) => ({ key, label: config.services[key].label, requiresDropoff: config.services[key].requiresDropoff,
      variants: config.services[key].variants.map(({ key: variantKey, label, manualQuote }) => ({ key: variantKey, label, manualQuote })) }));
    changes = bookingChangesFromSnapshot(booking);
    assertBookingRepriceAllowed(booking);
    assertBookingRepriceSnapshot(booking);
    await assertAdminBookingChangeReady(prisma, id);
  } catch (error) {
    if (error instanceof AppError && error.code === 'CONFLICT') repriceReason = error.message;
    else if (error instanceof ZodError) repriceReason = 'The saved move details need review before this booking can be repriced.';
    else throw error;
  }
  return AdminBookingEditContextSchema.parse({
    id, version: booking.version, contact: { name: booking.contactName, email: booking.contactEmail, phone: booking.contactPhone },
    notes: booking.adminNotes, vanId: booking.vanId, changes, currentTotalPence: booking.totalPence,
    editable: reason === null, reason, repriceEditable: repriceReason === null, repriceReason, services,
  });
}
export async function patchAdminBooking(id: string, input: z.infer<typeof AdminBookingPatchSchema>, actor: AdminBookingEditActor): Promise<AdminBookingMutationResponse> {
  try {
    return await prisma.$transaction(async (tx) => {
      const booking = await currentBooking(tx, id);
      assertBookingEditVersion(booking, input.expectedVersion);
      const reason = bookingDetailsEditReason(booking);
      if (reason) throw new AppError('CONFLICT', reason);
      if (input.contact === undefined && input.notes === undefined && input.vanId === undefined) throw new AppError('VALIDATION_ERROR', 'Choose a detail to update.');
      if (input.vanId !== undefined && input.vanId !== booking.vanId) {
        if (booking.status !== 'CONFIRMED' || booking.jobStage !== 'NOT_STARTED') throw new AppError('CONFLICT', 'The van can only be changed on a confirmed move that has not started.');
        if (input.vanId) await assertAdminBookingVanAvailable(tx, id, input.vanId);
      }
      const data: Prisma.BookingUpdateManyMutationInput = {
        ...(input.contact ? { contactName: input.contact.name, contactEmail: input.contact.email, contactPhone: input.contact.phone } : {}),
        ...(input.notes !== undefined ? { adminNotes: input.notes } : {}),
        ...(input.vanId !== undefined ? { vanId: input.vanId } : {}),
        version: { increment: 1 },
      };
      const updated = await tx.booking.updateMany({ where: { id, version: input.expectedVersion, status: booking.status, deletedAt: null }, data });
      if (updated.count !== 1) throw new AppError('CONFLICT', 'This booking changed while you were editing. Reload to see the latest.');
      const version = booking.version + 1;
      await tx.auditLog.create({ data: { action: 'admin.bookings.patch', actorType: 'USER', actorUserId: actor.userId, requestId: actor.requestId,
        entityType: 'booking', entityId: id,
        before: json({ contact: { name: booking.contactName, email: booking.contactEmail, phone: booking.contactPhone }, notes: booking.adminNotes, vanId: booking.vanId, version: booking.version }),
        after: json({ ...input, version }),
      } });
      await enqueueOutbox(tx, 'booking.updated', { bookingId: id }, `admin-booking:${id}:${String(version)}:updated`);
      return AdminBookingMutationResponseSchema.parse({ ok: true, id, version });
    }, { isolationLevel: 'Serializable' });
  } catch (error) { return transactionError(error); }
}
export async function previewAdminBookingReprice(id: string, input: z.infer<typeof RepricePreviewSchema>): Promise<AdminBookingRepricePreview> {
  const booking = await readEditableBooking(id);
  assertBookingEditVersion(booking, input.expectedVersion);
  await assertAdminBookingChangeReady(prisma, id);
  const priced = await calculateAdminBookingReprice(booking, input.changes);
  const settlement = await prisma.$transaction(async (tx) => {
    const current = await currentBooking(tx, id);
    assertBookingEditVersion(current, input.expectedVersion);
    assertBookingRepriceAllowed(current);
    await assertAdminBookingChangeReady(tx, id);
    await assertAdminBookingCapacity(tx, current, { moveDate: current.moveDate, slot: current.slot, ...priced.size }, { now: new Date(), actorRole: 'ADMIN' });
    if (priced.size.blocksSlots !== current.blocksSlots) await assertAdminBookingResourcesForTarget(tx, id, { moveDate: current.moveDate, slot: current.slot, blocksSlots: priced.size.blocksSlots });
    return previewAdminBookingSettlement(tx, current, priced.totalPence);
  }, { isolationLevel: 'Serializable' }).catch(transactionError);
  return AdminBookingRepricePreviewSchema.parse({ id, expectedVersion: booking.version, currentTotalPence: booking.totalPence,
    newTotalPence: priced.totalPence, differencePence: priced.totalPence - booking.totalPence,
    oldBreakdownLines: formatPriceBreakdownLines(priced.oldPrice.breakdown), newBreakdownLines: formatPriceBreakdownLines(priced.price.breakdown),
    ...settlement,
  });
}
export async function applyAdminBookingReprice(id: string, input: z.infer<typeof RepriceApplySchema>, actor: AdminBookingEditActor, now = new Date()): Promise<AdminBookingMutationResponse> {
  const snapshot = await readEditableBooking(id);
  assertBookingEditVersion(snapshot, input.expectedVersion);
  const priced = await calculateAdminBookingReprice(snapshot, input.changes, now);
  if (priced.totalPence !== input.expectedTotalPence) throw new AppError('PRICE_CHANGED', 'The price changed. Review the new amount before saving.', { newTotalPence: priced.totalPence });
  try {
    const result = await prisma.$transaction(async (tx) => {
      const booking = await currentBooking(tx, id);
      assertBookingEditVersion(booking, input.expectedVersion);
      assertBookingRepriceAllowed(booking);
      await assertAdminBookingChangeReady(tx, id);
      await assertAdminBookingCapacity(tx, booking, { moveDate: booking.moveDate, slot: booking.slot, ...priced.size }, { now, actorRole: actor.role });
      const updated = await tx.booking.updateMany({
        where: { id, version: input.expectedVersion, status: 'CONFIRMED', jobStage: 'NOT_STARTED', deletedAt: null },
        data: {
          service: input.changes.service, variant: input.changes.variant, pickup: json(input.changes.pickup), dropoff: input.changes.dropoff ? json(input.changes.dropoff) : Prisma.DbNull,
          pickupPostcode: input.changes.pickup.postcode, dropoffPostcode: input.changes.dropoff?.postcode ?? null,
          pricingInput: json(priced.input), accessDetail: json({ pickup: input.changes.pickupAccess, dropoff: input.changes.dropoffAccess }), priceBreakdown: json(priced.price),
          distanceMiles: priced.route.distanceMiles, durationMinutes: priced.route.durationMinutes, routeGeometry: priced.route.geometry || null,
          ...priced.size, totalPence: priced.totalPence, version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT', 'This booking changed while you were editing. Reload to see the latest.');
      if (priced.size.blocksSlots !== booking.blocksSlots) await assertAdminBookingResourcesAvailable(tx, id, now);
      await settleAdminBookingChange(tx, booking, { newTotalPence: priced.totalPence, expectedSettlementPence: input.expectedSettlementPence,
        settle: input.settle, reason: input.reason, actorUserId: actor.userId }, now);
      const version = booking.version + 1;
      await tx.auditLog.create({ data: { action: 'admin.bookings.reprice_apply', actorType: 'USER', actorUserId: actor.userId, requestId: actor.requestId,
        entityType: 'booking', entityId: id, reason: input.reason,
        before: json({ pricingInput: booking.pricingInput, pickup: booking.pickup, dropoff: booking.dropoff, totalPence: booking.totalPence, version: booking.version }),
        after: json({ pricingInput: priced.input, pickup: input.changes.pickup, dropoff: input.changes.dropoff, totalPence: priced.totalPence, version }),
      } });
      await enqueueOutbox(tx, 'booking.updated', { bookingId: id }, `admin-booking:${id}:${String(version)}:updated`);
      return AdminBookingMutationResponseSchema.parse({ ok: true, id, version });
    }, { isolationLevel: 'Serializable' });
    invalidateAvailabilityCache();
    return result;
  } catch (error) { return transactionError(error); }
}
