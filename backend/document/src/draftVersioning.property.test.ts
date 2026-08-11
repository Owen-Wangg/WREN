/**
 * Property-based test for draft versioning and resubmission
 * (REQ-DOC-DRAFT-01 / Requirements 8.1, 8.2).
 *
 * Tag: Feature: wren-writing-coach, Property 5: Draft history accumulation
 *
 * **Validates: Requirements 8.1, 8.2**
 *
 * Complements the example-based `draftVersioning.test.ts` by expressing the
 * design's Property 5 generatively:
 *
 *   *For any* sequence of submissions to a Document, each submission creates
 *   exactly one new Draft, retains all prior Drafts unchanged, assigns strictly
 *   increasing version numbers, and identifies the highest version as the
 *   current Draft.
 *
 * Encoded invariants:
 *   A. History accumulates — after K submissions exactly K Drafts are retained
 *      (Requirement 8.1 retention).
 *   B. Version numbers are exactly `1..K` in creation order — strictly
 *      monotonically increasing by 1, first = 1 (Requirement 8.2).
 *   C. Immutability — a deep snapshot taken right after each Draft is created
 *      remains byte-for-byte equal at the end (Requirement 8.1).
 *   D. Current = highest — `selectCurrentDraft` (pure) and `getCurrentDraft`
 *      (repository) both return the Draft with versionNumber === K, regardless
 *      of the order the Drafts are iterated (Requirement 8.2).
 *   E. Order-independence of the pure selectors over an arbitrary shuffled set
 *      of Drafts with DISTINCT versions (Requirement 8.2).
 *   F. `nextVersionNumber` returns `h + 1` for any highest `h >= 0`, and `1`
 *      for an empty list / null (Requirement 8.2).
 *
 * The fake {@link DraftRepository} mirrors the append-only in-memory fake in
 * `draftVersioning.test.ts` (re-implemented here so this file is self-contained
 * and does not modify the existing test file).
 */
import fc from 'fast-check';

import type { Draft, FeedbackItem, Segment, TipTapDoc } from '@wren/types';

import type { DraftRepository, NewDraftInput } from './draftRepository';
import {
  createDraftRevision,
  highestVersionNumber,
  nextVersionNumber,
  selectCurrentDraft,
  type DraftSubmission,
} from './draftVersioning';

import { wrenProperty } from '../../../testing/typescript/property';

const DOCUMENT_ID = 'doc_prop_5';

/* -------------------------------------------------------------------------- */
/* In-memory append-only fake (mirrors draftVersioning.test.ts)                */
/* -------------------------------------------------------------------------- */

/**
 * Append-only in-memory {@link DraftRepository}. `insertDraft` never mutates a
 * prior Draft (Requirement 8.1) and enforces the schema's
 * `UNIQUE (document_id, version_number)` invariant. `getHighestVersionNumber` /
 * `getCurrentDraft` derive from the stored Drafts via the pure selectors.
 */
class FakeDraftRepository implements DraftRepository {
  private readonly drafts: Draft[] = [];
  private nextId = 1;

  public constructor(private readonly feedbackItems: FeedbackItem[] = []) {}

  /** Read-only snapshot of what has been persisted (for assertions). */
  public get stored(): readonly Draft[] {
    return this.drafts;
  }

  public async getHighestVersionNumber(documentId: string): Promise<number | null> {
    return highestVersionNumber(this.drafts.filter((d) => d.documentId === documentId));
  }

