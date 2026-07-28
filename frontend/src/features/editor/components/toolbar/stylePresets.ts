/**
 * Phase 5 style presets for the document editor toolbar.
 * Student highlight uses backgroundColor (not the AI Highlight mark).
 */

export const FONT_FAMILY_PRESETS = [
  { id: 'default', label: 'Default font', value: null as string | null },
  { id: 'inter', label: 'Inter', value: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  {
    id: 'source-serif',
    label: 'Source Serif',
    value: '"Source Serif 4", ui-serif, Georgia, serif',
  },
  { id: 'georgia', label: 'Georgia', value: 'Georgia, ui-serif, serif' },
  { id: 'times', label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { id: 'mono', label: 'Courier New', value: '"Courier New", ui-monospace, monospace' },
] as const;

export const TEXT_COLORS = [
  { id: 'clear', label: 'Default', value: null as string | null },
  { id: 'ink', label: 'Ink', value: '#1e1e1e' },
  { id: 'muted', label: 'Muted', value: '#767676' },
  { id: 'red', label: 'Red', value: '#b91c1c' },
  { id: 'green', label: 'Green', value: '#166534' },
  { id: 'blue', label: 'Blue', value: '#1d4ed8' },
  { id: 'amber', label: 'Amber', value: '#b45309' },
  { id: 'teal', label: 'Teal', value: '#0f766e' },
  { id: 'white', label: 'White', value: '#ffffff' },
] as const;

/** Student highlight — separate from AI quote Highlight marks. */
export const HIGHLIGHT_COLORS = [
  { id: 'clear', label: 'No highlight', value: null as string | null },
  { id: 'yellow', label: 'Yellow', value: '#fef08a' },
  { id: 'green', label: 'Green', value: '#bbf7d0' },
  { id: 'blue', label: 'Blue', value: '#bfdbfe' },
  { id: 'amber', label: 'Amber', value: '#fde68a' },
  { id: 'rose', label: 'Rose', value: '#fecdd3' },
  { id: 'gray', label: 'Gray', value: '#e5e5e5' },
] as const;
