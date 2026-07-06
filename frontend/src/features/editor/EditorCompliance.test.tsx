/**
 * Compliance render tests for the editor feature (task 18.7; Requirement 11.2).
 *
 * **Asserts:**
 * 1. AI feedback is structurally distinguishable from writer-authored text in
 *    the DOM (via `data-ai-feedback="true"` on AI content, absent on writer
 *    text) — not just a color difference.
 * 2. NO Apply/Insert/Accept affordance exists anywhere in the editor view.
 *
 * These tests validate EXISTING compliance behavior and do not modify any
 * component implementation.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AnchoredFeedbackEditor } from './components/AnchoredFeedbackEditor';

import type { JSONContent } from '@tiptap/react';
import type { Anchor, FeedbackItem } from '@wren/types';

// --- Fixtures ---------------------------------------------------------------

const writerContent: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'The court held that disclosure obligations apply broadly.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'This is the second paragraph of writer-authored text.' }] },
  ],
};

const inlineFeedbackItem: FeedbackItem = {
  id: 'fb-compliance-1',
  documentId: 'doc-compliance',
  errorCategoryId: 'cat-clarity',
  kind: 'inline',
  questionText: 'Can you state the holding in a single, complete sentence?',
  currentAnchorId: 'anchor-compliance-1',
  sourceDraftId: 'draft-compliance',
  createdAt: '2024-06-01T00:00:00.000Z',
};

const inlineAnchor: Anchor = {
  id: 'anchor-compliance-1',
  feedbackItemId: 'fb-compliance-1',
  draftId: 'draft-compliance',
  paragraphIndex: 0,
  startOffset: 0,
  endOffset: 9, // "The court"
  contentFingerprint: 'fp-compliance',
  state: 'active',
};

const structuralFeedbackItem: FeedbackItem = {
  id: 'fb-compliance-2',
  documentId: 'doc-compliance',
  errorCategoryId: 'cat-structure',
  kind: 'inline',
  questionText: 'Does the order of your arguments reflect the strongest point first?',
  currentAnchorId: 'anchor-compliance-2',
  sourceDraftId: 'draft-compliance',
  createdAt: '2024-06-01T00:00:00.000Z',
};

const structuralAnchor: Anchor = {
  id: 'anchor-compliance-2',
  feedbackItemId: 'fb-compliance-2',
  draftId: 'draft-compliance',
  paragraphIndex: 1,
  startOffset: 0,
  endOffset: 4, // "This"
  contentFingerprint: 'fp-compliance-2',
  state: 'active',
};

// --- Tests ------------------------------------------------------------------

describe('Editor — No-Ghostwriting Compliance (Requirement 11.2)', () => {
  describe('AI feedback is structurally distinguishable from writer text', () => {
    it('AI-anchored comment marks carry data-ai-feedback="true" in the editor DOM', async () => {
      render(
        <AnchoredFeedbackEditor
          initialContent={writerContent}
          feedbackItems={[inlineFeedbackItem]}
          anchors={[inlineAnchor]}
        />,
      );

      const editor = screen.getByRole('textbox');
      await waitFor(() => {
        const aiMarks = editor.querySelectorAll('[data-ai-feedback="true"]');
        expect(aiMarks.length).toBeGreaterThan(0);
      });
    });

    it('writer-authored text paragraphs do NOT carry the data-ai-feedback attribute', async () => {
      render(
        <AnchoredFeedbackEditor
          initialContent={writerContent}
          feedbackItems={[inlineFeedbackItem]}
          anchors={[inlineAnchor]}
        />,
      );

      const editor = screen.getByRole('textbox');
      await waitFor(() =>
        expect(editor.querySelector('[data-ai-feedback="true"]')).not.toBeNull(),
      );

      // The second paragraph is purely writer text — no AI marker anywhere inside it.
      const paragraphs = editor.querySelectorAll('p');
      const writerParagraph = Array.from(paragraphs).find((p) =>
        p.textContent?.includes('second paragraph of writer-authored text'),
      );
      expect(writerParagraph).toBeDefined();
      expect(writerParagraph?.querySelector('[data-ai-feedback]')).toBeNull();
      expect(writerParagraph).not.toHaveAttribute('data-ai-feedback');
    });

    it('margin comment cards carry data-ai-feedback="true", distinguishing them from writer text', () => {
      render(
        <AnchoredFeedbackEditor
          initialContent={writerContent}
          feedbackItems={[inlineFeedbackItem, structuralFeedbackItem]}
          anchors={[inlineAnchor, structuralAnchor]}
        />,
      );

      const cards = screen.getAllByRole('button', { name: /Can you state|order of your arguments/ });
      for (const card of cards) {
        expect(card).toHaveAttribute('data-ai-feedback', 'true');
      }
    });

    it('AI feedback uses a distinct CSS class on its marks (not relying on color alone)', async () => {
      render(
        <AnchoredFeedbackEditor
          initialContent={writerContent}
          feedbackItems={[inlineFeedbackItem]}
          anchors={[inlineAnchor]}
        />,
      );

      const editor = screen.getByRole('textbox');
      await waitFor(() =>
        expect(editor.querySelector('[data-ai-feedback="true"]')).not.toBeNull(),
      );

      const aiMark = editor.querySelector('[data-ai-feedback="true"]');
      // The comment mark extension applies a border-b (underline) class — a
      // structural visual cue beyond just background color.
      expect(aiMark?.className).toMatch(/border-b/);
    });
  });

  describe('No Apply/Insert/Accept affordance exists in the editor view', () => {
    it('no button with Apply/Insert/Accept text exists when feedback is rendered', async () => {
      render(
        <AnchoredFeedbackEditor
          initialContent={writerContent}
          feedbackItems={[inlineFeedbackItem, structuralFeedbackItem]}
          anchors={[inlineAnchor, structuralAnchor]}
        />,
      );

      const editor = screen.getByRole('textbox');
      await waitFor(() =>
        expect(editor.querySelector('[data-ai-feedback="true"]')).not.toBeNull(),
      );

      const forbidden = /\b(apply|insert|accept)\b/i;
      const buttons = screen.getAllByRole('button');
      for (const button of buttons) {
        expect(button.textContent ?? '').not.toMatch(forbidden);
      }
    });

    it('no element with aria-label matching Apply/Insert/Accept exists', async () => {
      render(
        <AnchoredFeedbackEditor
          initialContent={writerContent}
          feedbackItems={[inlineFeedbackItem, structuralFeedbackItem]}
          anchors={[inlineAnchor, structuralAnchor]}
        />,
      );

      const editor = screen.getByRole('textbox');
      await waitFor(() =>
        expect(editor.querySelector('[data-ai-feedback="true"]')).not.toBeNull(),
      );

      const forbidden = /\b(apply|insert|accept)\b/i;
      const allElements = document.querySelectorAll('[aria-label]');
      for (const el of allElements) {
        expect(el.getAttribute('aria-label') ?? '').not.toMatch(forbidden);
      }
    });

    it('no link or clickable element offering code/text insertion exists', async () => {
      render(
        <AnchoredFeedbackEditor
          initialContent={writerContent}
          feedbackItems={[inlineFeedbackItem, structuralFeedbackItem]}
          anchors={[inlineAnchor, structuralAnchor]}
        />,
      );

      const editor = screen.getByRole('textbox');
      await waitFor(() =>
        expect(editor.querySelector('[data-ai-feedback="true"]')).not.toBeNull(),
      );

      // Check all interactive elements for forbidden affordances.
      const forbidden = /\b(apply|insert|accept|use this|paste suggestion)\b/i;
      const interactive = document.querySelectorAll('button, a, [role="button"]');
      for (const el of interactive) {
        expect(el.textContent ?? '').not.toMatch(forbidden);
      }
    });
  });
});