  public async insertDraft(input: NewDraftInput): Promise<Draft> {
    const clash = this.drafts.some(
      (d) => d.documentId === input.documentId && d.versionNumber === input.versionNumber,
    );
    if (clash) {
      throw new Error(
        `duplicate version ${input.versionNumber} for document ${input.documentId}`,
      );
    }
    const draft: Draft = {
      id: `draft_${this.nextId}`,
      documentId: input.documentId,
      versionNumber: input.versionNumber,
      s3Key: input.s3Key,
      segments: input.segments.map((s) => ({ ...s })),
      wordCount: input.wordCount,
      createdAt: new Date(Date.UTC(2025, 0, this.nextId)).toISOString(),
      ...(input.content ? { content: input.content } : {}),
      ...(input.header ? { header: input.header } : {}),
      ...(input.footer ? { footer: input.footer } : {}),
      ...(typeof input.ocrConfidence === 'number'
        ? { ocrConfidence: input.ocrConfidence }
        : {}),
    };
    this.nextId += 1;
    this.drafts.push(draft);
    return draft;
  }

  public async getCurrentDraft(documentId: string): Promise<Draft | null> {
    return selectCurrentDraft(this.drafts.filter((d) => d.documentId === documentId));
  }

  public async updateCurrentDraftContent(
    documentId: string,
    content: TipTapDoc,
    wordCount: number,
  ): Promise<Draft | null> {
    const current = await this.getCurrentDraft(documentId);
    if (!current) return null;
    const updated: Draft = { ...current, content, wordCount };
    const idx = this.drafts.findIndex((d) => d.id === current.id);
    this.drafts[idx] = updated;
    return updated;
  }

  public async listFeedbackItems(documentId: string): Promise<FeedbackItem[]> {
    return this.feedbackItems.filter((f) => f.documentId === documentId);
  }

  public async updateOcrConfidence(
    documentId: string,
    confidence: number,
  ): Promise<Draft | null> {
    const current = await this.getCurrentDraft(documentId);
    if (!current) return null;
    const updated: Draft = { ...current, ocrConfidence: confidence };
    const idx = this.drafts.findIndex((d) => d.id === current.id);
    this.drafts[idx] = updated;
    return updated;
  }
}

/* -------------------------------------------------------------------------- */
/* Generators                                                                  */
/* -------------------------------------------------------------------------- */

/** Ordered paragraph segments with sequential, nonnegative indices. */
const segmentsArb: fc.Arbitrary<Segment[]> = fc
  .array(fc.string(), { minLength: 0, maxLength: 6 })
  .map((texts) => texts.map((text, index) => ({ index, text })));

/** A single submission to the shared Document. */
const submissionArb: fc.Arbitrary<DraftSubmission> = fc.record({
  documentId: fc.constant(DOCUMENT_ID),
  segments: segmentsArb,
  wordCount: fc.nat({ max: 5000 }),
  s3Key: fc.string({ minLength: 1, maxLength: 40 }).map((s) => `documents/${DOCUMENT_ID}/${s}`),
});

/** A non-empty sequence of 1..20 submissions (K submissions). */
const submissionSequenceArb: fc.Arbitrary<DraftSubmission[]> = fc.array(submissionArb, {
  minLength: 1,
  maxLength: 20,
});

