const bookingCreatedFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Europe/London',
  timeZoneName: 'short',
});

/** Format a validated API timestamp independently of the device's time zone. */
export function displayBookingCreatedAt(timestamp: string): string {
  return bookingCreatedFormatter.format(new Date(timestamp));
}
