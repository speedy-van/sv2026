import 'server-only';

import { formatGBP } from '@sv/contracts';
import { enqueueOutbox, Prisma, prisma, type DbTx } from '@sv/db';
import type { EmailTemplateData, EmailTemplateKey } from '@sv/emails';
import { sendTransactionalEmail, type EmailSendPayload } from '../integrations/resend';
import { dbDateLabel, slotLabel } from '../london-time';
import { channelsForEvent } from '../notifications/matrix';
import { bookingStatusToken } from '../status-token';
import { getSetting } from '../settings';
import { runRefundOutbox } from '../services/payments';

interface ClaimedOutboxEvent {
  attempts: number;
  id: string;
  payload: unknown;
  type: string;
}

interface EventPayload {
  bookingId?: string;
  issue?: string;
  manualQuoteId?: string;
  paymentId?: string;
  quoteId?: string;
  refundId?: string;
}

const BACKOFF_MINUTES = [1, 5, 15, 60, 360] as const;

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function asPayload(value: unknown): EventPayload {
  return value && typeof value === 'object' ? value : {};
}

function routeLabel(pickup: unknown, dropoff: unknown): string {
  const pickupTown = pickup && typeof pickup === 'object' && 'town' in pickup ? String(pickup.town) : 'Pickup';
  const dropoffTown = dropoff && typeof dropoff === 'object' && 'town' in dropoff ? String(dropoff.town) : null;
  return dropoffTown ? `${pickupTown} to ${dropoffTown}` : pickupTown;
}

async function adminUsers(tx: DbTx) {
  return tx.user.findMany({
    where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE' },
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
      dropoff: true,
      id: true,
      moveDate: true,
      pickup: true,
      reference: true,
      service: true,
      slot: true,
      totalPence: true,
    },
  });
  if (!booking) throw new Error(`Booking ${bookingId} not found`);
  const [web, contact, company] = await Promise.all([getSetting('web'), getSetting('contact'), getSetting('company')]);
  const token = bookingStatusToken({ bookingId: booking.id, reference: booking.reference });
  const data: EmailTemplateData = {
    amountPence: booking.totalPence,
    canonicalOrigin: web.canonicalOrigin,
    contactEmail: contact.emailBookings ?? contact.emailPublic,
    legalLine: company.legalName ? `${company.legalName}. Booking reference ${booking.reference}.` : `Booking reference ${booking.reference}.`,
    manageUrl: `/manage?token=${encodeURIComponent(token)}`,
    moveDateLabel: dbDateLabel(booking.moveDate),
    reference: booking.reference,
    routeLabel: routeLabel(booking.pickup, booking.dropoff),
    serviceLabel: booking.service,
    slotLabel: slotLabel(booking.slot),
    trackingUrl: `/track?token=${encodeURIComponent(token)}`,
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
      id: true,
      pricePence: true,
      quoteId: true,
    },
  });
  if (!manualQuote) throw new Error('Manual quote not found');
  const quote = await tx.quote.findUnique({
    where: { id: manualQuote.quoteId },
    select: { dropoff: true, pickup: true },
  });
  if (!quote) throw new Error('Manual quote source quote not found');
  const [web, contact] = await Promise.all([getSetting('web'), getSetting('contact')]);
  const details = manualQuote.details ?? undefined;
  return {
    customerEmail: manualQuote.contactEmail,
    data: {
      amountPence: manualQuote.pricePence ?? 0,
      canonicalOrigin: web.canonicalOrigin,
      contactEmail: contact.emailBookings ?? contact.emailPublic,
      payUrl: `/pay/manual-quote/${manualQuote.id}`,
      reference: `MQ-${manualQuote.id.slice(-8).toUpperCase()}`,
      routeLabel: routeLabel(quote.pickup, quote.dropoff),
      ...(details ? { message: details } : {}),
    },
  };
}

async function enqueueEmail(tx: DbTx, event: ClaimedOutboxEvent, template: EmailTemplateKey, to: string | string[], data: EmailTemplateData): Promise<void> {
  const recipients = Array.isArray(to) ? to : [to];
  if (recipients.length === 0) return;
  await enqueueOutbox(
    tx,
    'email.send',
    json({ data, template, to: recipients } satisfies EmailSendPayload),
    `${event.id}:email:${template}:${recipients.join(',')}`,
  );
}

async function enqueueAdminNotification(tx: DbTx, event: ClaimedOutboxEvent, title: string, body: string, data: Record<string, unknown>): Promise<void> {
  const users = await adminUsers(tx);
  for (const user of users) {
    await enqueueOutbox(
      tx,
      'notification.create',
      json({ body, data, title, type: event.type, userId: user.id }),
      `${event.id}:notification:${user.id}`,
    );
  }
}

