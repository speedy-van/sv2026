import { DEFAULT_PRICING_CONFIG, SERVICE_KEYS, SLOT_KEYS } from '@sv/pricing';
import { z } from 'zod';
import { UkPostcodeSchema } from './address';
import { BOOKING_STATUSES, DISPATCH_STATUSES, JOB_STAGES } from './booking-state';
import { ApiErrorCodeSchema, ErrorEnvelopeSchema } from './errors';
import { PenceSchema } from './money';
import { SlotSchema } from './settings';
import { IsoDateSchema } from './time';

export const ServiceKeySchema = z.enum(SERVICE_KEYS);
export const BookingStatusSchema = z.enum(BOOKING_STATUSES);
export const DispatchStatusSchema = z.enum(DISPATCH_STATUSES);
export const JobStageSchema = z.enum(JOB_STAGES);
export const UuidSchema = z.uuid();
export const PublicIdSchema = z.string().trim().min(6).max(80);
export const CursorSchema = z.string().trim().min(1).max(300);
export const LimitSchema = z.coerce.number().int().min(1).max(100).default(25);
export const IsoTimestampSchema = z.iso.datetime();
export const EmailSchema = z.string().trim().toLowerCase().max(160).pipe(z.email());
export const UrlSchema = z.string().trim().pipe(z.url());

export const PaginationQuerySchema = z
  .object({
    cursor: CursorSchema.optional(),
    limit: LimitSchema,
  })
  .strict();

export function PageSchema<T extends z.ZodType>(itemSchema: T): z.ZodObject<{ items: z.ZodArray<T>; nextCursor: z.ZodNullable<z.ZodString> }> {
  return z
    .object({
      items: z.array(itemSchema),
      nextCursor: z.string().nullable(),
    })
    .strict();
}

export const UkPhoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s()-]{6,24}$/)
  .transform((value) => value.replace(/[()\s-]/g, ''));

export const ContactSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: EmailSchema,
    phone: UkPhoneSchema,
  })
  .strict();

export const AttributionSchema = z
  .object({
    landingPath: z.string().trim().max(300).optional(),
    referrer: z.string().trim().max(500).optional(),
    gclid: z.string().trim().max(160).optional(),
    utmSource: z.string().trim().max(120).optional(),
    utmMedium: z.string().trim().max(120).optional(),
    utmCampaign: z.string().trim().max(120).optional(),
    utmTerm: z.string().trim().max(120).optional(),
    utmContent: z.string().trim().max(120).optional(),
  })
  .strict();

export const AddressSchema = z
  .object({
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().max(120).optional(),
    flat: z.string().trim().max(40).optional(),
    town: z.string().trim().min(1).max(80),
    postcode: UkPostcodeSchema,
    lat: z.number().min(49.8).max(60.9),
    lng: z.number().min(-8.7).max(1.8),
    label: z.string().trim().max(240),
    source: z.enum(['MAPBOX', 'MANUAL']),
    mapboxId: z.string().trim().max(200).optional(),
  })
  .strict();

export const AddressSummarySchema = AddressSchema.pick({
  flat: true,
  label: true,
  lat: true,
  line1: true,
  lng: true,
  postcode: true,
  town: true,
});

export const AccessDetailSchema = z
  .object({
    floorChoice: z.enum(['BASEMENT', 'GROUND', 'FLOOR']),
    floorNumber: z.number().int().min(1).max(30).optional(),
    hasLift: z.boolean(),
    carryMetres: z.number().int().min(0).max(500),
    narrowAccess: z.boolean(),
    permitZone: z.boolean(),
    notes: z.string().trim().max(300).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.floorChoice === 'FLOOR' && value.floorNumber === undefined) {
      ctx.addIssue({ code: 'custom', message: 'floorNumber is required when floorChoice is FLOOR', path: ['floorNumber'] });
    }
    if (value.floorChoice !== 'FLOOR' && value.floorNumber !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'floorNumber is only valid when floorChoice is FLOOR', path: ['floorNumber'] });
    }
  });

