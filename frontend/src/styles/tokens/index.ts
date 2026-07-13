/**
 * Barrel for the WREN design tokens — the centralized single source of truth for
 * colors, typography, spacing, radii, and shadows (frontend steering §9).
 *
 * Import tokens from `@/styles/tokens` in components; never hardcode raw color,
 * font-size, spacing, radius, or shadow values inline.
 */
export { colors, palette } from './colors';
export type { ColorToken } from './colors';

export {
  fontFamilies,
  fontWeights,
  fontSizes,
  lineHeights,
  type,
} from './typography';
export type { TypeToken } from './typography';

export { spacing } from './spacing';
export type { SpacingToken } from './spacing';

export { radii } from './radii';
export type { RadiusToken } from './radii';

export { shadows } from './shadows';
export type { ShadowToken } from './shadows';
