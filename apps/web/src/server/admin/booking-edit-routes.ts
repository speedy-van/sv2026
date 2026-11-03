import 'server-only';

import {
  AdminBookingAssignmentOptionsSchema, AdminBookingCalendarResponseSchema, AdminBookingEditContextSchema,
  AdminBookingMutationResponseSchema, AdminBookingPatchSchema, AdminBookingRepricePreviewSchema,
  AdminBookingReschedulePreviewSchema, AdminReschedulePreviewRequestSchema, AdminRescheduleSchema,
  AdminUnassignBookingSchema, AppError, AssignBookingSchema, OfferBookingSchema, RepriceApplySchema, RepricePreviewSchema,
} from '@sv/contracts';
import type { StaffContext } from '../auth/staff';
import { assertBrowserSessionOrigin } from '../auth/browser-session';
import { assignAdminBooking, offerAdminBooking, readAdminAssignmentOptions, unassignAdminBooking } from './booking-dispatch';
import { readAdminBookingCalendar, previewAdminReschedule, rescheduleAdminBooking } from './booking-reschedule';
import { readAdminBookingEditContext, patchAdminBooking, previewAdminBookingReprice, applyAdminBookingReprice } from './booking-edit';
import { scheduleAdminBookingEdit } from './booking-edit-dispatch';

const supported = new Set([
  'admin.bookings.edit_context', 'admin.bookings.assignment_options', 'admin.bookings.calendar',
  'admin.bookings.patch', 'admin.bookings.reprice_preview', 'admin.bookings.reprice_apply',
  'admin.bookings.reschedule_preview', 'admin.bookings.reschedule', 'admin.bookings.assign',
  'admin.bookings.offer', 'admin.bookings.unassign',
]);

export async function handleAdminBookingEdit(input: {
  action: string; id: string | undefined; body: unknown; staff: StaffContext; requestId: string; request: Request;
}): Promise<unknown> {
  if (!supported.has(input.action)) return undefined;
  if (!input.id) throw new AppError('NOT_FOUND', 'Booking not found.');
  if (input.staff.role !== 'ADMIN' && input.staff.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Admin access is required.');
  if (input.request.method !== 'GET' && input.request.headers.has('origin')) assertBrowserSessionOrigin(input.request);
  const actor = { userId: input.staff.userId, role: input.staff.role, requestId: input.requestId };
  const { id, body, action } = input;
  if (action === 'admin.bookings.edit_context') return AdminBookingEditContextSchema.parse(await readAdminBookingEditContext(id));
  if (action === 'admin.bookings.assignment_options') return AdminBookingAssignmentOptionsSchema.parse(await readAdminAssignmentOptions(id));
  if (action === 'admin.bookings.calendar') return AdminBookingCalendarResponseSchema.parse(await readAdminBookingCalendar(id));
  if (action === 'admin.bookings.reprice_preview') return AdminBookingRepricePreviewSchema.parse(await previewAdminBookingReprice(id, RepricePreviewSchema.parse(body)));
  if (action === 'admin.bookings.reschedule_preview') return AdminBookingReschedulePreviewSchema.parse(await previewAdminReschedule(id, AdminReschedulePreviewRequestSchema.parse(body), actor));

  const result = action === 'admin.bookings.patch'
    ? await patchAdminBooking(id, AdminBookingPatchSchema.parse(body), actor)
    : action === 'admin.bookings.reprice_apply'
      ? await applyAdminBookingReprice(id, RepriceApplySchema.parse(body), actor)
      : action === 'admin.bookings.reschedule'
        ? await rescheduleAdminBooking(id, AdminRescheduleSchema.parse(body), actor)
        : action === 'admin.bookings.assign'
          ? await assignAdminBooking(id, AssignBookingSchema.parse(body), actor)
          : action === 'admin.bookings.offer'
            ? await offerAdminBooking(id, OfferBookingSchema.parse(body), actor)
            : await unassignAdminBooking(id, AdminUnassignBookingSchema.parse(body), actor);
  const confirmed = AdminBookingMutationResponseSchema.parse(result);
  scheduleAdminBookingEdit(confirmed.id, confirmed.version);
  return confirmed;
}
