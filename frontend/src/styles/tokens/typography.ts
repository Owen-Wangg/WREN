/**
 * Typography tokens — font families and the type scale (sizes + line-heights +
 * weights). The single source of truth for text styling (frontend steering §9).
 *
 * Two faces (§9): a clean sans for UI chrome and a more editorial serif reserved
 * for document/draft content — reinforcing the visual separation between "the
 * app" and "the legal document being written" (no-ghostwriting distinction).
 *
 * Keep in sync with the `@theme` block in `src/styles/theme.css`. Raw `px`
 * font sizes are only permitted in this `/styles/tokens` directory.
 */

export const fontFamilies = {
  /** UI / chrome. */
  sans: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
  /** Document / draft content. */
  serif: "'Source Serif 4', ui-serif, Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SFMono-Regular', 'Menlo', monospace",
} as const;

export const fontWeights = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/** Font-size scale (px) with matching line-heights. */
export const fontSizes = {
  caption: '12px',
  bodySmall: '14px',
  body: '16px',
  heading3: '20px',
  heading2: '24px',
  heading1: '32px',
} as const;

export const lineHeights = {
  caption: '16px',
  bodySmall: '20px',
  body: '24px',
  heading3: '28px',
  heading2: '32px',
  heading1: '40px',
} as const;

/** Composite named type styles used across the UI. */
export const type = {
  heading1: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.heading1,
    lineHeight: lineHeights.heading1,
    fontWeight: fontWeights.bold,
  },
  heading2: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.heading2,
    lineHeight: lineHeights.heading2,
    fontWeight: fontWeights.semibold,
  },
  heading3: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.heading3,
    lineHeight: lineHeights.heading3,
    fontWeight: fontWeights.semibold,
  },
  body: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.body,
    lineHeight: lineHeights.body,
    fontWeight: fontWeights.regular,
  },
  bodySmall: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.bodySmall,
    lineHeight: lineHeights.bodySmall,
    fontWeight: fontWeights.regular,
  },
  caption: {
    fontFamily: fontFamilies.sans,
    fontSize: fontSizes.caption,
    lineHeight: lineHeights.caption,
    fontWeight: fontWeights.regular,
  },
  /** Reserved for rendered document/draft content only. */
  documentBody: {
    fontFamily: fontFamilies.serif,
    fontSize: fontSizes.body,
    lineHeight: lineHeights.body,
    fontWeight: fontWeights.regular,
  },
} as const;

export type TypeToken = keyof typeof type;
