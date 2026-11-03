export interface NotificationData {
  bookingId?: string;
  conversationId?: string;
  recipientUserId?: string;
  notificationId?: string;
  type?: string;
  url?: string;
}

export function routeFromNotificationData(data: NotificationData): string {
  if (data.type === 'CHAT_MESSAGE')
    return data.conversationId
      ? `/(app)/chat/${encodeURIComponent(data.conversationId)}`
      : '/(app)/chat';
  if (data.url?.startsWith('speedyvan-admin://')) {
    return data.url.replace('speedyvan-admin://', '/');
  }
  if (data.type === 'NEW_BOOKING' && data.bookingId) return `/(app)/bookings/${data.bookingId}`;
  if (data.type === 'QUOTE_REQUEST') return '/(app)/more?section=leads';
  return '/(app)/today';
}
