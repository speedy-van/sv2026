import 'server-only';

import { formatGBP, londonToday, parseIsoDate, type PublicSettings } from '@sv/contracts';
import { prisma } from '@sv/db';
import {
  computeQuote,
  formatPriceBreakdownLines,
  type InventoryLine,
  type PricingConfig,
  type PricingInput,
} from '@sv/pricing';
import { cache } from 'react';
import { FAQ_SEED } from '@/content/faqs';
import {
  locationsBySlug,
  routeDistanceFor,
  routesBySlug,
  type LocationPage,
  type RoutePage,
} from '@/content/locations';
import {
  featuredRouteSlugs,
  removalExampleProfiles,
  servicePresetSlugs,
  type ExampleProfile,
} from '@/content/seo-examples';
import { serviceContent, type ServiceContent } from '@/content/services';
import { overlayAvailability } from './services/availability';
import { getActivePricingConfig, getCatalogue } from './services/catalogue';
import { jobSize } from './services/job-size';
import { getOperationsSettings, getSetting } from './settings';

export interface FromPrice {
  label: string;
  pence: number | null;
}

export interface RenderedFaq {
  answer: string;
  category: string;
  question: string;
}

export interface ReviewSummary {
  average: number | null;
  count: number;
  distribution: Array<{ count: number; rating: number }>;
  reviews: Array<{
    comment: string | null;
    date: string;
    displayName: string;
    rating: number;
    town: string | null;
  }>;
}

const wholePounds = new Intl.NumberFormat('en-GB', {
  currency: 'GBP',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: 'currency',
});

const dateLabel = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Europe/London',
  year: 'numeric',
});

const profileItems: Record<ServiceContent['slug'], Array<{ slug: string; quantity: number }>> = {
  'furniture-delivery': [{ quantity: 1, slug: 'sofa-3-seater' }],
  'house-removals': [
    { quantity: 1, slug: 'sofa-2-seater' },
    { quantity: 1, slug: 'bed-double' },
    { quantity: 1, slug: 'wardrobe-double' },
    { quantity: 1, slug: 'chest-of-drawers' },
    { quantity: 1, slug: 'tv-small' },
    { quantity: 1, slug: 'tv-unit' },
    { quantity: 1, slug: 'dining-table-small' },
    { quantity: 2, slug: 'dining-chair' },
    { quantity: 10, slug: 'box-medium' },
  ],
  'ikea-delivery': [{ quantity: 3, slug: 'box-small' }],
  'man-and-van': [{ quantity: 1, slug: 'armchair' }],
  'office-removals': [
    { quantity: 5, slug: 'desk-office' },
    { quantity: 5, slug: 'chair-office' },
    { quantity: 5, slug: 'workstation' },
    { quantity: 8, slug: 'box-archive' },
  ],
  'piano-moving': [{ quantity: 1, slug: 'piano-upright' }],
  'same-day-delivery': [{ quantity: 1, slug: 'box-medium' }],
  'storage-moves': [{ quantity: 5, slug: 'box-medium' }],
  'student-moves': [
    { quantity: 8, slug: 'box-medium' },
    { quantity: 3, slug: 'box-large' },
    { quantity: 2, slug: 'suitcase' },
    { quantity: 3, slug: 'bag-holdall' },
  ],
};

const marketingCatalogue = cache(getCatalogue);

async function inventoryForProfile(
  profile: Pick<ExampleProfile, 'items' | 'preset'>,
): Promise<InventoryLine[] | null> {
  const catalogue = await marketingCatalogue();
  const items = profile.preset
    ? catalogue.presets.find((preset) => preset.slug === profile.preset)?.items
    : profile.items;
  if (!items?.length) return null;
  const rows = new Map(catalogue.items.map((item) => [item.slug, item]));
  const inventory: InventoryLine[] = [];
  for (const item of items) {
    const row = rows.get(item.itemSlug);
    if (!row) return null;
    inventory.push({
      itemId: row.slug,
      name: row.name,
      quantity: item.quantity,
      unitVolumeM3: row.unitVolumeM3,
    });
  }
  return inventory;
}

