import { ApiClientError } from '@sv/api-client';

export function authFailureMessage(error: unknown, method: 'password' | 'code' = 'password'): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return method === 'password'
      ? 'Email or password is incorrect.'
      : 'This code is invalid or has expired. Request a new code.';
    if (error.status === 429) return 'Too many sign-in attempts. Wait a few minutes before trying again.';
    if (error.status === 426) return 'Update the app before signing in.';
  }
  return 'We could not complete sign-in. Check your connection and try again.';
}
