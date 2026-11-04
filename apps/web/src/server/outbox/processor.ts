import 'server-only';

import { AddressSchema, ServiceKeySchema, addDays as addLondonDays, formatGBP, fromDbDate, londonToday } from '@sv/contracts';
import { enqueueOutbox, Prisma, prisma, type DbTx } from '@sv/db';
import type { EmailTemplateData, EmailTemplateKey } from '@sv/emails';
import { z } from 'zod';
import { sendPushOutbox, type PushSendPayload } from '../integrations/expo-push';
import { sendTransactionalEmail, type EmailSendPayload } from '../integrations/mail';
import { processMailDelivery } from '../mail/delivery';
import { MailDeferredError, MailPermanentError, MailReviewRequiredError, MailTransientError } from '../mail/errors';
import { dbDateLabel, londonDateTimeToUtc, slotLabel } from '../london-time';
import { channelsForEvent, type MatrixChannels } from '../notifications/matrix';
import { getSetting } from '../settings';
import { bookingPurposeLink, contactEmailHash, manageLinkForBooking } from '../auth/customer-links';
import { actionEmailStillValid, readActionEmailGuard, type ActionEmailGuard } from '../notifications/action-email-guard';
import { payLinkForBooking, payLinkForExtraCharge, payLinkForManualQuote } from '../services/customer-self-service';
import { runRefundOutbox } from '../services/payments';
import { outboxProcessFrom } from '../env';

interface ClaimedOutboxEvent {
  attempts: number;
  id: string;
  payload: unknown;
  type: string;
}

interface EventPayload {
  expectedUpdatedAt?: string;
  notifyCustomer?: boolean;
  template?: 'CONFIRMATION' | 'PAYMENT_LINK' | 'MANAGE_LINK';
  bookingId?: string;
  contactMessageId?: string;
  driverId?: string;
  extraChargeId?: string;
  issue?: string;
  manualQuoteId?: string;
  paymentId?: string;
  payoutId?: string;
  previousDriverId?: string | null;
  bookingVersion?: number;
  assignmentIds?: string[];
  driverIds?: string[];
  quoteId?: string;
  refundId?: string;
  refundPence?: number;
  toStage?: string;
}

const DispatchSnapshotSchema = z.object({
  kind: z.enum(['booking.assigned', 'booking.offered', 'booking.driver_accepted']),
  bookingId: z.string().min(1), bookingVersion: z.number().int().nonnegative(),
  assignmentIds: z.array(z.string().min(1)).min(1), driverIds: z.array(z.string().min(1)).min(1),
}).strict();
type DispatchSnapshot = z.infer<typeof DispatchSnapshotSchema>;

function dispatchSnapshot(event: ClaimedOutboxEvent): DispatchSnapshot | null {
  if (!['booking.assigned', 'booking.offered', 'booking.driver_accepted'].includes(event.type)) return null;
  const payload = asPayload(event.payload);
  // Older durable events have no snapshot. Keep their original processing path.
  if (payload.bookingVersion === undefined) return null;
  return DispatchSnapshotSchema.parse({ kind: event.type, bookingId: payload.bookingId, bookingVersion: payload.bookingVersion,
    assignmentIds: payload.assignmentIds, driverIds: payload.driverIds });
}
function channelDispatchSnapshot(value: unknown): DispatchSnapshot | null {
  if (!value || typeof value !== 'object' || !('dispatchSnapshot' in value)) return null;
  return DispatchSnapshotSchema.parse(value.dispatchSnapshot);
}
async function snapshotRecipients(tx: DbTx, snapshot: DispatchSnapshot): Promise<string[]> {
  const booking = await tx.booking.findUnique({ where: { id: snapshot.bookingId },
    select: { version: true, status: true, deletedAt: true, dispatchStatus: true, driverId: true } });
  const offered = snapshot.kind === 'booking.offered';
  if (!booking || booking.deletedAt || booking.version < snapshot.bookingVersion
    || !['CONFIRMED', 'IN_PROGRESS'].includes(booking.status)
    || booking.dispatchStatus !== (offered ? 'OFFERED' : 'ACCEPTED')) return [];
  const assignments = await tx.assignment.findMany({
    where: { id: { in: snapshot.assignmentIds }, bookingId: snapshot.bookingId, driverId: { in: snapshot.driverIds },
      status: offered ? 'OFFERED' : 'ACCEPTED', ...(offered ? { expiresAt: { gt: new Date() } } : {}) },
    select: { driverId: true },
  });
  // Assignment identity survives notes/contact edits but changes on reassigning
  // even the same driver. This prevents old events notifying a replacement.
  return [...new Set(assignments.map((assignment) => assignment.driverId))]
    .filter((driverId) => snapshot.driverIds.includes(driverId) && (offered || booking.driverId === driverId));
}