async function inventoryFor(service: ServiceContent): Promise<InventoryLine[] | null> {
  const preset = servicePresetSlugs[service.slug];
  return inventoryForProfile(
    preset
      ? { preset }
      : {
          items: (profileItems[service.slug] ?? []).map((item) => ({
            itemSlug: item.slug,
            quantity: item.quantity,
          })),
        },
  );
}

function pricingInput(service: ServiceContent, inventory: InventoryLine[]): PricingInput {
  return {
    access: { carryMetres: 0, narrowAccess: false, permitZone: false },
    addons: { assembly: false, helpers: 0, packing: false },
    distanceMiles: 5,
    dropoff: { floor: 0, hasLift: false },
    inventory,
    pickup: { floor: 0, hasLift: false },
    service: service.engineKey,
    variant: service.variantKey,
  };
}

function roundUpWholePounds(pence: number): number {
  return Math.ceil(pence / 100) * 100;
}

export function formatFromPrice(price: FromPrice): string {
  if (price.pence === null) return price.label;
  return `From ${wholePounds.format(price.pence / 100)}`;
}

export const getPricingConfigForMarketing = cache(
  async (): Promise<PricingConfig> => (await getActivePricingConfig()).config,
);

const marketingContext = cache(async () => ({
  config: await getPricingConfigForMarketing(),
  operations: await getOperationsSettings(),
}));

async function availableFromPrice(input: PricingInput, label: string): Promise<FromPrice> {
  const { config, operations } = await marketingContext();
  if (operations.bookingPaused) return { label: 'Online booking is paused', pence: null };
  const quote = computeQuote(input, config, londonToday());
  if (quote.requiresManualQuote || input.distanceMiles > operations.maxInstantDistanceMiles)
    return { label: 'Individual quote required', pence: null };
  const availability = await overlayAvailability({
    ...jobSize(quote.breakdown.inventory.volumeM3, operations),
    calendar: quote.calendar,
    operations,
    service: input.service,
  });
  return availability.cheapest
    ? { label, pence: roundUpWholePounds(availability.cheapest.pricePence) }
    : {
        label: input.service === 'same-day' ? 'Today: fully booked' : 'Fully booked for the next 4 weeks',
        pence: null,
      };
}

export const getFromPrices = cache(async (): Promise<Map<string, FromPrice>> => {
  const fromPrices = new Map<string, FromPrice>();
  for (const service of serviceContent) {
    const inventory = await inventoryFor(service);
    fromPrices.set(
      service.slug,
      inventory
        ? await availableFromPrice(pricingInput(service, inventory), service.profileLabel)
        : { label: 'Price shown in booking', pence: null },
    );
  }
  return fromPrices;
});

export async function getWorkedExample(): Promise<{
  breakdown: Array<{ label: string; value: string }>;
  dateLabel: string;
  total: string;
}> {
  const { config, operations } = await marketingContext();
  if (operations.bookingPaused)
    return { breakdown: [], dateLabel: todayLabel(), total: 'Online booking is paused' };
  const home = serviceContent[0];
  const inventory = await inventoryForProfile({ preset: '1-bed' });
  if (!inventory) return { breakdown: [], dateLabel: todayLabel(), total: 'Price shown in booking' };
  const input = {
    ...pricingInput(home, inventory),
    variant: '1-bed',
    distanceMiles: 8,
    pickup: { floor: 2, hasLift: false },
  };
  const quote = computeQuote(input, config, londonToday());
  const available = await overlayAvailability({
    ...jobSize(quote.breakdown.inventory.volumeM3, operations),
    calendar: quote.calendar,
    operations,
    service: input.service,
  });
  const afternoon = available.calendar
    .filter((day) => day.weekday >= 1 && day.weekday <= 5)
    .flatMap((day) => day.slots)
    .find((slot) => slot.slot === 'AFTERNOON' && slot.available);
  return {
    breakdown: formatPriceBreakdownLines(quote.breakdown).map((line) => ({
      label: line.label,
      value: formatGBP(line.pence),
    })),
    dateLabel: todayLabel(),
    total: afternoon ? formatGBP(afternoon.pricePence) : 'No weekday afternoon slot available',
  };
}

