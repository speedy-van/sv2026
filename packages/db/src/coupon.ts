import { createHash, randomInt } from 'node:crypto';

// Crockford base32 without I, L, O, U, so a code read aloud or retyped is unambiguous.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** The only form a coupon code is stored in. Shared by checkout and the coupon CLI. */
export function couponCodeHash(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/** 16 random characters (80 bits), grouped for reading: SV-XXXX-XXXX-XXXX-XXXX. */
export function generateCouponCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < 4; group += 1) {
    let part = '';
    for (let i = 0; i < 4; i += 1) part += ALPHABET.charAt(randomInt(ALPHABET.length));
    groups.push(part);
  }
  return `SV-${groups.join('-')}`;
}
