import { DEFAULT_PRICING_CONFIG } from '@sv/pricing';
import { describe, expect, it } from 'vitest';
import { serviceByKey } from '../src/components/booking-flow/content';
import { localSearchTarget } from '../src/content/keyword-targets';
import { citySlugs, isCitySlug, isIndexableLocation, locationPages } from '../src/content/locations';
import { getServiceSearchContent, localSearchSections, searchIntents } from '../src/content/service-search';
import { serviceBySlug, serviceContent, serviceLandingPages } from '../src/content/services';

const expectedOwners = {
  'house-removals': 'house-removals',
  'flat-removals': 'flat-removals',
  'man-and-van': 'man-and-van',
  'furniture-removals': 'furniture-delivery',
  'sofa-removals': 'sofa-removals',
} as const;

function expectTransportOnly(value: unknown): void {
  if (typeof value === 'string') {
    if (/\b(?:disposal|recycling|rubbish|waste)\b/iu.test(value)) {
      expect(value).toMatch(/\b(?:not|no|exclude(?:s|d)?|outside|without|cannot|don't|doesn't)\b/iu);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) expectTransportOnly(entry);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const isFaq = 'question' in value && 'answer' in value;
  if (isFaq && typeof value.question === 'string' && typeof value.answer === 'string') {
    // A disposal question is valid only together with its explicit exclusion answer.
    expectTransportOnly(`${value.question} ${value.answer}`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (isFaq && (key === 'question' || key === 'answer')) continue;
    expectTransportOnly(entry);
  }
}

describe('existing local keyword coverage', () => {
  it('keeps the existing 221 locations and 59 indexed / 162 staged publication policy', () => {
    expect(locationPages).toHaveLength(221);
    expect(new Set(locationPages.map((location) => location.slug)).size).toBe(221);
    expect(locationPages.filter((location) => isIndexableLocation(location, false))).toHaveLength(59);
    expect(locationPages.filter((location) => !isIndexableLocation(location, false))).toHaveLength(162);
    expect(citySlugs).toHaveLength(8);
    expect(
      locationPages
        .filter((location) => location.tier === 1)
        .map((location) => location.slug)
        .sort(),
    ).toEqual([...citySlugs].sort());
  });

  it('assigns each of the five search families to one national service owner', () => {
    expect(searchIntents).toHaveLength(5);
    expect(new Set(searchIntents.map((intent) => intent.id)).size).toBe(5);
    expect(new Set(searchIntents.map((intent) => intent.serviceSlug)).size).toBe(5);
    expect(Object.fromEntries(searchIntents.map((intent) => [intent.id, intent.serviceSlug]))).toEqual(
      expectedOwners,
    );
    for (const intent of searchIntents) {
      expect(serviceBySlug(intent.serviceSlug), intent.id).toBeDefined();
      expect(intent.nearMeQuery, intent.id).toMatch(/\bnear me\b/iu);
      expect(intent.nearbyQuery, intent.id).toMatch(/\bnearby\b/iu);
      expect(getServiceSearchContent(intent.serviceSlug), intent.id).toBeDefined();
    }
    expect(getServiceSearchContent('piano-moving')).toBeUndefined();
    expect(getServiceSearchContent('not-a-service')).toBeUndefined();
  });

  it('gives every existing location all five named sections and resolving owned targets', () => {
    for (const location of locationPages) {
      const sections = localSearchSections(location);
      expect(sections, location.slug).toHaveLength(5);
      expect(new Set(sections.map((section) => section.id)).size, location.slug).toBe(5);
      expect(sections.map((section) => section.id).sort(), location.slug).toEqual(
        searchIntents.map((intent) => intent.id).sort(),
      );
      for (const intent of searchIntents) {
        const section = sections.find((entry) => entry.id === intent.id);
        expect(section?.heading, `${location.slug} ${intent.id}`).toContain(location.name);
        expect(section?.paragraphs.length, `${location.slug} ${intent.id}`).toBeGreaterThan(0);
        expect(section?.serviceHref).toBe(`/services/${intent.serviceSlug}`);
        expect(section?.serviceLabel).toBeTruthy();
        const target = localSearchTarget(intent.id, location);
        if (intent.id === 'man-and-van' && isCitySlug(location.slug)) {
          expect(target).toBe(`/man-and-van/${location.slug}`);
        } else {
          expect(target).toBe(`/removals/${location.slug}#${intent.id}`);
          expect(sections.some((entry) => target.endsWith(`#${entry.id}`))).toBe(true);
        }
      }
    }
  });

  it('keeps new national and local copy about transport, allowing only explicit disposal exclusions', () => {
    for (const intent of searchIntents) {
      expectTransportOnly(serviceBySlug(intent.serviceSlug));
      expectTransportOnly(getServiceSearchContent(intent.serviceSlug));
    }
    for (const location of locationPages) expectTransportOnly(localSearchSections(location));
    expect(serviceLandingPages.some((service) => /disposal|waste|rubbish/iu.test(service.slug))).toBe(false);
  });
});

describe('sofa and flat landing-page booking defaults', () => {
  it('adds two distinct landings without adding duplicate engine services', () => {
    expect(serviceContent).toHaveLength(9);
    expect(serviceLandingPages).toHaveLength(11);
    expect(new Set(serviceLandingPages.map((service) => service.slug)).size).toBe(11);
    for (const service of serviceLandingPages) expect(serviceBySlug(service.slug)).toEqual(service);
  });

  it.each([
    ['sofa-removals', 'furniture', 'standard', 'furniture-delivery'],
    ['flat-removals', 'house-removals', 'studio', 'house-removals'],
  ] as const)(
    'maps %s to the existing engine, valid variant and honest price profile',
    (slug, engineKey, variantKey, sourceSlug) => {
      const service = serviceBySlug(slug);
      const source = serviceBySlug(sourceSlug);
      expect(service).toMatchObject({ engineKey, variantKey, priceSourceSlug: sourceSlug });
      expect(source).toMatchObject({ engineKey, variantKey });
      expect(service?.profileLabel).toBe(source?.profileLabel);
      expect(serviceByKey(engineKey)?.variants.some((variant) => variant.key === variantKey)).toBe(true);
      expect(
        DEFAULT_PRICING_CONFIG.services[engineKey].variants.some((variant) => variant.key === variantKey),
      ).toBe(true);
    },
  );
});
