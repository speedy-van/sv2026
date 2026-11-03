import { z } from 'zod';
import { AdminCancelSchema, AdminPhoneBookingSchema, BookingStatusSchema, ContactSchema, ExpectedVersionSchema, IsoTimestampSchema, LimitSchema, ManualQuotePriceSchema, ManualQuoteReasonSchema, QuoteDtoSchema, ServiceKeySchema, UuidSchema } from './api';
import { AdminBookingEditContextSchema, BookingAccessDetailSchema, BookingPricingInputSchema } from './admin-booking-edit';
import { PenceSchema } from './money';
import { IsoDateSchema } from './time';
import { SlotSchema } from './settings';

export const AdminPhoneBookingCreateSchema = AdminPhoneBookingSchema.extend({ expectedTotalPence: PenceSchema, idempotencyKey: UuidSchema }).strict();
export const AdminPhoneBookingResponseSchema = z.object({ ok: z.literal(true), id: z.string(), version: z.number().int(), reference: z.string(), status: BookingStatusSchema, totalPence: PenceSchema, paymentUrl: z.url().nullable() }).strict();
export const AdminBookingCreateContextSchema = z.object({ services: AdminBookingEditContextSchema.shape.services, ready: z.boolean(), reason: z.string().nullable() }).strict();
export const AdminQuoteResponseSchema = z.union([z.object({ quote: QuoteDtoSchema }).strict(), z.object({ manualQuote: z.object({ quotePublicId: z.string(), reasons: z.array(ManualQuoteReasonSchema) }).strict() }).strict()]);
export const AdminCancelPreviewRequestSchema = AdminCancelSchema;
export const AdminCancelApplySchema = AdminCancelSchema.extend({ expectedRefundPence: PenceSchema }).strict();
export const AdminCancelPreviewResponseSchema = z.object({ id: z.string(), expectedVersion: z.number().int(), refundPence: PenceSchema, paidNetPence: PenceSchema, policySummary: z.string(), willUnassignDriver: z.boolean() }).strict();
export const AdminPaymentRefundRequestSchema = ExpectedVersionSchema.extend({ paymentId: z.string().min(1), amountPence: PenceSchema.positive(), reason: z.string().trim().min(1).max(500) }).strict();
export const AdminOfflinePaymentRequestSchema = ExpectedVersionSchema.extend({ amountPence: PenceSchema.positive(), reference: z.string().trim().min(1).max(120), paidAt: IsoTimestampSchema }).strict();
export const AdminExtraChargeRequestSchema = ExpectedVersionSchema.extend({ amountPence: PenceSchema.positive(), description: z.string().trim().min(1).max(200) }).strict();
export const AdminResendEmailRequestSchema = ExpectedVersionSchema.extend({ template: z.enum(['CONFIRMATION', 'PAYMENT_LINK', 'MANAGE_LINK']) }).strict();
const CapabilitySchema = z.object({ allowed: z.boolean(), reason: z.string().nullable() }).strict();
export const AdminBookingActionsContextSchema = z.object({
  id: z.string(), version: z.number().int(), status: BookingStatusSchema, totalPence: PenceSchema, paidPence: PenceSchema, refundedPence: PenceSchema, balancePence: PenceSchema,
  cancellation: CapabilitySchema, refund: CapabilitySchema, offlinePayment: CapabilitySchema, extraCharge: CapabilitySchema,
  payments: z.array(z.object({ id: z.string(), method: z.enum(['STRIPE','OFFLINE']), status: z.string(), amountPence: PenceSchema, refundablePence: PenceSchema, createdAt: IsoTimestampSchema }).strict()),
}).strict();
export const AdminManualQuoteStatusSchema = z.enum(['REQUESTED','PRICED','ACCEPTED','DECLINED','EXPIRED']);
export const AdminManualQuoteQuerySchema = z.object({ status: AdminManualQuoteStatusSchema.optional(), cursor: z.string().min(1).optional(), limit: LimitSchema }).strict();
export const AdminManualQuoteDetailSchema = z.object({ id: z.string(), updatedAt: IsoTimestampSchema, createdAt: IsoTimestampSchema, status: AdminManualQuoteStatusSchema, contact: ContactSchema, service: ServiceKeySchema, variant: z.string(), pickupLabel: z.string(), dropoffLabel: z.string().nullable(), preferredDate: IsoDateSchema.nullable(), preferredSlot: SlotSchema.nullable(), details: z.string().nullable(), reasons: z.array(z.string()), pricePence: PenceSchema.nullable(), adminMessage: z.string().nullable(), validUntil: IsoTimestampSchema.nullable(), bookingId: z.string().nullable(), pricingInput: BookingPricingInputSchema.nullable(), accessDetail: BookingAccessDetailSchema.nullable(), distanceMiles: z.number().nonnegative(), durationMinutes: z.number().nonnegative() }).strict();
export const AdminManualQuoteListSchema = z.object({ items: z.array(AdminManualQuoteDetailSchema), nextCursor: z.string().nullable() }).strict();
export const AdminManualQuotePriceRequestSchema = ManualQuotePriceSchema.extend({ pricePence: PenceSchema.positive(), expectedUpdatedAt: IsoTimestampSchema }).strict();
export const AdminManualQuoteDeclineRequestSchema = z.object({ expectedUpdatedAt: IsoTimestampSchema, message: z.string().trim().min(1).max(1000) }).strict();
export const AdminManualQuoteMutationResponseSchema = z.object({ ok: z.literal(true), id: z.string(), updatedAt: IsoTimestampSchema }).strict();
export const AdminReportsQuerySchema = z.object({ from: IsoDateSchema, to: IsoDateSchema }).strict().refine(({ from, to }) => to >= from && Date.parse(to) - Date.parse(from) <= 365 * 86_400_000, { message: 'Choose a date range of up to 366 days.', path: ['to'] });
const ReportGroupSchema = z.object({ label: z.string(), bookings: z.number().int().nonnegative(), totalPence: PenceSchema }).strict();
export const AdminReportsResponseSchema = z.object({ from: IsoDateSchema, to: IsoDateSchema, dateBasis: z.literal('BOOKING_CREATED_AT'), bookings: z.number().int().nonnegative(), confirmed: z.number().int().nonnegative(), pending: z.number().int().nonnegative(), cancelled: z.number().int().nonnegative(), completed: z.number().int().nonnegative(), totalPence: PenceSchema, paidPence: PenceSchema, refundedPence: PenceSchema, netPaidPence: PenceSchema, quotes: z.number().int().nonnegative(), manualQuotes: z.number().int().nonnegative(), byService: z.array(ReportGroupSchema), bySource: z.array(ReportGroupSchema), topTowns: z.array(ReportGroupSchema) }).strict();
export const AdminReportExportResponseSchema = z.object({ filename: z.string(), contentType: z.literal('text/csv;charset=utf-8'), content: z.string() }).strict();
export type AdminPhoneBookingCreate = z.infer<typeof AdminPhoneBookingCreateSchema>;
export type AdminPhoneBookingResponse = z.infer<typeof AdminPhoneBookingResponseSchema>;
export type AdminBookingActionsContext = z.infer<typeof AdminBookingActionsContextSchema>;
export type AdminCancelPreviewRequest = z.infer<typeof AdminCancelPreviewRequestSchema>;
export type AdminCancelApply = z.infer<typeof AdminCancelApplySchema>;
export type AdminCancelPreviewResponse = z.infer<typeof AdminCancelPreviewResponseSchema>;
export type AdminPaymentRefundRequest = z.infer<typeof AdminPaymentRefundRequestSchema>;
export type AdminOfflinePaymentRequest = z.infer<typeof AdminOfflinePaymentRequestSchema>;
export type AdminExtraChargeRequest = z.infer<typeof AdminExtraChargeRequestSchema>;
export type AdminResendEmailRequest = z.infer<typeof AdminResendEmailRequestSchema>;
export type AdminManualQuoteQuery = z.infer<typeof AdminManualQuoteQuerySchema>;
export type AdminManualQuoteDetail = z.infer<typeof AdminManualQuoteDetailSchema>;
export type AdminManualQuotePriceRequest = z.infer<typeof AdminManualQuotePriceRequestSchema>;
export type AdminManualQuoteDeclineRequest = z.infer<typeof AdminManualQuoteDeclineRequestSchema>;
export type AdminReportsQuery = z.infer<typeof AdminReportsQuerySchema>;
