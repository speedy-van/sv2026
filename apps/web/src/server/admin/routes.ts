import 'server-only';

import {
  AdminBookingPatchSchema,
  AdminCancelSchema,
  AdminPhoneBookingSchema,
  AdminRescheduleSchema,
  AdminStatusChangeSchema,
  AppError,
  AssignBookingSchema,
  BannerPutSchema,
  CapacityOverrideSchema,
  CapacityRuleSchema,
  DriverInviteSchema,
  DriverPatchSchema,
  ExtraChargeCreateSchema,
  FaqAdminSchema,
  ManualQuotePriceSchema,
  OfferBookingSchema,
  OfflinePaymentSchema,
  PayoutCreateSchema,
  PresetAdminSchema,
  PricingDraftCreateSchema,
  PricingDraftPatchSchema,
  PricingSimulateSchema,
  RefundCreateSchema,
  RepriceApplySchema,
  RepricePreviewSchema,
  SettingKeySchema,
  TeamInviteSchema,
  VanUpsertSchema,
} from '@sv/contracts';
import { Prisma, prisma } from '@sv/db';
import { z, type ZodType } from 'zod';
import { apiJson, withApi } from '../request';
import type { StaffRole } from '../auth/staff';

export type AdminMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export interface AdminRouteDefinition {
  action: string;
  entityType: string;
  input?: ZodType;
  method: AdminMethod;
  ownerOnly?: boolean;
  pattern: string;
  response: 'detail' | 'export' | 'health' | 'list' | 'ok' | 'summary';
}

interface RouteMatch {
  definition: AdminRouteDefinition;
  params: Record<string, string>;
}

