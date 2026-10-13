import 'server-only';

import { renderEmailTemplate, type EmailTemplateData, type EmailTemplateKey } from '@sv/emails';
import { Resend } from 'resend';
import { AppError } from '@sv/contracts';
import { serverEnv } from '../env';

export interface EmailSendPayload {
  data: EmailTemplateData;
  template: EmailTemplateKey;
  to: string | string[];
}

let client: Resend | null | undefined;

function resendClient(): Resend | null {
  if (client !== undefined) return client;
  const key = serverEnv().RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV !== 'production') {
      client = null;
      return client;
    }
    throw new AppError('INTERNAL', 'RESEND_API_KEY is required.');
  }
  client = new Resend(key);
  return client;
}

export async function sendTransactionalEmail(payload: EmailSendPayload, outboxEventId: string): Promise<void> {
  const rendered = await renderEmailTemplate(payload.template, payload.data);
  const from = serverEnv().EMAIL_FROM;
  const resend = resendClient();
  if (!resend) return;
  if (!from) throw new AppError('INTERNAL', 'EMAIL_FROM is required.');

  const options = {
    from,
    headers: { 'X-Entity-Ref-ID': outboxEventId },
    html: rendered.html,
    subject: rendered.subject,
    tags: [{ name: 'template', value: payload.template }],
    text: rendered.text,
    to: payload.to,
    ...(payload.data.contactEmail ? { replyTo: payload.data.contactEmail } : {}),
  };
  const result = await resend.emails.send(options);
  if (result.error) {
    throw new AppError('UPSTREAM_UNAVAILABLE', 'Email could not be sent.', { resendError: result.error.message });
  }
}
