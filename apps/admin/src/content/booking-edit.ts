import { ApiClientError } from '@sv/api-client';
import { ZodError } from 'zod';

export const bookingEditCopy = {
  offline: 'You’re offline. Your changes are kept here. Reconnect to the internet to check the price or save.',
  conflict:
    'Someone else changed this booking just now. Your changes are kept. Tap Refresh to see the latest booking, then check it before saving.',
  uncertain:
    'We couldn’t tell if your changes were saved. Your changes are kept. Tap Refresh to check before trying again.',
  emailWarning: 'If you change the email address, the links already sent to the customer will stop working.',
  previewRequired: 'Check the new price before saving. If you change the move again, check the price again.',
  loadError: 'We couldn’t open this booking for editing. Check your internet connection and try again.',
} as const;

export function bookingEditFailure(error: unknown): { message: string; reload: boolean } {
  if (error instanceof ZodError)
    return {
      message: 'Some details are missing or not quite right. Please check the form and try again.',
      reload: false,
    };
  if (error instanceof ApiClientError) {
    if (error.status === 409) return { message: bookingEditCopy.conflict, reload: true };
    if (error.status === 401 || error.status === 403)
      return { message: 'Sign in with an admin account and unlock the app to continue.', reload: false };
    if (error.status >= 400 && error.status < 500) return { message: error.message, reload: false };
  }
  return { message: bookingEditCopy.uncertain, reload: true };
}
