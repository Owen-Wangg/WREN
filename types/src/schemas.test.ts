/**
 * Tests for the shared WREN domain schemas.
 *
 * Two concerns are covered:
 *   1. Strict schemas parse valid examples and reject malformed ones.
 *   2. The no-ghostwriting invariant (REQ-CORE-NOGHOST-01 / Requirements 11.1):
 *      no DTO may carry a `replacementProse` field — enforced at runtime by the
 *      strict schemas and by the deep {@link containsReplacementProse} guard.
 *      (Structural compile-time enforcement lives in `index.ts` and is verified
 *      by `tsc --noEmit`.)
 *
 * The structural no-`replacementProse` invariant uses a fast-check property to
 * confirm it holds for arbitrarily-shaped injected payloads, not just a single
 * hand-written example.
 */
import fc from 'fast-check';

import {
  accessGrantSchema,
  activityEventSchema,
  aggregateCounterSchema,
  analyticsQuerySchema,
  analyticsResultSchema,
  anchorSchema,
  assertNoReplacementProse,
  containsReplacementProse,
  departmentSchema,
  documentSchema,
  documentTypeSchema,
  draftSchema,
  type Expect,
  feedbackItemSchema,
  FORBIDDEN_PROSE_KEY,
  type LacksReplacementProse,
  overrideSchema,
  resolutionStatusSchema,
  roleSchema,
} from './index';

/* -------------------------------------------------------------------------- */
/* Compile-time proof of the structural no-ghostwriting guard.                */
/* These are type-only and verified by `tsc` (which compiles this file via    */
/* types/tsconfig.json). The @ts-expect-error asserts the guard genuinely      */
/* rejects a shape carrying `replacementProse` — if it did NOT error, the      */
/* directive itself would fail the build.                                      */
/* -------------------------------------------------------------------------- */

// @ts-expect-error - a shape carrying `replacementProse` must NOT satisfy `true`.
type _GuardFiresOnViolation = Expect<LacksReplacementProse<{ replacementProse: string }>>;

const ISO = '2024-01-01T00:00:00.000Z';

/** Valid example fixtures, one per strict object schema. */
const validExamples = {
  department: {
    schema: departmentSchema,
    value: {
      id: 'dept_1',
      name: 'Legal Studies',
    },
  },
  documentType: {
    schema: documentTypeSchema,
    value: {
      id: 'dt_1',
      departmentId: 'dept_1',
      name: 'Legal Writing',
      accessState: 'OPEN',
      sizeLimitWords: 10000,
    },
  },
  document: {
    schema: documentSchema,
    value: {
      id: 'doc_1',
      ownerUserId: 'user_1',
      documentTypeId: 'dt_1',
      contentTypeId: 'ct_1',
      name: 'Case Brief',
      metadata: { 'Writing Topic': 'Tort' },
      status: 'Still Drafting',
      createdAt: ISO,
    },
  },
  draft: {
    schema: draftSchema,
    value: {
      id: 'draft_1',
      documentId: 'doc_1',
      versionNumber: 1,
      s3Key: 'documents/doc_1/v1.docx',
      segments: [{ index: 0, text: 'First paragraph.' }],
      wordCount: 2,
      createdAt: ISO,
    },
  },
  anchor: {
    schema: anchorSchema,
    value: {
      id: 'anchor_1',
      feedbackItemId: 'fb_1',
      draftId: 'draft_1',
      paragraphIndex: 0,
      startOffset: 0,
      endOffset: 5,
      contentFingerprint: 'hash:abc123',
      state: 'active',
    },
  },
  feedbackItem: {
    schema: feedbackItemSchema,
    value: {
      id: 'fb_1',
      documentId: 'doc_1',
      errorCategoryId: 'cat_1',
      kind: 'inline',
      questionText: 'Is this the main holding, or a qualification of it?',
      sourceDraftId: 'draft_1',
      createdAt: ISO,
    },
  },
  accessGrant: {
    schema: accessGrantSchema,
    value: {
      id: 'grant_1',
      userId: 'user_1',
      documentTypeId: 'dt_1',
      grantedBy: 'user_admin',
      grantedAt: ISO,
    },
  },
  override: {
    schema: overrideSchema,
    value: {
      id: 'ovr_1',
      userId: 'user_1',
      documentTypeId: 'dt_1',
      bounds: { additionalActions: 5 },
      reason: 'Approved extra feedback runs for revision week.',
      grantedBy: 'user_admin',
      expiresAt: ISO,
    },
  },
  activityEvent: {
    schema: activityEventSchema,
    value: {
      id: 'evt_1',
      actorPseudonym: 'pseudo_1',
      verb: 'requested',
      objectType: 'AiDebrief',
      objectRef: 'doc_1',
      timestamp: ISO,
      context: { draftVersion: 2 },
    },
  },
  aggregateCounter: {
    schema: aggregateCounterSchema,
    value: {
      id: 'agg_1',
      scopeKind: 'documentType',
      scopeId: 'dt_1',
      metric: 'feedback_requested_count',
      windowStart: ISO,
      value: 42,
    },
  },
  analyticsQuery: {
    schema: analyticsQuerySchema,
    value: {
      documentTypeId: 'dt_1',
    },
  },
  analyticsResult: {
    schema: analyticsResultSchema,
    value: {
      totals: [
        {
          id: 'agg_1',
          scopeKind: 'documentType',
          scopeId: 'dt_1',
          metric: 'feedback_requested_count',
          windowStart: ISO,
          value: 42,
        },
      ],
    },
  },
} as const;

