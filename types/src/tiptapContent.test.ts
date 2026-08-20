import {
  stripAiMarksFromTipTapContent,
  tipTapContentToSegments,
  wordCountFromTipTapContent,
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
