import { describe, expect, it } from 'vitest';
import {
  appDarkColors,
  appLightColors,
  breakpoints,
  chakraPalettes,
  colors,
  durationMs,
  durations,
  layout,
  radii,
  semanticColors,
  shadows,
  space,
  springs,
  textStyles,
} from '../src';

describe('@sv/tokens', () => {
  it('exports the documented brand colours and semantic roles', () => {
    expect(colors.ink[900]).toBe('#0B1F33');
    expect(colors.gorse[400]).toBe('#FFC93C');
    expect(colors.thistle[600]).toBe('#6D3BD7');
    expect(semanticColors.bg.canvas).toBe(colors.ink[50]);
    expect(semanticColors.action.solid).toBe(colors.gorse[400]);
    expect(chakraPalettes.gorse.contrast).toBe(colors.ink[900]);
  });

  it('exports typography, layout and shape tokens for web and apps', () => {
    expect(textStyles['price.hero'].fontVariantNumeric).toBe('tabular-nums');
    expect(space[16]).toBe('64px');
    expect(breakpoints.lg).toBe('1024px');
    expect(layout.maxContentWidth).toBe('1200px');
    expect(radii.md).toBe('12px');
    expect(shadows.floating).toContain('0 16px 40px');
    expect(appLightColors.action).toBe(colors.gorse[400]);
    expect(appDarkColors.background).toBe(colors.ink[950]);
  });

  it('exports the motion timings and springs from the design system', () => {
    expect(durations.reveal).toBe('900ms');
    expect(durationMs.fast).toBe(150);
    expect(springs.snappy).toEqual({ stiffness: 520, damping: 38 });
  });
});
