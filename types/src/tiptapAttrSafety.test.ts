import {
  findUnsafeTipTapAttr,
  isSafeCssColor,
  isSafeCssFontFamily,
  isSafeCssFontSize,
  isSafeImageSrc,
  stripUnsafeTipTapAttrs,
} from './tiptapAttrSafety';
import type { TipTapNode } from './tiptapContent';

const BREAKOUT = 'x" onerror="alert(1)';

function textWithMark(type: string, attrs: Record<string, unknown>): TipTapNode {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hi', marks: [{ type, attrs }] }] },
    ],
  };
}

describe('attribute validators', () => {
  it('accepts values the editor, docx import, and Textract produce', () => {
    for (const c of ['#fef08a', '#FFF', 'rgb(29, 78, 216)', 'oklch(0.5 0.2 240)', 'var(--ink)', 'red']) {
      expect(isSafeCssColor(c)).toBe(true);
    }
    for (const f of [
      '"Times New Roman", Times, serif',
      'Inter, ui-sans-serif, system-ui, sans-serif',
      '"Source Serif 4", ui-serif, Georgia, serif',
      '宋体',
    ]) {
      expect(isSafeCssFontFamily(f)).toBe(true);
    }
    for (const s of ['12pt', '16px', '1.2em', '120%', 'larger']) {
      expect(isSafeCssFontSize(s)).toBe(true);
    }
    for (const src of [
      'data:image/png;base64,iVBORw0KGgo=',
      'https://example.com/a.png?x=1&y=2',
      'figures/0b6c/figure-1-0.png',
    ]) {
      expect(isSafeImageSrc(src)).toBe(true);
    }
  });

  it('rejects attribute breakouts and CSS/URL injection', () => {
    for (const c of [BREAKOUT, 'red;background:url(https://x)', 'url(https://x)', 'red}']) {
      expect(isSafeCssColor(c)).toBe(false);
    }
    for (const f of [BREAKOUT, 'Arial;color:red', '"Arial', 'a:b', 'x(1)']) {
      expect(isSafeCssFontFamily(f)).toBe(false);
    }
    expect(isSafeCssFontSize('12pt;color:red')).toBe(false);
    for (const src of [
      BREAKOUT,
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'https://x/"onerror=',
      '//evil.example/a.png',
    ]) {
      expect(isSafeImageSrc(src)).toBe(false);
    }
  });
});

describe('findUnsafeTipTapAttr', () => {
  it('returns null for an ordinary styled document', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center', indent: 1 },
          content: [
            {
              type: 'text',
              text: 'Styled',
              marks: [
                { type: 'bold' },
                { type: 'textStyle', attrs: { color: '#b91c1c', fontSize: '18pt', fontFamily: null } },
              ],
            },
          ],
        },
        { type: 'image', attrs: { src: 'data:image/png;base64,AAAA', alt: 'x"y' } },
      ],
    };
    expect(findUnsafeTipTapAttr(doc)).toBeNull();
  });

  it('flags image src breakouts (finding f-6b67e136)', () => {
    const doc: TipTapNode = { type: 'doc', content: [{ type: 'image', attrs: { src: BREAKOUT } }] };
    expect(findUnsafeTipTapAttr(doc)).toBe('image.src');
  });

  it('flags mark attrs that previously reached style=""', () => {
    expect(findUnsafeTipTapAttr(textWithMark('highlight', { color: BREAKOUT }))).toBe(
      'highlight mark.color',
    );
    expect(findUnsafeTipTapAttr(textWithMark('textStyle', { fontFamily: BREAKOUT }))).toBe(
      'textStyle mark.fontFamily',
    );
    expect(findUnsafeTipTapAttr(textWithMark('textStyle', { fontSize: BREAKOUT }))).toBe(
      'textStyle mark.fontSize',
    );
  });

  it('flags non-string values and walks footnote attrs.content', () => {
    expect(
      findUnsafeTipTapAttr({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: { x: 1 } } }] }),
    ).toBe('paragraph.textAlign');
    const footnote: TipTapNode = {
      type: 'doc',
      content: [
        {
          type: 'footnote',
          attrs: {
            footnoteNumber: 1,
            content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:x' } }] },
          },
        },
      ],
    };
    expect(findUnsafeTipTapAttr(footnote)).toBe('image.src');
  });
});

describe('stripUnsafeTipTapAttrs', () => {
  it('returns the same reference when nothing is unsafe', () => {
    const doc = textWithMark('textStyle', { color: '#000000' });
    expect(stripUnsafeTipTapAttrs(doc)).toBe(doc);
  });

  it('drops unsafe images, mark attrs, and node attrs so the result passes the check', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: BREAKOUT } },
        {
          type: 'paragraph',
          attrs: { textAlign: BREAKOUT },
          content: [
            {
              type: 'text',
              text: 'hi',
              marks: [{ type: 'textStyle', attrs: { color: BREAKOUT, fontSize: '12pt' } }],
            },
          ],
        },
      ],
    };
    const cleaned = stripUnsafeTipTapAttrs(doc);
    expect(findUnsafeTipTapAttr(cleaned)).toBeNull();
    expect(cleaned.content).toHaveLength(1);
    expect(cleaned.content![0]!.attrs).toEqual({ textAlign: null });
    expect(cleaned.content![0]!.content![0]!.marks![0]!.attrs).toEqual({ fontSize: '12pt' });
    // Input is not mutated.
    expect(doc.content).toHaveLength(2);
  });
});
