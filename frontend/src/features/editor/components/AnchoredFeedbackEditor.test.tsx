/**
 * Render tests for `<AnchoredFeedbackEditor>` (task 18.2).
 *
 * **Validates: Requirements 11.2, 12.1**
 *
 * Covers: comment marks render for active anchors, removed-anchor items
 * do not produce comment marks, and a compliance assertion that the
 * AI-feedback UI is structurally distinguishable from plain writer text
 * (`data-ai-feedback` present on AI content, absent on writer paragraphs).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnchoredFeedbackEditor } from './AnchoredFeedbackEditor';

import type { JSONContent } from '@tiptap/react';
import type { Anchor, FeedbackItem } from '@wren/types';

const initialContent: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Denis cited it.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Later.' }] },
  ],
};

const activeFeedbackItem: FeedbackItem = {
  id: 'fb-active',
  documentId: 'doc-1',
  errorCategoryId: 'cat-clarity',
  kind: 'inline',
  questionText: 'Can you identify the main legal holding here?',
  currentAnchorId: 'anchor-active',
  sourceDraftId: 'draft-1',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const activeAnchor: Anchor = {
  id: 'anchor-active',
  feedbackItemId: 'fb-active',
  draftId: 'draft-1',
  paragraphIndex: 0,
  startOffset: 0,
  endOffset: 5,
  contentFingerprint: 'fp-1',
  state: 'active',
};

const removedFeedbackItem: FeedbackItem = {
  id: 'fb-removed',
  documentId: 'doc-1',
  errorCategoryId: 'cat-terminology',
  kind: 'inline',
  questionText: 'Is this the correct legal term?',
  currentAnchorId: 'anchor-removed',
  sourceDraftId: 'draft-1',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const removedAnchor: Anchor = {
  id: 'anchor-removed',
  feedbackItemId: 'fb-removed',
  draftId: 'draft-1',
  paragraphIndex: 1,
  startOffset: 0,
  endOffset: 4,
  contentFingerprint: 'fp-2',
  state: 'removed',
};

describe('AnchoredFeedbackEditor', () => {
  it('attaches a comment mark to the active anchor span, distinguishable from writer text (Requirement 12.1)', async () => {
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[activeFeedbackItem]}
        anchors={[activeAnchor]}
      />,
    );

    const editor = screen.getByRole('textbox');
    await waitFor(() => {
      const mark = editor.querySelector('[data-ai-feedback="true"]');
      expect(mark).not.toBeNull();
      expect(mark).toHaveAttribute('data-comment-id', 'fb-active');
      expect(mark).toHaveTextContent('Denis');
    });
  });

  it('does not attach a comment mark for a removed anchor (Requirement 12.4)', async () => {
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[removedFeedbackItem]}
        anchors={[removedAnchor]}
      />,
    );

    const editor = screen.getByRole('textbox');
    // Give any async effects time to run, then confirm no mark appeared.
    await waitFor(() => expect(editor).toBeInTheDocument());
    expect(editor.querySelector('[data-comment-id="fb-removed"]')).toBeNull();
  });

  it('never renders an Apply, Insert, or Accept affordance anywhere (REQ-CORE-NOGHOST-01)', async () => {
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[activeFeedbackItem, removedFeedbackItem]}
        anchors={[activeAnchor, removedAnchor]}
      />,
    );

    const editor = screen.getByRole('textbox');
    await waitFor(() =>
      expect(editor.querySelector('[data-ai-feedback="true"]')).not.toBeNull(),
    );

    const forbidden = /apply|insert|accept|use this/i;
    const buttons = screen.queryAllByRole('button');
    for (const button of buttons) {
      expect(button.textContent ?? '').not.toMatch(forbidden);
    }
  });

  it('marks AI feedback content structurally distinguishable from plain writer text (compliance)', async () => {
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[activeFeedbackItem]}
        anchors={[activeAnchor]}
      />,
    );

    const editor = screen.getByRole('textbox');
    await waitFor(() =>
      expect(editor.querySelector('[data-ai-feedback="true"]')).not.toBeNull(),
    );

    // The second paragraph ("Later.") is plain writer text with no AI marker.
    const paragraphs = editor.querySelectorAll('p');
    const plainParagraph = Array.from(paragraphs).find((p) => p.textContent === 'Later.');
    expect(plainParagraph?.querySelector('[data-ai-feedback="true"]')).toBeNull();
    expect(plainParagraph).not.toHaveAttribute('data-ai-feedback');
  });
});
