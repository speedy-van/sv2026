import 'server-only';

import { formatGBP, londonToday, parseIsoDate, type PublicSettings } from '@sv/contracts';
import { prisma } from '@sv/db';
import { computeQuote, formatPriceBreakdownLines, type InventoryLine, type PricingConfig, type PricingInput } from '@sv/pricing';
import { DEFAULT_PRICING_CONFIG } from '@sv/pricing';
import { FAQ_SEED } from '@/content/faqs';
import { serviceContent, type ServiceContent } from '@/content/services';
import { overlayAvailability } from './services/availability';
import { getActivePricingConfig } from './services/catalogue';
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
  'rubbish-removal': [{ quantity: 5, slug: 'bag-black' }],
  'same-day-delivery': [{ quantity: 1, slug: 'box-medium' }],
  'storage-moves': [{ quantity: 5, slug: 'box-medium' }],
  'student-moves': [
    { quantity: 8, slug: 'box-medium' },
    { quantity: 3, slug: 'box-large' },
    { quantity: 2, slug: 'suitcase' },
    { quantity: 3, slug: 'bag-holdall' },
  ],
};

function fallbackVolume(slug: string): number {
  const volumes: Record<string, number> = {
    armchair: 0.6,
    'bag-black': 0.05,
    'bag-holdall': 0.05,
    'bed-double': 1.7,
    'box-archive': 0.05,
    'box-large': 0.13,
    'box-medium': 0.08,
    'box-small': 0.04,
    'chair-office': 0.3,
    'chest-of-drawers': 0.55,
    'desk-office': 0.7,
    'dining-chair': 0.15,
    'dining-table-small': 0.55,
    'piano-upright': 1.2,
    'sofa-2-seater': 1,
    'sofa-3-seater': 1.4,
    suitcase: 0.1,
    'tv-small': 0.2,
    'tv-unit': 0.4,
    'wardrobe-double': 1.3,
    workstation: 0.15,
  };
  return volumes[slug] ?? 0.3;
}

async function inventoryFor(service: ServiceContent): Promise<InventoryLine[]> {
  const profile = profileItems[service.slug] ?? [];
  const slugs = profile.map((item) => item.slug);
  const rows = await prisma.item
    .findMany({
      where: { slug: { in: slugs } },
      select: { name: true, slug: true, volumeM3: true },
    })
    .catch(() => []);
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return profile.map((item) => {
    const row = bySlug.get(item.slug);
    return {
      itemId: item.slug,
      name: row?.name ?? item.slug.replaceAll('-', ' '),
      quantity: item.quantity,
      unitVolumeM3: row?.volumeM3 ?? fallbackVolume(item.slug),
    };
  });
}

