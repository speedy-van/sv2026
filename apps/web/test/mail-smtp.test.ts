import { Duplex, Readable } from 'node:stream';
import type * as Tls from 'node:tls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), config: vi.fn() }));
vi.mock('node:tls', async (importOriginal) => {
  const actual = await importOriginal<typeof Tls>();
  return { ...actual, connect: mocks.connect, default: { ...actual, connect: mocks.connect } };
});
vi.mock('../src/server/mail/config', () => ({ mailConfig: mocks.config }));
vi.mock('@sv/db', () => ({ prisma: {} }));
vi.mock('../src/server/env', () => ({ serverEnv: vi.fn() }));

import { classifySmtpFailure, compileMail, sendSmtp, type MailEnvelope } from '../src/server/mail/smtp';
import { MailDeferredError, MailPermanentError, MailReviewRequiredError, MailTransientError } from '../src/server/mail/errors';

type Outcome = 'success' | 'hang' | 'drop' | 'quota' | 'reject';

/** Real Nodemailer SMTP protocol over an in-memory duplex, never a network socket. */
class SmtpSocket extends Duplex {
  authorized = true;
  dataReceived = false;
  commands: string[] = [];
  private commandsPending = '';
  private dataPending = '';
  private receivingData = false;

  constructor(readonly outcome: Outcome = 'success', readonly authResponse = '235 Authentication successful', readonly rejectRecipient = '') { super(); }

  override _read(): void { /* Server replies are pushed by respond(). */ }

  setTimeout(): this { return this; } // Deliberately no idle timer: exercise our hard deadline.

  establish(): void {
    this.emit('secureConnect');
    this.respond('220 test.example.test ESMTP');
  }

  private respond(value: string): void {
    queueMicrotask(() => { if (!this.destroyed) this.push(Buffer.from(`${value}\r\n`)); });
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.receivingData) {
      this.dataPending += chunk.toString();
      if (this.dataPending.includes('\r\n.\r\n')) {
        this.dataReceived = true;
        if (this.outcome === 'drop') this.destroy();
        else if (this.outcome === 'quota') this.respond('452 Daily sending quota exceeded');
        else if (this.outcome === 'reject') this.respond('554 Message rejected');
        else if (this.outcome === 'success') this.respond('250 Message accepted');
      }
      callback();
      return;
    }
    this.commandsPending += chunk.toString();
    let end: number;
    while ((end = this.commandsPending.indexOf('\r\n')) >= 0) {
      const command = this.commandsPending.slice(0, end);
      this.commandsPending = this.commandsPending.slice(end + 2);
      this.commands.push(command);
      if (command.startsWith('EHLO ')) this.respond('250-test.example.test\r\n250 AUTH PLAIN');
      else if (command.startsWith('AUTH ')) this.respond(this.authResponse);
      else if (command.startsWith('MAIL FROM:')) this.respond('250 Sender accepted');
      else if (command.startsWith('RCPT TO:')) this.respond(this.rejectRecipient && command.includes(this.rejectRecipient) ? '550 Recipient rejected' : '250 Recipient accepted');
      else if (command === 'DATA') { this.receivingData = true; this.respond('354 Send message'); }
      else if (command === 'QUIT') this.respond('221 Goodbye');
    }
    callback();
  }
}

const envelope: MailEnvelope = { to: ['customer@example.test'], cc: [], bcc: [] };
const raw = Buffer.from('From: support@example.test\r\nTo: customer@example.test\r\nSubject: Test\r\nMessage-ID: <test@example.test>\r\n\r\nMessage body\r\n');

