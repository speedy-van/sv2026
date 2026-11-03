import type { BookingActivityHeartbeatRequest } from '@sv/contracts';

const activityEvent = 'sv:booking-activity-stage';
let activity: BookingActivityHeartbeatRequest | null = null;

export function currentBookingActivity(): BookingActivityHeartbeatRequest | null {
  return activity;
}
export function publishBookingActivity(next: BookingActivityHeartbeatRequest | null): void {
  activity = next;
  window.dispatchEvent(new Event(activityEvent));
}
export function subscribeBookingActivity(listener: () => void): () => void {
  window.addEventListener(activityEvent, listener);
  return () => { window.removeEventListener(activityEvent, listener); };
}
