import 'server-only';

import {
  AppError,
  DriverAvailabilitySchema,
  DriverExtraRequestSchema,
  DriverLocationSchema,
  DriverOfferDecisionSchema,
  DriverPhotoUploadFieldsSchema,
  DriverProfilePatchSchema,
  DriverSignatureSchema,
  DriverSyncRequestSchema,
  addDays,
  assertDriverStageTransition,
  fromDbDate,
  londonToday,
  type ApiErrorCode,
  type DriverSyncResponseSchema,
  type JobStage,
} from '@sv/contracts';
import { DEFAULT_PRICING_CONFIG, type ServiceKey } from '@sv/pricing';
import { Prisma, prisma } from '@sv/db';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { z, ZodType } from 'zod';
import { apiJson, withApi } from '../request';

export type DriverMethod = 'GET' | 'PATCH' | 'POST' | 'PUT';

interface DriverRouteDefinition<TInput = unknown> {
  input?: ZodType<TInput>;
  method: DriverMethod;
  pattern: string;
  run(input: { driverId: string; input: TInput; params: Record<string, string>; request: Request }): Promise<unknown>;
  status?: number;
}

interface RouteMatch {
  definition: DriverRouteDefinition;
  params: Record<string, string>;
}

const serviceKeys = Object.keys(DEFAULT_PRICING_CONFIG.services) as ServiceKey[];
const activeLocationStages = new Set<JobStage>(['EN_ROUTE_TO_PICKUP', 'AT_PICKUP', 'LOADING', 'EN_ROUTE_TO_DROPOFF', 'AT_DROPOFF', 'UNLOADING']);

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function serviceKey(value: string): ServiceKey {
  const match = serviceKeys.find((candidate) => candidate === value);
  if (!match) throw new AppError('INTERNAL', 'Booking service is not configured.');
  return match;
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = splitPath(pattern);
  const pathParts = splitPath(path);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const pathPart = pathParts[index];
    if (!patternPart || !pathPart) return null;
    if (patternPart.startsWith(':')) params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    else if (patternPart !== pathPart) return null;
  }
  return params;
}

function requiredParam(params: Record<string, string>, key: string): string {
  const value = params[key];
  if (!value) throw new AppError('NOT_FOUND', 'Driver endpoint not found.');
  return value;
}

function driverEarning(totalPence: number, payoutPercent: number | null | undefined): number {
  return Math.round((totalPence * (payoutPercent ?? 0)) / 100);
}