function pricingInput(service: ServiceContent, inventory: InventoryLine[]): PricingInput {
  return {
    access: { carryMetres: 0, narrowAccess: false, permitZone: false },
    addons: { assembly: false, helpers: 0, packing: false },
    distanceMiles: service.engineKey === 'rubbish' ? 0 : 5,
    dropoff: service.engineKey === 'rubbish' ? null : { floor: 0, hasLift: false },
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

export async function getPricingConfigForMarketing(): Promise<PricingConfig> {
  try {
    return (await getActivePricingConfig()).config;
  } catch {
    return DEFAULT_PRICING_CONFIG;
  }
}

export async function getFromPrices(): Promise<Map<string, FromPrice>> {
  const config = await getPricingConfigForMarketing();
  const fromPrices = new Map<string, FromPrice>();
  for (const service of serviceContent) {
    const input = pricingInput(service, await inventoryFor(service));
    const quote = computeQuote(input, config, londonToday());
    try {
      const operations = await getOperationsSettings();
      const availability = await overlayAvailability({
        blocksSlots: 1,
        calendar: quote.calendar,
        capacityUnits: 1,
        operations,
        service: service.engineKey,
      });
      const cheapest = availability.cheapest;
      if (!cheapest) {
        fromPrices.set(service.slug, { label: service.engineKey === 'same-day' ? 'Today: fully booked' : 'Fully booked', pence: null });
        continue;
      }
      fromPrices.set(service.slug, { label: service.profileLabel, pence: roundUpWholePounds(cheapest.pricePence) });
    } catch {
      const firstOpen = quote.calendar.flatMap((day) => day.slots).sort((left, right) => left.pricePence - right.pricePence)[0];
      fromPrices.set(service.slug, { label: service.profileLabel, pence: firstOpen ? roundUpWholePounds(firstOpen.pricePence) : null });
    }
  }
  return fromPrices;
}

export async function getWorkedExample(): Promise<{
  breakdown: Array<{ label: string; value: string }>;
  dateLabel: string;
  total: string;
}> {
  const config = await getPricingConfigForMarketing();
  const home = serviceContent[0];
  const input = {
    ...pricingInput(home, await inventoryFor(home)),
    distanceMiles: 8,
    pickup: { floor: 2, hasLift: false },
  };
  const quote = computeQuote(input, config, londonToday());
  const afternoon = quote.calendar[3]?.slots.find((slot) => slot.slot === 'AFTERNOON') ?? quote.calendar[0]?.slots[1];
  const total = afternoon?.pricePence ?? quote.breakdown.staticSubtotalPence;
  return {
    breakdown: formatPriceBreakdownLines(quote.breakdown).map((line) => ({ label: line.label, value: formatGBP(line.pence) })),
    dateLabel: todayLabel(),
    total: formatGBP(total),
  };
}

export async function getExampleRoutes(): Promise<Array<{ detail: string; price: string; route: string }>> {
  const fromPrices = await getFromPrices();
  const bySlug = (slug: string): string => formatFromPrice(fromPrices.get(slug) ?? { label: 'Price shown in booking', pence: null });
  return [
    { detail: '1-bedroom flat', price: bySlug('house-removals'), route: 'Glasgow to Edinburgh' },
    { detail: 'Armchair', price: bySlug('man-and-van'), route: 'Paisley to Glasgow' },
    { detail: 'Three-seater sofa', price: bySlug('furniture-delivery'), route: 'Dundee to Perth' },
    { detail: 'Student room', price: bySlug('student-moves'), route: 'Stirling to Glasgow' },
    { detail: 'Five archive boxes', price: bySlug('office-removals'), route: 'Aberdeen city centre' },
    { detail: 'Five black bags', price: bySlug('rubbish-removal'), route: 'Edinburgh collection' },
  ];
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
    getOperationsSettings().catch(() => ({
      bookingPaused: false,
      calendarDays: DEFAULT_PRICING_CONFIG.calendarDays,
      crossBorderMoves: null,
      defaultCapacityPerSlot: 1,
      jobSizeRules: [],
      maxInstantDistanceMiles: 400,
      minLeadMinutes: 120,
      paymentHoldMinutes: 30,
      phoneBookingHoldHours: 24,
      quoteValidityMinutes: 60,
      serviceAreaRule: 'TO_OR_FROM_SCOTLAND' as const,
      slotWindows: {
        AFTERNOON: { end: '17:00', label: '12pm-5pm', start: '12:00' },
        EVENING: { end: '21:00', label: '5pm-9pm', start: '17:00' },
        MORNING: { end: '12:00', label: '8am-12pm', start: '08:00' },
      },
    })),
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
    if (settings.operations.crossBorderMoves === true || operations.serviceAreaRule === 'TO_OR_FROM_SCOTLAND') {
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
    .replaceAll('{rescheduleHours}', settings.cancellation.selfServiceRescheduleHours?.toString() ?? 'the cutoff shown in your booking')
    .replaceAll('{freeHours}', settings.cancellation.freeCancellationHours?.toString() ?? 'the published cancellation window')
    .replaceAll('{noRefundHours}', settings.cancellation.noRefundHours?.toString() ?? 'the final cancellation window')
    .replaceAll('{latePercent}', settings.cancellation.lateCancellationRefundPercent?.toString() ?? 'the published refund')
    .replace('Owner to write: hazardous materials, gas bottles, fuel, etc.', 'Contact Speedy Van before booking anything hazardous or unusual; the final restricted-items list is confirmed before launch.');
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
    distribution: [5, 4, 3, 2, 1].map((rating) => ({ count: reviews.filter((review) => review.rating === rating).length, rating })),
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
  if (process.env.NODE_ENV === 'production') return false;
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
