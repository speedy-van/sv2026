import 'server-only';
import type { z } from 'zod';
import { AddressSchema, AdminManualQuoteDetailSchema, AdminManualQuoteListSchema, AdminManualQuoteMutationResponseSchema, AppError, BookingAccessDetailSchema, BookingPricingInputSchema, fromDbDate, londonToday, type AdminManualQuoteQuery, type AdminManualQuotePriceRequest, type AdminManualQuoteDeclineRequest } from '@sv/contracts';
import { assertSlotCapacity, enqueueOutbox, prisma, type DbTx, type Prisma } from '@sv/db';
import type { AdminBookingEditActor } from './booking-edit';
import { getOperationsSettings } from '../settings';
import { londonDateTimeToUtc } from '../london-time';

const quoteInclude = { quote: true } as const satisfies Prisma.ManualQuoteInclude;
type Manual = Prisma.ManualQuoteGetPayload<{ include: typeof quoteInclude }>;
function dto(manual: Manual) {
  return AdminManualQuoteDetailSchema.parse({ id: manual.id, updatedAt: manual.updatedAt.toISOString(), createdAt: manual.createdAt.toISOString(), status: manual.status,
    contact: { name: manual.contactName, email: manual.contactEmail, phone: manual.contactPhone }, service: manual.quote.service, variant: manual.quote.variant,
    pickupLabel: AddressSchema.parse(manual.quote.pickup).label, dropoffLabel: manual.quote.dropoff ? AddressSchema.parse(manual.quote.dropoff).label : null,
    preferredDate: manual.preferredDate ? fromDbDate(manual.preferredDate) : null, preferredSlot: manual.preferredSlot, details: manual.details, reasons: manual.reasons,
    pricePence: manual.pricePence, adminMessage: manual.adminMessage, validUntil: manual.validUntil?.toISOString() ?? null, bookingId: manual.bookingId,
    pricingInput: BookingPricingInputSchema.safeParse(manual.quote.input).data ?? null, accessDetail: BookingAccessDetailSchema.safeParse(manual.quote.accessDetail).data ?? null,
    distanceMiles: manual.quote.distanceMiles, durationMinutes: manual.quote.durationMinutes });
}
async function load(tx: DbTx, id: string) { const manual = await tx.manualQuote.findUnique({ where: { id }, include: quoteInclude }); if (!manual) throw new AppError('NOT_FOUND', 'Manual quote not found.'); return manual; }
function assertEditable(manual: Manual, expectedUpdatedAt: string): void {
  if (manual.updatedAt.toISOString() !== expectedUpdatedAt) throw new AppError('CONFLICT', 'This quote changed. Refresh it before editing.');
  if (manual.bookingId || !['REQUESTED','PRICED'].includes(manual.status)) throw new AppError('CONFLICT', 'Only unbooked requested or priced quotes can be changed.');
}
function transactionError(error: unknown): never {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') throw new AppError('CONFLICT', 'This quote changed. Refresh it before editing.');
  throw error;
}
export async function listAdminManualQuotes(query: AdminManualQuoteQuery): Promise<z.infer<typeof AdminManualQuoteListSchema>> {
  const rows = await prisma.manualQuote.findMany({ where: { ...(query.status ? { status: query.status } : {}), ...(query.cursor ? { id: { lt: query.cursor } } : {}) }, orderBy: { id: 'desc' }, take: query.limit + 1, include: quoteInclude });
  return AdminManualQuoteListSchema.parse({ items: rows.slice(0, query.limit).map(dto), nextCursor: rows.length > query.limit ? rows[query.limit - 1]?.id ?? null : null });
}
export async function readAdminManualQuote(id: string): Promise<z.infer<typeof AdminManualQuoteDetailSchema>> { return dto(await load(prisma, id)); }
export async function priceAdminManualQuote(id: string, input: AdminManualQuotePriceRequest, actor: AdminBookingEditActor, now = new Date()): Promise<z.infer<typeof AdminManualQuoteMutationResponseSchema>> {
  const operations = await getOperationsSettings();
  const cutoff = new Date(londonDateTimeToUtc(input.date, operations.slotWindows[input.slot].start).getTime() - operations.minLeadMinutes * 60_000);
  if (operations.bookingPaused || input.date < londonToday(now) || now >= cutoff) throw new AppError('CONFLICT', 'Choose an available future period before its booking cutoff.');
  const validUntil = new Date(Math.min(now.getTime() + input.validForHours * 3_600_000, cutoff.getTime()));
  try { return await prisma.$transaction(async (tx) => {
    const manual = await load(tx, id); assertEditable(manual, input.expectedUpdatedAt);
    if (manual.quote.service === 'same-day' && input.date !== londonToday(now)) throw new AppError('CONFLICT', 'Same-day moves must be scheduled for today.');
    await assertSlotCapacity(tx, { moveDate: new Date(`${input.date}T00:00:00.000Z`), slot: input.slot, capacityUnits: manual.quote.capacityUnits, blocksSlots: manual.quote.blocksSlots, now });
    const updatedAt = new Date(Math.max(now.getTime(), manual.updatedAt.getTime() + 1));
    const updated = await tx.manualQuote.updateMany({ where: { id, updatedAt: manual.updatedAt, bookingId: null, status: manual.status }, data: { status: 'PRICED', pricePence: input.pricePence, preferredDate: new Date(`${input.date}T00:00:00.000Z`), preferredSlot: input.slot, adminMessage: input.message, pricedById: actor.userId, pricedAt: now, validUntil, updatedAt } });
    if (updated.count !== 1) throw new AppError('CONFLICT', 'This quote changed. Refresh it before editing.');
    await tx.auditLog.create({ data: { action: 'admin.manual-quotes.price', actorType: 'USER', actorUserId: actor.userId, requestId: actor.requestId, entityType: 'manualQuote', entityId: id, reason: input.message,
      before: { status: manual.status, pricePence: manual.pricePence, updatedAt: input.expectedUpdatedAt }, after: { pricePence: input.pricePence, date: input.date, slot: input.slot, validUntil: validUntil.toISOString(), updatedAt: updatedAt.toISOString() } } });
    await enqueueOutbox(tx, 'manual_quote.priced', { manualQuoteId: id, expectedUpdatedAt: updatedAt.toISOString() }, `manual-quote:${id}:${updatedAt.toISOString()}:priced`);
    return AdminManualQuoteMutationResponseSchema.parse({ ok: true, id, updatedAt: updatedAt.toISOString() });
  }, { isolationLevel: 'Serializable' }); } catch (error) { return transactionError(error); }
}
export async function declineAdminManualQuote(id: string, input: AdminManualQuoteDeclineRequest, actor: AdminBookingEditActor, now = new Date()): Promise<z.infer<typeof AdminManualQuoteMutationResponseSchema>> {
  try { return await prisma.$transaction(async (tx) => {
    const manual = await load(tx, id); assertEditable(manual, input.expectedUpdatedAt);
    const updatedAt = new Date(Math.max(now.getTime(), manual.updatedAt.getTime() + 1));
    const updated = await tx.manualQuote.updateMany({ where: { id, updatedAt: manual.updatedAt, bookingId: null, status: manual.status }, data: { status: 'DECLINED', adminMessage: input.message, validUntil: null, updatedAt } });
    if (updated.count !== 1) throw new AppError('CONFLICT', 'This quote changed. Refresh it before editing.');
    await tx.auditLog.create({ data: { action: 'admin.manual-quotes.decline', actorType: 'USER', actorUserId: actor.userId, requestId: actor.requestId, entityType: 'manualQuote', entityId: id, reason: input.message, before: { status: manual.status, updatedAt: input.expectedUpdatedAt }, after: { status: 'DECLINED', updatedAt: updatedAt.toISOString() } } });
    await enqueueOutbox(tx, 'manual_quote.declined', { manualQuoteId: id, expectedUpdatedAt: updatedAt.toISOString() }, `manual-quote:${id}:${updatedAt.toISOString()}:declined`);
    return AdminManualQuoteMutationResponseSchema.parse({ ok: true, id, updatedAt: updatedAt.toISOString() });
  }, { isolationLevel: 'Serializable' }); } catch (error) { return transactionError(error); }
}
