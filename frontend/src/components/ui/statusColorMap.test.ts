import { describe, expect, it } from 'vitest';

import { colors } from '@/styles/tokens';

import {
  getStatusColor,
  getStatusColorEntry,
  statusColorMap,
} from './statusColorMap';

import type { DocumentStatus } from '@wren/types';

describe('statusColorMap', () => {
  it('covers every DocumentStatus value from the shared domain contract', () => {
    const statuses: DocumentStatus[] = ['Still Drafting', 'Polishing'];
    for (const status of statuses) {
      expect(statusColorMap[status]).toBeDefined();
    }
  });

  it('always pairs a color token with a non-empty text-equivalent label', () => {
    for (const entry of Object.values(statusColorMap)) {
      expect(entry.colorToken).toBeTruthy();
      expect(entry.surfaceToken).toBeTruthy();
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it('resolves the raw color value through the design token, not a hardcoded hex', () => {
    expect(getStatusColor('Still Drafting')).toBe(colors.statusDrafting);
    expect(getStatusColor('Polishing')).toBe(colors.statusPolishing);
  });

  it('getStatusColorEntry returns the same entry as the map', () => {
    expect(getStatusColorEntry('Polishing')).toBe(statusColorMap.Polishing);
  });
});
