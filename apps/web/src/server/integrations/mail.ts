import 'server-only';
import { prisma } from '@sv/db';
import { renderEmailTemplate, type EmailTemplateData, type EmailTemplateKey } from '@sv/emails';
import { prepareDelivery, processMailDelivery, saveDelivery } from '../mail/delivery';
import { mailConfig } from '../mail/config';
import { uniqueRecipients } from '../mail/quota';

export interface EmailSendPayload { data: EmailTemplateData; template: EmailTemplateKey; to: string | string[] }

export async function sendTransactionalEmail(payload: EmailSendPayload, outboxEventId: string): Promise<void> {
  const key = `outbox:${outboxEventId}`;
  const existing = await prisma.mailDelivery.findUnique({ where: { key }, select: { id: true } });
  if (existing) return processMailDelivery(existing.id);
  const rendered = await renderEmailTemplate(payload.template, payload.data);
  const to = uniqueRecipients(Array.isArray(payload.to) ? payload.to : [payload.to]);
  const prepared = await prepareDelivery(key, { to, subject: rendered.subject, html: rendered.html, text: rendered.text, replyTo: mailConfig().mailbox });
  const delivery = await prisma.$transaction((tx) => saveDelivery(tx, prepared, outboxEventId));
  return processMailDelivery(delivery.id);
}
