import { appDarkColors, appLightColors, colors, radii, space } from '@sv/tokens';
import { useColorScheme } from 'react-native';

export const theme = {
  colors: {
    action: colors.gorse[400],
    background: appLightColors.background,
    border: colors.ink[100],
    brand: appLightColors.brand,
    danger: colors.rowan[600],
    inverse: colors.ink[900],
    muted: appLightColors.muted,
    success: colors.moss[600],
    surface: appLightColors.surface,
    text: appLightColors.text,
    warning: colors.gorse[500]
  },
  darkColors: {
    action: colors.gorse[400],
    background: appDarkColors.background,
    border: colors.ink[800],
    brand: appDarkColors.brand,
    danger: colors.rowan[400],
    inverse: colors.ink[50],
    muted: appDarkColors.muted,
    success: colors.moss[400],
    surface: appDarkColors.surface,
    text: appDarkColors.text,
    warning: colors.gorse[400]
  },
  radii,
  space
} as const;

export interface AppTheme {
  action: string;
  background: string;
  border: string;
  brand: string;
  danger: string;
  inverse: string;
  muted: string;
  success: string;
  surface: string;
  text: string;
  warning: string;
}

export function useAppColors(): AppTheme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? theme.darkColors : theme.colors;
}