export interface MarketingExample {
  detail: string;
  distanceMiles: number;
  price: string;
}

async function priceExample(profile: ExampleProfile, distanceMiles: number): Promise<MarketingExample> {
  const inventory = await inventoryForProfile(profile);
  const price = inventory
    ? await availableFromPrice(
        {
          access: { carryMetres: 0, narrowAccess: false, permitZone: false },
          addons: { assembly: false, helpers: 0, packing: false },
          distanceMiles,
          dropoff: { floor: 0, hasLift: false },
          inventory,
          pickup: { floor: 0, hasLift: false },
          service: profile.service,
          variant: profile.variant,
        },
        profile.detail,
      )
    : { label: 'Price shown in booking', pence: null };
  return { detail: profile.detail, distanceMiles, price: formatFromPrice(price) };
}

export async function getRouteExamples(route: RoutePage): Promise<MarketingExample[]> {
  const examples: MarketingExample[] = [];
  for (const profile of removalExampleProfiles)
    examples.push(await priceExample(profile, route.distanceMiles));
  return examples;
}

export async function getLocationExamplePrice(
  location: LocationPage,
  service: 'house-removals' | 'man-and-van',
): Promise<FromPrice> {
  if (location.ferry !== 'NO') return { label: 'Individual route check and quote required', pence: null };
  const content = serviceContent.find((item) => item.engineKey === service);
  if (!content) return { label: 'Price shown in booking', pence: null };
  const inventory = await inventoryFor(content);
  if (!inventory) return { label: 'Price shown in booking', pence: null };
  const distanceMiles = service === 'man-and-van' ? 5 : routeDistanceFor(location).miles;
  const destination = location.cityDistances[0];
  const label =
    service === 'man-and-van'
      ? 'One armchair, 5 miles within the city, ground floors'
      : `Studio preset, ${location.name} to ${destination ? (locationsBySlug.get(destination.slug)?.name ?? destination.slug) : 'the nearest city'}, ${String(distanceMiles)} miles, ground floors`;
  return availableFromPrice({ ...pricingInput(content, inventory), distanceMiles }, label);
}

export async function getLocationExamples(
  location: LocationPage,
): Promise<Array<MarketingExample & { route: string }>> {
  if (location.ferry !== 'NO') return [];
  const examples: Array<MarketingExample & { route: string }> = [];
  const small = removalExampleProfiles[0];
  if (small) examples.push({ ...(await priceExample(small, 3)), route: `Within ${location.name}` });
  const first = location.cityDistances[0];
  const second = location.cityDistances[1];
  if (first)
    examples.push({
      ...(await priceExample(
        { detail: '1-bedroom flat preset', preset: '1-bed', service: 'house-removals', variant: '1-bed' },
        first.miles,
      )),
      route: `${location.name} to ${locationsBySlug.get(first.slug)?.name ?? first.slug}`,
    });
  if (second)
    examples.push({
      ...(await priceExample(
        { detail: '2-bedroom home preset', preset: '2-bed', service: 'house-removals', variant: '2-bed' },
        second.miles,
      )),
      route: `${location.name} to ${locationsBySlug.get(second.slug)?.name ?? second.slug}`,
    });
  return examples;
}

export async function getExampleRoutes(): Promise<Array<MarketingExample & { href: string; route: string }>> {
  const examples: Array<MarketingExample & { href: string; route: string }> = [];
  for (const slug of featuredRouteSlugs) {
    const route = routesBySlug.get(slug);
    const profile = removalExampleProfiles[1];
    if (route && profile)
      examples.push({
        ...(await priceExample(profile, route.distanceMiles)),
        href: `/removals/${route.slug}`,
        route: `${route.fromName} to ${route.toName}`,
      });
  }
  return examples;
}

function humanPercent(multiplier: number): string {
  return String(Math.round((multiplier - 1) * 100));
}

function minLeadHours(settings: Awaited<ReturnType<typeof getOperationsSettings>>): string {
  return String(Math.ceil(settings.minLeadMinutes / 60));
}

