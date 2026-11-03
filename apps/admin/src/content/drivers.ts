import { ApiClientError } from '@sv/api-client';

export const driverCopy = {
  add: 'Add driver',
  adding: 'Adding driver…',
  back: 'Back to drivers',
  subtitle: 'Create an account the driver can use straight away.',
  accountTitle: 'Driver account',
  accountHint: 'The driver signs in to the driver app with this email and the password you set.',
  email: 'Email',
  password: 'Password',
  passwordHint: 'Use at least 12 characters. Share this password securely with the driver.',
  phone: 'Phone number',
  phoneHint: 'Include the country code for international numbers.',
  offline: 'You’re offline. Reconnect to add a driver.',
  success: 'Driver added',
  successHint: 'The account is active. The driver can sign in with the email and password you set.',
  open: 'Open driver',
  another: 'Add another driver',
  invalidEmail: 'Enter a valid email address.',
  invalidPassword: 'Use a password between 12 and 1,024 characters.',
  invalidPhone: 'Enter a valid phone number.',
  failed: 'The driver could not be added. Check your connection and try again.',
} as const;

export function driverCreateFailure(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 409) {
      return 'An account already uses this email. Check the driver directory or use a different email.';
    }
    if (error.status === 401 || error.status === 403)
      return 'Sign in with an admin account and unlock the app to add a driver.';
    if (error.status === 429) return 'Too many attempts. Wait a moment, then try again.';
    if (error.status === 400) return 'Check the email, password and phone number, then try again.';
  }
  return driverCopy.failed;
}
