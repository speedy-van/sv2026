export const space = {
  0.5: '2px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
  32: '128px',
} as const;

export const breakpoints = {
  sm: '480px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1440px',
} as const;

export const radii = {
  sm: '8px',
  md: '12px',
  lg: '20px',
  xl: '32px',
  full: '9999px',
} as const;

export const shadows = {
  floating: '0 1px 2px rgb(11 31 51 / 0.06), 0 16px 40px -16px rgb(11 31 51 / 0.28)',
  none: 'none',
} as const;

export const layout = {
  mobileColumns: 4,
  desktopColumns: 12,
  mobileGutter: space[4],
  desktopGutter: space[6],
  maxContentWidth: '1200px',
  sectionPaddingYMobile: space[16],
  sectionPaddingYDesktop: '112px',
  webTouchTarget: '44px',
  adminTouchTarget: '48px',
  driverTouchTarget: '56px',
} as const;
