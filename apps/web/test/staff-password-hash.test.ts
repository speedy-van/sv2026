import { PasswordLoginRequestSchema } from '@sv/contracts';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashStaffPassword, verifyStaffPassword } from '../src/server/auth/password';

describe('staff password hashing', () => {
  it('uses fresh 16-byte salts and verifies the full versioned scrypt hash', async () => {
    const password = randomBytes(24).toString('base64url');
    const first = await hashStaffPassword(password);
    const second = await hashStaffPassword(password);
    expect(first).toMatch(/^scrypt\$v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/u);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await verifyStaffPassword(password, first)).toBe(true);
    expect(await verifyStaffPassword(`${password}!`, first)).toBe(false);
  });

  it('preserves whitespace and Unicode instead of silently changing the password', async () => {
    const password = `  ${randomBytes(16).toString('hex')} Ω🚐  `;
    const encoded = await hashStaffPassword(password);
    expect(await verifyStaffPassword(password, encoded)).toBe(true);
    expect(await verifyStaffPassword(password.trim(), encoded)).toBe(false);
  });

  it('rejects missing, malformed and excessive-cost hash parameters without trusting their KDF settings', async () => {
    const password = randomBytes(24).toString('base64url');
    const salt = 'a'.repeat(32);
    const key = 'b'.repeat(128);
    for (const encoded of [
      null,
      '',
      `scrypt$v2$131072$8$1$${salt}$${key}`,
      `scrypt$v1$2147483648$8$1$${salt}$${key}`,
      `scrypt$v1$131072$1024$1024$${salt}$${key}`,
      `scrypt$v1$131072$8$1$${salt.slice(1)}$${key}`,
      `scrypt$v1$131072$8$1$${salt}$${key}g`,
      'x'.repeat(4096),
    ]) {
      expect(await verifyStaffPassword(password, encoded)).toBe(false);
    }
  });

  it('bounds password input for both provisioning and verification', async () => {
    for (const password of ['', 'x'.repeat(1025)]) {
      await expect(hashStaffPassword(password)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await verifyStaffPassword(password, null)).toBe(false);
    }
  });
});

describe('password login contract', () => {
  const input = {
    app: 'admin',
    device: { appVersion: '1.0.0', deviceId: 'password-test-device', deviceName: 'Unit test', platform: 'web' },
    email: '  STAFF@EXAMPLE.TEST ',
    password: `  ${randomBytes(24).toString('hex')}  `,
  };

  it('normalizes email and preserves the exact password and web device', () => {
    const parsed = PasswordLoginRequestSchema.parse(input);
    expect(parsed.email).toBe('staff@example.test');
    expect(parsed.password).toBe(input.password);
    expect(parsed.device.platform).toBe('web');
  });

  it('rejects empty/oversized passwords, invalid apps, missing devices and unexpected privilege fields', () => {
    for (const candidate of [
      { ...input, password: '' },
      { ...input, password: 'x'.repeat(1025) },
      { ...input, app: 'owner' },
      { ...input, device: undefined },
      { ...input, role: 'OWNER' },
      { ...input, passwordHash: 'not-a-login-field' },
    ]) expect(PasswordLoginRequestSchema.safeParse(candidate).success).toBe(false);
  });
});
