export function formatPence(pence: number): string {
  return new Intl.NumberFormat('en-GB', { currency: 'GBP', style: 'currency' }).format(pence / 100);
}

export function earningTotals(items: readonly { amountPence: number; paid: boolean }[]): { earnedPence: number; paidPence: number; unpaidPence: number } {
  const earnedPence = items.reduce((total, item) => total + item.amountPence, 0);
  const paidPence = items.filter((item) => item.paid).reduce((total, item) => total + item.amountPence, 0);
  return { earnedPence, paidPence, unpaidPence: earnedPence - paidPence };
}