async function enqueueAdminPush(tx: DbTx, event: ClaimedOutboxEvent, title: string, body: string, data: Record<string, unknown>): Promise<void> {
  const users = await adminUsers(tx);
  for (const user of users) {
    await enqueueOutbox(
      tx,
      'push.send',
      json({ body, data, title, userId: user.id }),
      `${event.id}:push:${user.id}`,
    );
  }
}

async function expandDomainEvent(tx: DbTx, event: ClaimedOutboxEvent): Promise<void> {
  const channels = channelsForEvent(event.type);
  if (!channels) return;
  const payload = asPayload(event.payload);
  let customer: { customerEmail: string; data: EmailTemplateData } | null = null;
  if (payload.bookingId) {
    customer = await bookingEmailData(tx, payload.bookingId);
  } else if (payload.manualQuoteId || payload.quoteId) {
    customer = await manualQuoteEmailData(tx, payload);
  }

  const title = event.type === 'booking.confirmed'
    ? `New booking - ${customer?.data.amountPence ? formatGBP(customer.data.amountPence) : 'paid'}`
    : event.type.replaceAll('_', ' ').replaceAll('.', ' ');
  const body = payload.issue ?? customer?.data.routeLabel ?? 'Open Speedy Van admin.';

  if (channels.customerEmail && customer) {
    const refund = payload.refundId
      ? await tx.refund.findUnique({ where: { id: payload.refundId }, select: { amountPence: true } })
      : null;
    await enqueueEmail(tx, event, channels.customerEmail as EmailTemplateKey, customer.customerEmail, {
      ...customer.data,
      ...(refund ? { refundPence: refund.amountPence } : {}),
    });
  }
  if (channels.adminEmail) {
    const emails = await adminEmails(tx);
    await enqueueEmail(tx, event, channels.adminEmail as EmailTemplateKey, emails, customer?.data ?? { message: payload.issue ?? event.type });
  }
  if (channels.adminNotification) {
    await enqueueAdminNotification(tx, event, title, body, { ...payload, eventType: event.type });
  }
  if (channels.adminPush) {
    await enqueueAdminPush(tx, event, title, body, { ...payload, category: channels.adminPush.category, eventType: event.type });
  }
}

async function handleEvent(event: ClaimedOutboxEvent): Promise<void> {
  if (event.type === 'email.send') {
    await sendTransactionalEmail(event.payload as EmailSendPayload, event.id);
    return;
  }
  if (event.type === 'notification.create') {
    const payload = event.payload as { body: string; data?: Prisma.InputJsonValue; title: string; type: string; userId: string };
    await prisma.notification.create({
      data: {
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
    return;
  }
  if (event.type === 'payment.refund') {
    const payload = asPayload(event.payload);
    if (!payload.refundId) throw new Error('refundId missing');
    await prisma.$transaction(async (tx) => runRefundOutbox(tx, payload.refundId as string));
    return;
  }
  await prisma.$transaction(async (tx) => expandDomainEvent(tx, event));
}

async function claimDueEvents(limit: number): Promise<ClaimedOutboxEvent[]> {
  return prisma.$transaction(async (tx) => {
    return tx.$queryRaw<ClaimedOutboxEvent[]>`
      UPDATE "OutboxEvent"
      SET "status" = 'PROCESSING', "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id"
        FROM "OutboxEvent"
        WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING "id", "type", "payload", "attempts"
    `;
  });
}

async function markDone(id: string): Promise<void> {
  await prisma.outboxEvent.update({ data: { lastError: null, processedAt: new Date(), status: 'DONE' }, where: { id } });
}

async function markFailed(event: ClaimedOutboxEvent, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : 'Unknown outbox error';
  const attempts = event.attempts;
  if (attempts >= 6) {
    await prisma.outboxEvent.update({ data: { lastError: message, status: 'FAILED' }, where: { id: event.id } });
    await prisma.outboxEvent.create({
      data: {
        dedupeKey: `system.alert:outbox-failed:${event.id}`,
        payload: json({ issue: `Outbox event ${event.id} failed: ${message}` }),
        type: 'system.alert',
      },
    }).catch(() => undefined);
    return;
  }
  const minutes = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 360;
  await prisma.outboxEvent.update({
    data: {
      lastError: message,
      nextAttemptAt: new Date(Date.now() + minutes * 60_000),
      status: 'PENDING',
    },
    where: { id: event.id },
  });
}

export async function processOutboxBatch(limit = 25): Promise<{ done: number; failed: number }> {
  const events = await claimDueEvents(limit);
  let done = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await handleEvent(event);
      await markDone(event.id);
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
    data: { attempts: { increment: 1 }, status: 'PROCESSING' },
    where: { id },
    select: { attempts: true, id: true, payload: true, type: true },
  });
  try {
    await handleEvent(event);
    await markDone(event.id);
    return { done: 1, failed: 0 };
  } catch (error) {
    await markFailed(event, error);
    return { done: 0, failed: 1 };
  }
}
