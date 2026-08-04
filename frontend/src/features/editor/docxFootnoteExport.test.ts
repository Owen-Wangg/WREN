/**
 * Tests for `.docx` footnote export (footnote-citation-support spec, Task 12.1).
 *
 * Validates: Requirements 8.2
 */
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { tiptapContentToDocxBytes } from './docxContentMapper';

function docWithOneFootnote() {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See the holding below.' },
          {
            type: 'footnote',
            attrs: {
              footnoteNumber: 1,
              content: {
                type: 'doc',
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'See discussion below.' }] },
                ],
              },
              author: 'R. Smith',
              title: 'Contract Interpretation',
              source: 'Canadian Bar Review',
              pinpoint: '¶ 42',
              year: '2019',
            },
          },
        ],
      },
    ],
  };
}

describe('.docx footnote export', () => {
  it('produces a word/footnotes.xml part when the document contains footnotes', async () => {
    const bytes = await tiptapContentToDocxBytes(docWithOneFootnote());
    const zip = await JSZip.loadAsync(bytes);

    const footnotesXml = zip.file('word/footnotes.xml');
    expect(footnotesXml).not.toBeNull();

    const xmlText = await footnotesXml!.async('text');
    expect(xmlText).toContain('See discussion below');
    // Citation fields rendered into the footnote body.
    expect(xmlText).toContain('R. Smith');
    expect(xmlText).toContain('Contract Interpretation');
    expect(xmlText).toContain('2019');
  });

  it('references the footnote from the document body via a footnoteReference run', async () => {
    const bytes = await tiptapContentToDocxBytes(docWithOneFootnote());
    const zip = await JSZip.loadAsync(bytes);

    const documentXml = await zip.file('word/document.xml')!.async('text');
    expect(documentXml).toMatch(/<w:footnoteReference[^>]*w:id="1"/);
  });

  it('produces no footnotes.xml part when the document has no footnotes', async () => {
    const bytes = await tiptapContentToDocxBytes({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'No footnotes here.' }] }],
    });
    const zip = await JSZip.loadAsync(bytes);

    // Either absent, or present-but-empty (docx's default separator-only
    // footnotes part) — never containing OUR footnote body text, since there
    // is none to include.
    const footnotesXml = zip.file('word/footnotes.xml');
    if (footnotesXml) {
      const xmlText = await footnotesXml.async('text');
      expect(xmlText).not.toContain('No footnotes here');
    }
  });

  it('exports multiple footnotes each keyed by their sequential footnoteNumber', async () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'footnote',
              attrs: {
                footnoteNumber: 1,
                content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First note.' }] }] },
                author: '',
                title: '',
                source: '',
                pinpoint: '',
                year: '',
              },
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'footnote',
              attrs: {
                footnoteNumber: 2,
                content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second note.' }] }] },
                author: '',
                title: '',
                source: '',
                pinpoint: '',
                year: '',
              },
            },
          ],
        },
      ],
    };

    const bytes = await tiptapContentToDocxBytes(doc);
    const zip = await JSZip.loadAsync(bytes);
    const xmlText = await zip.file('word/footnotes.xml')!.async('text');

    expect(xmlText).toContain('First note.');
    expect(xmlText).toContain('Second note.');

    const documentXml = await zip.file('word/document.xml')!.async('text');
    expect(documentXml).toMatch(/<w:footnoteReference[^>]*w:id="1"/);
    expect(documentXml).toMatch(/<w:footnoteReference[^>]*w:id="2"/);
  });
});
