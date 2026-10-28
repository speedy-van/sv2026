import { DEFAULT_PRICING_CONFIG, computeQuote } from '@sv/pricing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import presetsData from '../../../docs/data/item-presets.json';
import {
  isIndexableLocation,
  locationPages,
  locationsBySlug,
  routePages,
  routesBySlug,
} from '../src/content/locations';
import { locationCopy, locationFaqs } from '../src/content/location-copy';
import { serviceContent } from '../src/content/services';
import { serviceByKey } from '../src/components/booking-flow/content';
import { mergePersistedBookingDraft, useBookingDraft } from '../src/components/booking-flow/booking-store';
import { getPublishedLocationContent, getPublishedLocationContentMap } from '../src/server/location-content';
import {
  getExampleRoutes,
  getFromPrices,
  getLocationExamplePrice,
  getLocationExamples,
  getRouteExamples,
  getWorkedExample,
} from '../src/server/marketing';
import type { getCatalogue } from '../src/server/services/catalogue';
import type { AvailabilityInput, AvailabilityOverlay } from '../src/server/services/availability';
import { jobSize } from '../src/server/services/job-size';
import type { OperationsSettings } from '../src/server/settings';

const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  catalogue: vi.fn(),
  operations: vi.fn(),
  overlay: vi.fn(),
  location: vi.fn(),
  locations: vi.fn(),
}));
vi.mock('@sv/db', () => ({
  prisma: { locationContent: { findUnique: mocks.location, findMany: mocks.locations } },
}));
vi.mock('../src/server/services/catalogue', () => ({
  getActivePricingConfig: mocks.active,
  getCatalogue: mocks.catalogue,
}));
vi.mock('../src/server/services/availability', () => ({ overlayAvailability: mocks.overlay }));
vi.mock('../src/server/settings', () => ({
  getOperationsSettings: mocks.operations,
  getPublicSettings: vi.fn(),
  getSetting: vi.fn(),
}));

const operations: OperationsSettings = {
  bookingPaused: false,
  crossBorderMoves: false,
  defaultCapacityPerSlot: 10,
  jobSizeRules: [
    { minVolumeM3: 10, capacityUnits: 2, blocksSlots: 2 },
    { minVolumeM3: 2, capacityUnits: 2, blocksSlots: 1 },
  ],
  maxInstantDistanceMiles: 400,
  minLeadMinutes: 120,
  paymentHoldMinutes: 30,
  phoneBookingHoldHours: 24,
  quoteValidityMinutes: 60,
  serviceAreaRule: 'SCOTLAND_ONLY',
  slotWindows: {
    MORNING: { start: '08:00', end: '12:00', label: '8am-12pm' },
    AFTERNOON: { start: '12:00', end: '17:00', label: '12pm-5pm' },
    EVENING: { start: '17:00', end: '21:00', label: '5pm-9pm' },
  },
};

function catalogueFixture(): Awaited<ReturnType<typeof getCatalogue>> {
  const slugs = new Set([
    ...presetsData.presets.flatMap((preset) => preset.items.map((item) => item.itemSlug)),
    'armchair',
    'sofa-3-seater',
    'piano-upright',
    'box-small',
    'box-medium',
  ]);
  return {
    categories: ['Test'],
    customSizes: { S: 0.05, M: 0.2, L: 0.5, XL: 1 },
    items: [...slugs].map((slug) => ({
      slug,
      name: slug,
      aliases: [],
      category: 'Test',
      unitVolumeM3: slug === 'armchair' ? 2.25 : 0.1,
    })),
    presets: presetsData.presets.map((preset) => ({
      slug: preset.slug,
      label: preset.name,
      items: preset.items,
    })),
  };
}

