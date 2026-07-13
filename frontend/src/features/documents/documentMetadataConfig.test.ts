import { describe, expect, it } from 'vitest';

import {
  DEFAULT_METADATA_FIELDS,
  areRequiredFieldsFilled,
  getMissingRequiredFields,
} from './documentMetadataConfig';

describe('documentMetadataConfig', () => {
  it('seeds only "Writing Topic" as the illustrative required field (no "Location Reference")', () => {
    expect(DEFAULT_METADATA_FIELDS).toEqual([
      { key: 'Writing Topic', label: 'Writing Topic', required: true },
    ]);
  });

  it('flags a required field missing when its value is absent', () => {
    const missing = getMissingRequiredFields(DEFAULT_METADATA_FIELDS, {});
    expect(missing).toEqual(DEFAULT_METADATA_FIELDS);
  });

  it('flags a required field missing when its value is whitespace-only', () => {
    const missing = getMissingRequiredFields(DEFAULT_METADATA_FIELDS, {
      'Writing Topic': '   ',
    });
    expect(missing).toHaveLength(1);
  });

  it('reports no missing fields once the required value is set', () => {
    const missing = getMissingRequiredFields(DEFAULT_METADATA_FIELDS, {
      'Writing Topic': 'Tort',
    });
    expect(missing).toHaveLength(0);
    expect(areRequiredFieldsFilled(DEFAULT_METADATA_FIELDS, { 'Writing Topic': 'Tort' })).toBe(
      true,
    );
  });

  it('scales generically to N configured fields, ignoring optional ones', () => {
    const fields = [
      { key: 'A', label: 'A', required: true },
      { key: 'B', label: 'B', required: false },
      { key: 'C', label: 'C', required: true },
    ];

    expect(areRequiredFieldsFilled(fields, { A: '1' })).toBe(false);
    expect(areRequiredFieldsFilled(fields, { A: '1', C: '2' })).toBe(true);
  });
});
