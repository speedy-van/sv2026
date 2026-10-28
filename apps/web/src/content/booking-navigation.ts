export const bookingSteps = [
  { key: 'move', label: 'Move' },
  { key: 'access', label: 'Access' },
  { key: 'items', label: 'Items' },
  { key: 'prices', label: 'Prices' },
  { key: 'pay', label: 'Pay' },
] as const;

export const bookingNavigationCopy = {
  back: 'Back',
  progress: 'Booking progress',
  route: 'Your route',
  stepCount: (current: number, total: number): string => `Step ${String(current)} of ${String(total)}`,
  stepLabel: (number: number, label: string, completed: boolean): string =>
    `Step ${String(number)}${completed ? ', completed' : ''}: ${label}`,
} as const;
