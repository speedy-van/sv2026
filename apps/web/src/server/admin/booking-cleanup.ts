import 'server-only';

import {
  AdminBookingCleanupResponseSchema, AppError, assertTransition,
  type AdminBookingCleanupRequest, type AdminBookingCleanupResponse,
} from '@sv/contracts';
import { prisma, type Prisma, type DbTx } from '@sv/db';
import { cancelPaymentIntentForCleanup } from '../integrations/stripe';

export const cleanupPaymentSelect = {
  id: true, kind: true, method: true, status: true, stripePaymentIntentId: true,
  stripeCheckoutSessionId: true, stripeChargeId: true, refunds: { select: { id: true } },
  extraCharge: { select: { id: true, status: true } },
} as const satisfies Prisma.PaymentSelect;

export const bookingCleanupSelect = {
  id: true, status: true, jobStage: true, dispatchStatus: true, driverId: true,
  paidPence: true, refundedPence: true, holdExpiresAt: true, version: true, deletedAt: true,
  payments: { select: cleanupPaymentSelect }, slotHolds: { select: { paymentId: true } },
} as const satisfies Prisma.BookingSelect;

type CleanupBooking = Prisma.BookingGetPayload<{ select: typeof bookingCleanupSelect }>;
interface StaffAction { userId: string; requestId: string }
interface DeletionCapability { allowed: boolean; reason: string | null }

export function bookingDeletionCapability(booking: CleanupBooking): DeletionCapability {
  const denied = (reason: string): DeletionCapability => ({ allowed: false, reason });
  if (booking.deletedAt) return denied('This booking has already been removed from the list.');
  if (booking.status === 'CONFIRMED' || booking.status === 'IN_PROGRESS') {
    return denied('An active booking cannot be removed. Complete or cancel it through the booking workflow first.');
  }
  if (booking.payments.some((payment) => payment.status === 'PROCESSING')) {
    return denied('A payment is processing. Wait for its final status before removing this booking.');
  }
  if (booking.status === 'PENDING_PAYMENT') {
    if (booking.jobStage !== 'NOT_STARTED' || booking.dispatchStatus !== 'UNASSIGNED' || booking.driverId) {
      return denied('This booking has assigned or started work. Resolve that work before removing it.');
    }
    if (booking.paidPence > 0 || booking.refundedPence > 0 || booking.payments.some((payment) =>
      payment.status === 'SUCCEEDED' || payment.stripeChargeId !== null || payment.refunds.length > 0)) {
      return denied('This booking has payment history that needs reconciliation before it can be removed.');
    }
  }
  if (booking.payments.some((payment) => payment.stripeCheckoutSessionId !== null)) {
    return denied('This booking has a checkout session that must be closed before it can be removed.');
  }
  if (booking.payments.some((payment) => payment.method === 'STRIPE'
    && payment.status !== 'SUCCEEDED' && !payment.stripePaymentIntentId)) {
    return denied('A payment attempt is still being prepared. Refresh this booking before removing it.');
  }
  if (booking.slotHolds.some((hold) => booking.payments.some((payment) => payment.id === hold.paymentId && payment.status === 'SUCCEEDED'))) {
    return denied('A paid change to this booking is awaiting reconciliation. Refresh the booking before removing it.');
  }
  if (booking.payments.some((payment) => payment.kind === 'EXTRA_CHARGE' && payment.status === 'SUCCEEDED' && payment.extraCharge?.status !== 'PAID')) {
    return denied('A paid extra charge is awaiting reconciliation. Refresh the booking before removing it.');
  }
  return { allowed: true, reason: null };
}

function response(booking: Pick<CleanupBooking, 'id' | 'deletedAt' | 'version' | 'status'>): AdminBookingCleanupResponse {
  return AdminBookingCleanupResponseSchema.parse({ ...booking, deletedAt: booking.deletedAt?.toISOString() ?? null });
}

function assertVersion(booking: CleanupBooking, input: AdminBookingCleanupRequest): void {
  if (booking.version !== input.expectedVersion) throw new AppError('CONFLICT', 'This booking changed. Refresh it and try again.');
}

function assertCanDelete(booking: CleanupBooking): void {
  const capability = bookingDeletionCapability(booking);
  if (!capability.allowed) throw new AppError('CONFLICT', capability.reason ?? 'This booking cannot be removed.');
}

function paymentSnapshot(booking: CleanupBooking): string {
  return JSON.stringify(booking.payments.map((payment) => ({
    ...payment, refunds: payment.refunds.map((refund) => refund.id).sort(),
  })).sort((left, right) => left.id.localeCompare(right.id)));
}

