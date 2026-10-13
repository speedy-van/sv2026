import 'server-only';

export interface MatrixChannels {
  adminEmail?: string;
  adminNotification: boolean;
  adminNotificationOwnerOnly?: boolean;
  adminPush?: {
    category: string;
    onlyWithinHours?: number;
    ownerOnly?: boolean;
    sound: 'default' | 'new-job.wav';
    timeSensitive?: boolean;
  };
  customerEmail?: string;
  driverPush?: {
    category: string;
    quietHours?: boolean;
    sound: 'default' | 'job-offer.wav';
    target: 'assigned' | 'offered' | 'payload-driver' | 'previous-driver';
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
  'booking.assigned': {
    adminNotification: true,
    driverPush: { category: 'JOB_ASSIGNED', sound: 'job-offer.wav', target: 'assigned', timeSensitive: true },
  },
  'booking.cancelled': {
    adminNotification: true,
    adminPush: { category: 'CHANGE', onlyWithinHours: 48, sound: 'default' },
    customerEmail: 'cancelled',
    driverPush: { category: 'JOB_CANCELLED', sound: 'default', target: 'assigned', timeSensitive: true },
  },
  'booking.completed': { adminNotification: true, customerEmail: 'move-completed' },
  'booking.driver_accepted': { adminNotification: true, customerEmail: 'driver-assigned' },
  'booking.driver_declined': {
    adminNotification: true,
    adminPush: { category: 'DISPATCH', sound: 'default' },
  },
  'booking.extra_paid': {
    adminNotification: true,
    customerEmail: 'payment-received',
    driverPush: { category: 'EXTRA_PAID', sound: 'default', target: 'assigned', timeSensitive: true },
  },
  'booking.offer_expired': {
    adminNotification: true,
    adminPush: { category: 'DISPATCH', sound: 'default' },
  },
  'booking.offered': {
    adminNotification: true,
    driverPush: { category: 'JOB_OFFER', sound: 'job-offer.wav', target: 'offered', timeSensitive: true },
  },
  'booking.rescheduled': {
    adminNotification: true,
    adminPush: { category: 'CHANGE', onlyWithinHours: 48, sound: 'default' },
    customerEmail: 'rescheduled',
    driverPush: { category: 'JOB_WITHDRAWN', sound: 'default', target: 'previous-driver', timeSensitive: true },
  },
  'booking.updated': {
    adminNotification: true,
    driverPush: { category: 'JOB_CHANGED', quietHours: true, sound: 'default', target: 'assigned' },
  },
  'contact.received': { adminNotification: true, customerEmail: 'contact-received' },
  'extra_charge.requested': {
    adminNotification: true,
    adminPush: { category: 'EXTRA_REQUEST', sound: 'default', timeSensitive: true },
  },
  'extra_charge.awaiting_payment': { adminNotification: true, customerEmail: 'extra-charge-request' },
  'job.issue_reported': {
    adminNotification: true,
    adminPush: { category: 'JOB_ISSUE', sound: 'default', timeSensitive: true },
  },
  'job.stage_changed': { adminNotification: true, customerEmail: 'on-the-way' },
  'manual_quote.requested': {
    adminEmail: 'admin-manual-quote',
    adminNotification: true,
    adminPush: { category: 'QUOTE_REQUEST', sound: 'new-job.wav', timeSensitive: true },
    customerEmail: 'manual-quote-received',
  },
  'manual_quote.priced': { adminNotification: true, customerEmail: 'manual-quote-ready' },
  'manual_quote.declined': { adminNotification: true, customerEmail: 'manual-quote-declined' },
  'payout.recorded': {
    adminNotification: false,
    driverPush: { category: 'PAYOUT', quietHours: true, sound: 'default', target: 'payload-driver' },
  },
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
  'review.submitted': { adminNotification: true },
  'system.alert': {
    adminEmail: 'admin-system-alert',
    adminNotification: true,
    adminNotificationOwnerOnly: true,
    adminPush: { category: 'SYSTEM', ownerOnly: true, sound: 'default' },
  },
};

export function channelsForEvent(type: string): MatrixChannels | null {
  return NOTIFICATION_MATRIX[type] ?? null;
}
