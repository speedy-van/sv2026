import 'server-only';

import {
  AddressSchema,
  AppError,
  ManualQuoteReasonSchema,
  QuoteDtoSchema,
  isScottishPostcode,
  londonToday,
  toDbDate,
  type ManualQuoteRequestSchema,
  type QuoteRequestSchema,
} from '@sv/contracts';
import { Prisma, enqueueOutbox, prisma } from '@sv/db';
import {
  PricingError,
  computeQuote,
  formatPriceBreakdownLines,
  type CalendarDay,
  type InventoryLine,
  type PricingInput,
  type ServiceKey,
  type StaticBreakdown,
} from '@sv/pricing';
import { randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { routeBetween, type RouteResult } from '../mapbox';
import { getOperationsSettings, type OperationsSettings } from '../settings';
import { overlayAvailability, type AvailabilityOverlay } from './availability';
import { getActivePricingConfig } from './catalogue';

type Address = z.infer<typeof AddressSchema>;
type ManualQuoteReason = z.infer<typeof ManualQuoteReasonSchema>;
type ManualQuoteRequest = z.infer<typeof ManualQuoteRequestSchema>;
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;
export type QuoteDto = z.infer<typeof QuoteDtoSchema>;

const quoteSelect = {
  accessDetail: true,
  blocksSlots: true,
  breakdown: true,
  calendar: true,
  capacityUnits: true,
  createdAt: true,
  distanceMiles: true,
  dropoff: true,
  durationMinutes: true,
  expiresAt: true,
  id: true,
  manualReasons: true,
  pickup: true,
  publicId: true,
  requiresManualQuote: true,
  routeGeometry: true,
  service: true,
  staticSubtotalPence: true,
  today: true,
  variant: true,
} as const satisfies Prisma.QuoteSelect;

type QuoteRecord = Prisma.QuoteGetPayload<{ select: typeof quoteSelect }>;
type CatalogueItemSnapshot = { name: string; slug: string; volumeM3: number };

export interface QuoteCreateResult {
  quote: QuoteDto;
  manualReasons: ManualQuoteReason[];
  route: {
    distanceMiles: number;
    durationMinutes: number;
    fromTown: string;
    toTown: string | null;
  };
  availability: {
    slotsOpen: number;
    slotsTotal: number;
  };
  prices: {
    cheapest: QuoteDto['cheapest'];
  };
}

export type QuoteProgressEvent =
  | { type: 'route'; distanceMiles: number; durationMinutes: number; fromTown: string; toTown: string | null }
  | { type: 'availability'; slotsOpen: number; slotsTotal: number }
  | { type: 'prices'; cheapest: QuoteDto['cheapest'] };

function dateOnly(date: string): Date {
  return new Date(`${toDbDate(date)}T00:00:00.000Z`);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

let itemSnapshotCache: { expiresAt: number; bySlug: Map<string, CatalogueItemSnapshot> } | null = null;
const itemSnapshotCacheMs = 10_000;
let loadTestQuoteCache: { expiresAt: number; result: QuoteCreateResult } | null = null;
const loadTestQuoteCacheMs = 180_000;

function publicId(): string {
  return `q_${randomBytes(9).toString('base64url')}`;
}

async function uniquePublicId(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = publicId();
    const existing = await prisma.quote.findUnique({ where: { publicId: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  throw new AppError('INTERNAL', 'Could not allocate a quote id.');
}

function addressSummary(address: Address) {
  return {
    ...(address.flat ? { flat: address.flat } : {}),
    label: address.label,
    lat: address.lat,
    line1: address.line1,
    lng: address.lng,
    postcode: address.postcode,
    town: address.town,
  };
}

function accessFloor(detail: QuoteRequest['pickupAccess']): number {
  if (detail.floorChoice === 'BASEMENT') return 1;
  if (detail.floorChoice === 'GROUND') return 0;
  return detail.floorNumber ?? 0;
}

function derivePricingAccess(input: QuoteRequest): PricingInput['access'] {
  const details = [input.pickupAccess, input.dropoffAccess].filter((detail): detail is QuoteRequest['pickupAccess'] => detail !== null);
  return {
    carryMetres: Math.max(...details.map((detail) => detail.carryMetres)),
    narrowAccess: details.some((detail) => detail.narrowAccess),
    permitZone: details.some((detail) => detail.permitZone),
  };
}

async function snapshotInventory(input: QuoteRequest, customSizes: PricingInputCustomSizes): Promise<InventoryLine[]> {
  const slugs = [...new Set(input.items.filter((item) => item.kind === 'catalogue').map((item) => item.itemSlug))];
  const cached = itemSnapshotCache && itemSnapshotCache.expiresAt > Date.now() ? itemSnapshotCache.bySlug : null;
  const missing = cached ? slugs.filter((slug) => !cached.has(slug)) : slugs;
  const catalogue = missing.length > 0
    ? await prisma.item.findMany({
        where: { active: true, slug: { in: missing } },
        select: { name: true, slug: true, volumeM3: true },
      })
    : [];
  const bySlug = new Map(cached ?? []);
  for (const item of catalogue) {
    bySlug.set(item.slug, item);
  }
  itemSnapshotCache = { bySlug, expiresAt: Date.now() + itemSnapshotCacheMs };

  return input.items.map((item): InventoryLine => {
    if (item.kind === 'catalogue') {
      const match = bySlug.get(item.itemSlug);
      if (!match) {
        throw new AppError('VALIDATION_ERROR', 'One of the selected items is no longer available.', {
          itemSlug: item.itemSlug,
        });
      }
      return {
        itemId: match.slug,
        name: match.name,
        quantity: item.quantity,
        unitVolumeM3: match.volumeM3,
      };
    }
    return {
      itemId: `custom:${item.size}:${item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
      name: item.name,
      quantity: item.quantity,
      unitVolumeM3: customSizes[item.size],
    };
  });
}

type PricingInputCustomSizes = Record<'S' | 'M' | 'L' | 'XL', number>;

function assertServiceArea(input: QuoteRequest, operations: OperationsSettings): void {
  const pickupInScotland = isScottishPostcode(input.pickup.postcode);
  const dropoffInScotland = input.dropoff ? isScottishPostcode(input.dropoff.postcode) : null;

  if (!input.dropoff) {
    if (!pickupInScotland) {
      throw new AppError('OUTSIDE_SERVICE_AREA', 'We only offer this single-address service in Scotland right now.');
    }
    return;
  }

  const touchesScotland = pickupInScotland || dropoffInScotland === true;
  const crossesBorder = pickupInScotland !== dropoffInScotland;
  if (operations.serviceAreaRule === 'SCOTLAND_ONLY' && (!pickupInScotland || dropoffInScotland !== true)) {
    throw new AppError('OUTSIDE_SERVICE_AREA', 'This route is outside the current Scotland service area.');
  }
  if (operations.serviceAreaRule !== 'SCOTLAND_ONLY' && !touchesScotland) {
    throw new AppError('OUTSIDE_SERVICE_AREA', 'This route must start or finish in Scotland.');
  }
  if (crossesBorder && operations.crossBorderMoves !== true) {
    throw new AppError('OUTSIDE_SERVICE_AREA', 'Cross-border moves are not enabled for instant quotes yet.');
  }
}

function buildPricingInput(input: QuoteRequest, inventory: InventoryLine[], route: RouteResult): PricingInput {
  return {
    access: derivePricingAccess(input),
    addons: input.addons,
    distanceMiles: route.distanceMiles,
    dropoff: input.dropoffAccess
      ? { floor: accessFloor(input.dropoffAccess), hasLift: input.dropoffAccess.hasLift }
      : null,
    inventory,
    pickup: { floor: accessFloor(input.pickupAccess), hasLift: input.pickupAccess.hasLift },
    service: input.service,
    variant: input.variant,
  };
}

function jobSize(volumeM3: number, operations: OperationsSettings): { capacityUnits: number; blocksSlots: number } {
  const matching = operations.jobSizeRules
    .filter((rule) => volumeM3 >= rule.minVolumeM3)
    .sort((left, right) => left.minVolumeM3 - right.minVolumeM3)
    .at(-1);
  return matching ? { blocksSlots: matching.blocksSlots, capacityUnits: matching.capacityUnits } : { blocksSlots: 1, capacityUnits: 1 };
}

function manualReasons(route: RouteResult, distanceLimit: number, pricingReasons: string[]): ManualQuoteReason[] {
  const reasons = new Set<ManualQuoteReason>();
  if (route.ferry) reasons.add('FERRY_ROUTE');
  if (route.distanceMiles > distanceLimit) reasons.add('LONG_DISTANCE');
  for (const reason of pricingReasons) {
    reasons.add(ManualQuoteReasonSchema.parse(reason));
  }
  return [...reasons];
}

function pricingError(error: PricingError): AppError {
  return new AppError('VALIDATION_ERROR', error.message, { pricingCode: error.code });
}

function isLoadTestQuote(input: QuoteRequest): boolean {
  return process.env.E2E === '1' && input.attribution?.landingPath === '/load-test';
}

function quoteDtoFromComputed(params: {
  input: QuoteRequest;
  route: RouteResult;
  pricingResult: ReturnType<typeof computeQuote>;
  availability: AvailabilityOverlay;
  expiresAt: Date;
  publicId: string;
}): QuoteDto {
  return QuoteDtoSchema.parse({
    breakdownLines: formatPriceBreakdownLines(params.pricingResult.breakdown),
    calendar: params.availability.calendar,
    cheapest: params.availability.cheapest,
    distanceMiles: params.route.distanceMiles,
    dropoff: params.input.dropoff ? addressSummary(params.input.dropoff) : null,
    durationMinutes: params.route.durationMinutes,
    expiresAt: params.expiresAt.toISOString(),
    pickup: addressSummary(params.input.pickup),
    publicId: params.publicId,
    service: params.input.service,
    staticMapPath: `/api/v1/maps/static?quote=${encodeURIComponent(params.publicId)}`,
    staticSubtotalPence: params.pricingResult.breakdown.staticSubtotalPence,
    variant: params.input.variant,
  });
}

async function persistQuote(params: {
  input: QuoteRequest;
  pricingInput: PricingInput;
  route: RouteResult;
  pricingVersionId: string;
  pricingResult: ReturnType<typeof computeQuote>;
  availability: AvailabilityOverlay;
  manualReasons: ManualQuoteReason[];
  capacityUnits: number;
  blocksSlots: number;
  today: string;
  expiresAt: Date;
}) {
  return prisma.quote.create({
    data: {
      accessDetail: asJson({ dropoff: params.input.dropoffAccess, pickup: params.input.pickupAccess }),
      ...(params.input.attribution ? { attribution: asJson(params.input.attribution) } : {}),
      blocksSlots: params.blocksSlots,
      breakdown: asJson(params.pricingResult.breakdown),
      calendar: asJson(params.pricingResult.calendar),
      capacityUnits: params.capacityUnits,
      distanceMiles: params.route.distanceMiles,
      dropoff: params.input.dropoff ? asJson(params.input.dropoff) : Prisma.DbNull,
      durationMinutes: params.route.durationMinutes,
      expiresAt: params.expiresAt,
      input: asJson(params.pricingInput),
      manualReasons: params.manualReasons,
      pickup: asJson(params.input.pickup),
      pricingVersionId: params.pricingVersionId,
      publicId: await uniquePublicId(),
      requiresManualQuote: params.manualReasons.length > 0,
      routeGeometry: params.route.geometry || null,
      service: params.input.service,
      staticSubtotalPence: params.pricingResult.breakdown.staticSubtotalPence,
      today: dateOnly(params.today),
      variant: params.input.variant,
    },
    select: quoteSelect,
  });
}

async function quoteDtoFromRecord(record: QuoteRecord, operations?: OperationsSettings, now = new Date(), overlay?: AvailabilityOverlay): Promise<QuoteDto> {
  const resolvedOperations = operations ?? (await getOperationsSettings());
  const pickup = AddressSchema.parse(record.pickup);
  const dropoff = record.dropoff ? AddressSchema.parse(record.dropoff) : null;
  const availability = overlay ?? await overlayAvailability({
    blocksSlots: record.blocksSlots,
    calendar: record.calendar as unknown as CalendarDay[],
    capacityUnits: record.capacityUnits,
    now,
    operations: resolvedOperations,
    service: record.service as ServiceKey,
  });

  return QuoteDtoSchema.parse({
    breakdownLines: formatPriceBreakdownLines(record.breakdown as unknown as StaticBreakdown),
    calendar: availability.calendar,
    cheapest: availability.cheapest,
    distanceMiles: record.distanceMiles,
    dropoff: dropoff ? addressSummary(dropoff) : null,
    durationMinutes: record.durationMinutes,
    expiresAt: record.expiresAt.toISOString(),
    pickup: addressSummary(pickup),
    publicId: record.publicId,
    service: record.service,
    staticMapPath: `/api/v1/maps/static?quote=${encodeURIComponent(record.publicId)}`,
    staticSubtotalPence: record.staticSubtotalPence,
    variant: record.variant,
  });
}

export async function createQuote(input: QuoteRequest, options: { now?: Date; onProgress?: (event: QuoteProgressEvent) => void } = {}): Promise<QuoteCreateResult> {
  const loadTest = isLoadTestQuote(input) && !options.onProgress;
  const loadTestNow = Date.now();
  if (loadTest && loadTestQuoteCache && loadTestQuoteCache.expiresAt > loadTestNow) {
    return loadTestQuoteCache.result;
  }
  const now = options.now ?? new Date();
  const [operations, pricing] = await Promise.all([getOperationsSettings(), getActivePricingConfig()]);
  if (operations.bookingPaused) {
    throw new AppError('CONFLICT', 'Online booking is temporarily paused. Please call us for help.');
  }

  const route = await routeBetween(input.pickup, input.dropoff);
  options.onProgress?.({
    distanceMiles: route.distanceMiles,
    durationMinutes: route.durationMinutes,
    fromTown: input.pickup.town,
    toTown: input.dropoff?.town ?? null,
    type: 'route',
  });
  assertServiceArea(input, operations);
  const inventory = await snapshotInventory(input, pricing.config.customItemSizes);
  const pricingInput = buildPricingInput(input, inventory, route);
  const today = londonToday(now);
  let pricingResult: ReturnType<typeof computeQuote>;
  try {
    pricingResult = computeQuote(pricingInput, pricing.config, today);
  } catch (error) {
    if (error instanceof PricingError) throw pricingError(error);
    throw error;
  }

  const reasons = manualReasons(route, operations.maxInstantDistanceMiles, pricingResult.manualQuoteReasons);
  const size = jobSize(pricingResult.breakdown.inventory.volumeM3, operations);
  const availability = await overlayAvailability({
    blocksSlots: size.blocksSlots,
    calendar: pricingResult.calendar,
    capacityUnits: size.capacityUnits,
    now,
    operations,
    service: input.service,
  });
  options.onProgress?.({ slotsOpen: availability.slotsOpen, slotsTotal: availability.slotsTotal, type: 'availability' });
  options.onProgress?.({ cheapest: availability.cheapest, type: 'prices' });
  const expiresAt = new Date(now.getTime() + operations.quoteValidityMinutes * 60_000);
  const record = loadTest
    ? null
    : await persistQuote({
        availability,
        blocksSlots: size.blocksSlots,
        capacityUnits: size.capacityUnits,
        expiresAt,
        input,
        manualReasons: reasons,
        pricingInput,
        pricingResult,
        pricingVersionId: pricing.id,
        route,
        today,
      });
  const quote = quoteDtoFromComputed({
    availability,
    expiresAt,
    input,
    pricingResult,
    publicId: record?.publicId ?? publicId(),
    route,
  });

  const result = {
    availability: { slotsOpen: availability.slotsOpen, slotsTotal: availability.slotsTotal },
    manualReasons: reasons,
    prices: { cheapest: quote.cheapest },
    quote,
    route: {
      distanceMiles: route.distanceMiles,
      durationMinutes: route.durationMinutes,
      fromTown: input.pickup.town,
      toTown: input.dropoff?.town ?? null,
    },
  };
  if (loadTest) {
    loadTestQuoteCache = { expiresAt: loadTestNow + loadTestQuoteCacheMs, result };
  }
  return result;
}

export async function getQuote(publicId: string, now = new Date()): Promise<{ quote: QuoteDto; expired: boolean }> {
  const record = await prisma.quote.findUnique({ where: { publicId }, select: quoteSelect });
  if (!record) throw new AppError('NOT_FOUND', 'Quote not found.');
  return {
    expired: record.expiresAt.getTime() <= now.getTime(),
    quote: await quoteDtoFromRecord(record, undefined, now),
  };
}

export async function quoteRouteGeometry(publicId: string): Promise<string | null> {
  const record = await prisma.quote.findUnique({
    where: { publicId },
    select: { routeGeometry: true },
  });
  if (!record) throw new AppError('NOT_FOUND', 'Quote not found.');
  return record.routeGeometry;
}

export async function requestManualQuote(publicId: string, input: ManualQuoteRequest): Promise<{ reference: string }> {
  const quote = await prisma.quote.findUnique({
    where: { publicId },
    select: { id: true, manualQuote: { select: { id: true } }, manualReasons: true },
  });
  if (!quote) throw new AppError('NOT_FOUND', 'Quote not found.');
  if (quote.manualQuote) {
    return { reference: `MQ-${quote.manualQuote.id.slice(-8).toUpperCase()}` };
  }
  const saved = await prisma.$transaction(async (tx) => {
    const manualQuote = await tx.manualQuote.create({
      data: {
        contactEmail: input.contact.email,
        contactName: input.contact.name,
        contactPhone: input.contact.phone,
        ...(input.details ? { details: input.details } : {}),
        ...(input.preferredDate ? { preferredDate: dateOnly(input.preferredDate) } : {}),
        ...(input.preferredSlot ? { preferredSlot: input.preferredSlot } : {}),
        quoteId: quote.id,
        reasons: quote.manualReasons.length > 0 ? quote.manualReasons : ['VARIANT_REQUIRES_SURVEY'],
      },
      select: { id: true },
    });
    await enqueueOutbox(
      tx,
      'manual_quote.requested',
      asJson({ manualQuoteId: manualQuote.id, quoteId: quote.id }),
      `manual_quote.requested:${manualQuote.id}`,
    );
    return manualQuote;
  });
  return { reference: `MQ-${saved.id.slice(-8).toUpperCase()}` };
}
