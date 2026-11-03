import { z } from 'zod';
import {
  AccessDetailSchema, AdminBookingRepriceChangesSchema, BreakdownLineSchema, ContactSchema,
  ServiceKeySchema,
} from './api';
import { PenceSchema } from './money';
import { IsoDateSchema } from './time';
import { SlotSchema } from './settings';

export const BookingPricingInputSchema = z.object({
  service: ServiceKeySchema, variant: z.string().min(1), distanceMiles: z.number().min(0).max(2000),
  pickup: z.object({ floor: z.number().int().min(0).max(30), hasLift: z.boolean() }).strict(),
  dropoff: z.object({ floor: z.number().int().min(0).max(30), hasLift: z.boolean() }).strict().nullable(),
  inventory: z.array(z.object({ itemId: z.string().min(1), name: z.string().min(1), quantity: z.number().int().min(1).max(500), unitVolumeM3: z.number().positive().max(20) }).strict()).max(200),
  access: z.object({ carryMetres: z.number().min(0).max(500), narrowAccess: z.boolean(), permitZone: z.boolean() }).strict(),
  addons: z.object({ helpers: z.number().int().min(0).max(3), packing: z.boolean(), assembly: z.boolean() }).strict(),
}).strict();
export const BookingAccessDetailSchema = z.object({ pickup: AccessDetailSchema, dropoff: AccessDetailSchema.nullable() }).strict();
export const BookingSlotMultipliersSchema = z.object({ urgency: z.number().positive(), weekend: z.number().positive(), peakMonth: z.number().positive(), endOfMonth: z.number().positive(), slot: z.number().positive() }).strict();
export const BookingStaticBreakdownSchema = z.object({
  basePence: PenceSchema, variantMultiplier: z.number().nonnegative(), baseAfterVariantPence: PenceSchema,
  distance: z.object({ miles: z.number().nonnegative(), billableMiles: z.number().nonnegative(), fullRateMiles: z.number().nonnegative(), discountedMiles: z.number().nonnegative(), mode: z.enum(['STANDARD', 'LARGE_INVENTORY']), pence: PenceSchema }).strict(),
  floors: z.object({ pickupPence: PenceSchema, dropoffPence: PenceSchema }).strict(),
  inventory: z.object({ itemCount: z.number().int().nonnegative(), volumeM3: z.number().nonnegative(), mode: z.enum(['STANDARD', 'LARGE']), pence: PenceSchema }).strict(),
  access: z.object({ carryPence: PenceSchema, narrowPence: PenceSchema, permitPence: PenceSchema, pence: PenceSchema }).strict(),
  addons: z.object({ helpersPence: PenceSchema, packingPence: PenceSchema, assemblyPence: PenceSchema, pence: PenceSchema }).strict(),
  staticSubtotalPence: PenceSchema,
}).strict();
export const BookingStoredPriceSchema = z.object({
  breakdown: BookingStaticBreakdownSchema,
  slot: z.object({ date: IsoDateSchema, multipliers: BookingSlotMultipliersSchema, slot: SlotSchema }).strict(),
  coupon: z.object({ listPricePence: PenceSchema }).strict().optional(),
}).strict();
export const AdminBookingMutationResponseSchema = z.object({ ok: z.literal(true), id: z.string().min(1), version: z.number().int().nonnegative() }).strict();
export const AdminBookingRepricePreviewSchema = z.object({
  id: z.string().min(1), expectedVersion: z.number().int().nonnegative(), currentTotalPence: PenceSchema,
  newTotalPence: PenceSchema, differencePence: z.number().int(), oldBreakdownLines: z.array(BreakdownLineSchema), newBreakdownLines: z.array(BreakdownLineSchema),
  settle: z.enum(['EXTRA_CHARGE', 'REFUND', 'NONE']), settlementAmountPence: PenceSchema,
}).strict().refine((value) => value.differencePence === value.newTotalPence - value.currentTotalPence, { message: 'Price difference must match the totals.', path: ['differencePence'] }).refine((value) => (value.settle === 'NONE') === (value.settlementAmountPence === 0), { message: 'Settlement amount must match its action.', path: ['settlementAmountPence'] });
export const AdminBookingEditContextSchema = z.object({
  id: z.string().min(1), version: z.number().int().nonnegative(), contact: ContactSchema, notes: z.string().nullable(), vanId: z.string().nullable(),
  changes: AdminBookingRepriceChangesSchema.nullable(), currentTotalPence: PenceSchema,
  editable: z.boolean(), reason: z.string().nullable(), repriceEditable: z.boolean(), repriceReason: z.string().nullable(),
  services: z.array(z.object({ key: ServiceKeySchema, label: z.string(), requiresDropoff: z.boolean(), variants: z.array(z.object({ key: z.string(), label: z.string(), manualQuote: z.boolean() }).strict()) }).strict()),
}).strict();
export type AdminBookingMutationResponse = z.infer<typeof AdminBookingMutationResponseSchema>;
export type AdminBookingRepricePreview = z.infer<typeof AdminBookingRepricePreviewSchema>;
export type AdminBookingEditContext = z.infer<typeof AdminBookingEditContextSchema>;

