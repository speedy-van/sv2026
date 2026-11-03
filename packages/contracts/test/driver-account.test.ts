import { describe, expect, it } from 'vitest';
import { AdminDriverDetailResponseSchema, DriverCreateResponseSchema, DriverCreateSchema, DriverPatchSchema } from '../src';

const input = { email: ' DRIVER@EXAMPLE.TEST ', password: '  a long driver passphrase  ', phone: '07465 227962' };

describe('admin-created driver account contract', () => {
  it('normalizes contact fields without changing the chosen password', () => {
    expect(DriverCreateSchema.parse(input)).toEqual({
      email: 'driver@example.test', password: input.password, phone: '07465227962',
    });
  });

  it.each([
    { ...input, email: 'not-an-email' },
    { ...input, password: '' },
    { ...input, password: 'short-pass' },
    { ...input, password: ' '.repeat(12) },
    { ...input, password: 'x'.repeat(1025) },
    { ...input, phone: undefined },
    { ...input, phone: 'invalid' },
    { ...input, role: 'OWNER' },
    { ...input, status: 'INVITED' },
    { ...input, payoutPercent: 100 },
  ])('rejects invalid or privilege-bearing creation input %#', (invalid) => {
    expect(DriverCreateSchema.safeParse(invalid).success).toBe(false);
  });

  it('accepts the exact password limits and an optional real name', () => {
    expect(DriverCreateSchema.parse({ ...input, password: 'x'.repeat(12) }).password).toHaveLength(12);
    expect(DriverCreateSchema.parse({ ...input, password: 'x'.repeat(1024) }).password).toHaveLength(1024);
    expect(DriverCreateSchema.parse({ ...input, name: ' Driver Name ' }).name).toBe('Driver Name');
  });

  it('allows only the minimal creation acknowledgement', () => {
    expect(DriverCreateResponseSchema.parse({ id: 'driver-id', ok: true })).toEqual({ id: 'driver-id', ok: true });
    expect(DriverCreateResponseSchema.safeParse({ id: 'driver-id', ok: true, passwordHash: 'private' }).success).toBe(false);
  });

  it('keeps an absent phone-agreement percentage distinct from a genuine zero percentage', () => {
    const field = AdminDriverDetailResponseSchema.shape.payoutPercent;
    expect(field.parse(null)).toBeNull();
    expect(field.parse(0)).toBe(0);
    expect(field.safeParse(-1).success).toBe(false);
    expect(field.safeParse(101).success).toBe(false);
    expect(DriverPatchSchema.parse({ payoutPercent: null })).toEqual({ payoutPercent: null });
  });
});