export const ItemLineInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('catalogue'),
      itemSlug: z.string().trim().min(1).max(80),
      quantity: z.number().int().min(1).max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal('custom'),
      name: z.string().trim().min(2).max(60),
      size: z.enum(['S', 'M', 'L', 'XL']),
      quantity: z.number().int().min(1).max(50),
    })
    .strict(),
]);

export const QuoteRequestSchema = z
  .object({
    service: ServiceKeySchema,
    variant: z.string().trim().min(1).max(40),
    pickup: AddressSchema,
    dropoff: AddressSchema.nullable(),
    pickupAccess: AccessDetailSchema,
    dropoffAccess: AccessDetailSchema.nullable(),
    items: z.array(ItemLineInputSchema).max(200),
    addons: z
      .object({
        helpers: z.number().int().min(0).max(3),
        packing: z.boolean(),
        assembly: z.boolean(),
      })
      .strict(),
    attribution: AttributionSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const service = DEFAULT_PRICING_CONFIG.services[value.service];
    if (service.requiresDropoff && value.dropoff === null) {
      ctx.addIssue({ code: 'custom', message: 'dropoff is required for this service', path: ['dropoff'] });
    }
    if (service.requiresDropoff && value.dropoffAccess === null) {
      ctx.addIssue({ code: 'custom', message: 'dropoffAccess is required for this service', path: ['dropoffAccess'] });
    }
    if (!service.requiresDropoff && value.dropoff !== null) {
      ctx.addIssue({ code: 'custom', message: 'dropoff is not allowed for this service', path: ['dropoff'] });
    }
    if (!service.requiresDropoff && value.dropoffAccess !== null) {
      ctx.addIssue({ code: 'custom', message: 'dropoffAccess is not allowed for this service', path: ['dropoffAccess'] });
    }
  });

export const AvailabilityReasonSchema = z.enum(['FULL', 'PAST_CUTOFF', 'CLOSED', 'SAME_DAY_ONLY']);

export const SlotOfferSchema = z
  .object({
    slot: SlotSchema,
    windowLabel: z.string().trim().min(1).max(40),
    pricePence: PenceSchema,
    available: z.boolean(),
    reason: AvailabilityReasonSchema.optional(),
    lastOne: z.boolean(),
  })
  .strict();

export const BreakdownLineSchema = z
  .object({
    key: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    detail: z.string().trim().max(200).optional(),
    pence: PenceSchema,
  })
  .strict();

export const QuoteDtoSchema = z
  .object({
    publicId: PublicIdSchema,
    expiresAt: IsoTimestampSchema,
    service: ServiceKeySchema,
    variant: z.string().trim().min(1).max(40),
    distanceMiles: z.number().nonnegative().max(2000),
    durationMinutes: z.number().int().nonnegative().max(10080),
    pickup: AddressSummarySchema,
    dropoff: AddressSummarySchema.nullable(),
    breakdownLines: z.array(BreakdownLineSchema),
    staticSubtotalPence: PenceSchema,
    calendar: z.array(
      z
        .object({
          date: IsoDateSchema,
          weekday: z.number().int().min(0).max(6),
          slots: z.array(SlotOfferSchema).length(SLOT_KEYS.length),
        })
        .strict(),
    ),
    cheapest: z
      .object({
        date: IsoDateSchema,
        slot: SlotSchema,
        pricePence: PenceSchema,
      })
      .strict()
      .nullable(),
    staticMapPath: z.string().trim().startsWith('/api/v1/maps/static'),
  })
  .strict();

export const ManualQuoteReasonSchema = z.enum(['FERRY_ROUTE', 'LONG_DISTANCE', 'VARIANT_REQUIRES_SURVEY']);