type AdminPushConfig = NonNullable<MatrixChannels['adminPush']>;
type DriverPushTarget = NonNullable<MatrixChannels['driverPush']>['target'];

const BACKOFF_MINUTES = [1, 5, 15, 60, 360] as const;
// Email reads a display label only; it does not revalidate or change pricing.
const ServiceLabelsSchema = z.object({ services: z.record(z.string(), z.object({ label: z.string().trim().min(1).max(120) })) });

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asPayload(value: unknown): EventPayload {
  return value && typeof value === 'object' ? value : {};
}

function publicEventPayload(payload: EventPayload): EventPayload {
  const data = { ...payload };
  delete data.assignmentIds;
  delete data.driverIds;
  delete data.bookingVersion;
  return data;
}

function routeLabel(pickup: unknown, dropoff: unknown): string {
  const pickupTown = pickup && typeof pickup === 'object' && 'town' in pickup ? String(pickup.town) : 'Pickup';
  const dropoffTown = dropoff && typeof dropoff === 'object' && 'town' in dropoff ? String(dropoff.town) : null;
  return dropoffTown ? `${pickupTown} to ${dropoffTown}` : pickupTown;
}

function addressLabel(value: unknown): string | undefined {
  const parsed = AddressSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const address = parsed.data;
  return [address.flat, address.line1, address.line2, address.town, address.postcode].filter(Boolean).join(', ');
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

async function adminUsers(tx: DbTx, options: { ownerOnly?: boolean } = {}) {
  return tx.user.findMany({
    where: { role: options.ownerOnly ? 'OWNER' : { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
    select: { email: true, id: true, name: true },
  });
}

async function adminEmails(tx: DbTx): Promise<string[]> {
  const users = await adminUsers(tx);
  const contact = await getSetting('contact');
  const configured = contact.emailAdminAlerts;
  return configured.length > 0 ? configured : users.map((user) => user.email);
}

async function bookingEmailData(tx: DbTx, bookingId: string, extra: Partial<EmailTemplateData> = {}): Promise<{ customerEmail: string; data: EmailTemplateData }> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      contactEmail: true,
      contactName: true,
      completedAt: true,
      dropoff: true,
      id: true,
      moveDate: true,
      paidPence: true,
      pickup: true,
      pricingVersion: { select: { config: true } },
      reference: true,
      refundedPence: true,
      service: true,
      slot: true,
      totalPence: true,
    },
  });
  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  const savedConfig = ServiceLabelsSchema.safeParse(booking.pricingVersion.config);
  const service = ServiceKeySchema.safeParse(booking.service);
  const pickupLabel = addressLabel(booking.pickup);
  const dropoffLabel = addressLabel(booking.dropoff);
  const [web, contact, company] = await Promise.all([getSetting('web'), getSetting('contact'), getSetting('company')]);
  const [manageToken, trackToken, reviewToken] = await Promise.all([
    manageLinkForBooking(booking),
    bookingPurposeLink(booking, 'track', addDays(booking.moveDate, 2)),
    booking.completedAt ? bookingPurposeLink(booking, 'review', addDays(booking.completedAt, 60)) : Promise.resolve(null),
  ]);
  const data: EmailTemplateData = {
    amountPence: booking.totalPence,
    paidPence: booking.paidPence,
    refundedPence: booking.refundedPence,
    totalPence: booking.totalPence,
    balancePence: booking.totalPence - (booking.paidPence - booking.refundedPence),
    canonicalOrigin: web.canonicalOrigin,
    contactEmail: contact.emailBookings ?? contact.emailPublic,
    customerName: booking.contactName,
    legalLine: company.legalName ? `${company.legalName}. Booking reference ${booking.reference}.` : `Booking reference ${booking.reference}.`,
    manageUrl: `/manage/session?token=${encodeURIComponent(manageToken)}`,
    moveDateLabel: dbDateLabel(booking.moveDate),
    reference: booking.reference,
    routeLabel: routeLabel(booking.pickup, booking.dropoff),
    serviceLabel: savedConfig.success && service.success ? savedConfig.data.services[service.data]?.label ?? booking.service : booking.service,
    slotLabel: slotLabel(booking.slot),
    ...(pickupLabel ? { pickupLabel } : {}),
    ...(dropoffLabel ? { dropoffLabel } : {}),
    ...(reviewToken ? { reviewUrl: `/review/${encodeURIComponent(reviewToken)}` } : {}),
    trackingUrl: `/track/${encodeURIComponent(trackToken)}`,
    ...extra,
  };
  return { customerEmail: booking.contactEmail, data };
}

