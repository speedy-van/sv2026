import 'server-only';

import { isUtf8 } from 'node:buffer';

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_FILENAME_BYTES = 180;

const allowedMimeTypes: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  txt: 'text/plain',
};

const dangerousExtensions = new Set([
  'exe', 'com', 'scr', 'bat', 'cmd', 'msi', 'msp', 'dll', 'sys', 'cpl', 'lnk', 'pif',
  'ps1', 'psd1', 'psm1', 'sh', 'bash', 'zsh', 'ksh', 'js', 'mjs', 'cjs', 'jse',
  'vbs', 'vbe', 'wsf', 'wsh', 'py', 'pyc', 'php', 'phtml', 'asp', 'aspx', 'jsp',
  'jar', 'class', 'apk', 'app', 'dmg', 'iso', 'img', 'zip', 'rar', '7z', 'tar',
  'gz', 'tgz', 'bz2', 'xz', 'cab', 'arj', 'zst', 'ace', 'html', 'htm', 'shtml',
  'xhtml', 'svg', 'svgz', 'xml', 'xsl', 'xslt', 'url', 'scf', 'reg', 'chm', 'hta',
  'desktop', 'crx', 'swf', 'wasm',
]);

function cleanBasename(name: string | undefined): string {
  // Remove invisible controls before inspecting extensions; do not hide an .exe
  // behind a NUL, zero-width character, or right-to-left override.
  return (name ?? '').normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '')
    .split(/[\\/]/u).at(-1)?.trim() ?? '';
}

function truncateUtf8(value: string, byteLimit: number): string {
  let result = '';
  let size = 0;
  for (const character of value) {
    const bytes = Buffer.byteLength(character, 'utf8');
    if (size + bytes > byteLimit) break;
    result += character;
    size += bytes;
  }
  return result;
}

export function sanitizeAttachmentFilename(name: string | undefined): string {
  let filename = cleanBasename(name).replace(/[<>:"|?*]/gu, '_')
    .replace(/^[.\s]+|[.\s]+$/gu, '');
  if (!filename) return 'attachment';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(filename)) {
    filename = `_${filename}`;
  }
  const suffix = /\.[a-z0-9]{1,12}$/iu.exec(filename)?.[0] ?? '';
  const stem = suffix ? filename.slice(0, -suffix.length) : filename;
  return truncateUtf8(stem, MAX_FILENAME_BYTES - Buffer.byteLength(suffix)) + suffix;
}

function safeText(content: Buffer): boolean {
  if (!isUtf8(content)) return false;
  const text = content.toString('utf8');
  // Plain text may contain tabs/newlines, but not binary control bytes.
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159)) return false;
  }
  const visibleText = text.replace(/\p{Cf}/gu, '');
  // Fail closed for markup and script-bearing text, including entity-escaped tags.
  return !/(?:<|&lt;|&#0*60;|&#x0*3c;)\s*(?:[a-z!/]|\?xml)|(?:javascript|vbscript)\s*:|data\s*:\s*(?:text\/html|image\/svg\+xml)|^\s*(?:#!|@echo\s+off\b)/imu.test(visibleText);
}

function matchesSignature(extension: string, content: Buffer): boolean {
  switch (extension) {
    case 'pdf':
      return /^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/u.test(content.subarray(0, 12).toString('ascii'))
        && /%%EOF\s*$/u.test(content.subarray(-1024).toString('latin1'));
    case 'png':
      return content.length >= 45
        && content.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
        && content.readUInt32BE(8) === 13
        && content.subarray(12, 16).toString('ascii') === 'IHDR'
        && content.readUInt32BE(16) > 0 && content.readUInt32BE(20) > 0
        && content.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'));
    case 'jpg':
    case 'jpeg':
      return content.length >= 4 && content[0] === 0xff && content[1] === 0xd8
        && content[2] === 0xff && content.subarray(-2).equals(Buffer.from([0xff, 0xd9]));
    case 'gif':
      return content.length >= 14 && /^GIF8[79]a$/u.test(content.subarray(0, 6).toString('ascii'))
        && content.readUInt16LE(6) > 0 && content.readUInt16LE(8) > 0 && content.at(-1) === 0x3b;
    case 'webp':
      return content.length >= 20 && content.subarray(0, 4).toString('ascii') === 'RIFF'
        && content.readUInt32LE(4) === content.length - 8
        && content.subarray(8, 12).toString('ascii') === 'WEBP'
        && ['VP8 ', 'VP8L', 'VP8X'].includes(content.subarray(12, 16).toString('ascii'));
    case 'txt':
      return safeText(content);
    default:
      return false;
  }
}

interface AttachmentInspection {
  filename: string;
  contentType: string;
  size: number;
  allowed: boolean;
  blockedReason: string | null;
}

/** Type/size screening only, not malware scanning. Allowed bytes are returned
 * through authenticated, no-store JSON. Native previews disable script, cookies,
 * external navigation and unrestricted file access; PDFs remain untrusted. */
export function inspectAttachment(input: {
  filename: string | undefined;
  contentType: string;
  content: Buffer;
}): AttachmentInspection {
  const filename = sanitizeAttachmentFilename(input.filename);
  const suppliedMime = input.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const contentType = suppliedMime.length <= 150 && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(suppliedMime)
    ? suppliedMime : 'application/octet-stream';
  const parts = cleanBasename(input.filename).toLowerCase().split('.');
  const extension = parts.at(-1) ?? '';
  let blockedReason: string | null = null;
  if (input.content.length === 0) blockedReason = 'Empty attachments are not allowed.';
  else if (input.content.length > MAX_ATTACHMENT_BYTES) blockedReason = 'Attachments must be 2 MB or smaller.';
  else if (parts.slice(1).some((part) => dangerousExtensions.has(part.trim()))) {
    blockedReason = 'Executable, archive, and active-content attachments are not allowed.';
  } else if (parts.length < 2 || !parts.slice(0, -1).join('.').trim() || !Object.hasOwn(allowedMimeTypes, extension)) {
    blockedReason = 'This attachment file type is not allowed.';
  } else if (contentType !== allowedMimeTypes[extension]) {
    blockedReason = 'The attachment file extension and content type do not match.';
  } else if (!matchesSignature(extension, input.content)) {
    blockedReason = 'The attachment content does not match an allowed file format.';
  }
  return { filename, contentType, size: input.content.length, allowed: blockedReason === null, blockedReason };
}