function safePayload(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function addressLabel(value: Prisma.JsonValue): string {
  const payload = safePayload(value);
  const label = payload.label;
  return typeof label === 'string' ? label : 'Address';
}

function town(value: Prisma.JsonValue): string {
  const payload = safePayload(value);
  const townValue = payload.town;
  return typeof townValue === 'string' ? townValue : addressLabel(value);
}

function routeText(booking: { dropoff: Prisma.JsonValue | null; pickup: Prisma.JsonValue }): string {
  return booking.dropoff ? `${town(booking.pickup)} to ${town(booking.dropoff)}` : town(booking.pickup);
}

async function driverProfile(driverId: string): Promise<{ payoutPercent: number }> {
  const profile = await prisma.driverProfile.findUnique({ select: { payoutPercent: true }, where: { userId: driverId } });
  if (!profile) throw new AppError('FORBIDDEN', 'Driver profile required.');
  return profile;
}

async function bookingForDriver(bookingId: string, driverId: string): Promise<{
  dispatchStatus: 'ACCEPTED' | 'OFFERED' | 'UNASSIGNED';
  driverId: string | null;
  id: string;
  jobStage: JobStage;
  moveDate: Date;
  service: string;
  status: string;
}> {
  const booking = await prisma.booking.findFirst({
    select: { dispatchStatus: true, driverId: true, id: true, jobStage: true, moveDate: true, service: true, status: true },
    where: { id: bookingId, driverId },
  });
  if (!booking) throw new AppError('NOT_FOUND', 'Job not found.');
  return booking;
}

async function canViewJob(bookingId: string, driverId: string): Promise<void> {
  const [assigned, offer] = await Promise.all([
    prisma.booking.count({ where: { id: bookingId, driverId } }),
    prisma.assignment.count({ where: { bookingId, driverId, status: { in: ['OFFERED', 'ACCEPTED'] } } }),
  ]);
  if (assigned + offer === 0) throw new AppError('NOT_FOUND', 'Job not found.');
}

function moveDateIsTodayOrYesterday(moveDate: Date, now: Date = new Date()): boolean {
  const today = londonToday(now);
  const moveDateIso = fromDbDate(moveDate);
  return moveDateIso === today || moveDateIso === addDays(today, -1);
}

async function completionEvidenceSatisfied(bookingId: string): Promise<boolean> {
  const [afterPhotos, signature] = await Promise.all([
    prisma.jobPhoto.count({ where: { bookingId, kind: 'AFTER' } }),
    prisma.signature.findUnique({ select: { bookingId: true }, where: { bookingId } }),
  ]);
  return afterPhotos > 0 && Boolean(signature);
}

async function undoWindowOpen(bookingId: string, driverId: string): Promise<boolean> {
  const latest = await prisma.jobEvent.findFirst({
    orderBy: { receivedAt: 'desc' },
    select: { receivedAt: true },
    where: { actorUserId: driverId, bookingId, type: 'STAGE_CHANGED' },
  });
  return Boolean(latest && latest.receivedAt.getTime() >= Date.now() - 120_000);
}

function mapJobCard(booking: {
  dispatchStatus: string;
  dropoff: Prisma.JsonValue | null;
  id: string;
  jobStage: string;
  moveDate: Date;
  pickup: Prisma.JsonValue;
  reference: string;
  service: string;
  slot: string;
  totalPence: number;
}, payoutPercent: number): Record<string, unknown> {
  return {
    bookingId: booking.id,
    dispatchStatus: booking.dispatchStatus,
    earningPence: driverEarning(booking.totalPence, payoutPercent),
    jobStage: booking.jobStage,
    moveDate: fromDbDate(booking.moveDate),
    reference: booking.reference,
    route: routeText(booking),
    service: booking.service,
    slot: booking.slot,
  };
}

async function listJobs(driverId: string, request: Request): Promise<unknown> {
  const scope = new URL(request.url).searchParams.get('scope') ?? 'today';
  const profile = await driverProfile(driverId);
  if (scope === 'offers') {
    const offers = await prisma.assignment.findMany({
      include: { booking: true },
      orderBy: { offeredAt: 'asc' },
      where: { driverId, status: 'OFFERED', OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    return {
      items: offers.map((offer) => ({ ...mapJobCard(offer.booking, profile.payoutPercent), assignmentId: offer.id, expiresAt: offer.expiresAt?.toISOString() ?? null })),
      nextCursor: null,
    };
  }

  const today = londonToday();
  let where: Prisma.BookingWhereInput;
  if (scope === 'today') {
    where = { dispatchStatus: 'ACCEPTED', driverId, moveDate: new Date(`${today}T00:00:00.000Z`) };
  } else if (scope === 'history') {
    where = { driverId, status: { in: ['COMPLETED', 'CANCELLED'] } };
  } else {
    where = { driverId, moveDate: { gte: new Date(`${today}T00:00:00.000Z`) }, status: { in: ['CONFIRMED', 'IN_PROGRESS'] } };
  }
  const bookings = await prisma.booking.findMany({ orderBy: [{ moveDate: 'asc' }, { slot: 'asc' }], take: 50, where });
  return { items: bookings.map((booking) => mapJobCard(booking, profile.payoutPercent)), nextCursor: null };
}

async function getJob(driverId: string, bookingId: string): Promise<unknown> {
  await canViewJob(bookingId, driverId);
  const profile = await driverProfile(driverId);
  const booking = await prisma.booking.findUniqueOrThrow({
    include: {
      extraCharges: true,
      photos: { select: { clientId: true, createdAt: true, id: true, kind: true } },
      signature: { select: { signedAt: true, signedName: true } },
    },
    where: { id: bookingId },
  });
  return {
    accessDetail: booking.accessDetail,
    contact: { name: booking.contactName, phone: booking.contactPhone },
    customerNotes: booking.customerNotes,
    dispatchStatus: booking.dispatchStatus,
    earningPence: driverEarning(booking.totalPence, profile.payoutPercent),
    extraCharges: booking.extraCharges.map((charge) => ({ amountPence: charge.amountPence, description: charge.description, id: charge.id, status: charge.status })),
    id: booking.id,
    items: safePayload(booking.priceBreakdown).items ?? [],
    jobStage: booking.jobStage,
    moveDate: fromDbDate(booking.moveDate),
    photos: booking.photos,
    pickup: booking.pickup,
    dropoff: booking.dropoff,
    reference: booking.reference,
    route: routeText(booking),
    service: booking.service,
    signature: booking.signature,
    slot: booking.slot,
    status: booking.status,
  };
}

async function acceptOffer(driverId: string, bookingId: string): Promise<unknown> {
  const assignment = await prisma.assignment.findFirst({ where: { bookingId, driverId, status: 'OFFERED' } });
  if (!assignment) throw new AppError('NOT_FOUND', 'Offer not found.');
  const accepted = await prisma.assignment.count({ where: { bookingId, status: 'ACCEPTED', NOT: { driverId } } });
  if (accepted > 0) throw new AppError('OFFER_TAKEN', 'Another driver took this job.');
  await prisma.$transaction(async (tx) => {
    await tx.assignment.updateMany({ data: { status: 'WITHDRAWN' }, where: { bookingId, status: 'OFFERED', NOT: { id: assignment.id } } });
    await tx.assignment.update({ data: { respondedAt: new Date(), status: 'ACCEPTED' }, where: { id: assignment.id } });
    await tx.booking.update({ data: { dispatchStatus: 'ACCEPTED', driverId }, where: { id: bookingId } });
  });
  return { ok: true };
}

async function declineOffer(driverId: string, bookingId: string, input: z.infer<typeof DriverOfferDecisionSchema>): Promise<unknown> {
  const result = await prisma.assignment.updateMany({
    data: { declineReason: input.reason ?? null, respondedAt: new Date(), status: 'DECLINED' },
    where: { bookingId, driverId, status: 'OFFERED' },
  });
  if (result.count === 0) throw new AppError('NOT_FOUND', 'Offer not found.');
  return { ok: true };
}

async function applyStageEvent(driverId: string, event: z.infer<typeof DriverSyncRequestSchema>['events'][number] & { type: 'STAGE' }): Promise<'APPLIED' | 'DUPLICATE'> {
  const duplicate = await prisma.jobEvent.findUnique({ select: { id: true }, where: { clientEventId: event.clientEventId } });
  if (duplicate) return 'DUPLICATE';
  const booking = await bookingForDriver(event.bookingId, driverId);
  const service = serviceKey(booking.service);
  assertDriverStageTransition({
    actor: 'DRIVER',
    completionEvidenceSatisfied: event.toStage === 'COMPLETED' ? await completionEvidenceSatisfied(event.bookingId) : true,
    from: booking.jobStage,
    moveDateIsTodayOrYesterday: moveDateIsTodayOrYesterday(booking.moveDate),
    ownAcceptedJob: booking.dispatchStatus === 'ACCEPTED' && booking.driverId === driverId,
    service,
    to: event.toStage,
    undoWindowOpen: await undoWindowOpen(event.bookingId, driverId),
  });

  await prisma.$transaction(async (tx) => {
    await tx.jobEvent.create({
      data: {
        actorUserId: driverId,
        bookingId: event.bookingId,
        clientEventId: event.clientEventId,
        fromStage: booking.jobStage,
        lat: event.lat ?? null,
        lng: event.lng ?? null,
        occurredAt: new Date(event.occurredAt),
        payload: Prisma.JsonNull,
        toStage: event.toStage,
        type: 'STAGE_CHANGED',
      },
    });
    const data: Prisma.BookingUpdateInput = {
      jobStage: event.toStage,
      status: event.toStage === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS',
    };
    if (event.toStage === 'COMPLETED') data.completedAt = new Date(event.occurredAt);
    await tx.booking.update({ data, where: { id: event.bookingId } });
  });
  return 'APPLIED';
}

async function applyNoteOrIssue(driverId: string, event: z.infer<typeof DriverSyncRequestSchema>['events'][number] & ({ type: 'ISSUE' } | { type: 'NOTE' })): Promise<'APPLIED' | 'DUPLICATE'> {
  const duplicate = await prisma.jobEvent.findUnique({ select: { id: true }, where: { clientEventId: event.clientEventId } });
  if (duplicate) return 'DUPLICATE';
  await bookingForDriver(event.bookingId, driverId);
  await prisma.jobEvent.create({
    data: {
      actorUserId: driverId,
      bookingId: event.bookingId,
      clientEventId: event.clientEventId,
      occurredAt: new Date(),
      payload: json(event.type === 'ISSUE' ? { category: event.category, text: event.text } : { text: event.text }),
      type: event.type === 'ISSUE' ? 'ISSUE_REPORTED' : 'NOTE',
    },
  });
  return 'APPLIED';
}

async function sync(driverId: string, input: z.infer<typeof DriverSyncRequestSchema>): Promise<z.infer<typeof DriverSyncResponseSchema>> {
  const events: z.infer<typeof DriverSyncResponseSchema>['events'] = [];
  for (const event of input.events) {
    try {
      const result = event.type === 'STAGE' ? await applyStageEvent(driverId, event) : await applyNoteOrIssue(driverId, event);
      events.push({ clientEventId: event.clientEventId, result });
    } catch (error) {
      const code: ApiErrorCode = error instanceof AppError ? error.code : 'INTERNAL';
      events.push({ clientEventId: event.clientEventId, error: code, result: 'REJECTED' });
    }
  }
  return { events };
}

async function uploadPhoto(driverId: string, bookingId: string, request: Request): Promise<unknown> {
  await bookingForDriver(bookingId, driverId);
  const form = await request.formData();
  const fields = DriverPhotoUploadFieldsSchema.parse({
    clientId: form.get('clientId'),
    kind: form.get('kind'),
    takenAt: form.get('takenAt'),
  });
  const file = form.get('file');
  if (!(file instanceof Blob)) throw new AppError('VALIDATION_ERROR', 'Photo file is required.');
  if (file.size > 4_000_000) throw new AppError('VALIDATION_ERROR', 'Photo must be 4 MB or less.');
  const existing = await prisma.jobPhoto.findUnique({ where: { clientId: fields.clientId } });
  if (existing) return { id: existing.id, ok: true };
  const original = Buffer.from(await file.arrayBuffer());
  const isJpeg = original.length >= 3 && original[0] === 0xff && original[1] === 0xd8 && original[2] === 0xff;
  const isPng = original.length >= 8 && original.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isJpeg && !isPng) throw new AppError('VALIDATION_ERROR', 'Photo must be a JPEG or PNG image.');
  const processed = isPng
    ? await sharp(original).rotate().png({ compressionLevel: 9 }).toBuffer()
    : await sharp(original).rotate().jpeg({ quality: 85 }).toBuffer();
  if (processed.length > 4_000_000) throw new AppError('VALIDATION_ERROR', 'Processed photo must be 4 MB or less.');
  const extension = isPng ? 'png' : 'jpg';
  const photo = await prisma.jobPhoto.create({
    data: {
      blobKey: `driver-uploads/${bookingId}/${randomUUID()}.${extension}`,
      bookingId,
      bytes: processed.length,
      clientId: fields.clientId,
      contentType: isPng ? 'image/png' : 'image/jpeg',
      kind: fields.kind === 'ISSUE' ? 'DAMAGE' : fields.kind,
      takenAt: new Date(fields.takenAt),
      uploadedById: driverId,
    },
    select: { id: true },
  });
  return { id: photo.id, ok: true };
}

async function uploadSignature(driverId: string, bookingId: string, input: z.infer<typeof DriverSignatureSchema>): Promise<unknown> {
  await bookingForDriver(bookingId, driverId);
  await prisma.signature.upsert({
    create: {
      blobKey: `driver-signatures/${bookingId}/${input.clientId}.png`,
      bookingId,
      capturedById: driverId,
      signedAt: new Date(),
      signedName: input.signedName,
    },
    update: {
      blobKey: `driver-signatures/${bookingId}/${input.clientId}.png`,
      capturedById: driverId,
      signedAt: new Date(),
      signedName: input.signedName,
    },
    where: { bookingId },
  });
  return { ok: true };
}

async function createExtraRequest(driverId: string, bookingId: string, input: z.infer<typeof DriverExtraRequestSchema>): Promise<unknown> {
  await bookingForDriver(bookingId, driverId);
  const charge = await prisma.extraCharge.create({
    data: {
      amountPence: input.suggestedAmountPence ?? 0,
      bookingId,
      description: input.description,
      requestedById: driverId,
    },
    select: { id: true },
  });
  return { id: charge.id, ok: true };
}

async function recordLocation(driverId: string, input: z.infer<typeof DriverLocationSchema>): Promise<unknown> {
  const active = await prisma.booking.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, jobStage: true },
    where: { driverId, status: 'IN_PROGRESS' },
  });
  if (!active || !activeLocationStages.has(active.jobStage)) return { stored: 0 };
  await prisma.driverLocation.createMany({
    data: input.points.map((point) => ({
      accuracyM: point.accuracyM,
      bookingId: active.id,
      driverId,
      heading: point.heading ?? null,
      lat: point.lat,
      lng: point.lng,
      recordedAt: new Date(point.recordedAt),
      speedMps: point.speedMps ?? null,
    })),
  });
  return { stored: input.points.length };
}

