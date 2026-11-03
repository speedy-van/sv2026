export function isBookingJourneyPath(pathname: string): boolean {
  return pathname === '/book'
    || pathname.startsWith('/book/')
    || pathname.startsWith('/quote/')
    || pathname.startsWith('/pay/');
}
