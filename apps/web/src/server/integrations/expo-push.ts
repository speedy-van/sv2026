import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { AppError } from '@sv/contracts';
import { enqueueOutbox, prisma, type Prisma } from '@sv/db';
import { randomUUID } from 'node:crypto';
import { Expo, type ExpoPushMessage, type ExpoPushReceipt, type ExpoPushTicket } from 'expo-server-sdk';
import { serverEnv } from '../env';

type AppKind = 'ADMIN' | 'DRIVER';
type PushSound = 'default' | 'job-offer.wav' | 'new-job.wav';

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

let expoClient: Expo | undefined;

function captureMode(): boolean {
  const env = serverEnv();
  return env.PUSH_MODE === 'capture' || (!env.EXPO_ACCESS_TOKEN && process.env.NODE_ENV !== 'production');
}

function expo(): Expo {
  if (expoClient) return expoClient;
  const accessToken = serverEnv().EXPO_ACCESS_TOKEN;
  if (!accessToken) throw new AppError('INTERNAL', 'EXPO_ACCESS_TOKEN is required for live push sending.');
  expoClient = new Expo({ accessToken });
  return expoClient;
}

function errorCode(value: ExpoPushReceipt | ExpoPushTicket): string | null {
  return value.status === 'error' ? value.details?.error ?? value.message : null;
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
    sound: payload.sound,
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
  const devices = await prisma.pushDevice.findMany({
    orderBy: { lastRegisteredAt: 'desc' },
    select: { app: true, expoPushToken: true, id: true, userId: true },
    where: {
      enabled: true,
      userId: payload.userId,
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

  const unreadCount = await prisma.notification.count({ where: { readAt: null, userId: payload.userId } });

  if (captureMode()) {
    for (const device of validDevices) {
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
    return { devices: validDevices.length, tickets: validDevices.length };
  }

  const messages = validDevices.map((device) => messageFor(payload, device.expoPushToken, unreadCount));
  const pairs = validDevices.map((device, index) => ({ device, message: messages[index] }));
  let cursor = 0;
  let tickets = 0;
  for (const chunk of expo().chunkPushNotifications(messages)) {
    const chunkPairs = pairs.slice(cursor, cursor + chunk.length);
    cursor += chunk.length;
    const sent = await expo().sendPushNotificationsAsync(chunk);
    for (let index = 0; index < sent.length; index += 1) {
      const pair = chunkPairs[index];
      const ticket = sent[index];
      if (!pair || !ticket) continue;
      await createTicket(pair.device, outboxEventId, ticket);
      tickets += 1;
    }
  }
  return { devices: validDevices.length, tickets };
}

function receiptStatus(receipt: ExpoPushReceipt): { error: string | null; status: string } {
  if (receipt.status === 'ok') return { error: null, status: 'ok' };
  return { error: receipt.details?.error ?? receipt.message, status: 'error' };
}

export async function checkPushReceipts(now = new Date()): Promise<{ checked: number; disabled: number; errors: number }> {
  if (captureMode()) {
    return { checked: 0, disabled: 0, errors: 0 };
  }
  const cutoff = new Date(now.getTime() - 15 * 60_000);
  const tickets = await prisma.pushTicket.findMany({
    include: { pushDevice: { select: { id: true, userId: true } } },
    take: 500,
    where: {
      checkedAt: null,
      createdAt: { lte: cutoff },
      status: 'ok',
      ticketId: { not: { startsWith: 'capture:' } },
    },
  });
  let checked = 0;
  let disabled = 0;
  let errors = 0;
  for (const chunk of expo().chunkPushNotificationReceiptIds(tickets.map((ticket) => ticket.ticketId))) {
    const receipts = await expo().getPushNotificationReceiptsAsync(chunk);
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
