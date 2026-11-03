import 'server-only';
import {
  AddressSchema, AdminBookingRepriceChangesSchema, AppError, BookingAccessDetailSchema,
  BookingPricingConfigSchema, BookingPricingInputSchema, BookingStoredPriceSchema, ItemLineInputSchema, fromDbDate, londonToday,
} from '@sv/contracts';
import { prisma, type Prisma } from '@sv/db';
import { computeStaticBreakdown, PricingError, SERVICE_KEYS, slotPricePence, validateConfig, type InventoryLine, type PricingConfig, type PricingInput } from '@sv/pricing';
import type { z } from 'zod';
import { routeBetween, type RouteResult } from '../mapbox';
import { getOperationsSettings } from '../settings';
import { assertServiceArea, buildPricingInput, snapshotInventory } from '../services/quote';
import { jobSize } from '../services/job-size';

export const bookingEditSelect = {
  id: true, reference: true, status: true, jobStage: true, deletedAt: true, version: true,
  contactName: true, contactEmail: true, contactPhone: true, adminNotes: true, vanId: true, driverId: true,
  service: true, variant: true, pickup: true, dropoff: true, pricingInput: true, priceBreakdown: true, accessDetail: true,
  pricingVersionId: true, pricingVersion: { select: { config: true } }, couponId: true,
  totalPence: true, paidPence: true, refundedPence: true, moveDate: true, slot: true,
  distanceMiles: true, durationMinutes: true, routeGeometry: true, capacityUnits: true, blocksSlots: true,
} as const satisfies Prisma.BookingSelect;
export type EditableBooking = Prisma.BookingGetPayload<{ select: typeof bookingEditSelect }>;
export type BookingRepriceChanges = z.infer<typeof AdminBookingRepriceChangesSchema>;

