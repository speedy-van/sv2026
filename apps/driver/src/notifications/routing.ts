export interface NotificationData {
  bookingId?: string;
  notificationId?: string;
  type?: string;
  url?: string;
}

export function routeFromNotificationData(data: NotificationData): string {
  if (data.type === 'JOB_OFFERED' && data.bookingId) return `/(app)/offers/${data.bookingId}`;
  if (data.bookingId) return `/(app)/jobs/${data.bookingId}`;
  return '/(app)/today';
}
