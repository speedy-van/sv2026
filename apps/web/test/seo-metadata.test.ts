import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/server/settings', () => ({ getPublicSettings: vi.fn() }));

import { businessStructuredData, createPageMetadata } from '../src/server/seo';
import { isLegalSlug } from '../src/content/marketing';

const settings = {
  company: {
    companyNumber: null,
    icoRegistrationNumber: null,
    legalName: null,
    registeredIn: null,
    registeredOffice: 'Private office address',
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
  web: {
    analyticsIds: { gaMeasurementId: null, googleAdsId: null, googleAdsPurchaseLabel: null },
    canonicalOrigin: 'https://example.org/',
    googleBusinessProfileUrl: null,
    socials: { facebook: null, instagram: null, linkedin: null, tiktok: null, x: null, youtube: null },
  },
};

describe('SEO metadata and verified business identity', () => {
  it('rejects inherited object names as legal page slugs', () => {
    for (const slug of ['constructor', 'toString', '__proto__', 'missing-page']) expect(isLegalSlug(slug)).toBe(false);
    for (const slug of ['terms', 'privacy', 'cookies', 'cancellation']) expect(isLegalSlug(slug)).toBe(true);
  });

  it('uses the configured origin and page identity for canonicals and social previews', () => {
    const metadata = createPageMetadata({
      description: 'A local moving page.',
      path: '/areas/fife?tracking=1#top',
      settings,
      title: 'Removals in Fife',
    });
    expect(metadata.alternates?.canonical).toBe('https://example.org/areas/fife');
    expect(metadata.title).toEqual({ absolute: 'Removals in Fife | Speedy Van' });
    expect(metadata.openGraph).toMatchObject({
      description: 'A local moving page.',
      images: [{ alt: 'Speedy Van logo', height: 256, url: 'https://example.org/images/brand/speedy-van-silver-badge.webp', width: 256 }],
      title: 'Removals in Fife | Speedy Van',
      url: 'https://example.org/areas/fife',
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary', title: 'Removals in Fife | Speedy Van' });
    expect(metadata.robots).toBeUndefined();
  });

  it('resolves the home title without relying on a same-segment layout template', () => {
    const metadata = createPageMetadata({
      description: 'Removals across Scotland.',
      path: '/',
      settings,
      title: 'Removals Scotland',
    });
    expect(metadata.title).toEqual({ absolute: 'Removals Scotland | Speedy Van' });
    expect(metadata.openGraph).toMatchObject({ title: 'Removals Scotland | Speedy Van' });
    expect(metadata.twitter).toMatchObject({ title: 'Removals Scotland | Speedy Van' });
  });

  it('keeps the transactional wizard noindex with its canonical independent of step queries', () => {
    const metadata = createPageMetadata({
      description: 'Book a move.',
      indexable: false,
      path: '/book?step=pay',
      settings,
      title: 'Book your move',
    });
    expect(metadata.alternates?.canonical).toBe('https://example.org/book');
    expect(metadata.robots).toEqual({ follow: true, index: false });
    expect(
      createPageMetadata({
        description: 'Booking status.',
        follow: false,
        indexable: false,
        path: '/book/confirmation',
        settings,
        title: 'Confirmation',
      }).robots,
    ).toEqual({ follow: false, index: false });
  });

  it('omits unverified facts and private addresses from the public business graph', () => {
    const json = JSON.stringify(businessStructuredData(settings));
    expect(json).not.toContain('Private office address');
    expect(json).not.toContain('telephone');
    expect(json).not.toContain('legalName');
    expect(json).not.toContain('aggregateRating');
    expect(json).not.toContain('priceRange');
    expect(json).toContain('https://example.org/#business');
    expect(json).toContain('MovingCompany');
    expect(json).toContain('https://example.org/images/brand/speedy-van-silver-badge.webp');
  });

  it('publishes only supplied public contact data and the explicitly public office', () => {
    const publicSettings = {
      ...settings,
      company: { ...settings.company, legalName: 'Verified Company Ltd' },
      contact: {
        ...settings.contact,
        emailPublic: 'public@example.org',
        phoneE164: '+441234567890',
        showAddressPublicly: true,
      },
      web: { ...settings.web, googleBusinessProfileUrl: 'https://maps.example.org/verified' },
    };
    const json = JSON.stringify(businessStructuredData(publicSettings));
    expect(json).toContain('Verified Company Ltd');
    expect(json).toContain('public@example.org');
    expect(json).toContain('+441234567890');
    expect(json).toContain('Private office address');
    expect(json).toContain('https://maps.example.org/verified');
    expect(json).not.toContain('streetAddress');
  });
});
