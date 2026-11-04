import { describe, expect, it } from 'vitest';
import { mailReplyRecipients, MailListQuerySchema, MailReplyRequestSchema, MailRetryRequestSchema, MailAttachmentResponseSchema, MAIL_ATTACHMENT_MAX_BYTES } from '../src/mail';

describe('shared mail contracts', () => {
  it('uses the same reply recipient policy for native preview and backend delivery', () => {
    const headers = { from: [{ address: 'sender@example.test' }], replyTo: [{ address: 'billing@example.test' }], to: [{ address: 'support@example.test' }, { address: 'partner@example.test' }], cc: [{ address: 'PARTNER@example.test' }] };
    expect(mailReplyRecipients(headers, 'reply-all', 'SUPPORT@example.test')).toEqual({ to: ['billing@example.test'], cc: ['partner@example.test'] });
    expect(mailReplyRecipients({ ...headers, from: [{ address: 'support@example.test' }], to: [{ address: 'customer@example.test' }] }, 'reply', 'support@example.test')).toEqual({ to: ['customer@example.test'], cc: [] });
  });
  it('rejects credential or recipient injection and requires a stable reply identity', () => {
    const reply = { clientMessageId: 'ff888e5d-4646-4ad8-b919-b7c371f9956c', mode: 'reply', text: 'Thanks' };
    expect(MailReplyRequestSchema.safeParse(reply).success).toBe(true);
    expect(MailReplyRequestSchema.safeParse({ ...reply, to: ['attacker@example.org'] }).success).toBe(false);
    expect(MailReplyRequestSchema.safeParse({ ...reply, clientMessageId: 'random' }).success).toBe(false);
    expect(MailRetryRequestSchema.parse({})).toEqual({ acknowledgeDuplicateRisk: false });
  });
  it('bounds pagination and serialized attachment sizes', () => {
    expect(MailListQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(MailListQuerySchema.safeParse({ cursor: 'x'.repeat(257) }).success).toBe(false);
    expect(MailAttachmentResponseSchema.safeParse({ filename: 'file.txt', contentType: 'text/plain', size: MAIL_ATTACHMENT_MAX_BYTES + 1, base64: '' }).success).toBe(false);
  });
});