export const QuoteStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('accepted'), requestId: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal('route'),
      distanceMiles: z.number().nonnegative(),
      durationMinutes: z.number().int().nonnegative(),
      fromTown: z.string().min(1),
      toTown: z.string().min(1).nullable(),
    })
    .strict(),
  z.object({ type: z.literal('availability'), slotsOpen: z.number().int().min(0), slotsTotal: z.number().int().min(0) }).strict(),
  z
    .object({
      type: z.literal('prices'),
      cheapest: z.object({ date: IsoDateSchema, slot: SlotSchema, pricePence: PenceSchema }).strict().nullable(),
    })
    .strict(),
  z.object({ type: z.literal('done'), quote: QuoteDtoSchema }).strict(),
  z
    .object({
      type: z.literal('manual_quote'),
      quotePublicId: PublicIdSchema,
      reasons: z.array(ManualQuoteReasonSchema).min(1),
    })
    .strict(),
  z.object({ type: z.literal('error'), error: ErrorEnvelopeSchema.shape.error }).strict(),
]);

export const AddressSuggestRequestSchema = z
  .object({
    q: z.string().trim().min(2).max(100),
    sessionToken: UuidSchema,
    proximity: z.object({ lat: z.number(), lng: z.number() }).strict().optional(),
  })
  .strict();

export const AddressSuggestionSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    primary: z.string().trim().min(1).max(160),
    secondary: z.string().trim().max(160),
    kind: z.enum(['address', 'postcode', 'place', 'poi']),
  })
  .strict();

export const AddressSuggestResponseSchema = z.object({ suggestions: z.array(AddressSuggestionSchema).max(10) }).strict();

export const AddressRetrieveRequestSchema = z.object({ id: z.string().trim().min(1).max(200), sessionToken: UuidSchema }).strict();
export const AddressRetrieveResponseSchema = z
  .union([
    z.object({ address: AddressSchema }).strict(),
    z.object({ needsPostcode: z.literal(true), address: AddressSchema.partial({ postcode: true }) }).strict(),
  ]);

export const PostcodeLookupResponseSchema = z
  .object({
    town: z.string().trim().min(1).max(80),
    lat: z.number(),
    lng: z.number(),
    postcode: UkPostcodeSchema,
  })
  .strict();

export const CatalogueItemSchema = z
  .object({
    slug: z.string().trim().min(1).max(80),
    name: z.string().trim().min(1).max(120),
    aliases: z.array(z.string().trim().min(1).max(80)),
    category: z.string().trim().min(1).max(80),
    unitVolumeM3: z.number().positive().max(20),
  })
  .strict();

export const ItemPresetSchema = z
  .object({
    slug: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(120),
    items: z.array(z.object({ itemSlug: z.string().trim().min(1).max(80), quantity: z.number().int().min(1) }).strict()),
  })
  .strict();

export const CatalogueResponseSchema = z
  .object({
    items: z.array(CatalogueItemSchema),
    presets: z.array(ItemPresetSchema),
    customSizes: z.record(z.enum(['S', 'M', 'L', 'XL']), z.number().positive()),
    categories: z.array(z.string().trim().min(1).max(80)),
  })
  .strict();

export const ManualQuoteRequestSchema = z
  .object({
    contact: ContactSchema,
    preferredDate: IsoDateSchema.optional(),
    preferredSlot: SlotSchema.optional(),
    details: z.string().trim().max(500).optional(),
  })
  .strict();
export const ManualQuoteRequestResponseSchema = z.object({ reference: z.string().trim().min(1).max(40) }).strict();

export const BookingCreateSchema = z
  .object({
    quotePublicId: PublicIdSchema,
    date: IsoDateSchema,
    slot: SlotSchema,
    expectedTotalPence: PenceSchema,
    idempotencyKey: UuidSchema,
    contact: ContactSchema,
    customerNotes: z.string().trim().max(500).optional(),
    marketingOptIn: z.boolean(),
    termsAccepted: z.literal(true),
    startWithinCancellationPeriodAck: z.boolean(),
  })
  .strict();

export const BookingCreateResponseSchema = z
  .object({
    reference: z.string().regex(/^SV-[0-9A-HJKMNP-TV-Z]{6}$/),
    statusToken: z.string().min(20),
    clientSecret: z.string().min(1),
    totalPence: PenceSchema,
    holdExpiresAt: IsoTimestampSchema,
  })
  .strict();

