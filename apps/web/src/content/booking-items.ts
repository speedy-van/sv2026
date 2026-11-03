export const bookingItemsCopy = {
  addToList: 'Add to my list',
  autoFilled: (label: string): string => `We've added a typical list (${label.toLowerCase()}). Add or remove anything.`,
  cancel: 'Cancel',
  dismiss: 'Dismiss',
  moreInList: 'Also in your list',
  quickStart: 'Quick start',
  quickStartHelp: 'Pick a size to fill in a typical list, then adjust it.',
  replaceList: 'Replace my list',
  replaceOrAdd: (label: string): string => `Use the typical list (${label.toLowerCase()}). Replace your list or add to it?`,
} as const;

export const slotPartOfDay = {
  AFTERNOON: 'Afternoon',
  EVENING: 'Evening',
  MORNING: 'Morning',
} as const;

export const crewPriceOnTap = 'Tap for price';
