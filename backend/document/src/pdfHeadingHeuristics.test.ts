import {
  headingLevelFromPlainText,
  isCanliiOverlayStamp,
  looksLikeBodyCopy,
  looksLikeStandaloneHeading,
} from './pdfHeadingHeuristics';
import { pdfjsItemToSpatial } from './digitalPdfExtract';
import { polishPdfTipTapNodes } from './promotePdfHeadings';
import type { TipTapNode } from '@wren/types';

describe('pdfHeadingHeuristics', () => {
  it('treats Table of Contents and Reasons for Judgment as headings', () => {
    expect(looksLikeStandaloneHeading('Table of Contents')).toBe(true);
    expect(headingLevelFromPlainText('Table of Contents')).toBe(1);
    expect(headingLevelFromPlainText('Reasons for Judgment')).toBe(1);
    expect(headingLevelFromPlainText('INTRODUCTION')).toBe(2);
  });

  it.each(['1. INTRODUCTION', 'A. BACKGROUND', 'PART II. ANALYSIS', '(a) STANDARD OF REVIEW', 'R. V. SMITH'])(
    'treats outline-numbered ALL-CAPS heading %p as a heading',
    (heading) => {
      expect(looksLikeStandaloneHeading(heading)).toBe(true);
      expect(headingLevelFromPlainText(heading)).toBe(2);
    },
  );

  it.each([
    'THE APPEAL IS DISMISSED. COSTS TO THE RESPONDENT.',
    '1. Introduction',
    'A. Background',
  ])('does not treat %p as an ALL-CAPS standalone heading', (text) => {
    expect(looksLikeStandaloneHeading(text)).toBe(false);
  });

  it('does not treat hyphenated wraps as headings', () => {
    expect(looksLikeStandaloneHeading('environ-')).toBe(false);
  });

  it('detects CanLII overlay stamps but not case citations with party names', () => {
    expect(isCanliiOverlayStamp('2024 BCSC 1953 (CanLII)')).toBe(true);
    expect(isCanliiOverlayStamp('Pearman v. Kuramoto, 2024 BCSC 1953')).toBe(false);
  });
});

describe('looksLikeBodyCopy', () => {
  it.each([
    '1. Introduction',
    '4.1. Facts',
    '4.1 Facts',
    'A. Background',
    '(a) Standard of Review',
    'II. Analysis',
    'iv) Remedies',
    'Part II. Analysis',
    'Chapter 3. The Duty of Care',
    'R. v. Smith',
    'Smith v. Jones',
    'Pearman v. Kuramoto, 2024 BCSC 1953',
    'Re Smith Ltd. Appeal',
    'Is the Contract Enforceable?',
    'Solution Overview',
  ])('keeps heading %p as a heading', (heading) => {
    expect(looksLikeBodyCopy(heading)).toBe(false);
  });

  it.each([
    'The appeal is dismissed. Costs to the respondent.',
    'The court erred. It misapplied the test.',
    '1. The trial judge erred. She misread the evidence.',
    'Was the contract breached? The defendant says no.',
    'R. v. Smith was wrongly decided. The Court should revisit it.',
  ])('treats multi-sentence prose %p as body copy', (prose) => {
    expect(looksLikeBodyCopy(prose)).toBe(true);
  });

  it('treats over-long or wordy text as body copy', () => {
    expect(looksLikeBodyCopy('x'.repeat(91))).toBe(true);
    expect(
      looksLikeBodyCopy('one two three four five six seven eight nine ten eleven twelve thirteen'),
    ).toBe(true);
  });

  it('does not treat empty text as body copy', () => {
    expect(looksLikeBodyCopy('   ')).toBe(false);
  });
});

describe('pdfjsItemToSpatial', () => {
  it('converts PDF user-space Y (bottom origin) to top origin', () => {
    const item = pdfjsItemToSpatial(
      {
        str: 'Title',
        transform: [12, 0, 0, 12, 40, 700],
        width: 40,
        height: 12,
        fontName: 'F1',
      },
      792,
      { F1: { fontFamily: 'Arial-Bold' } },
    );
    expect(item?.text).toBe('Title');
    expect(item?.x).toBe(40);
    expect(item?.fontSize).toBe(12);
    expect(item?.y).toBeCloseTo(792 - 700 - 12);
    expect(item?.fontName).toContain('Arial-Bold');
  });
});

describe('polishPdfTipTapNodes', () => {
  it('promotes TOC titles and strips overlay stamps', () => {
    const nodes: TipTapNode[] = [
      { type: 'paragraph', content: [{ type: 'text', text: '2024 BCSC 1953 (CanLII)' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Table of Contents' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'INTRODUCTION' }] },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'The application is dismissed with costs.' }],
      },
    ];
    const out = polishPdfTipTapNodes(nodes);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
    expect(out[1]).toMatchObject({ type: 'heading' });
    expect(out[2]?.type).toBe('paragraph');
  });
});
