/**
 * Render tests for `<AnchoredFeedbackEditor>` (task 18.2).
 *
 * **Validates: Requirements 11.2, 12.1, 12.2, 12.3, 12.4**
 *
 * Covers: comment marks render for active anchors, removed-anchor items
 * render in the non-anchored "no longer applies" state, select-item ↔
 * highlight-span linkage works in both directions, and a compliance
 * assertion that the AI-feedback UI is structurally distinguishable from
 * plain writer text (`data-ai-feedback` present on AI content, absent on
 * writer paragraphs).
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const noAnchorFeedbackItem: FeedbackItem = {
  id: 'fb-no-anchor',
  documentId: 'doc-1',
  errorCategoryId: 'cat-grammar',
  kind: 'inline',
  questionText: 'Is this a complete sentence?',
  sourceDraftId: 'draft-1',
  createdAt: '2024-01-01T00:00:00.000Z',
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

  it('shows the category label and Socratic question in the margin card (Requirement 12.3)', () => {
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[activeFeedbackItem]}
        anchors={[activeAnchor]}
        categoryLabels={{ 'cat-clarity': 'Unclear Writing' }}
      />,
    );

    const card = screen.getByRole('button', {
      name: /Unclear Writing.*main legal holding/s,
    });
    expect(card).toBeInTheDocument();
    // Never an internal "correct version" — only the Socratic question.
    expect(card.textContent).not.toMatch(/correct version/i);
  });

  it('renders items whose anchor is `removed` in a distinct "no longer applies" state, not attached to any span (Requirement 12.4)', () => {
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[removedFeedbackItem]}
        anchors={[removedAnchor]}
      />,
    );

    const section = screen.getByRole('heading', { name: 'No longer applies' }).closest('section');
    expect(section).not.toBeNull();
    expect(
      within(section as HTMLElement).getByText('Is this the correct legal term?'),
    ).toBeInTheDocument();

    // No comment mark exists anywhere in the editor for a removed anchor.
    const editor = screen.getByRole('textbox');
    expect(editor.querySelector('[data-comment-id="fb-removed"]')).toBeNull();
  });

  it('renders items with no `currentAnchorId` in the same "no longer applies" state, never dropped (Requirement 12.4)', () => {
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[noAnchorFeedbackItem]}
        anchors={[]}
      />,
    );

    const section = screen.getByRole('heading', { name: 'No longer applies' }).closest('section');
    expect(
      within(section as HTMLElement).getByText('Is this a complete sentence?'),
    ).toBeInTheDocument();
  });

  it('select-item → highlight-span: clicking a margin card selects its span in the editor (Requirement 12.2)', async () => {
    const user = userEvent.setup();
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[activeFeedbackItem]}
        anchors={[activeAnchor]}
      />,
    );

    const editor = screen.getByRole('textbox');
    await waitFor(() => expect(editor.querySelector('[data-ai-feedback="true"]')).not.toBeNull());

    const card = screen.getByRole('button', { name: /main legal holding/ });
    await user.click(card);

    await waitFor(() => expect(card).toHaveAttribute('aria-current', 'true'));
  });

  it('highlight-span → select-item: activating the comment mark in the editor selects the margin card (Requirement 12.2)', async () => {
    const user = userEvent.setup();
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[activeFeedbackItem]}
        anchors={[activeAnchor]}
      />,
    );

    const editor = screen.getByRole('textbox');
    await waitFor(() => {
      expect(editor.querySelector('[data-ai-feedback="true"]')).not.toBeNull();
    });
    const mark = editor.querySelector('[data-ai-feedback="true"]');

    await user.click(mark!);

    const card = screen.getByRole('button', { name: /main legal holding/ });
    await waitFor(() => expect(card).toHaveAttribute('aria-current', 'true'));
  });

  it('never renders an Apply, Insert, or Accept affordance anywhere (REQ-CORE-NOGHOST-01)', () => {
    render(
      <AnchoredFeedbackEditor
        initialContent={initialContent}
        feedbackItems={[activeFeedbackItem, removedFeedbackItem, noAnchorFeedbackItem]}
        anchors={[activeAnchor, removedAnchor]}
      />,
    );

    const forbidden = /apply|insert|accept|use this/i;
    for (const button of screen.getAllByRole('button')) {
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

    // Every margin card also carries the same structural marker.
    const card = screen.getByRole('button', { name: /main legal holding/ });
    expect(card).toHaveAttribute('data-ai-feedback', 'true');
  });
});
