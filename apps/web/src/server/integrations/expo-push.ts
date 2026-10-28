import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { AppError, londonToday } from '@sv/contracts';
import { enqueueOutbox, prisma, type Prisma } from '@sv/db';
import { randomUUID } from 'node:crypto';
import { Expo, type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk';
import { serverEnv } from '../env';
import { shouldSendChatPush } from '../chat/push';
import { withExpoTransport } from './expo-transport';

type AppKind = 'ADMIN' | 'DRIVER';
type PushSound = 'default' | 'job-offer.wav' | 'new-job.wav' | 'chat-message.wav';

export interface PushSendPayload {
  app?: AppKind;
  body: string;
  category: string;
  data?: Record<string, unknown>;
  sound: PushSound;
  timeSensitive?: boolean;
  title: string;
  ttl?: number;
  userId: string;
}

interface PushDeviceRow {
  app: AppKind;
  expoPushToken: string;
  id: string;
  userId: string;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function captureMode(): boolean {
  const env = serverEnv();
  if (env.PUSH_MODE === 'capture' && process.env.NODE_ENV === 'production') {
    throw new AppError('INTERNAL', 'Captured push delivery is not allowed in production.');
  }
  return env.PUSH_MODE === 'capture' || (!env.EXPO_ACCESS_TOKEN && process.env.NODE_ENV !== 'production');
}

function expo(): Expo {
  const accessToken = serverEnv().EXPO_ACCESS_TOKEN;
  if (!accessToken) throw new AppError('INTERNAL', 'EXPO_ACCESS_TOKEN is required for live push sending.');
  return new Expo({ accessToken });
}

function errorCode(value: ExpoPushReceipt | ExpoPushTicket): string | null {
  // Provider message text can contain a device token. Persist only error codes.
  return value.status === 'error' ? value.details?.error ?? 'UnknownPushError' : null;
}

async function disableDevice(deviceId: string, reason: string): Promise<void> {
  await prisma.pushDevice.update({
    data: { enabled: false, lastError: reason },
    where: { id: deviceId },
  });
}

async function warnAdminWithoutDevice(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    select: { email: true, id: true, role: true, status: true },
    where: { id: userId },
  });
  if (!user || user.status !== 'ACTIVE' || (user.role !== 'OWNER' && user.role !== 'ADMIN')) return;
  const hasEnabledDevice = await prisma.pushDevice.count({ where: { app: 'ADMIN', enabled: true, userId } });
  if (hasEnabledDevice > 0) return;
  const day = new Date().toISOString().slice(0, 10);
  await prisma.$transaction(async (tx) => {
    await enqueueOutbox(
      tx,
      'notification.create',
      json({
        body: 'This admin account has no working push device. Re-enable notifications in the app.',
        data: { eventType: 'push.no_working_device' },
        title: 'Notifications are off',
        type: 'SYSTEM',
        userId,
      }),
      `push.no_working_device:notification:${userId}:${day}`,
    ).catch(() => undefined);
    await enqueueOutbox(
      tx,
      'email.send',
      json({
        data: { message: 'Notifications are off on your phone. Open the admin app and send a test push.' },
        template: 'admin-system-alert',
        to: [user.email],
      }),
      `push.no_working_device:email:${userId}:${day}`,
    ).catch(() => undefined);
  });
}

function messageFor(payload: PushSendPayload, token: string, badge: number): ExpoPushMessage {
  return {
    badge,
    body: payload.body,
    categoryId: payload.category,
    data: {
      ...payload.data,
      type: payload.category,
    },
    interruptionLevel: payload.timeSensitive ? 'time-sensitive' : 'active',
    priority: 'high',
    sound: payload.app === 'ADMIN'
      ? payload.category === 'CHAT_MESSAGE' ? 'chat-message.wav' : 'new-job.wav'
      : payload.sound,
    title: payload.title,
    to: token,
    ttl: payload.ttl ?? 3600,
  };
}

async function createTicket(device: PushDeviceRow, outboxEventId: string, ticket: ExpoPushTicket): Promise<void> {
  const code = errorCode(ticket);
  const ticketId = ticket.status === 'ok' ? ticket.id : `error:${outboxEventId}:${device.id}:${randomUUID()}`;
  await prisma.pushTicket.create({
    data: {
      error: code,
      outboxEventId,
      pushDeviceId: device.id,
      status: ticket.status,
      ticketId,
    },
  });
  if (code === 'DeviceNotRegistered') {
    await disableDevice(device.id, code);
    await warnAdminWithoutDevice(device.userId);
  }
}

