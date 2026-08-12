import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildCombinedExportHtml,
  combinedDocumentAndDebriefToPdfBlob,
  formatExportDate,
  isEditorContentEmpty,
  renderDebriefColumnHtml,
} from './combinedPdfExport';

import type { CombinedPdfExportInput } from './combinedPdfExport';
import type { Debrief } from '@/features/debrief/debriefTypes';
import type { FeedbackItem } from '@wren/types';
import type { JSONContent } from '@tiptap/react';

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 816;
    canvas.height = 1056;
    canvas.toDataURL = () =>
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPwB//9k=';
    return canvas;
  }),
}));

const emptyDoc: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

const sampleDoc: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Case Summary' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The court held that ' },
        { type: 'text', text: 'the appeal succeeded', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' on narrow grounds.' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'First finding' }],
            },
          ],
        },
      ],
    },
  ],
};

function feedbackItem(overrides: Partial<FeedbackItem>): FeedbackItem {
  return {
    id: 'item-1',
    documentId: 'doc-1',
    errorCategoryId: 'cat-clarity',
    kind: 'inline',
    questionText: 'Could this sentence be clearer?',
    sourceDraftId: 'draft-1',
    createdAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

function sampleDebrief(overrides: Partial<Debrief> = {}): Debrief {
  return {
    documentId: 'doc-1',
    draftId: 'draft-1',
    generatedAt: '2026-08-01T12:00:00.000Z',
    items: [
      feedbackItem({
        id: 'strength-1',
        kind: 'strength',
        questionText: 'Keep this up',
        positiveNote: 'Strong topic sentence.',
        quotedText: 'The court held that the appeal succeeded',
      }),
      feedbackItem({
        id: 'improve-1',
        kind: 'inline',
        questionText: 'Could this sentence be clearer?',
        quotedText: 'on narrow grounds',
      }),
    ],
    categoryNames: { 'cat-clarity': 'Clarity' },
    progressSummary: [
      {
        category: 'Clarity',
        tendency: 'improving',
        description: 'Sentences are getting tighter.',
      },
    ],
    ...overrides,
  };
}

describe('isEditorContentEmpty', () => {
  it('treats a blank paragraph doc as empty', () => {
    expect(isEditorContentEmpty(emptyDoc)).toBe(true);
  });

  it('treats whitespace-only text as empty', () => {
    expect(
      isEditorContentEmpty({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
      }),
    ).toBe(true);
  });

  it('returns false when the editor has words', () => {
    expect(isEditorContentEmpty(sampleDoc)).toBe(false);
  });
});

describe('renderDebriefColumnHtml', () => {
  it('shows a not-generated placeholder when the debrief is empty', () => {
    const html = renderDebriefColumnHtml(null, 'empty');
    expect(html).toContain('data-pdf-debrief-empty');
    expect(html).toContain('has not been generated yet');
    expect(html).toContain('AI Debrief');
  });

  it('shows a load-failure placeholder when the debrief is unavailable', () => {
    const html = renderDebriefColumnHtml(null, 'unavailable');
    expect(html).toContain('could not be loaded');
  });

  it('renders grouped strengths, improvements, and progress', () => {
    const html = renderDebriefColumnHtml(sampleDebrief(), 'ready');
    expect(html).toContain('data-pdf-debrief="true"');
    expect(html).toContain('Clarity');
    expect(html).toContain("What's Done Well");
    expect(html).toContain('Strong topic sentence.');
    expect(html).toContain('Areas for Improvement');
    expect(html).toContain('Could this sentence be clearer?');
    expect(html).toContain('Your Progress This Draft');
    expect(html).toContain('1 Improving');
    expect(html).toContain('Sentences are getting tighter.');
  });

  it('escapes untrusted debrief text', () => {
    const html = renderDebriefColumnHtml(
      sampleDebrief({
        items: [
          feedbackItem({
            questionText: '<script>alert(1)</script>',
            quotedText: 'a <b>quote</b>',
          }),
        ],
        progressSummary: [],
      }),
      'ready',
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &lt;b&gt;quote&lt;/b&gt;');
  });
});

describe('buildCombinedExportHtml', () => {
  const input = (overrides: Partial<CombinedPdfExportInput> = {}): CombinedPdfExportInput => ({
    content: sampleDoc,
    documentTitle: 'Memo on Appeals',
    exportDate: new Date('2026-08-11T15:00:00.000Z'),
    debrief: sampleDebrief(),
    debriefStatus: 'ready',
    ...overrides,
  });

  it('includes the page-1 header, formatted editor content, and debrief column', () => {
    const html = buildCombinedExportHtml(input());
    expect(html).toContain('data-pdf-export-header');
    expect(html).toContain('Memo on Appeals');
    expect(html).toContain(`Exported ${formatExportDate(input().exportDate)}`);
    expect(html).toContain('<h1');
    expect(html).toContain('Case Summary');
    expect(html).toContain('<strong>the appeal succeeded</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('First finding');
    expect(html).toContain('data-pdf-debrief="true"');
    expect(html).toContain('Could this sentence be clearer?');
  });

  it('keeps a two-column shell when the debrief is missing', () => {
    const html = buildCombinedExportHtml(
      input({ debrief: null, debriefStatus: 'empty' }),
    );
    expect(html).toContain('data-pdf-doc');
    expect(html).toContain('data-pdf-debrief-col');
    expect(html).toContain('has not been generated yet');
  });
});

describe('combinedDocumentAndDebriefToPdfBlob', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('returns a PDF blob and cleans up the offscreen host', async () => {
    const blob = await combinedDocumentAndDebriefToPdfBlob({
      content: sampleDoc,
      documentTitle: 'Memo on Appeals',
      exportDate: new Date('2026-08-11T15:00:00.000Z'),
      debrief: sampleDebrief(),
      debriefStatus: 'ready',
    });

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toMatch(/pdf/);
    expect(document.querySelector('[data-pdf-export="combined"]')).toBeNull();
  });
});
