/**
 * Draft versioning and resubmission (design "Document / Draft Service — Draft
 * versioning"; REQ-DOC-DRAFT-01 / Requirement 8).
 *
 * On every submission of a Document, WREN records a NEW immutable Draft rather
 * than editing an existing one:
 *
 *   - Requirement 8.1 — `createDraftRevision` appends a new Draft linked to the
 *     same Document and never mutates prior Drafts (the {@link DraftRepository}
 *     exposes no update path; the schema also blocks `UPDATE`s on `draft`).
 *   - Requirement 8.2 — each Draft gets a monotonically increasing
 *     `versionNumber` (`max existing + 1`, first Draft = 1). The current Draft
 *     is the one with the HIGHEST `versionNumber`; both a pure selector
 *     ({@link selectCurrentDraft}) and a DAL query
 *     (`DraftRepository.getCurrentDraft`) expose that.
 *   - Requirement 8.3 — a resubmission carries forward the Document's existing
 *     Feedback Items so the Progress_Tracker (a later stage) can re-evaluate
 *     them against the new Draft. This module only ASSOCIATES/retrieves them; it
 *     never re-anchors (task 8.x), re-generates, or deletes feedback (task 9.x).
 *
 * The pure selectors ({@link selectCurrentDraft}, {@link highestVersionNumber},
 * {@link nextVersionNumber}) take an in-memory list of Drafts, tolerate
 * arbitrary (out-of-order) input, and perform no I/O — mirroring the pure
 * `segmentParagraphs` core so they are trivially unit-testable.
 */
import type { Draft, FeedbackItem, Segment, TipTapDoc } from '@wren/types';

import type { DraftRepository } from './draftRepository';

/**
 * The highest `versionNumber` among `drafts`, or `null` when the list is empty.
 * Order-independent: the caller may pass Drafts in any order.
 */
export function highestVersionNumber(drafts: readonly Draft[]): number | null {
  let highest: number | null = null;
  for (const draft of drafts) {
    if (highest === null || draft.versionNumber > highest) {
      highest = draft.versionNumber;
    }
  }
  return highest;
}

/**
 * The current Draft — the one with the highest `versionNumber` — or `null` when
 * `drafts` is empty (Requirement 8.2). Order-independent.
 */
export function selectCurrentDraft(drafts: readonly Draft[]): Draft | null {
  let current: Draft | null = null;
  for (const draft of drafts) {
    if (current === null || draft.versionNumber > current.versionNumber) {
      current = draft;
    }
  }
  return current;
}

/**
 * The `versionNumber` to assign to the next Draft: `highest + 1`, or `1` when
 * there are no prior Drafts (Requirement 8.2). Accepts either the highest
 * existing version (as returned by `DraftRepository.getHighestVersionNumber`)
 * or an in-memory list of Drafts.
 */
export function nextVersionNumber(
  priorDraftsOrHighest: readonly Draft[] | number | null,
): number {
  const highest =
    typeof priorDraftsOrHighest === 'number' || priorDraftsOrHighest === null
      ? priorDraftsOrHighest
      : highestVersionNumber(priorDraftsOrHighest);
  return (highest ?? 0) + 1;
}

/** A new submission's content, produced by the ingestion pipeline. */
export interface DraftSubmission {
  readonly documentId: string;
  /** Ordered paragraph segments from `ingestUpload` / `segmentParagraphs`. */
  readonly segments: readonly Segment[];
  /** Measured word count (size-limit enforcement is a separate concern). */
  readonly wordCount: number;
  /** S3 object key where the submitted document bytes are stored. */
  readonly s3Key: string;
  /** Optional TipTap JSON for rich editor reload. */
  readonly content?: TipTapDoc;
}

/** The outcome of recording a submission as a new Draft. */
export interface DraftRevisionResult {
  /** The newly created, immutable Draft. It is always the current Draft. */
  readonly draft: Draft;
  /** `true` when this is the Document's first Draft (versionNumber === 1). */
  readonly isInitialDraft: boolean;
  /**
   * The Document's existing Feedback Items, associated for re-evaluation by the
   * Progress_Tracker (Requirement 8.3). Empty on a first submission. These are
   * returned unmodified — this stage neither re-anchors nor regenerates them.
   */
  readonly carriedForwardFeedbackItems: FeedbackItem[];
}

/**
 * Record a submission as a new immutable Draft (Requirement 8).
 *
 * Steps:
 *   1. Read the Document's highest existing version (Requirement 8.2).
 *   2. Append a new Draft at `highest + 1` (first Draft = 1). Prior Drafts are
 *      left untouched (Requirement 8.1). The new Draft, having the highest
 *      version, is by definition the current Draft.
 *   3. Retrieve the Document's existing Feedback Items to associate them for
 *      re-evaluation (Requirement 8.3) — without regenerating or mutating them.
 *
 * @throws whatever the repository throws (e.g. a `UNIQUE (document_id,
 *   version_number)` violation if two submissions race for the same version).
 */
export async function createDraftRevision(
  submission: DraftSubmission,
  repository: DraftRepository,
): Promise<DraftRevisionResult> {
  const highest = await repository.getHighestVersionNumber(submission.documentId);
  const versionNumber = nextVersionNumber(highest);

  const draft = await repository.insertDraft({
    documentId: submission.documentId,
    versionNumber,
    s3Key: submission.s3Key,
    segments: submission.segments,
    wordCount: submission.wordCount,
    ...(submission.content ? { content: submission.content } : {}),
  });

  // Association for re-evaluation (Requirement 8.3): only the FIRST Draft has no
  // prior feedback to carry forward. Feedback Items belong to the Document, so
  // they are retrieved as-is for the Progress_Tracker — never regenerated here.
  const carriedForwardFeedbackItems =
    versionNumber === 1 ? [] : await repository.listFeedbackItems(submission.documentId);

  return {
    draft,
    isInitialDraft: versionNumber === 1,
    carriedForwardFeedbackItems,
  };
}