export async function sendPushOutbox(payload: PushSendPayload, outboxEventId: string): Promise<{ devices: number; tickets: number }> {
  if (payload.app === 'ADMIN' && payload.category === 'CHAT_MESSAGE' && !await shouldSendChatPush(payload.data)) {
    return { devices: 0, tickets: 0 };
  }
  if (payload.app === 'ADMIN' && payload.category === 'NEW_BOOKING' && payload.data?.eventType !== 'admin.test_push') {
    const bookingId = payload.data?.bookingId;
    const booking = typeof bookingId === 'string' && bookingId ? await prisma.booking.findFirst({
      where: { id: bookingId, status: 'CONFIRMED', deletedAt: null, moveDate: { gte: new Date(`${londonToday()}T00:00:00.000Z`) } },
      select: { id: true },
    }) : null;
    if (!booking) return { devices: 0, tickets: 0 };
  }
  const devices = await prisma.pushDevice.findMany({
    orderBy: { lastRegisteredAt: 'desc' },
    select: { app: true, expoPushToken: true, id: true, userId: true },
    where: {
      enabled: true,
      userId: payload.userId,
      user: {
        status: 'ACTIVE',
        ...(payload.app === 'ADMIN' ? { role: { in: ['OWNER' as const, 'ADMIN' as const] } } : payload.app === 'DRIVER' ? { role: 'DRIVER' as const } : {}),
      },
      ...(payload.app ? { app: payload.app } : {}),
    },
  });

  const validDevices: PushDeviceRow[] = [];
  for (const device of devices) {
    if (Expo.isExpoPushToken(device.expoPushToken)) {
      validDevices.push(device);
    } else {
      await disableDevice(device.id, 'InvalidExpoPushToken');
    }
  }
  if (validDevices.length === 0) {
    if (payload.app === 'ADMIN') await warnAdminWithoutDevice(payload.userId);
    return { devices: 0, tickets: 0 };
  }

  const capturing = captureMode();
  // A later retry only targets devices for which Expo has not already accepted
  // this event. Successful devices must not ring again after a partial failure.
  const accepted = await prisma.pushTicket.findMany({
    select: { pushDeviceId: true },
    where: {
      outboxEventId,
      status: 'ok',
      ...(capturing ? {} : { ticketId: { not: { startsWith: 'capture:' } } }),
    },
  });
  const acceptedDeviceIds = new Set(accepted.map((ticket) => ticket.pushDeviceId));
  const pendingDevices = validDevices.filter((device) => !acceptedDeviceIds.has(device.id));
  if (pendingDevices.length === 0) return { devices: validDevices.length, tickets: 0 };

  const unreadCount = await prisma.notification.count({ where: { readAt: null, userId: payload.userId } });

  if (capturing) {
    for (const device of pendingDevices) {
      await prisma.pushTicket.upsert({
        create: {
          outboxEventId,
          pushDeviceId: device.id,
          status: 'ok',
          ticketId: `capture:${outboxEventId}:${device.id}`,
        },
        update: { checkedAt: new Date(), error: null, status: 'ok' },
        where: { ticketId: `capture:${outboxEventId}:${device.id}` },
      });
    }
    return { devices: validDevices.length, tickets: pendingDevices.length };
  }

  const messages = pendingDevices.map((device) => messageFor(payload, device.expoPushToken, unreadCount));
  let cursor = 0;
  let tickets = 0;
  const failures = new Set<string>();
  for (const chunk of expo().chunkPushNotifications(messages)) {
    const chunkDevices = pendingDevices.slice(cursor, cursor + chunk.length);
    cursor += chunk.length;
    const sent = await withExpoTransport((client) => client.sendPushNotificationsAsync(chunk));
    for (let index = 0; index < sent.length; index += 1) {
      const device = chunkDevices[index];
      const ticket = sent[index];
      if (!device || !ticket) continue;
      await createTicket(device, outboxEventId, ticket);
      tickets += 1;
      const code = errorCode(ticket);
      if (code && code !== 'DeviceNotRegistered') failures.add(code);
    }
    if (sent.length !== chunk.length) failures.add('UnexpectedTicketCount');
  }
  if (failures.size > 0) {
    throw new AppError('UPSTREAM_UNAVAILABLE', `Push delivery was not accepted: ${[...failures].sort().join(', ')}.`);
  }
  return { devices: validDevices.length, tickets };
}

function receiptStatus(receipt: ExpoPushReceipt): { error: string | null; status: string } {
  if (receipt.status === 'ok') return { error: null, status: 'ok' };
  return { error: errorCode(receipt), status: 'error' };
}

export async function checkPushReceipts(now = new Date(), limit = 500): Promise<{ checked: number; disabled: number; errors: number }> {
  if (captureMode()) {
    return { checked: 0, disabled: 0, errors: 0 };
  }
  const cutoff = new Date(now.getTime() - 15 * 60_000);
  const retentionCutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  const batchSize = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 500;
  const tickets = await prisma.pushTicket.findMany({
    include: { pushDevice: { select: { id: true, userId: true } } },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
    where: {
      checkedAt: null,
      // Expo removes receipts after 24 hours. Older unknown outcomes cannot be
      // recovered and must not monopolise each bounded polling batch.
      createdAt: { gt: retentionCutoff, lte: cutoff },
      status: 'ok',
      ticketId: { not: { startsWith: 'capture:' } },
    },
  });
  let checked = 0;
  let disabled = 0;
  let errors = 0;
  if (tickets.length === 0) return { checked, disabled, errors };
  for (const chunk of expo().chunkPushNotificationReceiptIds(tickets.map((ticket) => ticket.ticketId))) {
    const receipts = await withExpoTransport((client) => client.getPushNotificationReceiptsAsync(chunk));
    for (const ticket of tickets.filter((row) => chunk.includes(row.ticketId))) {
      const receipt = receipts[ticket.ticketId];
      if (!receipt) continue;
      const status = receiptStatus(receipt);
      await prisma.pushTicket.update({
        data: { checkedAt: now, error: status.error, status: status.status },
        where: { id: ticket.id },
      });
      checked += 1;
      if (status.error === 'DeviceNotRegistered') {
        await disableDevice(ticket.pushDeviceId, status.error);
        await warnAdminWithoutDevice(ticket.pushDevice.userId);
        disabled += 1;
      } else if (status.error) {
        Sentry.captureMessage('Expo push receipt error', {
          extra: { error: status.error, ticketId: ticket.ticketId },
          level: 'warning',
        });
        errors += 1;
      }
    }
  }
  return { checked, disabled, errors };
}