export const BookingStatusResponseSchema = z
  .object({
    status: BookingStatusSchema,
    reference: z.string().nullable(),
    summary: z.record(z.string(), z.unknown()).nullable(),
    manageUrl: UrlSchema.optional(),
    checkout: z.object({
      paymentStatus: z.enum(['REQUIRES_PAYMENT', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELED']).nullable(),
      holdExpiresAt: IsoTimestampSchema.nullable(),
      canRetry: z.boolean(),
    }).strict().optional(),
  })
  .strict();

export const ContactFormSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: EmailSchema,
    phone: UkPhoneSchema.optional(),
    message: z.string().trim().min(1).max(2000),
    company: z.literal(''),
  })
  .strict();

export const ManageRequestLinkSchema = z
  .object({
    email: EmailSchema,
    reference: z.string().trim().min(4).max(40),
  })
  .strict();

export const ManageBookingDtoSchema = z
  .object({
    reference: z.string().min(1),
    status: BookingStatusSchema,
    dispatchStatus: DispatchStatusSchema,
    service: ServiceKeySchema,
    date: IsoDateSchema,
    slot: SlotSchema,
    pickup: AddressSummarySchema,
    dropoff: AddressSummarySchema.nullable(),
    totalPence: PenceSchema,
    paidPence: PenceSchema,
    refundedPence: PenceSchema,
    customerNotes: z.string().max(500).nullable(),
    version: z.number().int().nonnegative(),
  })
  .strict();

export const ReschedulePreviewRequestSchema = z.object({ date: IsoDateSchema, slot: SlotSchema }).strict();
export const ReschedulePreviewResponseSchema = z
  .object({
    allowed: z.boolean(),
    reason: z.string().max(200).optional(),
    newTotalPence: PenceSchema,
    differencePence: z.number().int(),
  })
  .strict();

export const RescheduleApplyRequestSchema = z
  .object({
    date: IsoDateSchema,
    slot: SlotSchema,
    expectedDifferencePence: z.number().int(),
    idempotencyKey: UuidSchema,
  })
  .strict();
export const RescheduleApplyResponseSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('DONE') }).strict(),
  z.object({ result: z.literal('PAYMENT_REQUIRED'), clientSecret: z.string().min(1) }).strict(),
]);

export const CancelPreviewResponseSchema = z
  .object({
    allowed: z.boolean(),
    refundPence: PenceSchema,
    policySummary: z.string().min(1).max(300),
  })
  .strict();
export const CancelBookingRequestSchema = z
  .object({
    expectedRefundPence: PenceSchema,
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
export const CancelBookingResponseSchema = z.object({ refundPence: PenceSchema }).strict();
export const NotesPatchSchema = z.object({ customerNotes: z.string().trim().max(500) }).strict();

export const TrackingDtoSchema = z
  .object({
    reference: z.string().min(1),
    status: BookingStatusSchema,
    jobStage: JobStageSchema,
    driverFirstName: z.string().max(80).nullable(),
    vanRegistration: z.string().max(20).nullable(),
    liveLocation: z.object({ lat: z.number(), lng: z.number(), recordedAt: IsoTimestampSchema }).strict().nullable(),
  })
  .strict();

export const ReviewSubmitSchema = z
  .object({
    token: z.string().min(20),
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
    displayName: z.string().trim().min(1).max(80),
    town: z.string().trim().max(80).optional(),
  })
  .strict();

export const PaymentRequestDtoSchema = z
  .object({
    token: z.string().min(20),
    description: z.string().min(1).max(300),
    amountPence: PenceSchema,
    expiresAt: IsoTimestampSchema,
    paid: z.boolean(),
  })
  .strict();
export const PaymentIntentResponseSchema = z.object({ clientSecret: z.string().min(1), amountPence: PenceSchema }).strict();

export const StaffAppSchema = z.enum(['admin', 'driver']);
export const StaffRoleSchema = z.enum(['OWNER', 'ADMIN', 'DRIVER']);
export const UserStatusSchema = z.enum(['INVITED', 'ACTIVE', 'DISABLED']);
export const OtpRequestSchema = z.object({ email: EmailSchema, app: StaffAppSchema }).strict();
export const DeviceSchema = z
  .object({
    deviceId: z.string().trim().min(1).max(160),
    deviceName: z.string().trim().min(1).max(160),
    platform: z.enum(['ios', 'android', 'web']),
    appVersion: z.string().trim().min(1).max(40),
  })
  .strict();
export const OtpVerifySchema = OtpRequestSchema.extend({
  code: z.string().regex(/^\d{6}$/),
  device: DeviceSchema,
}).strict();
export const StaffPasswordSchema = z.string().min(1).max(1024);
export const PasswordLoginRequestSchema = OtpRequestSchema.extend({
  password: StaffPasswordSchema,
  device: DeviceSchema,
}).strict();
export const StaffUserSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    email: EmailSchema,
    role: StaffRoleSchema,
    status: UserStatusSchema,
  })
  .strict();