async function manualQuoteEmailData(tx: DbTx, payload: EventPayload): Promise<{ customerEmail: string; data: EmailTemplateData }> {
  const where = payload.manualQuoteId ? { id: payload.manualQuoteId } : payload.quoteId ? { quoteId: payload.quoteId } : undefined;
  if (!where) throw new Error('Manual quote id missing');
  const manualQuote = await tx.manualQuote.findFirst({
    where,
    select: {
      contactEmail: true,
      details: true,
      adminMessage: true,
      id: true,
      pricePence: true,
      quoteId: true,
      validUntil: true,
    },
  });
  if (!manualQuote) throw new Error('Manual quote not found');
  const quote = await tx.quote.findUnique({
    where: { id: manualQuote.quoteId },
    select: { dropoff: true, pickup: true },
  });
  if (!quote) throw new Error('Manual quote source quote not found');
  const [web, contact] = await Promise.all([getSetting('web'), getSetting('contact')]);
  const details = manualQuote.adminMessage ?? manualQuote.details ?? undefined;
  const payToken = manualQuote.pricePence && manualQuote.validUntil ? await payLinkForManualQuote(manualQuote) : null;
  return {
    customerEmail: manualQuote.contactEmail,
    data: {
      amountPence: manualQuote.pricePence ?? 0,
      canonicalOrigin: web.canonicalOrigin,
      contactEmail: contact.emailBookings ?? contact.emailPublic,
      ...(payToken ? { payUrl: `/pay/${encodeURIComponent(payToken)}` } : {}),
      reference: `MQ-${manualQuote.id.slice(-8).toUpperCase()}`,
      routeLabel: routeLabel(quote.pickup, quote.dropoff),
      ...(details ? { message: details } : {}),
    },
  };
}

async function contactEmailData(tx: DbTx, payload: EventPayload): Promise<{ customerEmail: string; data: EmailTemplateData } | null> {
  if (!payload.contactMessageId) return null;
  const message = await tx.contactMessage.findUnique({
    where: { id: payload.contactMessageId },
    select: { email: true, message: true },
  });
  if (!message) return null;
  const [web, contact] = await Promise.all([getSetting('web'), getSetting('contact')]);
  return {
    customerEmail: message.email,
    data: {
      canonicalOrigin: web.canonicalOrigin,
      contactEmail: contact.emailBookings ?? contact.emailPublic,
      message: message.message,
      reference: `CM-${payload.contactMessageId.slice(-8).toUpperCase()}`,
    },
  };
}

async function enqueueEmail(tx: DbTx, event: ClaimedOutboxEvent, template: EmailTemplateKey, to: string | string[], data: EmailTemplateData, actionEmailGuard?: ActionEmailGuard): Promise<void> {
  const recipients = Array.isArray(to) ? to : [to];
  if (recipients.length === 0) throw new MailPermanentError('MAIL_INVALID_RECIPIENT');
  await enqueueOutbox(
    tx,
    'email.send',
    json({ ...({ data, template, to: recipients } satisfies EmailSendPayload), ...(dispatchSnapshot(event) ? { dispatchSnapshot: dispatchSnapshot(event) } : {}), ...(actionEmailGuard ? { actionEmailGuard } : {}) }),
    `${event.id}:email:${template}:${recipients.join(',')}`,
  );
}

async function enqueueAdminNotification(
  tx: DbTx,
  event: ClaimedOutboxEvent,
  title: string,
  body: string,
  data: Record<string, unknown>,
  options: { ownerOnly?: boolean } = {},
): Promise<void> {
  const users = await adminUsers(tx, options);
  for (const user of users) {
    await enqueueOutbox(
      tx,
      'notification.create',
      json({ body, data: { ...data, deliveryKey: `${event.id}:notification:${user.id}` }, title, type: event.type, userId: user.id, ...(dispatchSnapshot(event) ? { dispatchSnapshot: dispatchSnapshot(event) } : {}) }),
      `${event.id}:notification:${user.id}`,
    );
  }
}

async function enqueuePush(
  tx: DbTx,
  event: ClaimedOutboxEvent,
  userId: string,
  payload: Omit<PushSendPayload, 'userId'>,
  options: { dedupeSuffix: string; nextAttemptAt?: Date },
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      ...(options.nextAttemptAt ? { nextAttemptAt: options.nextAttemptAt } : {}),
      dedupeKey: `${event.id}:push:${options.dedupeSuffix}:${userId}`,
      payload: json({ ...({ ...payload, userId } satisfies PushSendPayload), ...(dispatchSnapshot(event) ? { dispatchSnapshot: dispatchSnapshot(event) } : {}) }),
      type: 'push.send',
    },
  });
}