const EmptyBodySchema = z.object({}).strict();
const GenericObjectSchema = z.record(z.string(), z.unknown());
const ReasonSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const CapacityRulesPutSchema = z.object({ rules: z.array(CapacityRuleSchema).min(1).max(21) }).strict();
const CapacityOverridesPutSchema = z.object({ overrides: z.array(CapacityOverrideSchema).min(1).max(200) }).strict();
const ExtraChargeDecisionSchema = z
  .object({
    amountPence: z.number().int().nonnegative().optional(),
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const ResendEmailSchema = z.object({ template: z.string().trim().min(1).max(80) }).strict();
const LocationContentPutSchema = z
  .object({
    localNotes: z.string().trim().max(2000).nullable(),
    published: z.boolean(),
  })
  .strict();
const ReviewModerateSchema = z.object({ status: z.enum(['PUBLISHED', 'HIDDEN']), reason: z.string().trim().max(500).optional() }).strict();
const ContactMessagePatchSchema = z.object({ status: z.enum(['HANDLED', 'NEW']) }).strict();
const SettingsPutSchema = z.object({ key: SettingKeySchema.optional(), value: z.unknown(), reason: z.string().trim().max(500).optional() }).strict();
const TeamPatchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), role: z.enum(['OWNER', 'ADMIN', 'DRIVER']).optional(), status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']).optional() }).strict();
const CustomerPatchSchema = z.object({ name: z.string().trim().min(1).max(80).optional(), notes: z.string().trim().max(2000).optional(), phone: z.string().trim().min(7).max(30).optional() }).strict();
const ManualQuoteDeclineSchema = z.object({ message: z.string().trim().min(1).max(1000) }).strict();

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export const ADMIN_ROUTE_DEFINITIONS: readonly AdminRouteDefinition[] = [
  { action: 'admin.dashboard.view', entityType: 'dashboard', method: 'GET', pattern: 'dashboard', response: 'summary' },
  { action: 'admin.feed.view', entityType: 'feed', method: 'GET', pattern: 'feed', response: 'list' },
  { action: 'admin.system.health', entityType: 'system', method: 'GET', pattern: 'system/health', response: 'health' },
  { action: 'admin.system.outbox_retry', entityType: 'outboxEvent', input: EmptyBodySchema, method: 'POST', pattern: 'system/outbox/:id/retry', response: 'ok' },
  { action: 'admin.test_push', entityType: 'pushDevice', input: EmptyBodySchema, method: 'POST', pattern: 'test-push', response: 'ok' },

  { action: 'admin.bookings.list', entityType: 'booking', method: 'GET', pattern: 'bookings', response: 'list' },
  { action: 'admin.bookings.view', entityType: 'booking', method: 'GET', pattern: 'bookings/:id', response: 'detail' },
  { action: 'admin.bookings.create', entityType: 'booking', input: AdminPhoneBookingSchema, method: 'POST', pattern: 'bookings', response: 'ok' },
  { action: 'admin.bookings.patch', entityType: 'booking', input: AdminBookingPatchSchema, method: 'PATCH', pattern: 'bookings/:id', response: 'ok' },
  { action: 'admin.bookings.reprice_preview', entityType: 'booking', input: RepricePreviewSchema, method: 'POST', pattern: 'bookings/:id/reprice-preview', response: 'detail' },
  { action: 'admin.bookings.reprice_apply', entityType: 'booking', input: RepriceApplySchema, method: 'POST', pattern: 'bookings/:id/reprice-apply', response: 'ok' },
  { action: 'admin.bookings.calendar', entityType: 'booking', method: 'GET', pattern: 'bookings/:id/calendar', response: 'list' },
  { action: 'admin.bookings.reschedule_preview', entityType: 'booking', input: AdminRescheduleSchema, method: 'POST', pattern: 'bookings/:id/reschedule-preview', response: 'detail' },
  { action: 'admin.bookings.reschedule', entityType: 'booking', input: AdminRescheduleSchema, method: 'POST', pattern: 'bookings/:id/reschedule', response: 'ok' },
  { action: 'admin.bookings.assign', entityType: 'booking', input: AssignBookingSchema, method: 'POST', pattern: 'bookings/:id/assign', response: 'ok' },
  { action: 'admin.bookings.offer', entityType: 'booking', input: OfferBookingSchema, method: 'POST', pattern: 'bookings/:id/offer', response: 'ok' },
  { action: 'admin.bookings.unassign', entityType: 'booking', input: ReasonSchema, method: 'POST', pattern: 'bookings/:id/unassign', response: 'ok' },
  { action: 'admin.bookings.status', entityType: 'booking', input: AdminStatusChangeSchema, method: 'POST', pattern: 'bookings/:id/status', response: 'ok' },
  { action: 'admin.bookings.cancel', entityType: 'booking', input: AdminCancelSchema, method: 'POST', pattern: 'bookings/:id/cancel', response: 'ok' },
  { action: 'admin.bookings.refund', entityType: 'refund', input: RefundCreateSchema, method: 'POST', pattern: 'bookings/:id/refunds', response: 'ok' },
  { action: 'admin.bookings.extra_charge', entityType: 'extraCharge', input: ExtraChargeCreateSchema, method: 'POST', pattern: 'bookings/:id/extra-charges', response: 'ok' },
  { action: 'admin.extra_charges.decision', entityType: 'extraCharge', input: ExtraChargeDecisionSchema, method: 'POST', pattern: 'extra-charges/:id/decision', response: 'ok' },
  { action: 'admin.bookings.offline_payment', entityType: 'payment', input: OfflinePaymentSchema, method: 'POST', ownerOnly: true, pattern: 'bookings/:id/payments/offline', response: 'ok' },
  { action: 'admin.bookings.resend_email', entityType: 'booking', input: ResendEmailSchema, method: 'POST', pattern: 'bookings/:id/resend-email', response: 'ok' },

  { action: 'admin.checkouts.abandoned', entityType: 'booking', method: 'GET', pattern: 'checkouts/abandoned', response: 'list' },
  { action: 'admin.manual_quotes.list', entityType: 'manualQuote', method: 'GET', pattern: 'manual-quotes', response: 'list' },
  { action: 'admin.manual_quotes.view', entityType: 'manualQuote', method: 'GET', pattern: 'manual-quotes/:id', response: 'detail' },
  { action: 'admin.manual_quotes.price', entityType: 'manualQuote', input: ManualQuotePriceSchema, method: 'POST', pattern: 'manual-quotes/:id/price', response: 'ok' },
  { action: 'admin.manual_quotes.decline', entityType: 'manualQuote', input: ManualQuoteDeclineSchema, method: 'POST', pattern: 'manual-quotes/:id/decline', response: 'ok' },

  { action: 'admin.schedule.view', entityType: 'schedule', method: 'GET', pattern: 'schedule', response: 'list' },
  { action: 'admin.capacity.rules.view', entityType: 'capacityRule', method: 'GET', pattern: 'capacity/rules', response: 'list' },
  { action: 'admin.capacity.rules.put', entityType: 'capacityRule', input: CapacityRulesPutSchema, method: 'PUT', pattern: 'capacity/rules', response: 'ok' },
  { action: 'admin.capacity.overrides.view', entityType: 'capacityOverride', method: 'GET', pattern: 'capacity/overrides', response: 'list' },
  { action: 'admin.capacity.overrides.put', entityType: 'capacityOverride', input: CapacityOverridesPutSchema, method: 'PUT', pattern: 'capacity/overrides', response: 'ok' },
  { action: 'admin.capacity.overrides.delete', entityType: 'capacityOverride', input: EmptyBodySchema, method: 'DELETE', pattern: 'capacity/overrides/:id', response: 'ok' },

  { action: 'admin.drivers.list', entityType: 'driver', method: 'GET', pattern: 'drivers', response: 'list' },
  { action: 'admin.drivers.live', entityType: 'driverLocation', method: 'GET', pattern: 'drivers/live', response: 'list' },
  { action: 'admin.drivers.view', entityType: 'driver', method: 'GET', pattern: 'drivers/:id', response: 'detail' },
  { action: 'admin.drivers.invite', entityType: 'driver', input: DriverInviteSchema, method: 'POST', pattern: 'drivers/invite', response: 'ok' },
  { action: 'admin.drivers.patch', entityType: 'driver', input: DriverPatchSchema, method: 'PATCH', pattern: 'drivers/:id', response: 'ok' },
  { action: 'admin.drivers.disable', entityType: 'driver', input: ReasonSchema, method: 'POST', pattern: 'drivers/:id/disable', response: 'ok' },
  { action: 'admin.drivers.unavailability', entityType: 'driverUnavailability', method: 'GET', pattern: 'drivers/:id/unavailability', response: 'list' },
  { action: 'admin.drivers.unpaid_earnings', entityType: 'driverEarning', method: 'GET', pattern: 'drivers/:id/unpaid-earnings', response: 'list' },

  { action: 'admin.vans.list', entityType: 'van', method: 'GET', pattern: 'vans', response: 'list' },
  { action: 'admin.vans.create', entityType: 'van', input: VanUpsertSchema, method: 'POST', pattern: 'vans', response: 'ok' },
  { action: 'admin.vans.patch', entityType: 'van', input: VanUpsertSchema.partial(), method: 'PATCH', pattern: 'vans/:id', response: 'ok' },
  { action: 'admin.payouts.list', entityType: 'payout', method: 'GET', pattern: 'payouts', response: 'list' },
  { action: 'admin.payouts.create', entityType: 'payout', input: PayoutCreateSchema, method: 'POST', ownerOnly: true, pattern: 'payouts', response: 'ok' },

  { action: 'admin.customers.list', entityType: 'customer', method: 'GET', pattern: 'customers', response: 'list' },
  { action: 'admin.customers.view', entityType: 'customer', method: 'GET', pattern: 'customers/:id', response: 'detail' },
  { action: 'admin.customers.patch', entityType: 'customer', input: CustomerPatchSchema, method: 'PATCH', pattern: 'customers/:id', response: 'ok' },
  { action: 'admin.customers.export', entityType: 'customer', input: EmptyBodySchema, method: 'POST', pattern: 'customers/:id/export', response: 'export' },
  { action: 'admin.customers.anonymise', entityType: 'customer', input: ReasonSchema, method: 'POST', ownerOnly: true, pattern: 'customers/:id/anonymise', response: 'ok' },

  { action: 'admin.pricing.versions', entityType: 'pricingConfigVersion', method: 'GET', pattern: 'pricing/versions', response: 'list' },
  { action: 'admin.pricing.version_view', entityType: 'pricingConfigVersion', method: 'GET', pattern: 'pricing/versions/:id', response: 'detail' },
  { action: 'admin.pricing.draft_create', entityType: 'pricingConfigVersion', input: PricingDraftCreateSchema, method: 'POST', pattern: 'pricing/drafts', response: 'ok' },
  { action: 'admin.pricing.draft_patch', entityType: 'pricingConfigVersion', input: PricingDraftPatchSchema, method: 'PATCH', pattern: 'pricing/drafts/:id', response: 'ok' },
  { action: 'admin.pricing.simulate', entityType: 'pricingSimulation', input: PricingSimulateSchema, method: 'POST', pattern: 'pricing/simulate', response: 'detail' },
  { action: 'admin.pricing.publish', entityType: 'pricingConfigVersion', input: ReasonSchema, method: 'POST', pattern: 'pricing/drafts/:id/publish', response: 'ok' },
  { action: 'admin.pricing.approve', entityType: 'pricingConfigVersion', input: ReasonSchema, method: 'POST', ownerOnly: true, pattern: 'pricing/versions/:id/approve', response: 'ok' },

  { action: 'admin.items.list', entityType: 'item', method: 'GET', pattern: 'items', response: 'list' },
  { action: 'admin.items.create', entityType: 'item', input: GenericObjectSchema, method: 'POST', pattern: 'items', response: 'ok' },
  { action: 'admin.items.patch', entityType: 'item', input: GenericObjectSchema, method: 'PATCH', pattern: 'items/:id', response: 'ok' },
  { action: 'admin.presets.list', entityType: 'itemPreset', method: 'GET', pattern: 'presets', response: 'list' },
  { action: 'admin.presets.create', entityType: 'itemPreset', input: PresetAdminSchema, method: 'POST', pattern: 'presets', response: 'ok' },
  { action: 'admin.presets.patch', entityType: 'itemPreset', input: PresetAdminSchema.partial(), method: 'PATCH', pattern: 'presets/:id', response: 'ok' },

  { action: 'admin.content.location_view', entityType: 'locationContent', method: 'GET', pattern: 'content/locations/:slug', response: 'detail' },
  { action: 'admin.content.location_put', entityType: 'locationContent', input: LocationContentPutSchema, method: 'PUT', pattern: 'content/locations/:slug', response: 'ok' },
  { action: 'admin.faqs.list', entityType: 'faq', method: 'GET', pattern: 'faqs', response: 'list' },
  { action: 'admin.faqs.create', entityType: 'faq', input: FaqAdminSchema, method: 'POST', pattern: 'faqs', response: 'ok' },
  { action: 'admin.faqs.patch', entityType: 'faq', input: FaqAdminSchema.partial(), method: 'PATCH', pattern: 'faqs/:id', response: 'ok' },
  { action: 'admin.faqs.delete', entityType: 'faq', input: EmptyBodySchema, method: 'DELETE', pattern: 'faqs/:id', response: 'ok' },
  { action: 'admin.content.banner_put', entityType: 'siteBanner', input: BannerPutSchema, method: 'PUT', pattern: 'content/banner', response: 'ok' },
  { action: 'admin.reviews.list', entityType: 'review', method: 'GET', pattern: 'reviews', response: 'list' },
  { action: 'admin.reviews.patch', entityType: 'review', input: ReviewModerateSchema, method: 'PATCH', pattern: 'reviews/:id', response: 'ok' },
  { action: 'admin.contact_messages.list', entityType: 'contactMessage', method: 'GET', pattern: 'contact-messages', response: 'list' },
  { action: 'admin.contact_messages.patch', entityType: 'contactMessage', input: ContactMessagePatchSchema, method: 'PATCH', pattern: 'contact-messages/:id', response: 'ok' },

  { action: 'admin.settings.list', entityType: 'setting', method: 'GET', pattern: 'settings', response: 'detail' },
  { action: 'admin.settings.put', entityType: 'setting', input: SettingsPutSchema, method: 'PUT', ownerOnly: true, pattern: 'settings/:key', response: 'ok' },
  { action: 'admin.team.list', entityType: 'user', method: 'GET', pattern: 'team', response: 'list' },
  { action: 'admin.team.invite', entityType: 'user', input: TeamInviteSchema, method: 'POST', ownerOnly: true, pattern: 'team/invite', response: 'ok' },
  { action: 'admin.team.patch', entityType: 'user', input: TeamPatchSchema, method: 'PATCH', ownerOnly: true, pattern: 'team/:id', response: 'ok' },
  { action: 'admin.team.revoke_sessions', entityType: 'session', input: ReasonSchema, method: 'POST', ownerOnly: true, pattern: 'team/:id/revoke-sessions', response: 'ok' },

  { action: 'admin.reports.summary', entityType: 'report', method: 'GET', pattern: 'reports/summary', response: 'summary' },
  { action: 'admin.reports.funnel', entityType: 'report', method: 'GET', pattern: 'reports/funnel', response: 'summary' },
  { action: 'admin.reports.areas', entityType: 'report', method: 'GET', pattern: 'reports/areas', response: 'summary' },
  { action: 'admin.reports.export', entityType: 'report', method: 'GET', pattern: 'reports/export', response: 'export' },
  { action: 'admin.audit.list', entityType: 'auditLog', method: 'GET', pattern: 'audit', response: 'list' },
] as const;

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
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(pathPart);
    } else if (patternPart !== pathPart) {
      return null;
    }
  }
  return params;
}