export const AuthTokenResponseSchema = z
  .object({
    accessToken: z.string().min(20),
    accessExpiresAt: IsoTimestampSchema,
    refreshToken: z.string().min(20),
    user: StaffUserSchema,
  })
  .strict();
export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(20), deviceId: z.string().min(1).max(160), requestId: z.uuid().optional(),
}).strict();
export const PushDevicePutSchema = z.object({ expoPushToken: z.string().min(1).max(300), platform: z.enum(['ios', 'android']) }).strict();
export const NotificationReadSchema = z.union([
  z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export const MeResponseSchema = z
  .object({
    user: StaffUserSchema,
    role: StaffRoleSchema,
    driverProfile: z.record(z.string(), z.unknown()).nullable(),
    appConfig: z
      .object({
        minVersion: z.string().min(1),
        slotWindows: z.record(SlotSchema, z.object({ label: z.string(), start: z.string(), end: z.string() }).strict()),
        supportPhone: z.string().nullable(),
        featureFlags: z.record(z.string(), z.boolean()),
      })
      .strict(),
  })
  .strict();

export const ExpectedVersionSchema = z.object({ expectedVersion: z.number().int().nonnegative() }).strict();
export const AdminBookingsQuerySchema = PaginationQuerySchema.extend({
  status: BookingStatusSchema.optional(),
  dispatch: DispatchStatusSchema.optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  service: ServiceKeySchema.optional(),
  driverId: z.string().optional(),
  q: z.string().trim().max(120).optional(),
}).strict();
export const AdminBookingPatchSchema = ExpectedVersionSchema.extend({
  contact: ContactSchema.optional(),
  notes: z.string().trim().max(1000).optional(),
  vanId: z.string().min(1).nullable().optional(),
}).strict();
export const AdminPhoneBookingSchema = z
  .object({
    quotePublicId: PublicIdSchema,
    date: IsoDateSchema,
    slot: SlotSchema,
    contact: ContactSchema,
    payment: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('LINK') }).strict(),
      z.object({ mode: z.literal('OFFLINE'), reference: z.string().trim().min(1).max(120) }).strict(),
    ]),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();
export const RepricePreviewSchema = z.object({ changes: z.record(z.string(), z.unknown()) }).strict();
export const RepriceApplySchema = ExpectedVersionSchema.extend({
  changes: z.record(z.string(), z.unknown()),
  settle: z.enum(['EXTRA_CHARGE', 'REFUND', 'NONE']),
  reason: z.string().trim().min(1).max(500),
}).strict();
export const AdminRescheduleSchema = ExpectedVersionSchema.extend({
  date: IsoDateSchema,
  slot: SlotSchema,
  priceMode: z.enum(['KEEP_PRICE', 'NEW_PRICE']),
  settle: z.enum(['EXTRA_CHARGE', 'REFUND', 'NONE']),
  reason: z.string().trim().min(1).max(500),
  overrideCapacity: z.boolean().optional(),
}).strict();
export const AssignBookingSchema = ExpectedVersionSchema.extend({
  driverId: z.string().min(1),
  vanId: z.string().min(1).optional(),
  mode: z.enum(['DIRECT', 'OFFER']),
}).strict();
export const OfferBookingSchema = z
  .object({
    driverIds: z.array(z.string().min(1)).min(1),
    expiresInMinutes: z.number().int().min(1).max(1440),
  })
  .strict();
