import 'server-only';

export interface MatrixChannels {
  adminEmail?: string;
  adminNotification: boolean;
  adminPush?: {
    category: string;
    sound: 'default' | 'new-job.wav';
    timeSensitive?: boolean;
  };
  customerEmail?: string;
  driverPush?: {
    category: string;
    sound: 'default' | 'job-offer.wav';
    timeSensitive?: boolean;
  };
}

export const NOTIFICATION_MATRIX: Record<string, MatrixChannels> = {
  'booking.checkout_abandoned': { adminNotification: true },
  'booking.confirmed': {
    adminEmail: 'admin-new-booking',
    adminNotification: true,
    adminPush: { category: 'NEW_BOOKING', sound: 'new-job.wav', timeSensitive: true },
    customerEmail: 'booking-confirmed',
  },
  'contact.received': { adminNotification: true, customerEmail: 'contact-received' },
  'manual_quote.requested': {
    adminEmail: 'admin-manual-quote',
    adminNotification: true,
    adminPush: { category: 'QUOTE_REQUEST', sound: 'new-job.wav', timeSensitive: true },
    customerEmail: 'manual-quote-received',
  },
  'manual_quote.priced': { adminNotification: true, customerEmail: 'manual-quote-ready' },
  'manual_quote.declined': { adminNotification: true, customerEmail: 'manual-quote-declined' },
  'payment.after_expiry_refunded': {
    adminEmail: 'admin-system-alert',
    adminNotification: true,
    customerEmail: 'payment-after-expiry-refunded',
  },
  'payment.dispute.created': {
    adminEmail: 'admin-dispute',
    adminNotification: true,
    adminPush: { category: 'DISPUTE', sound: 'default', timeSensitive: true },
  },
  'payment.refund.created': { adminNotification: true, customerEmail: 'refund-issued' },
  'system.alert': {
    adminEmail: 'admin-system-alert',
    adminNotification: true,
    adminPush: { category: 'SYSTEM', sound: 'default' },
  },
};

export function channelsForEvent(type: string): MatrixChannels | null {
  return NOTIFICATION_MATRIX[type] ?? null;
}