async function earnings(driverId: string, request: Request): Promise<unknown> {
  const params = new URL(request.url).searchParams;
  const from = params.get('from');
  const to = params.get('to');
  const rows = await prisma.driverEarning.findMany({
    include: { booking: { select: { moveDate: true, reference: true, service: true } }, payout: true },
    orderBy: { createdAt: 'desc' },
    where: {
      driverId,
      ...(from ? { createdAt: { gte: new Date(`${from}T00:00:00.000Z`) } } : {}),
      ...(to ? { createdAt: { lte: new Date(`${to}T23:59:59.999Z`) } } : {}),
    },
  });
  const earnedPence = rows.reduce((total, row) => total + row.amountPence, 0);
  const paidPence = rows.filter((row) => row.payoutId).reduce((total, row) => total + row.amountPence, 0);
  return {
    items: rows.map((row) => ({
      amountPence: row.amountPence,
      bookingReference: row.booking.reference,
      id: row.id,
      moveDate: fromDbDate(row.booking.moveDate),
      paid: Boolean(row.payoutId),
      service: row.booking.service,
    })),
    totals: { earnedPence, paidPence, unpaidPence: earnedPence - paidPence },
  };
}

async function getAvailability(driverId: string): Promise<unknown> {
  const rows = await prisma.driverUnavailability.findMany({ orderBy: [{ date: 'asc' }, { slot: 'asc' }], where: { driverId } });
  return { unavailable: rows.map((row) => ({ date: fromDbDate(row.date), reason: row.reason, slot: row.slot })) };
}