export function parseBookingPricingInput(value: unknown): PricingInput {
  const parsed = BookingPricingInputSchema.safeParse(value);
  if (!parsed.success) throw new AppError('CONFLICT', 'This booking has an incomplete pricing snapshot. Its price needs review before it can be changed.');
  return parsed.data;
}
export function parseBookingPricingConfig(value: unknown): PricingConfig {
  let candidate = value;
  if (value && typeof value === 'object' && !Array.isArray(value) && 'services' in value) {
    const savedServices = value.services;
    if (savedServices && typeof savedServices === 'object' && !Array.isArray(savedServices)
      && Object.hasOwn(savedServices, 'rubbish') && SERVICE_KEYS.every((key) => Object.hasOwn(savedServices, key))) {
      // Older stored configs retained this retired service, which the pricing engine never uses.
      // Preserve every supported setting and keep strict validation for all other unknown keys.
      const services: Record<string, unknown> = { ...savedServices };
      delete services.rubbish;
      candidate = { ...value, services };
    }
  }
  const parsed = BookingPricingConfigSchema.safeParse(candidate);
  if (!parsed.success || validateConfig(parsed.data).length > 0) throw new AppError('CONFLICT', 'The saved pricing version needs review before this booking can be repriced.');
  return parsed.data;
}
export function assertBookingEditVersion(booking: EditableBooking, expectedVersion: number): void {
  if (booking.version !== expectedVersion) throw new AppError('CONFLICT', 'This booking changed while you were editing. Reload to see the latest.');
}
export function bookingDetailsEditReason(booking: Pick<EditableBooking, 'deletedAt' | 'status'>): string | null {
  if (booking.deletedAt) return 'Restore this booking to the list before editing it.';
  if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') return 'A cancelled or expired booking cannot be edited.';
  return null;
}
export function assertBookingRepriceAllowed(booking: EditableBooking): void {
  const reason = bookingDetailsEditReason(booking);
  if (reason) throw new AppError('CONFLICT', reason);
  if (booking.status !== 'CONFIRMED' || booking.jobStage !== 'NOT_STARTED') throw new AppError('CONFLICT', 'Only a confirmed move that has not started can be repriced.');
  if (booking.couponId) throw new AppError('CONFLICT', 'This booking has a fixed coupon price. Review its agreed price before changing the move.');
}
export function bookingChangesFromSnapshot(booking: EditableBooking): BookingRepriceChanges {
  const input = parseBookingPricingInput(booking.pricingInput);
  const access = BookingAccessDetailSchema.safeParse(booking.accessDetail);
  if (!access.success) throw new AppError('CONFLICT', 'This booking has incomplete access details. Review its original record before changing the move.');
  const items = input.inventory.map((line) => {
    const customSize = /^custom:(S|M|L|XL):/.exec(line.itemId)?.[1];
    if (line.itemId.startsWith('custom:') && !customSize) throw new AppError('CONFLICT', 'A custom item has no saved size. Review the original item before changing this move.');
    return ItemLineInputSchema.parse(customSize ? { kind: 'custom', name: line.name, size: customSize, quantity: line.quantity } : { kind: 'catalogue', itemSlug: line.itemId, quantity: line.quantity });
  });
  const parsed = AdminBookingRepriceChangesSchema.safeParse({
    service: input.service, variant: input.variant, pickup: booking.pickup, dropoff: booking.dropoff,
    pickupAccess: access.data.pickup, dropoffAccess: access.data.dropoff, items, addons: input.addons,
  });
  if (!parsed.success) throw new AppError('CONFLICT', 'This booking has incomplete move details. Review its original record before changing the move.');
  return parsed.data;
}
function itemId(item: BookingRepriceChanges['items'][number]): string {
  return item.kind === 'catalogue' ? item.itemSlug : `custom:${item.size}:${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}
async function editInventory(changes: BookingRepriceChanges, original: PricingInput, config: PricingConfig): Promise<InventoryLine[]> {
  const oldById = new Map(original.inventory.map((line) => [line.itemId, line]));
  const added = changes.items.filter((item) => !oldById.has(itemId(item)));
  const newLines = await snapshotInventory({ ...changes, items: added }, config.customItemSizes);
  const byId = new Map([...oldById, ...newLines.map((line) => [line.itemId, line] as const)]);
  return changes.items.map((item) => {
    const saved = byId.get(itemId(item));
    if (!saved) throw new AppError('VALIDATION_ERROR', 'An item could not be priced. Choose it again from the catalogue.');
    return { ...saved, quantity: item.quantity };
  });
}
export function assertBookingRepriceSnapshot(booking: EditableBooking): z.infer<typeof BookingStoredPriceSchema> {
  const original = parseBookingPricingInput(booking.pricingInput);
  const config = parseBookingPricingConfig(booking.pricingVersion.config);
  const stored = BookingStoredPriceSchema.safeParse(booking.priceBreakdown);
  if (!stored.success) throw new AppError('CONFLICT', 'This booking has no complete saved price breakdown. Review its agreed price before repricing.');
  try {
    const total = slotPricePence(computeStaticBreakdown(original, config).staticSubtotalPence, stored.data.slot.multipliers);
    if (total !== booking.totalPence) throw new AppError('CONFLICT', 'This booking includes a separately agreed price or adjustment. Review it before repricing the move.');
  } catch (error) {
    if (error instanceof PricingError) throw new AppError('CONFLICT', 'The saved pricing inputs need review before this booking can be repriced.');
    throw error;
  }
  return stored.data;
}
export async function calculateAdminBookingReprice(booking: EditableBooking, changes: BookingRepriceChanges, now = new Date()): Promise<{
  input: PricingInput; price: z.infer<typeof BookingStoredPriceSchema>; oldPrice: z.infer<typeof BookingStoredPriceSchema>;
  totalPence: number; route: RouteResult; size: { blocksSlots: number; capacityUnits: number };
}> {
  assertBookingRepriceAllowed(booking);
  if (changes.service === 'same-day' && fromDbDate(booking.moveDate) !== londonToday(now)) throw new AppError('VALIDATION_ERROR', 'The same-day service can only be used for a move taking place today. Change the date or choose another service.');
  const original = parseBookingPricingInput(booking.pricingInput);
  const config = parseBookingPricingConfig(booking.pricingVersion.config);
  const stored = assertBookingRepriceSnapshot(booking);
  const operations = await getOperationsSettings();
  assertServiceArea(changes, operations);
  const variant = config.services[changes.service].variants.find((item) => item.key === changes.variant);
  if (!variant) throw new AppError('VALIDATION_ERROR', 'Choose a variant from the saved booking pricing version.');
  if (variant.manualQuote) throw new AppError('MANUAL_QUOTE_REQUIRED', 'This move needs an individually agreed quote.');
  const currentPickup = AddressSchema.parse(booking.pickup);
  const currentDropoff = booking.dropoff === null ? null : AddressSchema.parse(booking.dropoff);
  const sameRoute = JSON.stringify(currentPickup) === JSON.stringify(changes.pickup) && JSON.stringify(currentDropoff) === JSON.stringify(changes.dropoff);
  const route = sameRoute
    ? { distanceMiles: booking.distanceMiles, durationMinutes: booking.durationMinutes, geometry: booking.routeGeometry ?? '', ferry: false }
    : await routeBetween(changes.pickup, changes.dropoff);
  if (route.ferry || route.distanceMiles > operations.maxInstantDistanceMiles) throw new AppError('MANUAL_QUOTE_REQUIRED', 'This route needs an individually agreed quote.');
  const inventory = await editInventory(changes, original, config);
  const input = buildPricingInput(changes, inventory, route);
  try {
    const breakdown = computeStaticBreakdown(input, config);
    const totalPence = slotPricePence(breakdown.staticSubtotalPence, stored.slot.multipliers);
    const volumeUnchanged = breakdown.inventory.volumeM3 === stored.breakdown.inventory.volumeM3;
    return { input, price: { breakdown, slot: stored.slot }, oldPrice: stored, totalPence, route,
      size: volumeUnchanged ? { blocksSlots: booking.blocksSlots, capacityUnits: booking.capacityUnits } : jobSize(breakdown.inventory.volumeM3, operations) };
  } catch (error) {
    if (error instanceof PricingError) throw new AppError('VALIDATION_ERROR', error.message, { pricingCode: error.code });
    throw error;
  }
}
export async function readEditableBooking(id: string): Promise<EditableBooking> {
  const booking = await prisma.booking.findUnique({ where: { id }, select: bookingEditSelect });
  if (!booking) throw new AppError('NOT_FOUND', 'Booking not found.');
  return booking;
}