export const AdminStatusChangeSchema = ExpectedVersionSchema.extend({
  to: BookingStatusSchema,
  reason: z.string().trim().min(1).max(500),
}).strict();
export const AdminCancelSchema = ExpectedVersionSchema.extend({
  refund: z.discriminatedUnion('mode', [
    z.object({ mode: z.enum(['POLICY', 'FULL', 'NONE']) }).strict(),
    z.object({ mode: z.literal('CUSTOM'), amountPence: PenceSchema }).strict(),
  ]),
  reason: z.string().trim().min(1).max(500),
  notifyCustomer: z.boolean(),
}).strict();
export const RefundCreateSchema = z.object({ paymentId: z.string().min(1), amountPence: PenceSchema, reason: z.string().min(1).max(500) }).strict();
export const ExtraChargeCreateSchema = z.object({ description: z.string().min(1).max(200), amountPence: PenceSchema }).strict();
export const OfflinePaymentSchema = z.object({ amountPence: PenceSchema, reference: z.string().min(1).max(120), paidAt: IsoTimestampSchema }).strict();
export const ManualQuotePriceSchema = z
  .object({
    pricePence: PenceSchema,
    date: IsoDateSchema,
    slot: SlotSchema,
    message: z.string().trim().max(1000),
    validForHours: z.number().int().min(1).max(720),
  })
  .strict();
export const CapacityRuleSchema = z.object({ weekday: z.number().int().min(0).max(6), slot: SlotSchema, capacity: z.number().int().min(0).max(100) }).strict();
export const CapacityOverrideSchema = z.object({ date: IsoDateSchema, slot: SlotSchema, capacity: z.number().int().min(0).max(100), reason: z.string().max(200).optional() }).strict();
export const DriverInviteSchema = z.object({ name: z.string().min(1).max(80), email: EmailSchema, phone: UkPhoneSchema.optional() }).strict();
export const DriverPatchSchema = z.object({ name: z.string().min(1).max(80).optional(), phone: UkPhoneSchema.optional(), payoutPercent: z.number().int().min(0).max(100).nullable().optional() }).strict();
export const VanUpsertSchema = z.object({ registration: z.string().min(1).max(20), label: z.string().min(1).max(80), active: z.boolean() }).strict();
export const PayoutCreateSchema = z.object({ driverId: z.string().min(1), earningIds: z.array(z.string().min(1)).min(1), method: z.string().min(1).max(80), reference: z.string().max(120).optional(), paidAt: IsoTimestampSchema }).strict();
export const PricingDraftCreateSchema = z.object({ sourceVersionId: z.string().min(1).optional() }).strict();
export const PricingDraftPatchSchema = z.object({ config: z.record(z.string(), z.unknown()), expectedVersion: z.number().int().nonnegative() }).strict();
export const PricingSimulateSchema = z.object({ input: QuoteRequestSchema, today: IsoDateSchema.optional() }).strict();
export const ItemAdminSchema = CatalogueItemSchema.extend({ active: z.boolean(), sortOrder: z.number().int().min(0) }).strict();
export const PresetAdminSchema = ItemPresetSchema.extend({ active: z.boolean(), sortOrder: z.number().int().min(0) }).strict();
export const FaqAdminSchema = z.object({ question: z.string().min(1).max(200), answerMarkdown: z.string().min(1).max(4000), published: z.boolean(), sortOrder: z.number().int().min(0) }).strict();
export const BannerPutSchema = z.object({ enabled: z.boolean(), text: z.string().min(1).max(160), href: UrlSchema.optional(), tone: z.enum(['info', 'success', 'warning', 'danger']) }).strict();
export const TeamInviteSchema = z.object({ name: z.string().min(1).max(80), email: EmailSchema, role: StaffRoleSchema }).strict();
export const ReportExportQuerySchema = z.object({ type: z.enum(['bookings', 'payments', 'payouts']), from: IsoDateSchema, to: IsoDateSchema }).strict();

