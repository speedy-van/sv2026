export function poundsToPence(value: string): number {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error('Enter an amount in pounds with no more than two decimal places.');
  const [pounds = '0', pennies = ''] = normalized.split('.');
  const result = Number(pounds) * 100 + Number(pennies.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error('Enter an amount greater than £0.00.');
  return result;
}

export { londonToday as todayInLondon } from '@sv/contracts';

export function penceToInput(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('The amount must be whole pence.');
  return `${String(Math.floor(value / 100))}.${String(value % 100).padStart(2, '0')}`;
}
