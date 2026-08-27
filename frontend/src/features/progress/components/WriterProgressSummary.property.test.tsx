/**
 * Property-based render test — Property 19: Writer-facing progress carries no
 * numeric scoring.
 *
 * Validates: Requirements 18.3
 *
 * Exercises `<WriterProgressSummary>` with generated (fast-check arbitrary)
 * view models and asserts the rendered DOM never contains numeric scores,
 * grades, rankings, ratings, or per-user comparisons in the writer-facing text
 * content that the **component itself** introduces. Input strings (headline,
 * descriptions, categoryLabels) are generated with `fc.string()` — they can
 * contain anything. The property proves the component doesn't ADD numeric
 * scoring even with weird input.
 *
 * The draft-version reference (`data-reflects-draft-version`) is
 * machine-readable metadata exposed as a data attribute — it is NOT rendered as
 * body text and must NOT trigger a false positive.
 */
import { render } from '@testing-library/react';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { ProgressTendency, WriterProgressSummary as WriterProgressSummaryModel } from '../progressTypes';

import { WriterProgressSummary, WRITER_PROGRESS_SUMMARY_TEST_ID } from './WriterProgressSummary';

// Feature: wren-writing-coach, Property 19: Writer-facing progress carries no numeric scoring

/* -------------------------------------------------------------------------- */
/* Arbitraries                                                                 */
/* -------------------------------------------------------------------------- */

const tendencyArb: fc.Arbitrary<ProgressTendency> = fc.constantFrom(
  'improving',
  'persistent',
  'emerging',
);

const idArb = fc.string({ minLength: 1, maxLength: 36 }).filter((s) => s.length >= 1);

const progressPatternArb = fc.record({
  id: idArb,
  errorCategoryId: idArb,
  categoryLabel: fc.string({ minLength: 1, maxLength: 60 }),
  tendency: tendencyArb,
  description: fc.string({ minLength: 1, maxLength: 200 }),
});

const writerProgressSummaryArb: fc.Arbitrary<WriterProgressSummaryModel> = fc.record({
  documentId: idArb,
  draftId: idArb,
  // reflectsDraftVersion ≥ 2 so the component actually renders content.
  reflectsDraftVersion: fc.integer({ min: 2, max: 100 }),
  headline: fc.string({ minLength: 1, maxLength: 120 }),
  // React list keys model stable pattern IDs, so generated IDs must be unique.
  patterns: fc.uniqueArray(progressPatternArb, {
    minLength: 0,
    maxLength: 5,
    selector: (pattern) => pattern.id,
  }),
});

/* -------------------------------------------------------------------------- */
/* Forbidden patterns                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Patterns that must NEVER appear in writer-facing body text.
 * These detect numeric scores, grades, rankings, and ratings.
 */
const FORBIDDEN_PATTERNS: RegExp[] = [
  // "6/10", "3 / 5", etc.
  /\d+\s*\/\s*\d+/,
  // Percentages: "85%", "100 %"
  /\d+\s*%/,
  // Keywords (case-insensitive)
  /\bscore\b/i,
  /\bgrade\b/i,
  /\brank\b/i,
  /\branking\b/i,
  /\brating\b/i,
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Extract the text the component itself contributes by cloning the rendered
 * subtree and removing the structurally known input nodes. This avoids string
 * subtraction bugs when one generated fragment is a substring of another.
 */
function extractComponentOwnText(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  clone.querySelector(':scope > p')?.remove();

  for (const pattern of clone.querySelectorAll('li')) {
    pattern.querySelector(':scope > span > span:last-child')?.remove();
    pattern.querySelector(':scope > p')?.remove();
  }

  return clone.textContent ?? '';
}

/* -------------------------------------------------------------------------- */
/* Test                                                                         */
/* -------------------------------------------------------------------------- */

describe('WriterProgressSummary — Property 19: no numeric scoring', () => {
  it('rendered text content never contains numeric scores, grades, rankings, or ratings introduced by the component', () => {
    fc.assert(
      fc.property(writerProgressSummaryArb, (summary) => {
        const { container, unmount } = render(<WriterProgressSummary summary={summary} />);

        const root = container.querySelector(
          `[data-testid="${WRITER_PROGRESS_SUMMARY_TEST_ID}"]`,
        );
        // Component renders when reflectsDraftVersion >= 2 (guaranteed by our arb).
        expect(root).not.toBeNull();

        // The draft version attribute must be present as a data attribute…
        expect(root).toHaveAttribute(
          'data-reflects-draft-version',
          String(summary.reflectsDraftVersion),
        );

        // Extract what the COMPONENT itself contributes (not user-provided input).
        const componentOwnText = extractComponentOwnText(root!);

        // The component's own text must not contain forbidden scoring patterns.
        for (const pattern of FORBIDDEN_PATTERNS) {
          expect(componentOwnText).not.toMatch(pattern);
        }

        // No per-user comparisons or named per-user entries in component text.
        expect(componentOwnText).not.toMatch(/\buser\s*\d+\b/i);
        expect(componentOwnText).not.toMatch(/\bstudent\s*#?\d+\b/i);

        unmount();
      }),
      { numRuns: 100 },
    );
  });

  it('data-reflects-draft-version attribute is present but not rendered as body text by the component', () => {
    fc.assert(
      fc.property(writerProgressSummaryArb, (summary) => {
        const { container, unmount } = render(<WriterProgressSummary summary={summary} />);

        const root = container.querySelector(
          `[data-testid="${WRITER_PROGRESS_SUMMARY_TEST_ID}"]`,
        );
        expect(root).not.toBeNull();

        // Attribute present (machine-readable metadata).
        expect(root!.getAttribute('data-reflects-draft-version')).toBe(
          String(summary.reflectsDraftVersion),
        );

        // The version number must not appear as visible body text added by the
        // component itself. We verify structurally by removing all rendered
        // user-input nodes and checking what the component contributes.
        const componentOwnText = extractComponentOwnText(root!);
        const versionStr = String(summary.reflectsDraftVersion);

        // If the version number appears as a standalone token in the component's
        // own text (not in user input), the component is leaking it.
        const standaloneVersionPattern = new RegExp(`\\b${versionStr}\\b`);
        if (standaloneVersionPattern.test(componentOwnText)) {
          expect.fail(
            `Draft version "${versionStr}" was rendered as body text by the component itself (not from input data).`,
          );
        }

        unmount();
      }),
      { numRuns: 100 },
    );
  });
});
