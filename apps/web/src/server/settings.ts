import 'server-only';

import {
  AppError,
  PublicSettingsSchema,
  parseSetting,
  type OperationsSettingsSchema,
  type PublicSettings,
  type SettingKey,
  type SettingSchemas,
} from '@sv/contracts';
import { prisma } from '@sv/db';
import type { z } from 'zod';

export type OperationsSettings = z.infer<typeof OperationsSettingsSchema>;

const publicSettings: PublicSettings = {
  cancellation: {
    freeCancellationHours: null,
    lateCancellationRefundPercent: null,
    noRefundHours: null,
    selfServiceRescheduleHours: null,
  },
  company: {
    companyNumber: null,
    icoRegistrationNumber: null,
    legalName: null,
    registeredIn: null,
    registeredOffice: null,
    tradingName: 'Speedy Van',
    vatNumber: null,
    vatRegistered: null,
  },
  contact: {
    emailBookings: null,
    emailPublic: null,
    phoneDisplay: null,
    phoneE164: null,
    phoneHours: null,
    showAddressPublicly: false,
    whatsappE164: null,
  },
  insurance: {
    claimsEmail: null,
    goodsInTransitCoverPence: null,
    goodsInTransitInsurer: null,
    publicLiabilityCoverPence: null,
  },
  legal: {
    requireExpressStartAck: true,
  },
  operations: {
    bookingPaused: false,
    crossBorderMoves: null,
    slotWindows: {
      AFTERNOON: { end: '17:00', label: '12pm-5pm', start: '12:00' },
      EVENING: { end: '21:00', label: '5pm-9pm', start: '17:00' },
      MORNING: { end: '12:00', label: '8am-12pm', start: '08:00' },
    },
  },
  seo: {
    indexTier3: false,
  },
  siteBanner: {
    enabled: false,
    text: '',
    tone: 'info',
  },
  trust: {
    vansInFleet: null,
    yearsTrading: null,
  },
  web: {
    analyticsIds: {
      gaMeasurementId: null,
      googleAdsId: null,
      googleAdsPurchaseLabel: null,
    },
    canonicalOrigin: 'https://www.speedyvan.uk',
    googleBusinessProfileUrl: null,
    socials: {
      facebook: null,
      instagram: null,
      linkedin: null,
      tiktok: null,
      x: null,
      youtube: null,
    },
  },
};

export async function getSetting<K extends SettingKey>(key: K): Promise<z.infer<(typeof SettingSchemas)[K]>> {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  if (!row) {
    throw new AppError('INTERNAL', `Missing required setting: ${key}`);
  }
  return parseSetting(key, row.value);
}

export async function getOperationsSettings(): Promise<OperationsSettings> {
  return getSetting('operations');
}

export async function getPublicSettings(): Promise<PublicSettings> {
  try {
    const rows = await prisma.setting.findMany({
      where: {
        key: {
          in: ['company', 'contact', 'web', 'operations', 'cancellation', 'insurance', 'trust', 'siteBanner', 'seo', 'legal'],
        },
      },
      select: { key: true, value: true },
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const contact = parseSetting('contact', byKey.get('contact'));
    const web = parseSetting('web', byKey.get('web'));
    const operations = parseSetting('operations', byKey.get('operations'));
    return PublicSettingsSchema.parse({
      company: parseSetting('company', byKey.get('company')),
      contact: {
        emailBookings: contact.emailBookings,
        emailPublic: contact.emailPublic,
        phoneDisplay: contact.phoneDisplay,
        phoneE164: contact.phoneE164,
        phoneHours: contact.phoneHours,
        showAddressPublicly: contact.showAddressPublicly,
        whatsappE164: contact.whatsappE164,
      },
      web: {
        analyticsIds: web.analyticsIds,
        canonicalOrigin: web.canonicalOrigin,
        googleBusinessProfileUrl: web.googleBusinessProfileUrl,
        socials: web.socials,
      },
      operations: {
        bookingPaused: operations.bookingPaused,
        crossBorderMoves: operations.crossBorderMoves,
        slotWindows: operations.slotWindows,
      },
      cancellation: parseSetting('cancellation', byKey.get('cancellation')),
      insurance: parseSetting('insurance', byKey.get('insurance')),
      trust: parseSetting('trust', byKey.get('trust')),
      siteBanner: parseSetting('siteBanner', byKey.get('siteBanner')),
      seo: parseSetting('seo', byKey.get('seo')),
      legal: parseSetting('legal', byKey.get('legal')),
    });
  } catch {
    return publicSettings;
  }
}