/** Deterministic Fisher–Yates shuffle driven by a fast-check seed. */
function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  let state = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = out.length - 1; i > 0; i -= 1) {
    // xorshift32 PRNG for a reproducible permutation.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const j = state % (i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Build a Draft with a given versionNumber (for the pure-selector property). */
function makeDraft(versionNumber: number): Draft {
  return {
    id: `draft_v${versionNumber}`,
    documentId: DOCUMENT_ID,
    versionNumber,
    s3Key: `documents/${DOCUMENT_ID}/v${versionNumber}.docx`,
    segments: [{ index: 0, text: 'A paragraph.' }],
    wordCount: 2,
    createdAt: '2025-01-01T00:00:00.000Z',
  };
}

/* -------------------------------------------------------------------------- */
/* Property 5                                                                  */
/* -------------------------------------------------------------------------- */

describe('Property 5: Draft history accumulation', () => {
  it('accumulates immutable Drafts with monotonic versions and a highest-is-current selector', () => {
    const tag = wrenProperty(
      { number: 5, text: 'Draft history accumulation' },
      fc.asyncProperty(submissionSequenceArb, fc.integer(), async (submissions, shuffleSeed) => {
        const repo = new FakeDraftRepository();
        const K = submissions.length;

        // Apply the K submissions sequentially, snapshotting each new Draft
        // immediately after creation (deep clone => detects later mutation).
        const snapshots: Draft[] = [];
        const createdVersions: number[] = [];
        for (const sub of submissions) {
          const result = await createDraftRevision(sub, repo);
          snapshots.push(structuredClone(result.draft));
          createdVersions.push(result.draft.versionNumber);
        }

        // --- Invariant A: exactly K Drafts retained (Req 8.1) ---
        expect(repo.stored).toHaveLength(K);

        // --- Invariant B: versions are exactly 1..K in creation order (Req 8.2) ---
        const expectedVersions = Array.from({ length: K }, (_, i) => i + 1);
        expect(createdVersions).toEqual(expectedVersions);
        // Each is strictly one greater than its predecessor; the first is 1.
        expect(createdVersions[0]).toBe(1);
        for (let i = 1; i < createdVersions.length; i += 1) {
          expect(createdVersions[i]).toBe(createdVersions[i - 1]! + 1);
        }

        // --- Invariant C: no prior Draft was mutated (Req 8.1 immutability) ---
        // The stored Draft matching each snapshot's version is byte-for-byte equal.
        for (const snapshot of snapshots) {
          const retained = repo.stored.find((d) => d.versionNumber === snapshot.versionNumber);
          expect(retained).toEqual(snapshot);
        }

        // --- Invariant D: highest version is the current Draft (Req 8.2) ---
        // Iterating the stored Drafts in an arbitrary (shuffled) order must not
        // change which Draft is selected as current.
        const shuffled = shuffle(repo.stored, shuffleSeed);
        expect(selectCurrentDraft(shuffled)?.versionNumber).toBe(K);
        expect(highestVersionNumber(shuffled)).toBe(K);
        const currentFromRepo = await repo.getCurrentDraft(DOCUMENT_ID);
        expect(currentFromRepo?.versionNumber).toBe(K);
        // Both current-Draft views agree on the same identity.
        expect(currentFromRepo).toEqual(selectCurrentDraft(shuffled));
      }),
    );

    expect(tag).toBe('Feature: wren-writing-coach, Property 5: Draft history accumulation');
  });

  it('resolves the highest version as current independent of input order (Req 8.2)', () => {
    // A non-empty set of Drafts with DISTINCT version numbers, then shuffled.
    const distinctVersionsArb = fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
      minLength: 1,
      maxLength: 20,
    });

    const tag = wrenProperty(
      { number: 5, text: 'Draft history accumulation' },
      fc.property(distinctVersionsArb, fc.integer(), (versions, shuffleSeed) => {
        const drafts = versions.map(makeDraft);
        const shuffled = shuffle(drafts, shuffleSeed);
        const expectedMax = Math.max(...versions);

        expect(highestVersionNumber(shuffled)).toBe(expectedMax);
        expect(selectCurrentDraft(shuffled)?.versionNumber).toBe(expectedMax);
      }),
    );

    expect(tag).toBe('Feature: wren-writing-coach, Property 5: Draft history accumulation');
  });

  it('computes the next version as highest + 1, and 1 when there is no history (Req 8.2)', () => {
    const tag = wrenProperty(
      { number: 5, text: 'Draft history accumulation' },
      fc.property(fc.nat({ max: 100_000 }), (h) => {
        // From a bare highest value.
        expect(nextVersionNumber(h)).toBe(h + 1);
        // From a list of Drafts whose highest version is h + 1 (positive versions).
        const drafts = [makeDraft(1), makeDraft(h + 1)];
        expect(nextVersionNumber(drafts)).toBe(h + 2);
      }),
    );

    // Empty history / null both start at 1 (deterministic, order-free base cases).
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber(null)).toBe(1);
    expect(nextVersionNumber(0)).toBe(1);

    expect(tag).toBe('Feature: wren-writing-coach, Property 5: Draft history accumulation');
  });
});
