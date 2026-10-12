import 'server-only';

import type { PublicSettings } from '@sv/contracts';

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

export async function getPublicSettings(): Promise<PublicSettings> {
  await Promise.resolve();
  return publicSettings;
}
