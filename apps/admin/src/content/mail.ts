import type { MailAddress, MailDelivery } from '@sv/contracts';

export const mailCopy = {
  title: 'Mail',
  offline: 'You are offline. Reconnect to sync, reply or open attachments.',
  notConfigured:
    'The business mailbox is not connected. Ask the owner to complete the server mailbox settings.',
  loadError: 'Mail could not be loaded. Check your connection and retry.',
  replyQueued: 'Reply queued. Check Deliveries for its send status.',
  bodyTruncated: 'This message is shortened because it exceeds the viewing limit.',
  uncertain:
    'Delivery could not be confirmed. The original email may have been sent. Retrying can send a duplicate.',
  attachmentLimit: 'Attachments up to 2 MB can be opened here. Blocked files cannot be downloaded.',
} as const;

export function mailAddresses(addresses: MailAddress[]): string {
  return addresses
    .map((address) => (address.name ? `${address.name} <${address.address}>` : address.address))
    .join(', ');
}

export function mailDeliveryLabel(status: MailDelivery['status']): string {
  const labels: Record<MailDelivery['status'], string> = {
    QUEUED: 'Queued',
    SENDING: 'Sending',
    SENT: 'Sent',
    RETRY: 'Retry scheduled',
    FAILED: 'Failed',
    UNCERTAIN: 'Delivery unconfirmed',
    DEFERRED: 'Waiting for quota reset',
  };
  return labels[status];
}
