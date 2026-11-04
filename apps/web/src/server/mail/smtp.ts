import 'server-only';
import { connect as connectTls, type TLSSocket } from 'node:tls';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { z } from 'zod';
import { mailConfig } from './config';
import { MailDeferredError, MailPermanentError, MailReviewRequiredError, MailTransientError } from './errors';
import { nextQuotaReset, uniqueRecipients } from './quota';

export const MailEnvelopeSchema = z.object({
  to: z.array(z.email()).min(1).max(50), cc: z.array(z.email()).max(50).default([]), bcc: z.array(z.email()).max(50).default([]),
  requestHash: z.string().optional(),
}).strict();
export type MailEnvelope = z.infer<typeof MailEnvelopeSchema>;
export interface PreparedMail { subject: string; text: string; html?: string; to: string[]; cc?: string[]; bcc?: string[]; inReplyTo?: string; references?: string[]; replyTo?: string }

export async function compileMail(input: PreparedMail, messageId: string, date: Date): Promise<Buffer> {
  const { mailbox } = mailConfig();
  const { bcc, ...visibleInput } = input;
  uniqueRecipients(input.to, input.cc, bcc);
  if (!input.subject || input.subject.length > 1000 || /\p{Cc}/u.test(input.subject)
    || messageId.length > 998 || !/^<[^<>\s]+@[^<>\s]+>$/u.test(messageId) || /\p{Cc}/u.test(messageId)
    || [input.inReplyTo, ...(input.references ?? [])].some((header) => header !== undefined && /\p{Cc}/u.test(header))) {
    throw new MailPermanentError('MAIL_INVALID_HEADER');
  }
  if (input.replyTo && !z.email().safeParse(input.replyTo).success) throw new MailPermanentError('MAIL_INVALID_REPLY_TO');
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows', disableFileAccess: true, disableUrlAccess: true });
  try {
    // StreamTransport forces keepBcc=true; Bcc belongs only in the separately
    // persisted SMTP envelope, never in the raw bytes delivered to recipients.
    const result = await transport.sendMail({ ...visibleInput, from: { name: 'Speedy Van', address: mailbox }, date, messageId });
    // buffer:true promises buffered output. Never coerce an unexpected Readable
    // into a Buffer or leave a compilation stream running after failure.
    if (!Buffer.isBuffer(result.message)) {
      result.message.destroy();
      throw new MailPermanentError('MAIL_COMPILE_FAILED');
    }
    const raw = result.message;
    if (raw.byteLength > 2 * 1024 * 1024) throw new MailPermanentError('MAIL_TOO_LARGE');
    return raw;
  } finally { transport.close(); }
}

type ProviderFailure = { code?: string; command?: string; responseCode?: number; response?: string };
export function classifySmtpFailure(error: unknown): Error {
  if (error instanceof MailDeferredError || error instanceof MailPermanentError
    || error instanceof MailTransientError || error instanceof MailReviewRequiredError) return error;
  const value: ProviderFailure = error && typeof error === 'object' ? error : {};
  if (value.responseCode === 535) return new MailPermanentError('MAIL_AUTH_FAILED');
  if (value.responseCode && value.responseCode >= 400 && value.responseCode < 600
    && value.response && /(?:daily|quota|sending limit|recipient limit)/iu.test(value.response)) return new MailDeferredError(nextQuotaReset(), 'MAIL_PROVIDER_QUOTA');
  if (value.responseCode && value.responseCode >= 400 && value.responseCode < 500) return new MailTransientError(`SMTP_${String(value.responseCode)}`);
  if (value.responseCode && value.responseCode >= 500) return new MailPermanentError(`SMTP_${String(value.responseCode)}`);
  if (value.code === 'EAUTH') return new MailPermanentError('MAIL_AUTH_FAILED');
  if (value.command && /^(?:EHLO|HELO|AUTH|MAIL FROM|RCPT TO)(?:\s|$|:)/u.test(value.command)) return new MailTransientError('MAIL_CONNECTION_FAILED');
  // Nodemailer also labels socket errors after DATA as CONN. That label alone
  // cannot establish that no message was accepted, so never retry it blindly.
  // No positive rejection after DATA means acceptance cannot be ruled out.
  return new MailReviewRequiredError();
}

export async function sendSmtp(raw: Uint8Array, envelope: MailEnvelope): Promise<number> {
  const config = mailConfig();
  const recipients = uniqueRecipients(envelope.to, envelope.cc, envelope.bcc);
  let socket: TLSSocket | undefined;
  let stopped = false;
  let handedOff = false;
  let connectDeadline: ReturnType<typeof setTimeout> | undefined;
  const transport = nodemailer.createTransport({ host: 'smtp.larksuite.com', port: 465, secure: true,
    auth: { user: config.mailbox, pass: config.password }, pool: false, forceAuth: true,
    connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 15_000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, logger: false, debug: false,
    disableFileAccess: true, disableUrlAccess: true,
    // SMTPTransport.close() does not own its non-pooled in-flight connection.
    // Own the actual TLS socket through the supported hook so a deadline can
    // terminate network writes, including a pending DNS/TLS connection attempt.
    getSocket(_options, callback) {
      if (stopped) { callback(new MailTransientError('MAIL_CONNECTION_TIMEOUT')); return; }
      let settled = false;
      const fail = (error: MailTransientError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectDeadline);
        socket?.destroy();
        callback(error);
      };
      try {
        const connection = connectTls({
          host: 'smtp.larksuite.com', port: 465, servername: 'smtp.larksuite.com',
          minVersion: 'TLSv1.2', rejectUnauthorized: true,
        });
        socket = connection;
        connection.once('error', () => { fail(new MailTransientError('MAIL_CONNECTION_FAILED')); });
        connection.once('close', () => { fail(new MailTransientError('MAIL_CONNECTION_FAILED')); });
        connection.once('secureConnect', () => {
          if (settled || stopped) { connection.destroy(); return; }
          if (!connection.authorized) { fail(new MailTransientError('MAIL_TLS_FAILED')); return; }
          settled = true;
          handedOff = true;
          clearTimeout(connectDeadline);
          callback(null, { connection, secured: true });
        });
        connectDeadline = setTimeout(() => { fail(new MailTransientError('MAIL_CONNECTION_TIMEOUT')); }, 8_000);
      } catch {
        fail(new MailTransientError('MAIL_CONNECTION_FAILED'));
      }
    },
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<never>((_, reject) => {
      deadline = setTimeout(() => {
        stopped = true;
        reject(handedOff ? new MailReviewRequiredError('MAIL_SEND_TIMEOUT_UNCERTAIN') : new MailTransientError('MAIL_CONNECTION_TIMEOUT'));
        socket?.destroy();
      }, 25_000);
    });
    const result: SMTPTransport.SentMessageInfo = await Promise.race([
      transport.sendMail({ raw: Buffer.from(raw), envelope: { from: config.mailbox, to: recipients } }), timedOut,
    ]);
    if (result.rejected.length > 0 || result.accepted.length === 0) throw new MailReviewRequiredError('MAIL_PARTIAL_ACCEPTANCE');
    return Number(/^\d{3}/u.exec(result.response)?.[0] ?? 250);
  } catch (error) {
    throw classifySmtpFailure(error);
  } finally {
    stopped = true;
    clearTimeout(deadline);
    clearTimeout(connectDeadline);
    socket?.destroy();
    transport.close();
  }
}
