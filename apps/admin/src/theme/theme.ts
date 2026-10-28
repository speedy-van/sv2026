import { appLightColors, colors, radii, space } from '@sv/tokens';
import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';

const lightColors = {
  action: colors.gorse[400],
  background: appLightColors.background,
  border: colors.ink[100],
  borderStrong: colors.ink[400],
  brand: appLightColors.brand,
  brandSoft: colors.thistle[50],
  danger: colors.rowan[600],
  dangerSoft: colors.rowan[50],
  focus: colors.thistle[600],
  inverse: colors.ink[900],
  muted: appLightColors.muted,
  onAction: colors.ink[900],
  onBrand: colors.white,
  onDanger: colors.white,
  placeholder: colors.ink[500],
  separator: colors.ink[100],
  shadow: colors.ink[900],
  success: colors.moss[700],
  successSoft: colors.moss[50],
  surface: appLightColors.surface,
  surfaceElevated: colors.white,
  surfaceMuted: colors.ink[50],
  text: appLightColors.text,
  warning: colors.gorse[800],
  warningSoft: colors.gorse[50],
} as const;

export type AppTheme = { [Key in keyof typeof lightColors]: string };

// Neutral grouped surfaces keep the dark control room quiet; brand colours remain shared tokens.
const darkColors = {
  action: colors.gorse[400],
  background: '#0C0E13',
  border: '#2B303B',
  borderStrong: colors.ink[400],
  brand: colors.thistle[300],
  brandSoft: colors.thistle[950],
  danger: colors.rowan[300],
  dangerSoft: colors.rowan[950],
  focus: colors.thistle[300],
  inverse: colors.ink[50],
  muted: colors.ink[300],
  onAction: colors.ink[900],
  onBrand: colors.ink[950],
  onDanger: colors.ink[950],
  placeholder: colors.ink[300],
  separator: '#272C36',
  shadow: colors.ink[950],
  success: colors.moss[300],
  successSoft: colors.moss[950],
  surface: '#161920',
  surfaceElevated: '#20242D',
  surfaceMuted: '#10131A',
  text: colors.ink[50],
  warning: colors.gorse[200],
  warningSoft: colors.gorse[950],
} as const satisfies AppTheme;

export const appLayout = {
  canvasMaxWidth: 1120,
  cardRadius: Number.parseInt(radii.lg, 10),
  controlRadius: Number.parseInt(radii.md, 10),
  minTouchTarget: 48,
  phoneGutter: 20,
  tabletGutter: 32,
} as const;

export const theme = { colors: lightColors, darkColors, layout: appLayout, radii, space } as const;

export type AppAppearance = 'system' | 'light' | 'dark';

let appearance: AppAppearance = 'system';
const appearanceListeners = new Set<() => void>();

function subscribeAppearance(listener: () => void): () => void {
  appearanceListeners.add(listener);
  return () => {
    appearanceListeners.delete(listener);
  };
}

function setPreference(preference: AppAppearance): void {
  if (appearance === preference) return;
  appearance = preference;
  appearanceListeners.forEach((listener) => {
    listener();
  });
}

export function useAppAppearance(): {
  preference: AppAppearance;
  setPreference: (preference: AppAppearance) => void;
} {
  const preference = useSyncExternalStore<AppAppearance>(
    subscribeAppearance,
    () => appearance,
    () => 'system',
  );
  return { preference, setPreference };
}

export function useAppColorScheme(): 'light' | 'dark' {
  const systemScheme = useColorScheme();
  const { preference } = useAppAppearance();
  return preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;
}

export function useAppColors(): AppTheme {
  const scheme = useAppColorScheme();
  return scheme === 'dark' ? theme.darkColors : theme.colors;
}
