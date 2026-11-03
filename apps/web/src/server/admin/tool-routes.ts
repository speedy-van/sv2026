import 'server-only';
import * as C from '@sv/contracts';
import type { z } from 'zod';
import type { StaffContext } from '../auth/staff';
import { assertBrowserSessionOrigin } from '../auth/browser-session';
import { createQuote } from '../services/quote';
import { enforceRateLimit } from '../rate-limit';
import { scheduleOutboxRoots } from '../outbox/schedule-roots';
import { scheduleAdminBookingEdit } from './booking-edit-dispatch';
import * as actions from './booking-actions';
import * as quotes from './manual-quotes';
import { exportAdminReports, readAdminReports } from './reports';
import { readAdminAbandonedCheckouts, readAdminBookingActivity } from './leads';
import { readAdminNotificationSettings, updateAdminNotificationSettings } from './notification-settings';

const supported = new Set([
  'admin.bookings.create_context', 'admin.quotes.create', 'admin.bookings.create', 'admin.bookings.actions_context',
  'admin.bookings.cancel_preview', 'admin.bookings.cancel', 'admin.bookings.refund', 'admin.bookings.offline_payment',
  'admin.bookings.extra_charge', 'admin.bookings.resend_email', 'admin.leads.activity', 'admin.checkouts.abandoned',
  'admin.notifications.settings', 'admin.notifications.update', 'admin.manual_quotes.list', 'admin.manual_quotes.view',
  'admin.manual_quotes.price', 'admin.manual_quotes.decline', 'admin.reports.summary', 'admin.reports.funnel', 'admin.reports.areas', 'admin.reports.export',
]);
function query<T extends z.ZodType>(request: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!result.success) throw new C.AppError('VALIDATION_ERROR', 'Check the filters and try again.');
  return result.data;
}
export async function handleAdminTools(input: { action: string; id: string | undefined; body: unknown; staff: StaffContext; requestId: string; request: Request }): Promise<unknown> {
  const { action, body, request, staff, requestId } = input;
  if (!supported.has(action)) return undefined;
  if (staff.role !== 'ADMIN' && staff.role !== 'OWNER') throw new C.AppError('FORBIDDEN', 'Admin access is required.');
  if (request.method !== 'GET' && request.headers.has('origin')) assertBrowserSessionOrigin(request);
  const actor = { userId: staff.userId, role: staff.role, requestId };
  if (action === 'admin.leads.activity') return readAdminBookingActivity(new URL(request.url).searchParams);
  if (action === 'admin.checkouts.abandoned') return readAdminAbandonedCheckouts(new URL(request.url).searchParams);
  if (action === 'admin.notifications.settings') return readAdminNotificationSettings(staff);
  if (action === 'admin.notifications.update') return updateAdminNotificationSettings(staff, C.AdminNotificationSettingsUpdateSchema.parse(body), requestId);
  if (action.startsWith('admin.reports.')) {
    const filters = query(request, C.AdminReportsQuerySchema);
    return action === 'admin.reports.export' ? exportAdminReports(filters) : readAdminReports(filters);
  }
  if (action === 'admin.manual_quotes.list') return quotes.listAdminManualQuotes(query(request, C.AdminManualQuoteQuerySchema));
  if (action === 'admin.bookings.create_context') return actions.readAdminBookingCreateContext();
  if (action === 'admin.quotes.create') {
    await enforceRateLimit(request, 'quote');
    const result = await createQuote(C.QuoteRequestSchema.parse(body));
    return C.AdminQuoteResponseSchema.parse(result.manualReasons.length > 0
      ? { manualQuote: { quotePublicId: result.quote.publicId, reasons: result.manualReasons } } : { quote: result.quote });
  }
  if (action === 'admin.bookings.create') {
    const result = await actions.createAdminPhoneBooking(C.AdminPhoneBookingCreateSchema.parse(body), actor);
    scheduleAdminBookingEdit(result.id, result.version);
    return result;
  }
  const id = input.id;
  if (!id) throw new C.AppError('NOT_FOUND', 'Record not found.');
  if (action === 'admin.manual_quotes.view') return quotes.readAdminManualQuote(id);
  if (action === 'admin.manual_quotes.price' || action === 'admin.manual_quotes.decline') {
    const result = action === 'admin.manual_quotes.price'
      ? await quotes.priceAdminManualQuote(id, C.AdminManualQuotePriceRequestSchema.parse(body), actor)
      : await quotes.declineAdminManualQuote(id, C.AdminManualQuoteDeclineRequestSchema.parse(body), actor);
    scheduleOutboxRoots({ prefix: `manual-quote:${id}:${result.updatedAt}:` });
    return result;
  }
  if (action === 'admin.bookings.actions_context') return actions.readAdminBookingActionsContext(id, actor);
  if (action === 'admin.bookings.cancel_preview') return actions.previewAdminBookingCancellation(id, C.AdminCancelPreviewRequestSchema.parse(body));
  const result = action === 'admin.bookings.cancel' ? await actions.cancelAdminBooking(id, C.AdminCancelApplySchema.parse(body), actor)
    : action === 'admin.bookings.refund' ? await actions.refundAdminBookingPayment(id, C.AdminPaymentRefundRequestSchema.parse(body), actor)
      : action === 'admin.bookings.offline_payment' ? await actions.recordAdminOfflinePayment(id, C.AdminOfflinePaymentRequestSchema.parse(body), actor)
        : action === 'admin.bookings.extra_charge' ? await actions.createAdminExtraCharge(id, C.AdminExtraChargeRequestSchema.parse(body), actor)
          : await actions.resendAdminBookingEmail(id, C.AdminResendEmailRequestSchema.parse(body), actor);
  scheduleAdminBookingEdit(result.id, result.version);
  return result;
}