function openAvailability(input: AvailabilityInput): AvailabilityOverlay {
  const calendar = input.calendar.map((day) => ({
    ...day,
    slots: day.slots.map((slot) => ({
      ...slot,
      windowLabel: operations.slotWindows[slot.slot].label,
      available: true,
      lastOne: false,
    })),
  }));
  const first = calendar[0];
  const slot = first?.slots.find((item) => item.slot === 'AFTERNOON');
  return {
    calendar,
    cheapest: first && slot ? { date: first.date, slot: slot.slot, pricePence: slot.pricePence } : null,
    slotsOpen: calendar.length * 3,
    slotsTotal: calendar.length * 3,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2031-04-07T12:00:00.000Z'));
  mocks.active.mockResolvedValue({
    config: structuredClone(DEFAULT_PRICING_CONFIG),
    id: 'test-active',
    version: 1,
  });
  mocks.catalogue.mockResolvedValue(catalogueFixture());
  mocks.operations.mockResolvedValue(operations);
  mocks.overlay.mockImplementation(openAvailability);
  mocks.location.mockResolvedValue(null);
  mocks.locations.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('local SEO data and publication', () => {
  it('retains council, postcode, island and ferry facts without treating bridged islands as ferry-only', () => {
    expect(locationPages).toHaveLength(221);
    expect(locationsBySlug.get('rothesay')).toMatchObject({
      island: true,
      ferry: 'YES',
      councilArea: 'Argyll and Bute',
      postcodeArea: 'PA',
    });
    const rothesay = locationsBySlug.get('rothesay');
    if (!rothesay) throw new Error('Committed Rothesay location missing.');
    expect(locationFaqs(rothesay)[0]?.answer).toContain('ferry crossing');
    expect(locationFaqs(rothesay)[0]?.answer).not.toContain('instant');
    const portree = locationsBySlug.get('portree');
    if (!portree) throw new Error('Committed Portree location missing.');
    expect(portree).toMatchObject({ island: true, ferry: 'NO' });
    expect(locationCopy(portree).routeNote).toBeNull();
    const dunoon = locationsBySlug.get('dunoon');
    if (!dunoon) throw new Error('Committed Dunoon location missing.');
    expect(locationCopy(dunoon).routeNote).toContain('check');
  });

  it('indexes an individual tier 3 page only once its supplied published notes reach 120 words', () => {
    const tier3 = locationPages.find((location) => location.tier === 3);
    if (!tier3) throw new Error('Tier3 location missing.');
    expect(isIndexableLocation(tier3, false)).toBe(false);
    expect(isIndexableLocation(tier3, false, 'local '.repeat(119))).toBe(false);
    expect(isIndexableLocation(tier3, false, 'local '.repeat(120))).toBe(true);
    expect(isIndexableLocation(tier3, true)).toBe(true);
  });

  it('never exposes unpublished or empty owner notes', async () => {
    mocks.location.mockResolvedValueOnce({
      published: false,
      localNotes: 'Unpublished owner draft',
      updatedAt: new Date(),
    });
    expect(await getPublishedLocationContent('glasgow')).toBeNull();
    mocks.location.mockResolvedValueOnce({ published: true, localNotes: '  \n ', updatedAt: new Date() });
    expect(await getPublishedLocationContent('glasgow')).toBeNull();
    mocks.location.mockResolvedValueOnce({
      published: true,
      localNotes: '  Owner-reviewed local guidance.  ',
      updatedAt: new Date(),
    });
    expect(await getPublishedLocationContent('glasgow')).toMatchObject({
      localNotes: 'Owner-reviewed local guidance.',
    });
    mocks.locations.mockResolvedValue([
      { slug: 'glasgow', localNotes: 'Published notes', updatedAt: new Date() },
      { slug: 'edinburgh', localNotes: ' ', updatedAt: new Date() },
    ]);
    expect([...(await getPublishedLocationContentMap()).keys()]).toEqual(['glasgow']);
    expect(mocks.locations).toHaveBeenCalledWith(
      expect.objectContaining({ where: { published: true, localNotes: { not: null } } }),
    );
  });
});

describe('service defaults and existing capacity boundaries', () => {
  it('keeps every advertised service default valid in the wizard and pricing engine', () => {
    for (const service of serviceContent) {
      expect(
        serviceByKey(service.engineKey)?.variants.some((variant) => variant.key === service.variantKey),
        service.slug,
      ).toBe(true);
      expect(
        DEFAULT_PRICING_CONFIG.services[service.engineKey].variants.some(
          (variant) => variant.key === service.variantKey,
        ),
        service.slug,
      ).toBe(true);
    }
  });

  it.each([
    ['into-storage', 'to-storage'],
    ['out-of-storage', 'from-storage'],
  ])(
    'normalizes old persisted storage variant %s and invalidates its old selection',
    (oldVariant, variant) => {
      const merged = mergePersistedBookingDraft(
        {
          service: 'storage',
          variant: oldVariant,
          quotePublicId: 'old-quote',
          selectedDate: '2031-04-07',
          selectedSlot: 'MORNING',
        },
        useBookingDraft.getState(),
      );
      expect(merged).toMatchObject({
        service: 'storage',
        variant,
        quote: null,
        quotePublicId: null,
        selectedDate: null,
        selectedSlot: null,
      });
    },
  );

  it('preserves inclusive thresholds and highest matching rule without mutating rule order', () => {
    const original = structuredClone(operations.jobSizeRules);
    expect(jobSize(1.99, operations)).toEqual({ capacityUnits: 1, blocksSlots: 1 });
    expect(jobSize(2, operations)).toEqual({ capacityUnits: 2, blocksSlots: 1 });
    expect(jobSize(9.99, operations)).toEqual({ capacityUnits: 2, blocksSlots: 1 });
    expect(jobSize(10, operations)).toEqual({ capacityUnits: 2, blocksSlots: 2 });
    expect(operations.jobSizeRules).toEqual(original);
  });
});

describe('honest marketing prices', () => {
  it('prices named homepage routes using their committed distances and the real 1-bedroom preset', async () => {
    const examples = await getExampleRoutes();
    expect(examples).toHaveLength(5);
    const route = routesBySlug.get('glasgow-to-edinburgh');
    const preset = catalogueFixture().presets.find((item) => item.slug === '1-bed');
    if (!route || !preset) throw new Error('Required committed example data missing.');
    expect(examples[0]).toMatchObject({
      href: `/removals/${route.slug}`,
      distanceMiles: route.distanceMiles,
      detail: '1-bedroom flat preset',
    });
    const items = new Map(catalogueFixture().items.map((item) => [item.slug, item]));
    const inventory = preset.items.map((item) => {
      const row = items.get(item.itemSlug);
      if (!row) throw new Error('Missing test catalogue item.');
      return { itemId: row.slug, name: row.name, quantity: item.quantity, unitVolumeM3: row.unitVolumeM3 };
    });
    const expected = computeQuote(
      {
        access: { carryMetres: 0, narrowAccess: false, permitZone: false },
        addons: { assembly: false, helpers: 0, packing: false },
        distanceMiles: route.distanceMiles,
        dropoff: { floor: 0, hasLift: false },
        pickup: { floor: 0, hasLift: false },
        inventory,
        service: 'house-removals',
        variant: '1-bed',
      },
      DEFAULT_PRICING_CONFIG,
      '2031-04-07',
    );
    expect(mocks.overlay.mock.calls[0]?.[0]).toMatchObject({ calendar: expected.calendar });
  });

  it('uses real catalogue volumes for capacity and never bypasses failed availability', async () => {
    const glasgow = locationsBySlug.get('glasgow');
    if (!glasgow) throw new Error('Glasgow missing.');
    await getLocationExamplePrice(glasgow, 'man-and-van');
    expect(mocks.overlay.mock.calls[0]?.[0]).toMatchObject({ capacityUnits: 2, blocksSlots: 1 });
    mocks.overlay.mockRejectedValueOnce(new Error('Availability unavailable'));
    await expect(getLocationExamplePrice(glasgow, 'man-and-van')).rejects.toThrow('Availability unavailable');
  });

  it('omits ferry price examples and uses available-only prices for all move sizes', async () => {
    const ferry = locationsBySlug.get('stornoway');
    const route = routePages[0];
    if (!ferry || !route) throw new Error('Committed examples missing.');
    expect(await getLocationExamples(ferry)).toEqual([]);
    expect(await getLocationExamplePrice(ferry, 'house-removals')).toMatchObject({ pence: null });
    expect(mocks.overlay).not.toHaveBeenCalled();
    mocks.overlay.mockImplementation((input: AvailabilityInput) => ({
      ...openAvailability(input),
      cheapest: null,
    }));
    const examples = await getRouteExamples(route);
    expect(examples).toHaveLength(3);
    for (const example of examples) expect(example.price).toBe('Fully booked for the next 4 weeks');
  });

  it('does not invent prices when a preset is missing or no ACTIVE config exists', async () => {
    mocks.catalogue.mockResolvedValue({ ...catalogueFixture(), presets: [] });
    const prices = await getFromPrices();
    expect(prices.get('house-removals')).toEqual({ label: 'Price shown in booking', pence: null });
    mocks.active.mockRejectedValueOnce(new Error('No ACTIVE config'));
    const glasgow = locationsBySlug.get('glasgow');
    if (!glasgow) throw new Error('Glasgow missing.');
    await expect(getLocationExamplePrice(glasgow, 'man-and-van')).rejects.toThrow('No ACTIVE config');
  });

  it('does not substitute a weekend or unavailable afternoon in the worked example', async () => {
    mocks.overlay.mockImplementation((input: AvailabilityInput) => ({
      ...openAvailability(input),
      calendar: openAvailability(input).calendar.map((day) => ({
        ...day,
        slots: day.slots.map((slot) => ({ ...slot, available: day.weekday === 0 || day.weekday === 6 })),
      })),
    }));
    expect((await getWorkedExample()).total).toBe('No weekday afternoon slot available');
  });

  it('does not advertise an available price while online booking is paused', async () => {
    mocks.operations.mockResolvedValue({ ...operations, bookingPaused: true });
    const glasgow = locationsBySlug.get('glasgow');
    if (!glasgow) throw new Error('Glasgow missing.');
    expect(await getLocationExamplePrice(glasgow, 'man-and-van')).toEqual({
      label: 'Online booking is paused',
      pence: null,
    });
    expect((await getWorkedExample()).total).toBe('Online booking is paused');
    expect(mocks.overlay).not.toHaveBeenCalled();
  });
});