async function writeCleanupAudit(tx: DbTx, before: CleanupBooking, after: AdminBookingCleanupResponse, staff: StaffAction, restore: boolean): Promise<void> {
  await tx.auditLog.create({ data: {
    action: restore ? 'admin.bookings.restore' : 'admin.bookings.delete', actorType: 'USER', actorUserId: staff.userId,
    entityType: 'booking', entityId: before.id, requestId: staff.requestId,
    reason: restore ? 'Restored to the admin booking list; booking lifecycle is unchanged.' : 'Removed from the admin booking list; booking and financial records are retained.',
    before: { deletedAt: before.deletedAt?.toISOString() ?? null, status: before.status, version: before.version },
    after: { deletedAt: after.deletedAt, status: after.status, version: after.version },
  } });
}

function transactionError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
    throw new AppError('CONFLICT', 'This booking or its payment changed. Refresh it and try again.');
  }
  throw error;
}

export async function deleteAdminBooking(id: string, input: AdminBookingCleanupRequest, staff: StaffAction, now = new Date()): Promise<AdminBookingCleanupResponse> {
  const snapshot = await prisma.booking.findUnique({ where: { id }, select: bookingCleanupSelect });
  if (!snapshot) throw new AppError('NOT_FOUND', 'Booking not found.');
  if (snapshot.deletedAt) return response({ id: snapshot.id, deletedAt: snapshot.deletedAt, version: snapshot.version, status: snapshot.status });
  assertVersion(snapshot, input);
  assertCanDelete(snapshot);
  for (const payment of snapshot.payments) {
    if (payment.method === 'STRIPE' && payment.status !== 'SUCCEEDED' && payment.stripePaymentIntentId) {
      await cancelPaymentIntentForCleanup(payment.stripePaymentIntentId, { bookingId: snapshot.id, paymentId: payment.id });
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.booking.findUnique({ where: { id }, select: bookingCleanupSelect });
      if (!current) throw new AppError('NOT_FOUND', 'Booking not found.');
      if (current.deletedAt) return response({ id: current.id, deletedAt: current.deletedAt, version: current.version, status: current.status });
      assertVersion(current, input);
      assertCanDelete(current);
      if (current.status !== snapshot.status || paymentSnapshot(current) !== paymentSnapshot(snapshot)) {
        throw new AppError('CONFLICT', 'This booking or its payment changed. Refresh it and try again.');
      }
      const pending = current.status === 'PENDING_PAYMENT';
      if (pending) assertTransition('booking', current.status, 'CANCELLED', 'ADMIN');
      const updated = await tx.booking.updateMany({
        where: {
          id, version: input.expectedVersion, deletedAt: null, status: current.status,
          payments: { none: { status: { in: pending ? ['PROCESSING', 'SUCCEEDED'] : ['PROCESSING'] } } },
          ...(pending ? { paidPence: 0, refundedPence: 0, jobStage: 'NOT_STARTED', dispatchStatus: 'UNASSIGNED', driverId: null } : {}),
        },
        data: {
          deletedAt: now, version: { increment: 1 },
          ...(pending ? { status: 'CANCELLED', holdExpiresAt: null, cancelledAt: now, cancelledBy: 'ADMIN', cancelReason: 'Unpaid booking removed from the admin work list.' } : {}),
        },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT', 'This booking or its payment changed. Refresh it and try again.');
      await tx.payment.updateMany({
        where: { bookingId: id, status: { in: ['REQUIRES_PAYMENT', 'FAILED'] } }, data: { status: 'CANCELED' },
      });
      await tx.slotHold.deleteMany({ where: { bookingId: id } });
      const after = response({ id, deletedAt: now, version: current.version + 1, status: pending ? 'CANCELLED' : current.status });
      await writeCleanupAudit(tx, current, after, staff, false);
      return after;
    }, { isolationLevel: 'Serializable' });
  } catch (error) { return transactionError(error); }
}

export async function restoreAdminBooking(id: string, input: AdminBookingCleanupRequest, staff: StaffAction): Promise<AdminBookingCleanupResponse> {
  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.booking.findUnique({ where: { id }, select: bookingCleanupSelect });
      if (!current) throw new AppError('NOT_FOUND', 'Booking not found.');
      if (!current.deletedAt) return response({ id: current.id, deletedAt: null, version: current.version, status: current.status });
      assertVersion(current, input);
      const updated = await tx.booking.updateMany({
        where: { id, version: input.expectedVersion, deletedAt: current.deletedAt },
        data: { deletedAt: null, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new AppError('CONFLICT', 'This booking changed. Refresh it and try again.');
      const after = response({ id, deletedAt: null, version: current.version + 1, status: current.status });
      await writeCleanupAudit(tx, current, after, staff, true);
      return after;
    }, { isolationLevel: 'Serializable' });
  } catch (error) { return transactionError(error); }
}
