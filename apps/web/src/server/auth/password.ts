import 'server-only';

import { AppError, StaffPasswordSchema } from '@sv/contracts';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP scrypt minimum: N=2^17, r=8, p=1. Verification accepts only this version.
const parameters = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
const saltBytes = 16;
const keyBytes = 64;
const hashPrefix = 'scrypt$v1$131072$8$1$';
const hashPattern = /^scrypt\$v1\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/u;
const dummySalt = randomBytes(saltBytes);
const dummyKey = randomBytes(keyBytes);

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyBytes, parameters, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashStaffPassword(password: string): Promise<string> {
  if (!StaffPasswordSchema.safeParse(password).success) {
    throw new AppError('VALIDATION_ERROR', 'Password must contain between 1 and 1024 characters.');
  }
  const salt = randomBytes(saltBytes);
  const key = await deriveKey(password, salt);
  try {
    return `${hashPrefix}${salt.toString('hex')}$${key.toString('hex')}`;
  } finally {
    key.fill(0);
  }
}

export async function verifyStaffPassword(password: string, encodedHash: string | null): Promise<boolean> {
  if (!StaffPasswordSchema.safeParse(password).success) return false;
  const match = encodedHash !== null && encodedHash.length <= 256 ? hashPattern.exec(encodedHash) : null;
  const saltHex = match?.[1];
  const keyHex = match?.[2];
  const validHash = saltHex !== undefined && keyHex !== undefined;
  const salt = validHash ? Buffer.from(saltHex, 'hex') : dummySalt;
  const expected = validHash ? Buffer.from(keyHex, 'hex') : dummyKey;
  // Missing/unsupported hashes incur the same bounded KDF work as existing accounts.
  const actual = await deriveKey(password, salt);
  try {
    return timingSafeEqual(actual, expected) && validHash;
  } finally {
    actual.fill(0);
  }
}