async function putAvailability(driverId: string, input: z.infer<typeof DriverAvailabilitySchema>): Promise<unknown> {
  await prisma.$transaction(async (tx) => {
    await tx.driverUnavailability.deleteMany({ where: { driverId } });
    if (input.unavailable.length > 0) {
      await tx.driverUnavailability.createMany({
        data: input.unavailable.map((row) => ({ date: new Date(`${row.date}T00:00:00.000Z`), driverId, reason: row.reason ?? null, slot: row.slot })),
      });
    }
  });
  return { ok: true };
}

async function getProfile(driverId: string): Promise<unknown> {
  const user = await prisma.user.findUnique({ include: { driver: true }, where: { id: driverId } });
  if (!user?.driver) throw new AppError('NOT_FOUND', 'Driver profile not found.');
  return {
    email: user.email,
    homePostcode: user.driver.homePostcode,
    licenceExpiry: user.driver.licenceExpiry ? fromDbDate(user.driver.licenceExpiry) : null,
    name: user.name,
    payoutPercent: user.driver.payoutPercent,
    phone: user.phone,
  };
}

async function patchProfile(driverId: string, input: z.infer<typeof DriverProfilePatchSchema>): Promise<unknown> {
  await prisma.$transaction(async (tx) => {
    const userData: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) userData.name = input.name;
    if (input.phone !== undefined) userData.phone = input.phone;
    if (Object.keys(userData).length > 0) {
      await tx.user.update({ data: userData, where: { id: driverId } });
    }
    if (input.homePostcode) {
      await tx.driverProfile.update({ data: { homePostcode: input.homePostcode }, where: { userId: driverId } });
    }
  });
  return { ok: true };
}