const RateSchema = z.object({ freeMiles: z.number().nonnegative(), perMile: z.number().nonnegative(), discountAfterBillableMiles: z.number().nonnegative(), discountMultiplier: z.number().min(0.5).max(3) }).strict();
const MultiplierSchema = z.number().min(0.5).max(3);
export const BookingPricingConfigSchema = z.object({
  schemaVersion: z.literal(1),
  services: z.record(ServiceKeySchema, z.object({ label: z.string(), basePrice: z.number().nonnegative(), requiresDropoff: z.boolean(), variants: z.array(z.object({ key: z.string().min(1), label: z.string(), multiplier: MultiplierSchema, manualQuote: z.boolean() }).strict()).min(1) }).strict()),
  distance: RateSchema,
  largeInventory: z.object({ minItemsExclusive: z.number().nonnegative(), minVolumeM3: z.number().nonnegative(), inventory: z.object({ minimum: z.number().nonnegative(), perItem: z.number().nonnegative(), perM3: z.number().nonnegative() }).strict(), distance: RateSchema.nullable() }).strict(),
  floors: z.object({ perFloor: z.number().nonnegative(), noLiftMultiplier: MultiplierSchema }).strict(),
  inventory: z.object({ perItem: z.number().nonnegative(), perM3: z.number().nonnegative() }).strict(),
  access: z.object({ freeCarryMetres: z.number().nonnegative(), perMetreAfterFree: z.number().nonnegative(), narrowAccess: z.number().nonnegative(), permitZone: z.number().nonnegative() }).strict(),
  addons: z.object({ helper: z.number().nonnegative(), packing: z.number().nonnegative(), assembly: z.number().nonnegative(), maxHelpers: z.number().int().min(0).max(10) }).strict(),
  customItemSizes: z.object({ S: z.number().positive().max(20), M: z.number().positive().max(20), L: z.number().positive().max(20), XL: z.number().positive().max(20) }).strict(),
  multipliers: z.object({ urgency: z.object({ dayOffset0: MultiplierSchema, dayOffset1: MultiplierSchema, dayOffset2: MultiplierSchema }).strict(), weekend: MultiplierSchema, peakMonths: z.array(z.number().int().min(1).max(12)), peakMonth: MultiplierSchema, endOfMonthLastDays: z.number().int().min(0).max(10), endOfMonth: MultiplierSchema, slot: z.object({ MORNING: MultiplierSchema, AFTERNOON: MultiplierSchema, EVENING: MultiplierSchema }).strict() }).strict(),
  calendarDays: z.number().int().min(7).max(60),
}).strict();
