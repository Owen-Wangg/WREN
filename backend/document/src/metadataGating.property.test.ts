/**
 * Property-based test for the required-field metadata gate (REQ-DOC-SUBMIT-01 /
 * Requirements 6.7, 30.4; design Property 3 targets this module).
 *
 * Tag: Feature: wren-writing-coach, Property 3: Required-field gating
 *
 * **Validates: Requirements 6.7, 30.4**
 *
 * Complements the example-based `metadataGating.test.ts` by exercising the pure
 * gate across generated Writing-Type field configurations (each field required
 * or optional) and generated submitted metadata maps (values absent, empty,
 * whitespace-only, non-blank, or padded non-blank, plus unrelated unknown
 * keys). It encodes the design's Property 3 as generative invariants:
 *
 *   1. Gate biconditional (Req 6.7 / 30.4): `isDocumentCreationEnabled` is
 *      `true` iff EVERY required field has a non-empty (non-whitespace) value —
 *      re-derived independently with a different blank test (`/^\s*$/`) than the
 *      implementation's `trim().length === 0`.
 *   2. Result consistency: `evaluateRequiredFields` returns `satisfied` exactly
 *      when the gate is enabled; otherwise it reports `missing-required-fields`
 *      whose ids AND labels are precisely the required fields that are blank, in
 *      configured field order.
 *   3. Optional fields never gate (Req 30.4): dropping every optional field (and
 *      its metadata) never changes the decision — only required fields matter.
 *   4. Unknown keys are inert: extra metadata keys not backed by a configured
 *      field never affect the decision (covered by including them in every run).
 *
 * fast-check docs: https://fast-check.dev/
 */
import fc from 'fast-check';

import type { CustomMetadataField } from '@wren/types';

import {
  evaluateRequiredFields,
  isDocumentCreationEnabled,
} from './metadataGating';

import { wrenProperty } from '../../../testing/typescript/property';

/** How a field's value is submitted in the metadata map. */
type ValueKind = 'absent' | 'empty' | 'whitespace' | 'nonblank' | 'padded';

/** The absent/empty/whitespace kinds all count as BLANK for the gate. */
const BLANK_KINDS: ReadonlySet<ValueKind> = new Set<ValueKind>([
  'absent',
  'empty',
  'whitespace',
]);

/** A non-blank token: 1-8 alphanumeric characters, guaranteed non-whitespace. */
const tokenArb = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
    minLength: 1,
    maxLength: 8,
  })
  .map((chars) => chars.join(''));

/** Whitespace-only strings of varied kinds (all BLANK per Requirement 6.7). */
const whitespaceArb = fc.constantFrom(' ', '\t', '\n', '   ', ' \t\n ');

const valueKindArb = fc.constantFrom<ValueKind>(
  'absent',
  'empty',
  'whitespace',
  'nonblank',
  'padded',
);

/**
 * A generated field configuration paired with the shape of its submitted value.
 * `id` and `label` come from `tokenArb` so ids are stable identifiers and labels
 * satisfy the schema's `min(1)`; `whitespace`/`token` seed the chosen value.
 */
interface FieldSpec {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  readonly valueKind: ValueKind;
  readonly whitespace: string;
  readonly token: string;
}

const fieldSpecArb: fc.Arbitrary<FieldSpec> = fc.record({
  id: tokenArb,
  label: tokenArb,
  required: fc.boolean(),
  valueKind: valueKindArb,
  whitespace: whitespaceArb,
  token: tokenArb,
});

/** A configuration of up to 8 fields with unique ids (labels may repeat). */
const specsArb = fc.uniqueArray(fieldSpecArb, {
  selector: (spec) => spec.id,
  maxLength: 8,
});

/** Unknown metadata keys not backed by any configured field (inert per design). */
const unknownKeysArb = fc.uniqueArray(tokenArb, { maxLength: 4 });

/** Build the configured fields for the gate from the generated specs. */
function fieldsOf(specs: readonly FieldSpec[]): CustomMetadataField[] {
  return specs.map((spec) => ({
    id: spec.id,
    documentTypeId: 'dt-1',
    label: spec.label,
    required: spec.required,
  }));
}

/** Build the submitted metadata map (id -> value) implied by each spec's kind. */
function metadataOf(
  specs: readonly FieldSpec[],
  unknownKeys: readonly string[],
): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const spec of specs) {
    switch (spec.valueKind) {
      case 'absent':
        break; // omit the key entirely
      case 'empty':
        metadata[spec.id] = '';
        break;
      case 'whitespace':
        metadata[spec.id] = spec.whitespace;
        break;
      case 'nonblank':
        metadata[spec.id] = spec.token;
        break;
      case 'padded':
        metadata[spec.id] = `  ${spec.token} `;
        break;
    }
  }
  const configuredIds = new Set(specs.map((spec) => spec.id));
  for (const key of unknownKeys) {
    if (!configuredIds.has(key)) {
      metadata[key] = 'unrelated-value';
    }
  }
  return metadata;
}

/**
 * Independent blank test — different expression than the implementation's
 * `value === undefined || value.trim().length === 0`.
 */
function isBlankIndependent(value: string | undefined): boolean {
  return value === undefined || /^\s*$/.test(value);
}

describe('Property 3: Required-field gating', () => {
  it('enables document creation iff every required field has a non-empty value', () => {
    const tag = wrenProperty(
      { number: 3, text: 'Required-field gating' },
      fc.property(specsArb, unknownKeysArb, (specs, unknownKeys) => {
        const fields = fieldsOf(specs);
        const metadata = metadataOf(specs, unknownKeys);

        // Independent ground truth: the required fields still blank, in order.
        const blankRequired = specs.filter(
          (spec) => spec.required && isBlankIndependent(metadata[spec.id]),
        );
        const expectedEnabled = blankRequired.length === 0;

        // --- Sub-property 1: gate biconditional (Req 6.7 / 30.4) ---
        expect(isDocumentCreationEnabled(fields, metadata)).toBe(expectedEnabled);

        // --- Sub-property 2: result consistency ---
        const result = evaluateRequiredFields(fields, metadata);
        if (expectedEnabled) {
          expect(result).toEqual({ status: 'satisfied' });
        } else {
          expect(result).toEqual({
            status: 'missing-required-fields',
            missingRequiredFieldIds: blankRequired.map((spec) => spec.id),
            missingRequiredFieldLabels: blankRequired.map((spec) => spec.label),
          });
        }

        // --- Sub-property 3: optional fields never gate (Req 30.4) ---
        // Dropping every optional field (and its metadata) preserves the decision.
        const requiredOnlyFields = fields.filter((field) => field.required);
        expect(isDocumentCreationEnabled(requiredOnlyFields, metadata)).toBe(
          expectedEnabled,
        );

        // --- Sub-property 4: a satisfied config is broken by blanking one field ---
        // For any satisfied config with >=1 required field, clearing any single
        // required field's value flips the gate to DISABLED (strict "every").
        if (expectedEnabled) {
          for (const field of requiredOnlyFields) {
            const cleared = { ...metadata, [field.id]: '   ' };
            expect(isDocumentCreationEnabled(fields, cleared)).toBe(false);
          }
        }
      }),
    );

    expect(tag).toBe('Feature: wren-writing-coach, Property 3: Required-field gating');
  });
});
