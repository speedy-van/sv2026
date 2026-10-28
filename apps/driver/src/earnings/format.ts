export function formatPence(pence: number): string {
  return new Intl.NumberFormat('en-GB', { currency: 'GBP', style: 'currency' }).format(pence / 100);
}

export function formatAgreedEarning(pence: number | null): string {
  return pence === null ? 'Agreed by phone' : formatPence(pence);
}

export function formatPayoutAgreement(percent: number | null): string {
  return percent === null ? 'Agreed by phone' : `${String(percent)}%`;
}

export function earningTotals(items: readonly { amountPence: number; paid: boolean }[]): { earnedPence: number; paidPence: number; unpaidPence: number } {
  const earnedPence = items.reduce((total, item) => total + item.amountPence, 0);
  const paidPence = items.filter((item) => item.paid).reduce((total, item) => total + item.amountPence, 0);
  return { earnedPence, paidPence, unpaidPence: earnedPence - paidPence };
}