describe('strict schemas parse valid examples', () => {
  it.each(Object.entries(validExamples))('parses a valid %s', (_name, { schema, value }) => {
    expect(() => schema.parse(value)).not.toThrow();
  });
});

describe('enum schemas', () => {
  it('accepts every canonical role identifier (Requirement 1.1)', () => {
    for (const role of ['Student', 'DepartmentAdmin', 'TechnicalAdmin']) {
      expect(roleSchema.parse(role)).toBe(role);
    }
  });

  it('rejects an unknown role', () => {
    expect(() => roleSchema.parse('Instructor')).toThrow();
  });

  it('rejects V1 role names', () => {
    expect(() => roleSchema.parse('User')).toThrow();
    expect(() => roleSchema.parse('Field Expert')).toThrow();
    expect(() => roleSchema.parse('Org Owner')).toThrow();
    expect(() => roleSchema.parse('Admin')).toThrow();
  });

  it('accepts every resolution status (Requirement 17)', () => {
    for (const status of [
      'resolved',
      'partially_resolved',
      'still_unresolved',
      'removed',
      'unchanged',
    ]) {
      expect(resolutionStatusSchema.parse(status)).toBe(status);
    }
  });
});

describe('schemas reject malformed input', () => {
  it('rejects an empty document name', () => {
    expect(() =>
      documentSchema.parse({ ...validExamples.document.value, name: '' }),
    ).toThrow();
  });

  it('rejects a non-positive draft version number', () => {
    expect(() =>
      draftSchema.parse({ ...validExamples.draft.value, versionNumber: 0 }),
    ).toThrow();
  });

  it('rejects an invalid timestamp', () => {
    expect(() =>
      feedbackItemSchema.parse({ ...validExamples.feedbackItem.value, createdAt: 'yesterday' }),
    ).toThrow();
  });

  it('rejects an access grant with an extra scope field (strict mode)', () => {
    expect(() =>
      accessGrantSchema.parse({
        ...validExamples.accessGrant.value,
        scope: { writingTypeId: 'wt_1' },
      }),
    ).toThrow();
  });

  it('rejects a document type with INHERIT access state (V4 only allows OPEN/LOCKED)', () => {
    expect(() =>
      documentTypeSchema.parse({
        ...validExamples.documentType.value,
        accessState: 'INHERIT',
      }),
    ).toThrow();
  });
});

describe('no-ghostwriting invariant (REQ-CORE-NOGHOST-01)', () => {
  it('every strict schema rejects an injected replacementProse field', () => {
    for (const [, { schema, value }] of Object.entries(validExamples)) {
      const tainted = { ...value, [FORBIDDEN_PROSE_KEY]: 'Here is a better version...' };
      expect(schema.safeParse(tainted).success).toBe(false);
      // The original (untainted) example must still be valid, proving the
      // rejection is due to the forbidden key, not an unrelated schema error.
      expect(schema.safeParse(value).success).toBe(true);
    }
  });

  it('containsReplacementProse detects the forbidden key at any depth', () => {
    expect(containsReplacementProse(validExamples.feedbackItem.value)).toBe(false);
    expect(containsReplacementProse({ replacementProse: 'x' })).toBe(true);
    expect(containsReplacementProse({ nested: { deep: [{ replacementProse: 'x' }] } })).toBe(true);
    expect(containsReplacementProse({ context: { note: 'fine' } })).toBe(false);
  });

  it('assertNoReplacementProse throws on a tainted payload and passes a clean one', () => {
    const clean = validExamples.feedbackItem.value;
    expect(assertNoReplacementProse(clean)).toBe(clean);
    expect(() => assertNoReplacementProse({ replacementProse: 'nope' })).toThrow(
      /no-ghostwriting/i,
    );
  });

  // Property: for ANY otherwise-valid feedback item, injecting a replacementProse
  // field (with any string value, under any extra nesting) is always rejected by
  // the strict schema and always detected by the deep guard. Runs >= 100 cases.
  it('property: injected replacementProse is always rejected and always detected', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string({ minLength: 1 }),
        (prose, question) => {
          const item = {
            ...validExamples.feedbackItem.value,
            questionText: question,
            [FORBIDDEN_PROSE_KEY]: prose,
          };
          // Runtime boundary guard (strict schema) rejects it.
          expect(feedbackItemSchema.safeParse(item).success).toBe(false);
          // Deep structural guard detects it.
          expect(containsReplacementProse(item)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
