import { describe, expect, it } from 'vitest';
import { MAX_BODY_CHARACTERS, MAX_HEADER_BYTES, MAX_MESSAGE_BYTES, normalizeMessageId, parseMailAttachment, parseMailHeaders, parseMailMessage, sanitizeMailHtml } from '../src/server/mail/mime';

function rawMail(body: string, contentType = 'text/html; charset=utf-8'): Buffer {
  return Buffer.from(`From: Customer <customer@example.test>\r\nTo: Support <support@example.test>\r\nReply-To: Replies <reply@example.test>\r\nCc: office@example.test\r\nMessage-ID: <one@example.test>\r\nIn-Reply-To: <parent@example.test>\r\nReferences: <first@example.test> <parent@example.test>\r\nSubject: =?UTF-8?B?SGVsbG8=?=\r\nDate: Tue, 03 Nov 2026 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: ${contentType}\r\n\r\n${body}`);
}

function attachmentMail(mime: string, filename: string, content: Buffer): Buffer {
  return rawMail(`--test-boundary\r\nContent-Type: text/plain\r\n\r\nHello\r\n--test-boundary\r\nContent-Type: ${mime}\r\nContent-Disposition: attachment; filename="${filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${content.toString('base64')}\r\n--test-boundary--\r\n`, 'multipart/mixed; boundary=test-boundary');
}

describe('untrusted mail MIME content', () => {
  it('decodes RFC headers and preserves reply targets and thread references', async () => {
    const parsed = await parseMailMessage(rawMail('<p>Hello</p>'));
    expect(parsed).toMatchObject({ messageId: '<one@example.test>', subject: 'Hello', inReplyTo: '<parent@example.test>', references: ['<first@example.test>', '<parent@example.test>'], dateISO: '2026-11-03T12:00:00.000Z' });
    expect(parsed.replyTo).toEqual([{ name: 'Replies', address: 'reply@example.test' }]);
    expect(parsed.from[0]?.address).toBe('customer@example.test');
  });

  it('removes remote resources, CSS, active links, forms and scripts while retaining readable formatting', () => {
    const clean = sanitizeMailHtml('<style>@import "https://tracker.test";</style><script>alert(1)</script><p class="x" style="background:url(https://tracker.test)" onclick="alert(1)">Hello <strong>there</strong><a href="javascript:alert(1)">click</a></p><img src="https://tracker.test/pixel"><img src="cid:image"><svg><script>alert(2)</script></svg><form action="https://phishing.test"><input name="password">secret</form><iframe src="https://tracker.test">bad</iframe>');
    expect(clean).toBe('<p>Hello <strong>there</strong>click</p>');
    expect(clean).not.toMatch(/https:|javascript:|cid:|style|script|img|svg|form|iframe|onclick/);
  });

  it('never fabricates a timestamp for a missing or invalid Date header', async () => {
    expect((await parseMailHeaders(Buffer.from('Date: not a date\r\n\r\n'))).dateISO).toBeNull();
    expect((await parseMailHeaders(Buffer.from('Subject: hello\r\n\r\n'))).dateISO).toBeNull();
  });

  it('bounds source, headers and displayed body', async () => {
    await expect(parseMailMessage(Buffer.alloc(MAX_MESSAGE_BYTES + 1))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(parseMailHeaders(Buffer.alloc(MAX_HEADER_BYTES + 1))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const parsed = await parseMailMessage(rawMail('a'.repeat(MAX_BODY_CHARACTERS + 10), 'text/plain'));
    expect(parsed.bodyText).toHaveLength(MAX_BODY_CHARACTERS);
    expect(parsed.bodyTruncated).toBe(true);
    expect(sanitizeMailHtml('&'.repeat(MAX_BODY_CHARACTERS)).length).toBeLessThanOrEqual(MAX_BODY_CHARACTERS);
    expect(sanitizeMailHtml('<b>'.repeat(MAX_BODY_CHARACTERS / 3)).length).toBeLessThanOrEqual(MAX_BODY_CHARACTERS);
  });

  it('returns descriptors without attachment bytes and downloads only checked attachments', async () => {
    const raw = attachmentMail('text/plain', 'notes.txt', Buffer.from('Safe notes'));
    const parsed = await parseMailMessage(raw);
    expect(parsed.attachments).toEqual([{ id: 'attachment-1', filename: 'notes.txt', contentType: 'text/plain', size: 10, allowed: true, blockedReason: null }]);
    expect(JSON.stringify(parsed)).not.toContain(Buffer.from('Safe notes').toString('base64'));
    expect(await parseMailAttachment(raw, 'attachment-1')).toMatchObject({ base64: Buffer.from('Safe notes').toString('base64'), size: 10 });
    await expect(parseMailAttachment(raw, '../../notes.txt')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(parseMailAttachment(raw, 'attachment-2')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not trust MIME types inferred by mailparser from filenames', async () => {
    const raw = attachmentMail('application/octet-stream', 'notes.txt', Buffer.from('Safe notes'));
    expect((await parseMailMessage(raw)).attachments[0]?.allowed).toBe(false);
    await expect(parseMailAttachment(raw, 'attachment-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('blocks active attachments and oversized downloads even when the message itself is viewable', async () => {
    const active = attachmentMail('image/svg+xml', 'image.svg', Buffer.from('<svg onload="alert(1)"></svg>'));
    expect((await parseMailMessage(active)).attachments[0]?.allowed).toBe(false);
    await expect(parseMailAttachment(active, 'attachment-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const large = attachmentMail('text/plain', 'notes.txt', Buffer.alloc(2 * 1024 * 1024 + 1, 65));
    await expect(parseMailAttachment(large, 'attachment-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('validates Message-ID before it can be used as an IMAP search input', () => {
    expect(normalizeMessageId('<one@example.test>')).toBe('<one@example.test>');
    expect(normalizeMessageId('<one@example.test>\r\nBcc: attacker@example.test')).toBeNull();
    expect(normalizeMessageId('arbitrary input')).toBeNull();
  });
});
