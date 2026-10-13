import {
  stripAiMarksFromTipTapContent,
  tipTapContentToSegments,
  wordCountFromTipTapContent,
  charCountFromTipTapContent,
  findDisallowedTipTapNodeType,
  type TipTapNode,
} from './tiptapContent';

describe('tipTapContentToSegments', () => {
  it('flattens paragraphs and headings in order', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    };

    expect(tipTapContentToSegments(doc)).toEqual([
      { index: 0, text: 'Title' },
      { index: 1, text: 'Hello world' },
    ]);
  });

  it('emits one segment per list item including nested lists', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
                {
                  type: 'bulletList',
                  content: [
                    {
                      type: 'listItem',
                      content: [
                        { type: 'paragraph', content: [{ type: 'text', text: 'Nested' }] },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }],
            },
          ],
        },
      ],
    };

    expect(tipTapContentToSegments(doc)).toEqual([
      { index: 0, text: 'One' },
      { index: 1, text: 'Nested' },
      { index: 2, text: 'Two' },
    ]);
  });

  it('emits one segment per table cell in row-major order', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
                },
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }],
                },
              ],
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }],
                },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }],
                },
              ],
            },
          ],
        },
      ],
    };

    expect(tipTapContentToSegments(doc)).toEqual([
      { index: 0, text: 'A' },
      { index: 1, text: 'B' },
      { index: 2, text: '1' },
      { index: 3, text: '2' },
    ]);
  });

  it('counts words from flattened text', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'one two' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'three' }] },
      ],
    };
    expect(wordCountFromTipTapContent(doc)).toBe(3);
  });

  it('counts text under unrecognized containers and bare text nodes', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'text', text: 'quoted words here' }],
        },
        {
          type: 'codeBlock',
          content: [{ type: 'text', text: 'function hello world' }],
        },
        { type: 'text', text: 'bare leftover text' },
      ],
    };
    expect(wordCountFromTipTapContent(doc)).toBe(9);
  });
});

describe('footnote-aware word and character counting', () => {
  /**
   * A footnote whose body carries `bodyText`, inside a paragraph with a
   * leading marker. The segment substrate must still emit only `[N]` for the
   * footnote, but the authoritative word/char count must include the body.
   */
  const docWithFootnoteBody = (bodyText: string): TipTapNode => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Visible paragraph text' },
          {
            type: 'footnote',
            attrs: {
              footnoteNumber: 1,
              content: {
                type: 'paragraph',
                content: [{ type: 'text', text: bodyText }],
              },
            },
          },
        ],
      },
    ],
  });

  it('keeps the segment substrate as marker-only "[N]" (segmentation unchanged)', () => {
    const doc = docWithFootnoteBody('alpha beta gamma delta');
    // The paragraph flattens to its visible text plus the "[1]" marker — the
    // footnote body never leaks into the segment substrate.
    expect(tipTapContentToSegments(doc)).toEqual([
      { index: 0, text: 'Visible paragraph text[1]' },
    ]);
  });

  it('counts footnote body words on top of the segment words', () => {
    const doc = docWithFootnoteBody('alpha beta gamma delta');
    // Segment "Visible paragraph text[1]" => 3 words; body => 4 words.
    expect(wordCountFromTipTapContent(doc)).toBe(7);
  });

  it('counts footnote body characters so a whitespace-free blob is measured', () => {
    const blob = 'x'.repeat(5000); // one "word", but 5000 chars
    const doc = docWithFootnoteBody(blob);
    // Word count under-measures the blob (1 word) ...
    expect(wordCountFromTipTapContent(doc)).toBe(3 + 1);
    // ... but the char count reflects the full body length.
    const chars = charCountFromTipTapContent(doc);
    expect(chars).toBeGreaterThanOrEqual(5000);
    // Segment chars ("Visible paragraph text[1]" = 25) + 5000 body chars.
    expect(chars).toBe('Visible paragraph text[1]'.length + 5000);
  });

  it('returns 0 words and 0 chars for empty / non-doc content', () => {
    expect(wordCountFromTipTapContent(null)).toBe(0);
    expect(charCountFromTipTapContent(undefined)).toBe(0);
  });

  it('counts footnote citation metadata (author/title/source/pinpoint/year)', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'footnote',
              attrs: {
                footnoteNumber: 1,
                content: { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
                author: 'Jane Author',
                title: 'A Long Title Here',
                source: 'Journal',
                pinpoint: 'p 12',
                year: '2026',
              },
            },
          ],
        },
      ],
    };
    // Segment "[1]" => 1 word; body "body" => 1 word; metadata words:
    // "Jane Author"(2) + "A Long Title Here"(4) + "Journal"(1) + "p 12"(2) + "2026"(1) = 10.
    expect(wordCountFromTipTapContent(doc)).toBe(1 + 1 + 10);
    const chars = charCountFromTipTapContent(doc);
    const metaChars =
      'Jane Author'.length +
      'A Long Title Here'.length +
      'Journal'.length +
      'p 12'.length +
      '2026'.length;
    expect(chars).toBe('[1]'.length + 'body'.length + metaChars);
  });

  it('counts footnotes nested outside paragraph/heading, e.g. in a table cell', () => {
    const bodyText = 'alpha beta gamma';
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'footnote',
                      attrs: {
                        footnoteNumber: 1,
                        content: {
                          type: 'paragraph',
                          content: [{ type: 'text', text: bodyText }],
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    // The footnote body (3 words) must be counted even though the footnote is
    // not under a paragraph/heading — extractFootnotes would miss it.
    expect(wordCountFromTipTapContent(doc)).toBeGreaterThanOrEqual(3);
    expect(charCountFromTipTapContent(doc)).toBeGreaterThanOrEqual(bodyText.length);
  });

  it('counts footnote bodies with a non-integer footnoteNumber (gate must not trust validity)', () => {
    const bodyText = 'one two three four five';
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'footnote',
              attrs: {
                footnoteNumber: 1.5, // invalid per extractFootnotes, but engine accepts floats
                content: { type: 'paragraph', content: [{ type: 'text', text: bodyText }] },
              },
            },
          ],
        },
      ],
    };
    // Body words (5) are counted even though footnoteNumber is not a valid int.
    expect(wordCountFromTipTapContent(doc)).toBeGreaterThanOrEqual(5);
    expect(charCountFromTipTapContent(doc)).toBeGreaterThanOrEqual(bodyText.length);
  });
});

