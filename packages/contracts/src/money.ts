import { z } from 'zod';

export const PenceSchema = z.number().int().nonnegative();
export type Pence = z.infer<typeof PenceSchema>;

const gbpFormatter = new Intl.NumberFormat('en-GB', {
  currency: 'GBP',
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: 'currency',
});

export function assertPence(value: number): Pence {
  return PenceSchema.parse(value);
}

export function addPence(...values: number[]): Pence {
  return assertPence(values.reduce((sum, value) => sum + assertPence(value), 0));
}

export function subtractPence(left: number, right: number): number {
  assertPence(left);
  assertPence(right);
  return left - right;
}

export function formatGBP(pence: number): string {
  return gbpFormatter.format(assertPence(pence) / 100);
}

export function poundsToPence(pounds: number): Pence {
  if (!Number.isFinite(pounds) || pounds < 0) {
    throw new RangeError('Pounds must be a finite non-negative number');
  }
  return assertPence(Math.round(Number((pounds * 100).toPrecision(15))));
}