function provideSocket(socket: SmtpSocket, establish = true): void {
  mocks.connect.mockImplementation(() => {
    if (establish) queueMicrotask(() => { socket.establish(); });
    return socket;
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.config.mockReturnValue({ enabled: true, mailbox: 'support@example.test', password: 'test-only-app-password' });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('SMTP failure classification', () => {
  it.each([
    [{ code: 'EAUTH', responseCode: 535, response: '535 invalid secret' }, MailPermanentError, 'MAIL_AUTH_FAILED'],
    [{ code: 'EAUTH' }, MailPermanentError, 'MAIL_AUTH_FAILED'],
    [{ code: 'EAUTH', responseCode: 454, command: 'AUTH PLAIN' }, MailTransientError, 'SMTP_454'],
    [{ responseCode: 452, response: '452 Daily recipient quota exceeded' }, MailDeferredError, 'MAIL_PROVIDER_QUOTA'],
    [{ responseCode: 550, response: '550 Sending limit exceeded' }, MailDeferredError, 'MAIL_PROVIDER_QUOTA'],
    [{ responseCode: 451, command: 'DATA' }, MailTransientError, 'SMTP_451'],
    [{ responseCode: 554, command: 'DATA' }, MailPermanentError, 'SMTP_554'],
    [{ code: 'ETIMEDOUT', command: 'AUTH PLAIN' }, MailTransientError, 'MAIL_CONNECTION_FAILED'],
    [{ code: 'ETIMEDOUT', command: 'CONN' }, MailReviewRequiredError, 'MAIL_DELIVERY_UNCERTAIN'],
    [{ code: 'ESOCKET', command: 'CONN' }, MailReviewRequiredError, 'MAIL_DELIVERY_UNCERTAIN'],
    [{ code: 'ECONNECTION', command: 'DATA' }, MailReviewRequiredError, 'MAIL_DELIVERY_UNCERTAIN'],
    [new Error('unknown provider failure with private information'), MailReviewRequiredError, 'MAIL_DELIVERY_UNCERTAIN'],
  ])('classifies provider failures without exposing provider text: %j', (failure, errorType, code) => {
    const error = classifySmtpFailure(failure);
    expect(error).toBeInstanceOf(errorType);
    expect(error).toMatchObject({ code, message: code });
  });

  it('preserves already-classified errors and a concrete quota retry time', () => {
    const failure = new MailDeferredError(new Date('2026-11-05T00:00:01Z'));
    expect(classifySmtpFailure(failure)).toBe(failure);
  });
});

describe('SMTP transport cancellation and acceptance', () => {
  it('uses fixed verified TLS and authenticates, sends once, then destroys the owned socket', async () => {
    const socket = new SmtpSocket();
    provideSocket(socket);
    expect(await sendSmtp(raw, envelope)).toBe(250);
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith({ host: 'smtp.larksuite.com', port: 465, servername: 'smtp.larksuite.com', minVersion: 'TLSv1.2', rejectUnauthorized: true });
    expect(socket.commands.filter((command) => command.startsWith('AUTH '))).toHaveLength(1);
    expect(socket.dataReceived).toBe(true);
    expect(socket.destroyed).toBe(true);
  });

  it('deduplicates To, Cc and Bcc recipients in the SMTP envelope', async () => {
    const socket = new SmtpSocket(); provideSocket(socket);
    await sendSmtp(raw, { to: ['customer@example.test'], cc: ['CUSTOMER@example.test'], bcc: ['other@example.test'] });
    expect(socket.commands.filter((command) => command.startsWith('RCPT TO:'))).toEqual(['RCPT TO:<customer@example.test>', 'RCPT TO:<other@example.test>']);
  });

  it('keeps Bcc recipients in the envelope while omitting them from compiled message headers', async () => {
    const socket = new SmtpSocket(); provideSocket(socket);
    const compiled = await compileMail({ subject: 'Private recipients', text: 'Body', to: envelope.to, cc: ['office@example.test'], bcc: ['private@example.test'] }, '<stable@example.test>', new Date('2026-11-04T10:00:00Z'));
    expect(compiled.toString()).not.toMatch(/^Bcc:/imu);
    expect(compiled.toString()).not.toContain('private@example.test');
    await sendSmtp(compiled, { ...envelope, cc: ['office@example.test'], bcc: ['private@example.test'] });
    expect(socket.commands.filter((command) => command.startsWith('RCPT TO:'))).toContain('RCPT TO:<private@example.test>');
  });

  it('destroys a stuck TLS connection at the connection deadline and never hands it off late', async () => {
    vi.useFakeTimers();
    const socket = new SmtpSocket(); provideSocket(socket, false);
    const pending = expect(sendSmtp(raw, envelope)).rejects.toMatchObject({ code: 'MAIL_CONNECTION_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(8_000);
    await pending;
    expect(socket.destroyed).toBe(true);
    socket.emit('secureConnect');
    await vi.advanceTimersByTimeAsync(30_000);
    expect(socket.commands).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('destroys a live DATA socket at the hard deadline and marks delivery uncertain', async () => {
    vi.useFakeTimers();
    const socket = new SmtpSocket('hang'); provideSocket(socket);
    const pending = expect(sendSmtp(raw, envelope)).rejects.toMatchObject({ code: 'MAIL_SEND_TIMEOUT_UNCERTAIN' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(socket.dataReceived).toBe(true);
    expect(socket.destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(24_000);
    await pending;
    expect(socket.destroyed).toBe(true);
    expect(socket.commands.filter((command) => command === 'DATA')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry a connection drop after DATA despite Nodemailer labeling it CONN', async () => {
    const socket = new SmtpSocket('drop'); provideSocket(socket);
    await expect(sendSmtp(raw, envelope)).rejects.toMatchObject({ code: 'MAIL_DELIVERY_UNCERTAIN' });
    expect(socket.dataReceived).toBe(true);
    expect(socket.destroyed).toBe(true);
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it.each([
    ['quota', 'MAIL_PROVIDER_QUOTA'], ['reject', 'SMTP_554'],
  ] as const)('honors a definite %s rejection after DATA', async (outcome, code) => {
    const socket = new SmtpSocket(outcome); provideSocket(socket);
    await expect(sendSmtp(raw, envelope)).rejects.toMatchObject({ code });
    expect(socket.destroyed).toBe(true);
  });

  it('fails authentication without sending DATA and destroys the socket', async () => {
    const socket = new SmtpSocket('success', '535 Authentication failed'); provideSocket(socket);
    await expect(sendSmtp(raw, envelope)).rejects.toMatchObject({ code: 'MAIL_AUTH_FAILED' });
    expect(socket.dataReceived).toBe(false);
    expect(socket.destroyed).toBe(true);
  });

  it('requires review when some recipients were accepted and others rejected', async () => {
    const socket = new SmtpSocket('success', '235 Authentication successful', 'other@example.test'); provideSocket(socket);
    await expect(sendSmtp(raw, { ...envelope, cc: ['other@example.test'] })).rejects.toMatchObject({ code: 'MAIL_PARTIAL_ACCEPTANCE' });
    expect(socket.dataReceived).toBe(true);
    expect(socket.destroyed).toBe(true);
  });

  it('rejects an unauthorized TLS socket before AUTH and closes it', async () => {
    const socket = new SmtpSocket(); socket.authorized = false; provideSocket(socket);
    await expect(sendSmtp(raw, envelope)).rejects.toMatchObject({ code: 'MAIL_TLS_FAILED' });
    expect(socket.commands).toEqual([]);
    expect(socket.destroyed).toBe(true);
  });

  it('preserves invalid-recipient errors without opening a socket', async () => {
    await expect(sendSmtp(raw, { ...envelope, to: ['not-an-address'] })).rejects.toMatchObject({ code: 'MAIL_INVALID_RECIPIENT' });
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});

describe('buffered MIME compilation', () => {
  it('returns a real Buffer from the stream transport without opening a connection', async () => {
    const result = await compileMail({ subject: 'Booking confirmed', text: 'Confirmation', to: envelope.to }, '<compiled@example.test>', new Date('2026-11-04T10:00:00Z'));
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toContain('Message-ID: <compiled@example.test>');
    expect(result.toString()).toContain('From: Speedy Van <support@example.test>');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('preserves the supplied deterministic Message-ID across compilation attempts', async () => {
    const prepared = { subject: 'Booking confirmed', text: 'Confirmation', to: envelope.to };
    const messageId = '<delivery-fixed-id@speedyvan.uk>';
    const first = await compileMail(prepared, messageId, new Date('2026-11-04T10:00:00Z'));
    const second = await compileMail(prepared, messageId, new Date('2026-11-04T10:01:00Z'));
    for (const compiled of [first, second]) expect(compiled.toString().match(/^Message-ID: (.+)$/mu)?.[1]?.trim()).toBe(messageId);
  });

  it.each(['<safe@example.test>\r\nBcc: attacker@example.test', 'invalid-id', '<safe@example.test>\u0000'])('rejects malformed or injected Message-ID %j before compilation', async (messageId) => {
    await expect(compileMail({ subject: 'Test', text: 'Body', to: envelope.to }, messageId, new Date())).rejects.toMatchObject({ code: 'MAIL_INVALID_HEADER' });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('fails closed and destroys an unexpected stream instead of coercing it into Buffer', async () => {
    const stream = Readable.from(['unexpected output']);
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    vi.spyOn(transport.transporter, 'send').mockImplementation((_mail, callback) => {
      callback(null, { message: stream, messageId: '<unexpected@example.test>', envelope: { from: 'support@example.test', to: envelope.to } });
    });
    vi.spyOn(nodemailer, 'createTransport').mockReturnValueOnce(transport);
    await expect(compileMail({ subject: 'Test', text: 'Body', to: envelope.to }, '<compiled@example.test>', new Date())).rejects.toMatchObject({ code: 'MAIL_COMPILE_FAILED' });
    expect(stream.destroyed).toBe(true);
  });
});
