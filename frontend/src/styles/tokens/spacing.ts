/**
 * Spacing tokens — a single spacing scale (frontend steering §9). No arbitrary
 * one-off margin/padding values are allowed in component code; use these tokens
 * or the Tailwind utilities generated from the mirrored `@theme` block.
 */
export const spacing = {
  none: '0px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  '2xl': '32px',
  '3xl': '48px',
  '4xl': '64px',
} as const;

export type SpacingToken = keyof typeof spacing;