export function matchAdminRoute(method: AdminMethod, path: string): RouteMatch | null {
  for (const definition of ADMIN_ROUTE_DEFINITIONS) {
    if (definition.method !== method) continue;
    const params = matchPattern(definition.pattern, path);
    if (params) return { definition, params };
  }
  return null;
}

function rolesFor(definition: AdminRouteDefinition): readonly StaffRole[] {
  return definition.ownerOnly ? ['OWNER'] : ['OWNER', 'ADMIN'];
}

function reasonFrom(input: unknown): string | undefined {
  if (input && typeof input === 'object' && 'reason' in input && typeof input.reason === 'string') return input.reason;
  return undefined;
}

async function writeAudit(input: unknown, match: RouteMatch, staff: { userId: string }, requestId: string): Promise<void> {
  if (match.definition.method === 'GET') return;
  await prisma.auditLog.create({
    data: {
      action: match.definition.action,
      actorType: 'USER',
      actorUserId: staff.userId,
      after: input === undefined ? Prisma.JsonNull : json(input),
      before: Prisma.JsonNull,
      entityId: match.params.id ?? match.params.key ?? match.params.slug ?? match.definition.entityType,
      entityType: match.definition.entityType,
      reason: reasonFrom(input) ?? null,
      requestId,
    },
  });
}