const ROUTES: readonly DriverRouteDefinition[] = [
  { method: 'GET', pattern: 'jobs', run: ({ driverId, request }) => listJobs(driverId, request) },
  { method: 'GET', pattern: 'jobs/:id', run: ({ driverId, params }) => getJob(driverId, requiredParam(params, 'id')) },
  { method: 'POST', pattern: 'jobs/:id/accept', run: ({ driverId, params }) => acceptOffer(driverId, requiredParam(params, 'id')) },
  { input: DriverOfferDecisionSchema, method: 'POST', pattern: 'jobs/:id/decline', run: ({ driverId, input, params }) => declineOffer(driverId, requiredParam(params, 'id'), input as z.infer<typeof DriverOfferDecisionSchema>) },
  { input: DriverSyncRequestSchema, method: 'POST', pattern: 'sync', run: ({ driverId, input }) => sync(driverId, input as z.infer<typeof DriverSyncRequestSchema>) },
  { method: 'POST', pattern: 'jobs/:id/photos', run: ({ driverId, params, request }) => uploadPhoto(driverId, requiredParam(params, 'id'), request), status: 201 },
  { input: DriverSignatureSchema, method: 'POST', pattern: 'jobs/:id/signature', run: ({ driverId, input, params }) => uploadSignature(driverId, requiredParam(params, 'id'), input as z.infer<typeof DriverSignatureSchema>), status: 201 },
  { input: DriverExtraRequestSchema, method: 'POST', pattern: 'jobs/:id/extra-requests', run: ({ driverId, input, params }) => createExtraRequest(driverId, requiredParam(params, 'id'), input as z.infer<typeof DriverExtraRequestSchema>), status: 201 },
  { input: DriverLocationSchema, method: 'POST', pattern: 'location', run: ({ driverId, input }) => recordLocation(driverId, input as z.infer<typeof DriverLocationSchema>) },
  { method: 'GET', pattern: 'earnings', run: ({ driverId, request }) => earnings(driverId, request) },
  { method: 'GET', pattern: 'availability', run: ({ driverId }) => getAvailability(driverId) },
  { input: DriverAvailabilitySchema, method: 'PUT', pattern: 'availability', run: ({ driverId, input }) => putAvailability(driverId, input as z.infer<typeof DriverAvailabilitySchema>) },
  { method: 'GET', pattern: 'profile', run: ({ driverId }) => getProfile(driverId) },
  { input: DriverProfilePatchSchema, method: 'PATCH', pattern: 'profile', run: ({ driverId, input }) => patchProfile(driverId, input as z.infer<typeof DriverProfilePatchSchema>) },
];

function matchDriverRoute(method: DriverMethod, path: string): RouteMatch | null {
  for (const definition of ROUTES) {
    if (definition.method !== method) continue;
    const params = matchPattern(definition.pattern, path);
    if (params) return { definition, params };
  }
  return null;
}

export async function handleDriverRoute(request: Request, method: DriverMethod, path: string): Promise<Response> {
  const match = matchDriverRoute(method, path);
  if (!match) {
    return withApi(request, { auth: { app: 'driver', roles: ['DRIVER'] } }, () =>
      Promise.reject(new AppError('NOT_FOUND', 'Driver endpoint not found.')),
    );
  }
  return withApi(
    request,
    {
      auth: { app: 'driver', roles: ['DRIVER'] },
      ...(match.definition.input ? { input: match.definition.input } : {}),
    },
    async ({ input, requestId, staff }) => {
      if (!staff) throw new Error('Missing staff context.');
      const response = await match.definition.run({ driverId: staff.userId, input, params: match.params, request });
      return apiJson(response, { status: match.definition.status ?? 200 }, requestId);
    },
  );
}
