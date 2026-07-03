/**
 * Color tokens — the single source of truth for every color used in the app
 * (frontend steering §9). Components MUST import named tokens from here (or use
 * the Tailwind utilities generated from the mirrored `@theme` block in
 * `src/styles/theme.css`); they MUST NEVER write a raw hex / rgb() value inline.
 *
 * The ESLint rule `wren/no-raw-design-values` fails the build if a raw hex code
 * appears in a `.tsx` file outside this `/styles/tokens` directory.
 *
 * Tone (per the mockup): clean, low-chrome, mostly monochrome with sparse color
 * reserved for status/state signaling. Keep the raw values here in sync with the
 * `@theme` block in `src/styles/theme.css`.
 */

/** Raw palette — the only place raw hex values are permitted for colors. */
export const palette = {
  white: '#ffffff',
  black: '#0a0a0a',
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray500: '#6b7280',
  gray700: '#374151',
  gray900: '#111827',
  green100: '#dcfce7',
  green600: '#16a34a',
  green700: '#15803d',
  amber100: '#fef3c7',
  amber700: '#b45309',
  red100: '#fee2e2',
  red600: '#dc2626',
} as const;

/**
 * Semantic color tokens — components reference these names, never the raw
 * palette. A palette/theme change is therefore a one-file edit.
 */
export const colors = {
  surfacePrimary: palette.white,
  surfaceMuted: palette.gray50,
  surfaceSubtle: palette.gray100,

  textPrimary: palette.gray900,
  textSecondary: palette.gray700,
  textMuted: palette.gray500,
  textOnAccent: palette.white,

  borderSubtle: palette.gray200,
  borderStrong: palette.gray300,

  // Status signaling (mapped from the Document status enum via a single lookup).
  statusDrafting: palette.gray500,
  statusDraftingSurface: palette.gray100,
  statusPolishing: palette.green700,
  statusPolishingSurface: palette.green100,

  // Feedback / notice accents (calm, not alarming — see steering §9).
  noticeSurface: palette.gray50,
  noticeBorder: palette.gray200,

  // Feedback dimension signals (severity by color, never a numeric score).
  signalPositive: palette.green600,
  signalCaution: palette.amber700,
  signalCautionSurface: palette.amber100,
  signalCritical: palette.red600,
  signalCriticalSurface: palette.red100,
} as const;

export type ColorToken = keyof typeof colors;
