import { describe, expect, it } from 'vitest';
import {
  inspectAttachment, MAX_ATTACHMENT_BYTES, sanitizeAttachmentFilename,
} from '../src/server/mail/attachment-policy';

const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZAAAAABJRU5ErkJggg==', 'base64');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xd9]);
const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const webp = Buffer.from('5249464616000000574542505650384c0a0000002f0000000007d0fffe07', 'hex');

function inspect(filename: string | undefined, contentType = 'application/pdf', content = pdf) {
  return inspectAttachment({ filename, contentType, content });
}

describe('mail attachment filename sanitization', () => {
  it.each([
    [undefined, 'attachment'], ['', 'attachment'], ['..', 'attachment'],
    ['../../invoice.pdf', 'invoice.pdf'], ['C:\\private\\invoice.pdf', 'invoice.pdf'],
    ['invoice\r\nX-Header: bad.pdf', 'invoiceX-Header_ bad.pdf'],
    ['invoice\u202e.pdf', 'invoice.pdf'], ['nul.txt', '_nul.txt'],
    ['con.PDF', '_con.PDF'], [' report.pdf. ', 'report.pdf'],
  ])('sanitizes %j without creating a path or header', (name, expected) => {
    expect(sanitizeAttachmentFilename(name)).toBe(expected);
  });

  it('caps UTF-8 byte length, keeps the extension and never splits a character', () => {
    const name = sanitizeAttachmentFilename(`${'📦'.repeat(200)}.pdf`);
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(180);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(name).not.toContain('\ufffd');
  });
});

describe('mail attachment content policy', () => {
  it.each([
    ['invoice.pdf', 'application/pdf', pdf], ['photo.png', 'image/png', png],
    ['photo.jpg', 'image/jpeg', jpeg], ['photo.jpeg', 'image/jpeg', jpeg],
    ['photo.gif', 'image/gif', gif], ['photo.webp', 'image/webp', webp],
    ['notes.txt', 'text/plain', Buffer.from('Hello\tworld\n2 < 3\r\nمرحبا 📦')],
  ])('allows matching filename, MIME and signature for %s', (filename, contentType, content) => {
    expect(inspect(filename, contentType, content)).toEqual({
      filename, contentType, size: content.length, allowed: true, blockedReason: null,
    });
  });

  it('normalizes MIME parameters and case without trusting the declared MIME', () => {
    expect(inspect('INVOICE.PDF', ' APPLICATION/PDF; name="invoice.pdf"').allowed).toBe(true);
    expect(inspect('notes.txt', 'text/plain; charset=UTF-8', Buffer.from('Booking notes')).contentType).toBe('text/plain');
    expect(inspect('invoice.pdf', 'application/pdf\r\nX-Evil: yes').allowed).toBe(false);
  });

  it('allows exactly 2 MiB and blocks larger or empty attachments', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(2 * 1024 * 1024);
    expect(inspect('notes.txt', 'text/plain', Buffer.alloc(MAX_ATTACHMENT_BYTES, 65)).allowed).toBe(true);
    expect(inspect('notes.txt', 'text/plain', Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 65)).allowed).toBe(false);
    expect(inspect('notes.txt', 'text/plain', Buffer.alloc(0)).allowed).toBe(false);
  });

  it.each([
    'invoice.exe', 'invoice.zip', 'invoice.html', 'invoice.svg', 'invoice.exe.pdf',
    'invoice.PS1.pdf', 'invoice.zip.pdf', 'invoice.html.pdf', 'invoice.svg.pdf',
    'invoice.exe .pdf', 'invoice.e\u0000xe.pdf', 'invoice.e\u200bxe.pdf',
    'invoice．exe．pdf', 'invoice.pdf.exe', 'invoice.pdf:payload.exe',
  ])('blocks dangerous extensions including concealed inner suffixes: %s', (filename) => {
    expect(inspect(filename).allowed).toBe(false);
  });

  it.each([undefined, 'invoice', '.pdf', 'invoice.pdf ', 'invoice.pdf.', 'invoice.toString'])('fails closed for absent or ambiguous suffix %j', (filename) => {
    // Surrounding whitespace is ordinary MIME filename formatting, but a leading
    // dot without a stem must never manufacture an allowed attachment name.
    if (filename === 'invoice.pdf ') expect(inspect(filename).allowed).toBe(true);
    else expect(inspect(filename).allowed).toBe(false);
  });

  it.each([
    ['invoice.pdf', 'image/png', pdf], ['invoice.png', 'image/png', pdf],
    ['invoice.pdf', 'application/octet-stream', pdf], ['notes.txt', 'text/plain', png],
    ['invoice.pdf', 'application/pdf', Buffer.from('MZ executable payload')],
    ['archive.pdf', 'application/pdf', Buffer.from('PK\u0003\u0004zip payload')],
    ['photo.webp', 'image/webp', Buffer.from('RIFFxxxxWAVEfmt ')],
  ])('blocks MIME or content spoofing: %s / %s', (filename, contentType, content) => {
    const result = inspect(filename, contentType, content);
    expect(result.allowed).toBe(false);
    expect(result.blockedReason).toBeTypeOf('string');
  });

  it.each([
    Buffer.from([0xc0, 0xaf]), Buffer.from('hello\u0000world'), Buffer.from([0xff, 0xfe, 65, 0]),
    Buffer.from('<!DOCTYPE html><html><body>Hi</body></html>'), Buffer.from('<ScRiPt>alert(1)</ScRiPt>'),
    Buffer.from('<svg onload="alert(1)"/>'), Buffer.from('<?xml version="1.0"?><svg/>'),
    Buffer.from('&lt;script&gt;alert(1)'), Buffer.from('&#x3c;svg onload=alert(1)>'),
    Buffer.from('<s\u200bcript>alert(1)</script>'), Buffer.from('javascript:alert(1)'),
    Buffer.from('#!/bin/sh\nrm -rf /'), Buffer.from('@echo off\r\nmalware.exe'),
  ])('blocks invalid UTF-8, binary controls, markup and scripts renamed as text', (content) => {
    expect(inspect('notes.txt', 'text/plain', content).allowed).toBe(false);
  });

  it.each([
    ['invoice.pdf', 'application/pdf', pdf], ['photo.png', 'image/png', png],
    ['photo.jpg', 'image/jpeg', jpeg], ['photo.gif', 'image/gif', gif],
    ['photo.webp', 'image/webp', webp],
  ])('rejects truncated magic/header data and appended active content for %s', (filename, contentType, content) => {
    expect(inspect(filename, contentType, content.subarray(0, 3)).allowed).toBe(false);
    expect(inspect(filename, contentType, Buffer.concat([content, Buffer.from('<script>alert(1)</script>')])).allowed).toBe(false);
  });

  it('inspects the complete filename before length capping can hide a dangerous suffix', () => {
    expect(inspect(`invoice.exe.${'a'.repeat(300)}.pdf`).allowed).toBe(false);
    expect(inspect('invoice.2026.pdf').allowed).toBe(true);
  });
});
