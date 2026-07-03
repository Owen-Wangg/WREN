/**
 * Render tests for `<WriterProgressSummary>` (task 18.4).
 *
 * **Validates: Requirements 18.1, 18.3, 18.4**
 *
 * These are plain render tests covering the draft-anchoring gate and a
 * lightweight no-numeric-scoring compliance assertion. They anticipate but do
 * NOT replace the Property 19 property-based test (task 18.5).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  WriterProgressSummary,
  WRITER_PROGRESS_SUMMARY_TEST_ID,
} from './WriterProgressSummary';

import type { WriterProgressSummaryModel } from '../index';

const laterDraftSummary: WriterProgressSummaryModel = {
  documentId: 'doc-1',
  draftId: 'draft-2',
  reflectsDraftVersion: 2,
  headline:
    'Across your drafts, your framing of holdings is getting clearer, while citation phrasing is still worth another look.',
  patterns: [
    {
      id: 'pp-1',
      errorCategoryId: 'cat-clarity',
      categoryLabel: 'Clarity of holding',
      tendency: 'improving',
      description:
        'Your main holdings are landing as single, focused sentences more often than before — keep leading with the holding.',
    },
    {
      id: 'pp-2',
      errorCategoryId: 'cat-terminology',
      categoryLabel: 'Legal terminology',
      tendency: 'persistent',
      description:
        'A few terms of art are still standing in for the phrasing courts use — check each term when you revise.',
    },
  ],
};

const firstDraftSummary: WriterProgressSummaryModel = {
  documentId: 'doc-2',
  draftId: 'draft-1',
  reflectsDraftVersion: 1,
  headline: 'This is your first draft, so there is nothing to compare yet.',
  patterns: [],
};

describe('WriterProgressSummary', () => {
  it('renders the section and its patterns when reflectsDraftVersion >= 2', () => {
    render(<WriterProgressSummary summary={laterDraftSummary} />);

    const section = screen.getByTestId(WRITER_PROGRESS_SUMMARY_TEST_ID);
    expect(section).toBeInTheDocument();

    // Draft-anchoring reference is exposed as a machine-readable attribute.
    expect(section).toHaveAttribute('data-reflects-draft-id', 'draft-2');
    expect(section).toHaveAttribute('data-reflects-draft-version', '2');

    // Each pattern renders as an <li data-tendency="...">.
    const patterns = screen.getAllByRole('listitem');
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toHaveAttribute('data-tendency', 'improving');
    expect(patterns[1]).toHaveAttribute('data-tendency', 'persistent');

    // Qualitative tendency labels (the accessible text-equivalents) are shown.
    expect(screen.getByText('Improving')).toBeInTheDocument();
    expect(screen.getByText('Still appearing')).toBeInTheDocument();
    expect(screen.getByText(laterDraftSummary.patterns[0].description)).toBeInTheDocument();
  });

  it('renders nothing on the first draft (reflectsDraftVersion === 1 gate)', () => {
    const { container } = render(
      <WriterProgressSummary summary={firstDraftSummary} />,
    );

    expect(
      screen.queryByTestId(WRITER_PROGRESS_SUMMARY_TEST_ID),
    ).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows no numeric score / grade / rank / percentage in writer-facing text', () => {
    render(<WriterProgressSummary summary={laterDraftSummary} />);

    const section = screen.getByTestId(WRITER_PROGRESS_SUMMARY_TEST_ID);

    // The visible, writer-facing text carries no digits and no
    // score/grade/rank/percentage tokens (no-numeric-scoring, Requirement 18.3).
    const visibleText = section.textContent ?? '';
    expect(visibleText).not.toMatch(/\d/);
    expect(visibleText).not.toMatch(/\b(score|grade|rank|ranking|rating|percent|percentage)\b/i);
    expect(visibleText).not.toContain('%');
  });
});
