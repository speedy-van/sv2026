export const durations = {
  instant: '80ms',
  fast: '150ms',
  base: '220ms',
  slow: '360ms',
  reveal: '900ms',
} as const;

export const durationMs = {
  instant: 80,
  fast: 150,
  base: 220,
  slow: 360,
  reveal: 900,
} as const;

export const easings = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  enter: 'cubic-bezier(0, 0, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

export const springs = {
  snappy: { stiffness: 520, damping: 38 },
  gentle: { stiffness: 220, damping: 28 },
  bouncy: { stiffness: 380, damping: 20 },
} as const;

export const reducedMotion = {
  opacityDuration: '120ms',
  transform: 'none',
} as const;
