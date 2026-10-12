import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';
import { breakpoints, chakraPalettes, colors, durations, easings, radii, semanticColors, shadows, space, textStyles } from '@sv/tokens';

function tokenise<T extends Record<string, string>>(values: T): Record<keyof T, { value: string }> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])) as Record<keyof T, { value: string }>;
}

function colourScaleTokenise(scale: Record<string, string>): Record<string, { value: string }> {
  return Object.fromEntries(Object.entries(scale).map(([key, value]) => [key, { value }]));
}

function paletteTokens(palette: Record<string, string>): Record<string, { value: string }> {
  return Object.fromEntries(Object.entries(palette).map(([key, value]) => [key, { value }]));
}

export const system = createSystem(
  defaultConfig,
  defineConfig({
    globalCss: {
      html: { colorScheme: 'light' },
      body: {
        bg: 'bg.canvas',
        color: 'fg.default',
        fontFamily: 'body',
      },
      '*:focus-visible': {
        outline: '3px solid {colors.focus.ring}',
        outlineOffset: '2px',
      },
    },
    preflight: true,
    theme: {
      breakpoints,
      tokens: {
        colors: {
          ink: colourScaleTokenise(colors.ink),
          thistle: colourScaleTokenise(colors.thistle),
          gorse: colourScaleTokenise(colors.gorse),
          moss: colourScaleTokenise(colors.moss),
          rowan: colourScaleTokenise(colors.rowan),
          white: { value: colors.white },
        },
        durations: tokenise(durations),
        easings: tokenise(easings),
        fonts: {
          body: { value: 'var(--font-body), system-ui, sans-serif' },
          heading: { value: 'var(--font-display), system-ui, sans-serif' },
        },
        radii: tokenise(radii),
        shadows: tokenise(shadows),
        spacing: tokenise(space),
      },
      semanticTokens: {
        colors: {
          action: paletteTokens(semanticColors.action),
          bg: paletteTokens(semanticColors.bg),
          border: paletteTokens(semanticColors.border),
          brand: paletteTokens(semanticColors.brand),
          danger: paletteTokens(semanticColors.danger),
          fg: paletteTokens(semanticColors.fg),
          focus: paletteTokens(semanticColors.focus),
          gorse: paletteTokens(chakraPalettes.gorse),
          ink: paletteTokens(chakraPalettes.ink),
          moss: paletteTokens(chakraPalettes.moss),
          price: paletteTokens(semanticColors.price),
          rowan: paletteTokens(chakraPalettes.rowan),
          success: paletteTokens(semanticColors.success),
          thistle: paletteTokens(chakraPalettes.thistle),
        },
      },
      textStyles,
    },
  }),
);