describe('findDisallowedTipTapNodeType', () => {
  it('accepts editor node types including footnotes', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi' },
            { type: 'footnote', attrs: { footnoteNumber: 1, content: { type: 'paragraph' } } },
          ],
        },
      ],
    };
    expect(findDisallowedTipTapNodeType(doc)).toBeNull();
  });

  it('rejects unknown node types', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [{ type: 'script', content: [{ type: 'text', text: 'x' }] }],
    };
    expect(findDisallowedTipTapNodeType(doc)).toBe('script');
  });
});

describe('stripAiMarksFromTipTapContent', () => {
  it('removes highlight and comment marks but keeps bold', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'bold' }, { type: 'highlight' }, { type: 'comment' }],
            },
          ],
        },
      ],
    };

    const cleaned = stripAiMarksFromTipTapContent(doc);
    expect(cleaned.content?.[0]?.content?.[0]?.marks).toEqual([{ type: 'bold' }]);
  });

  it('keeps textStyle fontSize marks and paragraph indent attrs', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { indent: 2 },
          content: [
            {
              type: 'text',
              text: 'Sized',
              marks: [
                { type: 'textStyle', attrs: { fontSize: '18pt' } },
                { type: 'highlight' },
              ],
            },
          ],
        },
      ],
    };

    const cleaned = stripAiMarksFromTipTapContent(doc);
    const para = cleaned.content?.[0];
    expect(para?.attrs).toEqual({ indent: 2 });
    expect(para?.content?.[0]?.marks).toEqual([
      { type: 'textStyle', attrs: { fontSize: '18pt' } },
    ]);
  });
});

describe('tipTapContentToSegments with indent and font size', () => {
  it('flattens indented / sized text to plain segments (marks and attrs ignored)', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { indent: 1 },
          content: [
            {
              type: 'text',
              text: 'Indented sized',
              marks: [{ type: 'textStyle', attrs: { fontSize: '16pt' } }],
            },
          ],
        },
      ],
    };

    expect(tipTapContentToSegments(doc)).toEqual([
      { index: 0, text: 'Indented sized' },
    ]);
  });
});
