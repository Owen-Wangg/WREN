/**
 * Unit tests for the required-field metadata gate (REQ-DOC-SUBMIT-01 /
 * Requirements 6.6, 6.7, 30.4).
 *
 * Covers: a required field satisfied vs missing (absent, empty string,
 * whitespace-only); optional fields never gating regardless of value; unknown
 * extra metadata keys ignored; the `isDocumentCreationEnabled` boolean tracking
 * the gate; and missing field ids AND labels reported together in field order.
 */
import type { CustomMetadataField } from '@wren/types';

import {
  evaluateRequiredFields,
  isBlankMetadataValue,
  isDocumentCreationEnabled,
} from './metadataGating';

/** Build a custom metadata field with sensible defaults. */
function field(
  id: string,
  label: string,
  required: boolean,
  documentTypeId = 'dt-1',
): CustomMetadataField {
  return { id, documentTypeId, label, required };
}

const REQUIRED_TOPIC = field('f-topic', 'Writing Topic', true);
const REQUIRED_JURISDICTION = field('f-jur', 'Jurisdiction', true);
const OPTIONAL_NOTES = field('f-notes', 'Notes', false);

describe('isBlankMetadataValue', () => {
  it('treats undefined (absent) as blank', () => {
    expect(isBlankMetadataValue(undefined)).toBe(true);
  });

  it('treats the empty string as blank', () => {
    expect(isBlankMetadataValue('')).toBe(true);
  });

  it('treats whitespace-only as blank', () => {
    expect(isBlankMetadataValue('   \t\n ')).toBe(true);
  });

  it('treats any non-whitespace value as non-blank', () => {
    expect(isBlankMetadataValue('Tort')).toBe(false);
    expect(isBlankMetadataValue('  padded  ')).toBe(false);
  });
});

describe('evaluateRequiredFields', () => {
  it('is satisfied when the single required field has a value', () => {
    const result = evaluateRequiredFields([REQUIRED_TOPIC], { 'f-topic': 'Tort' });
    expect(result).toEqual({ status: 'satisfied' });
  });

  it('reports missing when a required field is absent', () => {
    const result = evaluateRequiredFields([REQUIRED_TOPIC], {});
    expect(result).toEqual({
      status: 'missing-required-fields',
      missingRequiredFieldIds: ['f-topic'],
      missingRequiredFieldLabels: ['Writing Topic'],
    });
  });

  it('reports missing when a required field is the empty string', () => {
    const result = evaluateRequiredFields([REQUIRED_TOPIC], { 'f-topic': '' });
    expect(result.status).toBe('missing-required-fields');
  });

  it('reports missing when a required field is whitespace-only', () => {
    const result = evaluateRequiredFields([REQUIRED_TOPIC], { 'f-topic': '   ' });
    expect(result.status).toBe('missing-required-fields');
  });

  it('never gates on optional fields, even when empty or absent', () => {
    expect(evaluateRequiredFields([OPTIONAL_NOTES], {}).status).toBe('satisfied');
    expect(evaluateRequiredFields([OPTIONAL_NOTES], { 'f-notes': '' }).status).toBe(
      'satisfied',
    );
    expect(evaluateRequiredFields([OPTIONAL_NOTES], { 'f-notes': '  ' }).status).toBe(
      'satisfied',
    );
  });

  it('ignores unknown extra metadata keys not backed by a configured field', () => {
    const result = evaluateRequiredFields([REQUIRED_TOPIC], {
      'f-topic': 'Tort',
      'unknown-key': 'whatever',
    });
    expect(result).toEqual({ status: 'satisfied' });
  });

  it('reports all missing required fields together, in field order', () => {
    const result = evaluateRequiredFields(
      [REQUIRED_TOPIC, OPTIONAL_NOTES, REQUIRED_JURISDICTION],
      { 'f-notes': 'ignored' },
    );
    expect(result).toEqual({
      status: 'missing-required-fields',
      missingRequiredFieldIds: ['f-topic', 'f-jur'],
      missingRequiredFieldLabels: ['Writing Topic', 'Jurisdiction'],
    });
  });

  it('is satisfied when every required field has a value and optionals are blank', () => {
    const result = evaluateRequiredFields(
      [REQUIRED_TOPIC, OPTIONAL_NOTES, REQUIRED_JURISDICTION],
      { 'f-topic': 'Tort', 'f-jur': 'BC' },
    );
    expect(result).toEqual({ status: 'satisfied' });
  });

  it('is satisfied for a Writing Type with no configured fields', () => {
    expect(evaluateRequiredFields([], {}).status).toBe('satisfied');
  });
});

describe('isDocumentCreationEnabled', () => {
  it('matches the gate: true when all required fields are satisfied', () => {
    expect(isDocumentCreationEnabled([REQUIRED_TOPIC], { 'f-topic': 'Tort' })).toBe(true);
  });

  it('matches the gate: false while a required field is empty (Requirement 6.7)', () => {
    expect(isDocumentCreationEnabled([REQUIRED_TOPIC], { 'f-topic': '  ' })).toBe(false);
    expect(isDocumentCreationEnabled([REQUIRED_TOPIC, REQUIRED_JURISDICTION], {})).toBe(
      false,
    );
  });
});