export const DriverJobsQuerySchema = PaginationQuerySchema.extend({
  scope: z.enum(['today', 'upcoming', 'offers', 'history']),
}).strict();
export const DriverOfferDecisionSchema = z.object({ reason: z.string().trim().max(300).optional() }).strict();
export const DriverSyncEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      clientEventId: UuidSchema,
      bookingId: z.string().min(1),
      type: z.literal('STAGE'),
      toStage: JobStageSchema,
      occurredAt: IsoTimestampSchema,
      lat: z.number().optional(),
      lng: z.number().optional(),
    })
    .strict(),
  z.object({ clientEventId: UuidSchema, bookingId: z.string().min(1), type: z.literal('NOTE'), text: z.string().min(1).max(1000) }).strict(),
  z.object({ clientEventId: UuidSchema, bookingId: z.string().min(1), type: z.literal('ISSUE'), category: z.string().min(1).max(80), text: z.string().min(1).max(1000) }).strict(),
]);
export const DriverSyncRequestSchema = z.object({ events: z.array(DriverSyncEventSchema).min(1).max(100) }).strict();
export const DriverSyncResponseSchema = z
  .object({
    events: z.array(
      z.discriminatedUnion('result', [
        z.object({ clientEventId: UuidSchema, result: z.enum(['APPLIED', 'DUPLICATE']) }).strict(),
        z.object({ clientEventId: UuidSchema, result: z.literal('REJECTED'), error: ApiErrorCodeSchema }).strict(),
      ]),
    ),
  })
  .strict();
export const DriverPhotoUploadFieldsSchema = z
  .object({
    kind: z.enum(['BEFORE', 'AFTER', 'ISSUE']),
    clientId: UuidSchema,
    takenAt: IsoTimestampSchema,
  })
  .strict();
export const DriverSignatureSchema = z
  .object({
    pngBase64: z.string().max(300_000),
    signedName: z.string().min(1).max(120),
    clientId: UuidSchema,
  })
  .strict();
export const DriverExtraRequestSchema = z
  .object({
    description: z.string().min(1).max(500),
    suggestedAmountPence: PenceSchema.optional(),
    photoIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
export const DriverLocationSchema = z
  .object({
    points: z
      .array(
        z
          .object({
            lat: z.number().min(49.8).max(60.9),
            lng: z.number().min(-8.7).max(1.8),
            accuracyM: z.number().nonnegative().max(10000),
            heading: z.number().min(0).max(360).optional(),
            speedMps: z.number().nonnegative().optional(),
            recordedAt: IsoTimestampSchema,
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
export const DriverAvailabilitySchema = z
  .object({
    unavailable: z.array(z.object({ date: IsoDateSchema, slot: SlotSchema, reason: z.string().max(200).optional() }).strict()),
  })
  .strict();
export const DriverProfilePatchSchema = z.object({ name: z.string().min(1).max(80).optional(), phone: UkPhoneSchema.optional(), homePostcode: UkPostcodeSchema.optional() }).strict();

export const CronAuthResponseSchema = z.object({ ok: z.literal(true), requestId: z.string().min(1) }).strict();

export const HealthResponseSchema = z
  .object({
    db: z.enum(['ok']),
    lastWebhookAt: IsoTimestampSchema.nullable(),
    oldestPendingSeconds: z.number().int().nonnegative().nullable(),
    outboxBacklog: z.number().int().nonnegative(),
    version: z.string().min(1),
  })
  .strict();
