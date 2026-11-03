import { ApiClientError } from '@sv/api-client';
import { ZodError } from 'zod';

export const bookingEditCopy = {
  offline: 'You are offline. Your draft is kept here. Reconnect before previewing or saving changes.',
  conflict:
    'This booking changed. Your draft has been kept. Reload the latest booking and review it before saving.',
  uncertain:
    'The save result could not be confirmed. Your draft has been kept. Reload the booking before trying again.',
  emailWarning: 'Changing the email address invalidates the customer’s existing booking links.',
  previewRequired: 'Preview the revised price before saving. Any change to the move invalidates the preview.',
  loadError: 'The booking editor could not be loaded. Check your connection and retry.',
} as const;

export function bookingEditFailure(error: unknown): { message: string; reload: boolean } {
  if (error instanceof ZodError)
    return {
      message: error.issues[0]?.message ?? 'Check the highlighted details before continuing.',
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