export async function getRenderedFaqs(limit?: number): Promise<RenderedFaq[]> {
  const [settings, operations, config] = await Promise.all([
    import('./settings').then((module) => module.getPublicSettings()),
    getOperationsSettings(),
    getPricingConfigForMarketing(),
  ]);
  const rows = await prisma.faq
    .findMany({ orderBy: [{ sortOrder: 'asc' }, { question: 'asc' }], where: { active: true } })
    .catch(() => FAQ_SEED);
  const faqs = rows.map((row) => ({
    answer: renderFaqAnswer(row.question, row.answer, settings, operations, config),
    category: row.category,
    question: row.question,
  }));
  return typeof limit === 'number' ? faqs.slice(0, limit) : faqs;
}

function renderFaqAnswer(
  question: string,
  answer: string,
  settings: PublicSettings,
  operations: Awaited<ReturnType<typeof getOperationsSettings>>,
  config: PricingConfig,
): string {
  if (question === 'Do you move to and from England?') {
    if (
      settings.operations.crossBorderMoves === true ||
      operations.serviceAreaRule === 'TO_OR_FROM_SCOTLAND'
    ) {
      return 'Yes - at least one address needs to be in Scotland.';
    }
    return 'Not at the moment. We cover moves within Scotland.';
  }
  if (question === 'How far ahead can I book online?' && !settings.contact.phoneDisplay) {
    return `Up to ${String(config.calendarDays)} days ahead. For later dates, use the contact page.`;
  }
  return answer
    .replaceAll('{weekend}', humanPercent(config.multipliers.weekend))
    .replaceAll('{peak}', humanPercent(config.multipliers.peakMonth))
    .replaceAll('{n}', String(config.multipliers.endOfMonthLastDays))
    .replaceAll('{eom}', humanPercent(config.multipliers.endOfMonth))
    .replaceAll('{calendarDays}', String(config.calendarDays))
    .replaceAll('{minLeadHours}', minLeadHours(operations))
    .replaceAll('{phone}', settings.contact.phoneDisplay ?? 'the contact page')
    .replaceAll(
      '{rescheduleHours}',
      settings.cancellation.selfServiceRescheduleHours?.toString() ?? 'the cutoff shown in your booking',
    )
    .replaceAll(
      '{freeHours}',
      settings.cancellation.freeCancellationHours?.toString() ?? 'the published cancellation window',
    )
    .replaceAll(
      '{noRefundHours}',
      settings.cancellation.noRefundHours?.toString() ?? 'the final cancellation window',
    )
    .replaceAll(
      '{latePercent}',
      settings.cancellation.lateCancellationRefundPercent?.toString() ?? 'the published refund',
    )
    .replace(
      'Owner to write: hazardous materials, gas bottles, fuel, etc.',
      'Contact Speedy Van before booking anything hazardous or unusual; the final restricted-items list is confirmed before launch.',
    );
}

export async function getReviewSummary(): Promise<ReviewSummary> {
  const reviews = await prisma.review
    .findMany({
      orderBy: { createdAt: 'desc' },
      select: { comment: true, createdAt: true, displayName: true, rating: true, town: true },
      take: 20,
      where: { status: 'PUBLISHED' },
    })
    .catch(() => []);
  const count = reviews.length;
  const average = count === 0 ? null : reviews.reduce((sum, review) => sum + review.rating, 0) / count;
  return {
    average,
    count,
    distribution: [5, 4, 3, 2, 1].map((rating) => ({
      count: reviews.filter((review) => review.rating === rating).length,
      rating,
    })),
    reviews: reviews.map((review) => ({
      comment: review.comment,
      date: dateLabel.format(review.createdAt),
      displayName: review.displayName,
      rating: review.rating,
      town: review.town,
    })),
  };
}

export async function showDraftLegalBanner(): Promise<boolean> {
  const launch = await getSetting('launch').catch(() => ({ legalApprovedAt: null }));
  return !launch.legalApprovedAt;
}

export function todayLabel(): string {
  const { day, month, year } = parseIsoDate(londonToday());
  return dateLabel.format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replaceAll('<', '\\u003c');
}
