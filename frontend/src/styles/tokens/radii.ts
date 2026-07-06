/**
 * Border-radius tokens (frontend steering §9). Single source of truth for
 * corner rounding; keep in sync with the `@theme` block in
 * `src/styles/theme.css`.
 */
export const radii = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  full: '9999px',
} as const;

export type RadiusToken = keyof typeof radii;
