import { SLOT_KEYS } from '@sv/pricing';
import { z } from 'zod';
import { IsoDateSchema } from './time';

export const SlotSchema = z.enum(SLOT_KEYS);
export const SettingEmailSchema = z.string().trim().toLowerCase().pipe(z.email());
export const SettingUrlSchema = z.string().trim().pipe(z.url());
export const SettingDateTimeSchema = z.iso.datetime();

export const SlotWindowSchema = z
  .object({
    label: z.string().min(1).max(40),
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .strict();

export const CompanySettingsSchema = z
  .object({
    legalName: z.string().trim().min(1).nullable(),
    tradingName: z.string().trim().min(1),
    companyNumber: z.string().trim().min(1).nullable(),
    registeredIn: z.string().trim().min(1).nullable(),
    registeredOffice: z.string().trim().min(1).nullable(),
    vatRegistered: z.boolean(),
    vatNumber: z.string().trim().min(1).nullable(),
    icoRegistrationNumber: z.string().trim().min(1).nullable(),
  })
  .strict();

export const ContactSettingsSchema = z
  .object({
    phoneDisplay: z.string().trim().min(1).nullable(),
    phoneE164: z.string().trim().regex(/^\+[1-9]\d{6,14}$/).nullable(),
    whatsappE164: z.string().trim().regex(/^\+[1-9]\d{6,14}$/).nullable(),
    emailPublic: SettingEmailSchema.nullable(),
    emailBookings: SettingEmailSchema.nullable(),
    emailAdminAlerts: z.array(SettingEmailSchema).max(20),
    phoneHours: z.string().trim().max(120).nullable(),
    showAddressPublicly: z.boolean(),
  })
  .strict();

export const WebSettingsSchema = z
  .object({
    canonicalOrigin: SettingUrlSchema,
    googleBusinessProfileUrl: SettingUrlSchema.nullable(),
    analyticsIds: z
      .object({
        gaMeasurementId: z.string().trim().min(1).nullable(),
        googleAdsId: z.string().trim().min(1).nullable(),
        googleAdsPurchaseLabel: z.string().trim().min(1).nullable(),
      })
      .strict(),
    socials: z
      .object({
        facebook: SettingUrlSchema.nullable(),
        instagram: SettingUrlSchema.nullable(),
        tiktok: SettingUrlSchema.nullable(),
      })
      .strict(),
  })
  .strict();

export const JobSizeRuleSchema = z
  .object({
    minVolumeM3: z.number().nonnegative(),
    capacityUnits: z.number().int().min(1).max(10),
    blocksSlots: z.number().int().min(1).max(3),
  })
  .strict();

export const OperationsSettingsSchema = z
  .object({
    slotWindows: z.record(SlotSchema, SlotWindowSchema),
    minLeadMinutes: z.number().int().min(0).max(10080),
    defaultCapacityPerSlot: z.number().int().min(0).max(100),
    serviceAreaRule: z.enum(['SCOTLAND_ONLY', 'TO_OR_FROM_SCOTLAND', 'SCOTLAND_ENGLAND_WALES']),
    crossBorderMoves: z.boolean(),
    maxInstantDistanceMiles: z.number().positive().max(2000),
    quoteValidityMinutes: z.number().int().min(1).max(1440),
    paymentHoldMinutes: z.number().int().min(1).max(1440),
    phoneBookingHoldHours: z.number().int().min(1).max(168),
    bookingPaused: z.boolean(),
    jobSizeRules: z.array(JobSizeRuleSchema).max(20),
  })
  .strict();

export const AppsSettingsSchema = z
  .object({
    adminInstallUrl: SettingUrlSchema.nullable(),
    driverInstallUrl: SettingUrlSchema.nullable(),
  })
  .strict();

export const CancellationSettingsSchema = z
  .object({
    freeCancellationHours: z.number().int().min(0).max(8760),
    lateCancellationRefundPercent: z.number().int().min(0).max(100),
    noRefundHours: z.number().int().min(0).max(8760),
    selfServiceRescheduleHours: z.number().int().min(0).max(8760),
  })
  .strict();

export const InsuranceSettingsSchema = z
  .object({
    goodsInTransitInsurer: z.string().trim().min(1).nullable(),
    goodsInTransitCoverPence: z.number().int().nonnegative().nullable(),
    publicLiabilityCoverPence: z.number().int().nonnegative().nullable(),
    claimsEmail: SettingEmailSchema.nullable(),
  })
  .strict();

export const TrustSettingsSchema = z
  .object({
    yearsTrading: z.number().int().positive().nullable(),
    vansInFleet: z.number().int().positive().nullable(),
  })
  .strict();

export const DriversSettingsSchema = z
  .object({
    defaultPayoutPercent: z.number().int().min(0).max(100),
  })
  .strict();

export const SiteBannerSettingsSchema = z
  .object({
    enabled: z.boolean(),
    text: z.string().trim().min(1).max(160),
    href: SettingUrlSchema.optional(),
    tone: z.enum(['info', 'success', 'warning', 'danger']),
  })
  .strict();

export const NotificationsSettingsSchema = z
  .object({
    newBookingRepeatUntilSeen: z.boolean(),
    driverQuietHours: z
      .object({
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
      })
      .strict(),
  })
  .strict();

export const SeoSettingsSchema = z
  .object({
    indexTier3: z.boolean(),
  })
  .strict();

export const LegalSettingsSchema = z
  .object({
    requireExpressStartAck: z.boolean(),
  })
  .strict();

export const LaunchSettingsSchema = z
  .object({
    legalApprovedAt: SettingDateTimeSchema.nullable(),
    applePayDomainVerifiedAt: SettingDateTimeSchema.nullable(),
    missingFacts: z.array(z.string().min(1)),
  })
  .strict();

export const SettingKeySchema = z.enum([
  'company',
  'contact',
  'web',
  'operations',
  'apps',
  'cancellation',
  'insurance',
  'trust',
  'drivers',
  'siteBanner',
  'notifications',
  'seo',
  'legal',
  'launch',
]);
export type SettingKey = z.infer<typeof SettingKeySchema>;

export const SettingSchemas = {
  company: CompanySettingsSchema,
  contact: ContactSettingsSchema,
  web: WebSettingsSchema,
  operations: OperationsSettingsSchema,
  apps: AppsSettingsSchema,
  cancellation: CancellationSettingsSchema,
  insurance: InsuranceSettingsSchema,
  trust: TrustSettingsSchema,
  drivers: DriversSettingsSchema,
  siteBanner: SiteBannerSettingsSchema,
  notifications: NotificationsSettingsSchema,
  seo: SeoSettingsSchema,
  legal: LegalSettingsSchema,
  launch: LaunchSettingsSchema,
} as const;

export const PublicSettingsSchema = z
  .object({
    company: CompanySettingsSchema,
    contact: ContactSettingsSchema.omit({ emailAdminAlerts: true }),
    web: WebSettingsSchema.pick({
      analyticsIds: true,
      canonicalOrigin: true,
      googleBusinessProfileUrl: true,
      socials: true,
    }),
    operations: OperationsSettingsSchema.pick({
      bookingPaused: true,
      crossBorderMoves: true,
      slotWindows: true,
    }),
    cancellation: CancellationSettingsSchema,
    insurance: InsuranceSettingsSchema,
    trust: TrustSettingsSchema,
    siteBanner: SiteBannerSettingsSchema,
    seo: SeoSettingsSchema,
    legal: LegalSettingsSchema,
  })
  .strict();

export const CapacityOverrideSettingSchema = z
  .object({
    date: IsoDateSchema,
    slot: SlotSchema,
    capacity: z.number().int().min(0).max(100),
  })
  .strict();

export type PublicSettings = z.infer<typeof PublicSettingsSchema>;

export function parseSetting<K extends SettingKey>(key: K, value: unknown): z.infer<(typeof SettingSchemas)[K]> {
  return SettingSchemas[key].parse(value) as z.infer<(typeof SettingSchemas)[K]>;
}
