import { displayBookingCreatedAt } from '../src/lib/admin-date-time';

describe('booking creation timestamp in Europe/London', () => {
  it.each([
    ['2031-03-01T12:34:56.789Z', '1 March 2031 at 12:34 GMT'],
    ['2026-01-15T01:53:10.000Z', '15 January 2026 at 01:53 GMT'],
    ['2026-07-15T01:53:10.000Z', '15 July 2026 at 02:53 BST'],
    ['2026-06-30T23:05:00.000Z', '1 July 2026 at 00:05 BST'],
    ['2026-03-29T00:59:00.000Z', '29 March 2026 at 00:59 GMT'],
    ['2026-03-29T01:00:00.000Z', '29 March 2026 at 02:00 BST'],
    ['2026-10-25T00:30:00.000Z', '25 October 2026 at 01:30 BST'],
    ['2026-10-25T01:30:00.000Z', '25 October 2026 at 01:30 GMT'],
    ['2026-12-31T23:59:00.000Z', '31 December 2026 at 23:59 GMT'],
    ['2027-01-01T00:00:00.000Z', '1 January 2027 at 00:00 GMT'],
  ])('formats %s with the correct London date, minute and zone', (input, expected) => {
    expect(displayBookingCreatedAt(input)).toBe(expected);
  });

  it('uses the same London instant when the recorded ISO timestamp has another offset', () => {
    expect(displayBookingCreatedAt('2031-03-01T07:34:56.789-05:00')).toBe('1 March 2031 at 12:34 GMT');
    expect(displayBookingCreatedAt('2026-07-01T08:15:00.000+09:00')).toBe('1 July 2026 at 00:15 BST');
  });

  it('does not collapse the two occurrences of the autumn repeated hour into an ambiguous value', () => {
    const before = displayBookingCreatedAt('2026-10-25T00:30:00.000Z');
    const after = displayBookingCreatedAt('2026-10-25T01:30:00.000Z');
    expect(before).not.toBe(after);
    expect(before).toBe('25 October 2026 at 01:30 BST');
    expect(after).toBe('25 October 2026 at 01:30 GMT');
  });
});