async function enqueueAdminPush(
  tx: DbTx,
  event: ClaimedOutboxEvent,
  title: string,
  body: string,
  data: Record<string, unknown>,
  push: AdminPushConfig | undefined,
): Promise<void> {
  if (!push) return;
  const users = await adminUsers(tx, push.ownerOnly ? { ownerOnly: true } : {});
  for (const user of users) {
    await enqueuePush(
      tx,
      event,
      user.id,
      {
        app: 'ADMIN',
        body,
        category: push.category,
        data: { ...data, deliveryKey: `${event.id}:notification:${user.id}`, type: push.category },
        sound: push.sound,
        title,
        ...(push.timeSensitive ? { timeSensitive: true } : {}),
      },
      { dedupeSuffix: push.category },
    );
  }
}

const SLOT_STARTS = {
  AFTERNOON: '12:00',
  EVENING: '17:00',
  MORNING: '08:00',
} as const;

function londonMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    timeZone: 'Europe/London',
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));
  return (values.get('hour') ?? 0) * 60 + (values.get('minute') ?? 0);
}

function minutesForTime(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function inQuietHours(now: Date, quiet: { end: string; start: string }): boolean {
  const current = londonMinutes(now);
  const start = minutesForTime(quiet.start);
  const end = minutesForTime(quiet.end);
  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function quietHoursEnd(now: Date, end: string): Date {
  const current = londonMinutes(now);
  const endMinutes = minutesForTime(end);
  const today = londonToday(now);
  const endDate = current < endMinutes ? today : addLondonDays(today, 1);
  return londonDateTimeToUtc(endDate, end);
}

async function bookingStartsWithinHours(tx: DbTx, bookingId: string | undefined, hours: number, now = new Date()): Promise<boolean> {
  if (!bookingId) return false;
  const booking = await tx.booking.findUnique({ where: { id: bookingId }, select: { moveDate: true, slot: true } });
  if (!booking) return false;
  const startsAt = londonDateTimeToUtc(fromDbDate(booking.moveDate), SLOT_STARTS[booking.slot]);
  return startsAt.getTime() <= now.getTime() + hours * 60 * 60_000;
}

async function driverPushDelay(tx: DbTx, event: ClaimedOutboxEvent, payload: EventPayload): Promise<Date | undefined> {
  const channels = channelsForEvent(event.type);
  const driverPush = channels?.driverPush;
  if (!driverPush?.quietHours || driverPush.timeSensitive) return undefined;
  if (driverPush.category === 'JOB_CHANGED' && await bookingStartsWithinHours(tx, payload.bookingId, 48)) return undefined;
  const settings = await getSetting('notifications').catch(() => ({
    driverQuietHours: { end: '07:00', start: '21:00' },
    newBookingRepeatUntilSeen: true,
  }));
  const now = new Date();
  return inQuietHours(now, settings.driverQuietHours) ? quietHoursEnd(now, settings.driverQuietHours.end) : undefined;
}

async function driverRecipients(tx: DbTx, payload: EventPayload, target: DriverPushTarget): Promise<string[]> {
  if (target === 'payload-driver') return payload.driverId ? [payload.driverId] : [];
  if (target === 'previous-driver') {
    if ('previousDriverId' in payload) return payload.previousDriverId ? [payload.previousDriverId] : [];
    if (!payload.bookingId) return [];
    const assignment = await tx.assignment.findFirst({
      orderBy: { respondedAt: 'desc' },
      select: { driverId: true },
      where: { bookingId: payload.bookingId, status: { in: ['ACCEPTED', 'WITHDRAWN'] } },
    });
    return assignment ? [assignment.driverId] : [];
  }
  if (!payload.bookingId) return [];
  if (target === 'offered') {
    const offers = await tx.assignment.findMany({
      select: { driverId: true },
      where: { bookingId: payload.bookingId, status: 'OFFERED' },
    });
    return offers.map((offer) => offer.driverId);
  }
  const booking = await tx.booking.findUnique({ where: { id: payload.bookingId }, select: { driverId: true } });
  return booking?.driverId ? [booking.driverId] : [];
}

async function enqueueDriverPush(
  tx: DbTx,
  event: ClaimedOutboxEvent,
  title: string,
  body: string,
  data: Record<string, unknown>,
  payload: EventPayload,
): Promise<void> {
  const channels = channelsForEvent(event.type);
  const driverPush = channels?.driverPush;
  if (!driverPush) return;
  const snapshot = dispatchSnapshot(event);
  const recipients = snapshot ? await snapshotRecipients(tx, snapshot) : await driverRecipients(tx, payload, driverPush.target);
  const nextAttemptAt = await driverPushDelay(tx, event, payload);
  for (const userId of recipients) {
    await enqueuePush(
      tx,
      event,
      userId,
      {
        app: 'DRIVER',
        body,
        category: driverPush.category,
        data: { ...data, type: driverPush.category },
        sound: driverPush.sound,
        title,
        ...(driverPush.timeSensitive ? { timeSensitive: true } : {}),
      },
      { dedupeSuffix: driverPush.category, ...(nextAttemptAt ? { nextAttemptAt } : {}) },
    );
  }
}

async function expandDomainEvent(tx: DbTx, event: ClaimedOutboxEvent): Promise<void> {
  const channels = channelsForEvent(event.type);
  if (!channels) return;
  const payload = asPayload(event.payload);
  let actionEmailGuard: ActionEmailGuard | undefined;
  if (event.type === 'booking.confirmed' && !z.string().trim().min(1).safeParse(payload.bookingId).success) {
    throw new MailPermanentError('MAIL_BOOKING_CONFIRMATION_MISSING_BOOKING');
  }
  if ((event.type === 'manual_quote.priced' || event.type === 'manual_quote.declined') && payload.manualQuoteId && payload.expectedUpdatedAt) {
    actionEmailGuard = { kind: 'manual-quote', id: payload.manualQuoteId, expectedUpdatedAt: payload.expectedUpdatedAt, status: event.type === 'manual_quote.priced' ? 'PRICED' : 'DECLINED' };
    if (!await actionEmailStillValid(tx, actionEmailGuard)) return;
  }
  if (event.type === 'booking.pending_payment') {
    const pending = payload.bookingId ? await tx.booking.findFirst({ where: {
      id: payload.bookingId, status: 'PENDING_PAYMENT', deletedAt: null, holdExpiresAt: { gt: new Date() },
    }, select: { id: true } }) : null;
    if (!pending) return;
  }
  const snapshot = dispatchSnapshot(event);
  if (snapshot && (await snapshotRecipients(tx, snapshot)).length === 0) return;
  if (event.type === 'payment.after_expiry_refunded') {
    const payment = payload.paymentId ? await tx.payment.findUnique({
      where: { id: payload.paymentId },
      select: { amountPence: true, refunds: { where: { status: 'SUCCEEDED' }, select: { amountPence: true } } },
    }) : null;
    const refundedPence = payment?.refunds.reduce((total, refund) => total + refund.amountPence, 0) ?? 0;
    if (!payment || refundedPence < payment.amountPence) throw new Error('The late-payment refund has not succeeded yet.');
  }
  if (event.type === 'job.stage_changed' && payload.toStage !== 'EN_ROUTE_TO_PICKUP') return;
  let customer: { customerEmail: string; data: EmailTemplateData } | null = null;
  if (payload.bookingId) {
    customer = await bookingEmailData(tx, payload.bookingId);
  } else if (payload.manualQuoteId || payload.quoteId) {
    customer = await manualQuoteEmailData(tx, payload);
  } else if (payload.contactMessageId) {
    customer = await contactEmailData(tx, payload);
  }

  if (event.type === 'booking.driver_accepted' && payload.bookingId && customer) {
    const booking = await tx.booking.findUnique({
      where: { id: payload.bookingId },
      select: { driver: { select: { user: { select: { name: true } } } } },
    });
    const driverName = booking?.driver?.user.name;
    const firstName = driverName?.split(/\s+/)[0];
    if (firstName) customer = { ...customer, data: { ...customer.data, driverFirstName: firstName } };
  }

  const resendTemplate = payload.template === 'CONFIRMATION' ? 'booking-confirmed' : payload.template === 'PAYMENT_LINK' ? 'payment-link' : payload.template === 'MANAGE_LINK' ? 'manage-link' : null;
  const customerTemplate = event.type === 'booking.email_resent' ? resendTemplate : channels.customerEmail;
  if (event.type === 'booking.confirmed' && payload.bookingId && customer) {
    actionEmailGuard = { kind: 'booking-confirmation', id: payload.bookingId, emailHash: contactEmailHash(customer.customerEmail) };
    if (!await actionEmailStillValid(tx, actionEmailGuard)) return;
  }
  if ((event.type === 'booking.email_resent' || event.type === 'booking.payment_requested') && payload.bookingId && customer) {
    if (typeof payload.bookingVersion !== 'number') throw new Error('Booking email version missing.');
    actionEmailGuard = { kind: 'booking', id: payload.bookingId, version: payload.bookingVersion, emailHash: contactEmailHash(customer.customerEmail), template: event.type === 'booking.payment_requested' ? 'PAYMENT_LINK' : payload.template ?? 'MANAGE_LINK' };
    if (!await actionEmailStillValid(tx, actionEmailGuard)) return;
  }
  if (customerTemplate === 'payment-link' && payload.bookingId && customer) {
    const booking = await tx.booking.findUnique({ where: { id: payload.bookingId }, select: { id: true, contactEmail: true, holdExpiresAt: true, status: true, deletedAt: true } });
    if (!booking || booking.deletedAt || booking.status !== 'PENDING_PAYMENT' || !booking.holdExpiresAt || booking.holdExpiresAt <= new Date()) return;
    const token = await payLinkForBooking(booking);
    customer = { ...customer, data: { ...customer.data, payUrl: `/pay/${encodeURIComponent(token)}`, holdExpiresAt: booking.holdExpiresAt.toISOString() } };
  }

  const title = event.type === 'booking.confirmed'
    ? `New booking - ${customer?.data.amountPence ? formatGBP(customer.data.amountPence) : 'paid'}`
    : event.type === 'booking.pending_payment' ? 'Booking awaiting payment' : event.type.replaceAll('_', ' ').replaceAll('.', ' ');
  const body = event.type === 'booking.confirmed' && customer
    ? `${customer.data.serviceLabel ?? 'Move'}, ${customer.data.moveDateLabel ?? ''} ${customer.data.slotLabel ?? ''}. ${customer.data.routeLabel ?? ''}`.trim()
    : event.type === 'booking.pending_payment' ? `${customer?.data.routeLabel ?? 'New checkout'}. Payment has not been confirmed.` : payload.issue ?? customer?.data.routeLabel ?? 'Open Speedy Van admin.';
  // Only non-sensitive booking facts belong in push payloads. Never copy email data
  // wholesale: it also contains signed customer links and contact information.
  const alertData: Record<string, unknown> = {
    ...publicEventPayload(payload), eventType: event.type,
    ...(event.type === 'booking.confirmed' && customer ? {
      type: 'NEW_BOOKING',
      reference: customer.data.reference,
      pricePence: customer.data.amountPence,
      route: customer.data.routeLabel,
      service: customer.data.serviceLabel,
      slot: customer.data.slotLabel,
      moveDateLabel: customer.data.moveDateLabel,
      url: `speedyvan-admin://bookings/${encodeURIComponent(payload.bookingId ?? '')}`,
    } : {}),
  };

  if (customerTemplate && customer && payload.notifyCustomer !== false) {
    const refund = payload.refundId
      ? await tx.refund.findUnique({ where: { id: payload.refundId }, select: { amountPence: true } })
      : null;
    const extraCharge = payload.extraChargeId
      ? await tx.extraCharge.findUnique({
          where: { id: payload.extraChargeId },
          include: { booking: { select: { contactEmail: true } } },
        })
      : null;
    const extraPayToken = extraCharge ? await payLinkForExtraCharge(extraCharge) : null;
    await enqueueEmail(tx, event, customerTemplate as EmailTemplateKey, customer.customerEmail, {
      ...customer.data,
      ...(extraCharge ? { amountPence: extraCharge.amountPence, message: extraCharge.description } : {}),
      ...(extraPayToken ? { payUrl: `/pay/${encodeURIComponent(extraPayToken)}` } : {}),
      ...(typeof payload.refundPence === 'number' ? { refundPence: payload.refundPence } : {}),
      ...(refund ? { refundPence: refund.amountPence } : {}),
    }, actionEmailGuard);
  }
  if (channels.adminEmail) {
    const emails = await adminEmails(tx);
    // Admin email is optional when no recipients are configured. Required
    // customer jobs must always persist and surface invalid-address failures.
    if (emails.length > 0) await enqueueEmail(tx, event, channels.adminEmail as EmailTemplateKey, emails, customer?.data ?? { message: payload.issue ?? event.type });
  }
  if (channels.adminNotification) {
    await enqueueAdminNotification(
      tx,
      event,
      title,
      body,
      alertData,
      channels.adminNotificationOwnerOnly ? { ownerOnly: true } : {},
    );
  }
  if (channels.adminPush && (!channels.adminPush.onlyWithinHours || await bookingStartsWithinHours(tx, payload.bookingId, channels.adminPush.onlyWithinHours))) {
    await enqueueAdminPush(tx, event, title, body, { ...alertData, category: channels.adminPush.category }, channels.adminPush);
  }
  if (channels.driverPush) {
    await enqueueDriverPush(tx, event, title, body, { ...publicEventPayload(payload), category: channels.driverPush.category, eventType: event.type }, payload);
  }
}

async function handleEvent(event: ClaimedOutboxEvent): Promise<void> {
  if (event.type === 'email.reply') {
    const payload = z.object({ deliveryId: z.string().min(1) }).strict().parse(event.payload);
    await processMailDelivery(payload.deliveryId);
    return;
  }
  if (event.type === 'email.send') {
    const actionGuard = readActionEmailGuard(event.payload);
    if (actionGuard && !await actionEmailStillValid(prisma, actionGuard)) return;
    const snapshot = channelDispatchSnapshot(event.payload);
    if (snapshot && (await snapshotRecipients(prisma, snapshot)).length === 0) return;
    await sendTransactionalEmail(event.payload as EmailSendPayload, event.id);
    return;
  }
  if (event.type === 'notification.create') {
    const snapshot = channelDispatchSnapshot(event.payload);
    if (snapshot && (await snapshotRecipients(prisma, snapshot)).length === 0) return;
    const payload = event.payload as { body: string; data?: Prisma.InputJsonValue; title: string; type: string; userId: string };
    if (payload.type === 'booking.pending_payment') {
      const data = asPayload(payload.data);
      const pending = data.bookingId ? await prisma.booking.findFirst({ where: {
        id: data.bookingId, status: 'PENDING_PAYMENT', deletedAt: null, holdExpiresAt: { gt: new Date() },
      }, select: { id: true } }) : null;
      if (!pending) return;
    }
    await prisma.notification.upsert({
      where: { id: event.id },
      update: {},
      create: {
        id: event.id,
        body: payload.body,
        data: payload.data ?? Prisma.JsonNull,
        title: payload.title,
        type: payload.type,
        userId: payload.userId,
      },
    });
    return;
  }
  if (event.type === 'push.send') {
    const snapshot = channelDispatchSnapshot(event.payload);
    const payload = event.payload as PushSendPayload;
    if (snapshot) {
      const recipients = await snapshotRecipients(prisma, snapshot);
      if (payload.app === 'DRIVER' ? !recipients.includes(payload.userId) : recipients.length === 0) return;
    }
    await sendPushOutbox(payload, event.id);
    return;
  }
  if (event.type === 'payment.refund') {
    const payload = asPayload(event.payload);
    if (!payload.refundId) throw new Error('refundId missing');
    await prisma.$transaction(async (tx) => runRefundOutbox(tx, payload.refundId as string, { notifyCustomer: payload.notifyCustomer !== false }));
    return;
  }
}

type ImmediateOutboxType = 'booking.confirmed' | 'booking.rescheduled' | 'booking.extra_paid'
  | 'payment.refund' | 'payment.refund.created' | 'payment.after_expiry_refunded'
  | 'notification.create' | 'push.send' | 'email.send' | 'email.reply';

interface OutboxDispatchScope {
  readonly rootEventId: string;
}

async function claimDueEvents(
  limit: number,
  types?: readonly ImmediateOutboxType[],
  scope?: OutboxDispatchScope,
): Promise<ClaimedOutboxEvent[]> {
  if (scope && !scope.rootEventId) throw new Error('An outbox dispatch scope requires an event id.');
  const processFrom = outboxProcessFrom();
  return prisma.$transaction(async (tx) => {
    return tx.$queryRaw<ClaimedOutboxEvent[]>`
      UPDATE "OutboxEvent"
      SET "status" = 'PROCESSING', "attempts" = "attempts" + 1, "claimedAt" = now()
      WHERE "id" IN (
        SELECT "id"
        FROM "OutboxEvent"
        WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
        ${processFrom ? Prisma.sql`AND "createdAt" >= ${processFrom}` : Prisma.empty}
        ${types?.length ? Prisma.sql`AND "type" IN (${Prisma.join(types)})` : Prisma.empty}
        ${scope ? Prisma.sql`AND ("id" = ${scope.rootEventId} OR starts_with("dedupeKey", ${`${scope.rootEventId}:`}))` : Prisma.empty}
        ${scope ? Prisma.sql`ORDER BY CASE "type" WHEN 'notification.create' THEN 1 WHEN 'push.send' THEN 2 WHEN 'email.send' THEN 3 ELSE 0 END, "createdAt" ASC` : Prisma.sql`ORDER BY "createdAt" ASC`}
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING "id", "type", "payload", "attempts"
    `;
  });
}

async function markDone(id: string, db: Pick<DbTx, 'outboxEvent'> = prisma): Promise<void> {
  await db.outboxEvent.update({ data: { claimedAt: null, lastError: null, processedAt: new Date(), status: 'DONE' }, where: { id } });
}

async function handleAndCompleteEvent(event: ClaimedOutboxEvent): Promise<void> {
  if (['email.send', 'email.reply', 'notification.create', 'push.send', 'payment.refund'].includes(event.type)) {
    await handleEvent(event);
    await markDone(event.id);
    return;
  }
  // Fan-out and completion are one commit. A crash cannot leave committed
  // channel jobs attached to a root that will expand and collide on retry.
  await prisma.$transaction(async (tx) => {
    await expandDomainEvent(tx, event);
    await markDone(event.id, tx);
  });
}

async function markFailed(event: ClaimedOutboxEvent, error: unknown): Promise<void> {
  const attempts = event.attempts;
  const mailEvent = event.type === 'email.send' || event.type === 'email.reply';
  const errorCode = error instanceof MailDeferredError || error instanceof MailPermanentError
    || error instanceof MailReviewRequiredError || error instanceof MailTransientError ? error.code : 'MAIL_OUTBOX_UNAVAILABLE';
  // Prisma/provider diagnostics can include serialized MIME or credentials.
  // Only normalized mail codes may enter persisted errors or admin alerts.
  const message = mailEvent ? errorCode : error instanceof Error ? error.message : 'Unknown outbox error';
  const writeFailure = async (data: Prisma.OutboxEventUpdateInput, status: string, nextAttemptAt: Date | null): Promise<void> => {
    const write = async (tx: DbTx): Promise<void> => {
      if (mailEvent) {
        const reply = event.type === 'email.reply' ? z.object({ deliveryId: z.string().min(1) }).strict().safeParse(event.payload) : null;
        // Keep the admin ledger consistent with the worker's retry policy. This
        // guarded SQL update cannot overwrite an accepted/uncertain result or a
        // different worker's active SMTP attempt, even if its state just changed.
        await tx.mailDelivery.updateMany({
          where: {
            OR: [{ outboxEventId: event.id }, ...(reply?.success ? [{ id: reply.data.deliveryId }] : [])],
            status: { in: ['QUEUED', 'RETRY', 'DEFERRED'] },
          },
          data: { status, nextAttemptAt, lastErrorCode: errorCode },
        });
      }
      await tx.outboxEvent.update({ data, where: { id: event.id } });
    };
    if (mailEvent) await prisma.$transaction(write);
    else await write(prisma);
  };
  if (error instanceof MailDeferredError) {
    await writeFailure({ attempts: { decrement: 1 }, claimedAt: null, lastError: message, nextAttemptAt: error.retryAt, status: 'PENDING' }, 'DEFERRED', error.retryAt);
    return;
  }
  if (error instanceof MailReviewRequiredError || error instanceof MailPermanentError || attempts >= 6) {
    await writeFailure({ claimedAt: null, lastError: message, status: 'FAILED' }, error instanceof MailReviewRequiredError ? 'UNCERTAIN' : 'FAILED', null);
    // The original system alert already has an in-app channel. A broken mail
    // account must not create an endless chain of alert emails about itself.
    if (event.type === 'email.send' && z.object({ template: z.literal('admin-system-alert') }).safeParse(event.payload).success) return;
    await prisma.outboxEvent.upsert({
      where: { dedupeKey: `system.alert:outbox-failed:${event.id}` },
      update: {},
      create: {
        dedupeKey: `system.alert:outbox-failed:${event.id}`,
        payload: json({ issue: `Outbox event ${event.id} failed: ${message}` }),
        type: 'system.alert',
      },
    });
    return;
  }
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 360;
  const nextAttemptAt = new Date(Date.now() + minutes * 60_000);
  await writeFailure({ claimedAt: null, lastError: message, nextAttemptAt, status: 'PENDING' }, 'RETRY', nextAttemptAt);
}

export async function processOutboxBatch(
  limit = 25,
  types?: readonly ImmediateOutboxType[],
  scope?: OutboxDispatchScope,
): Promise<{ done: number; failed: number }> {
  const events = await claimDueEvents(limit, types, scope);
  let done = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await handleAndCompleteEvent(event);
      done += 1;
    } catch (error) {
      await markFailed(event, error);
      failed += 1;
    }
  }
  return { done, failed };
}

export async function processOutboxEventNow(id: string): Promise<{ done: number; failed: number }> {
  const event = await prisma.outboxEvent.update({
    data: { attempts: { increment: 1 }, claimedAt: new Date(), status: 'PROCESSING' },
    where: { id },
    select: { attempts: true, id: true, payload: true, type: true },
  });
  try {
    await handleAndCompleteEvent(event);
    return { done: 1, failed: 0 };
  } catch (error) {
    await markFailed(event, error);
    return { done: 0, failed: 1 };
  }
}