function responseFor(match: RouteMatch): unknown {
  const id = match.params.id ?? match.params.key ?? match.params.slug ?? null;
  if (match.definition.response === 'list') return { items: [], nextCursor: null };
  if (match.definition.response === 'health') {
    return {
      cronLastRuns: {},
      failedEvents: 0,
      lastWebhookAt: null,
      outboxBacklog: 0,
      pushErrorRate: 0,
    };
  }
  if (match.definition.response === 'summary') {
    return {
      alerts: [],
      generatedAt: new Date().toISOString(),
      metrics: {},
    };
  }
  if (match.definition.response === 'export') {
    return { contentType: 'application/json', data: {}, id };
  }
  if (match.definition.response === 'detail') {
    return { id, items: [], nextCursor: null };
  }
  return { id, ok: true };
}

export async function handleAdminRoute(request: Request, method: AdminMethod, path: string): Promise<Response> {
  const match = matchAdminRoute(method, path);
  if (!match) {
    return withApi(request, { auth: { app: 'admin', roles: ['OWNER', 'ADMIN'] } }, () =>
      Promise.reject(new AppError('NOT_FOUND', 'Admin endpoint not found.')),
    );
  }
  return withApi(
    request,
    {
      auth: { app: 'admin', roles: rolesFor(match.definition) },
      ...(match.definition.input ? { input: match.definition.input } : {}),
    },
    async ({ input, requestId, staff }) => {
      if (!staff) throw new Error('Missing staff context.');
      await writeAudit(input, match, staff, requestId);
      return apiJson(responseFor(match), { status: method === 'POST' && match.definition.response === 'ok' ? 201 : 200 }, requestId);
    },
  );
}
