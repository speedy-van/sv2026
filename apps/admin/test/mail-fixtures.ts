import type { MailDelivery, MailMessage } from '@sv/contracts';

export const mailMessage: MailMessage = {
  id: 'message-one',
  threadId: 'thread-one',
  folder: 'inbox',
  subject: 'Moving details',
  from: [{ address: 'customer@example.test', name: 'Test customer' }],
  to: [{ address: 'business@example.test' }],
  cc: [{ address: 'helper@example.test' }],
  replyTo: [],
  sentAt: '2031-10-15T12:00:00.000Z',
  read: false,
  attachmentCount: 2,
  snippet: 'Here are the details.',
  bodyText: 'Here are the details.',
  bodyHtml: '<p>Here are the details.</p>',
  bodyTruncated: false,
  messageId: '<test@example.test>',
  attachments: [
    { id: 'file/one', filename: 'move.pdf', contentType: 'application/pdf', size: 10, blockedReason: null },
    {
      id: 'file-two',
      filename: 'unsafe.exe',
      contentType: 'application/octet-stream',
      size: 10,
      blockedReason: 'This file type is blocked.',
    },
  ],
};
export const mailSummary = {
  id: mailMessage.id,
  threadId: mailMessage.threadId,
  folder: mailMessage.folder,
  subject: mailMessage.subject,
  from: mailMessage.from,
  to: mailMessage.to,
  sentAt: mailMessage.sentAt,
  read: mailMessage.read,
  attachmentCount: mailMessage.attachmentCount,
  snippet: mailMessage.snippet,
};
export const mailStatus = {
  configured: true,
  mailbox: 'business@example.test',
  folders: [
    { id: 'inbox' as const, unreadCount: 1 },
    { id: 'sent' as const, unreadCount: 0 },
  ],
  lastSyncAt: '2031-10-15T12:00:00.000Z',
  syncError: null,
  failedCount: 1,
  uncertainCount: 1,
  quota: {
    messagesUsed: 1,
    messagesLimit: 100,
    externalRecipientsUsed: 1,
    externalRecipientsLimit: 100,
    resetsAt: '2031-10-16T00:00:00.000Z',
  },
};
export const mailList = {
  items: [mailSummary],
  nextCursor: null,
  sync: { at: mailStatus.lastSyncAt, error: null, hasMore: false },
};
export const mailThread = {
  id: mailMessage.threadId,
  subject: mailMessage.subject,
  messages: [mailMessage],
  nextCursor: null,
};
export const mailDelivery: MailDelivery = {
  id: 'delivery-one',
  subject: 'Reply to moving details',
  to: mailMessage.from,
  status: 'UNCERTAIN',
  attempts: 1,
  lastErrorCode: 'TIMEOUT',
  nextAttemptAt: null,
  createdAt: mailMessage.sentAt,
  sentAt: null,
  canRetry: true,
};
export const mailContent = {
  filename: 'move.pdf',
  contentType: 'application/pdf',
  size: 5,
  base64: 'SGVsbG8=',
};
