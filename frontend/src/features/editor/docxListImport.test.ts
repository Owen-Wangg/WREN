/**
 * `.docx` import: list grouping/numbering and tracked changes.
 *
 * Regressions: separate Word lists merged into one; a list continued after a
 * paragraph restarted at 1; `numId 0` ("numbering off") and numbering left
 * only in a `w:pPrChange` imported as list items; tracked moves duplicated
 * the moved text.
 */
import type { JSONContent } from '@tiptap/react';
import { Document, LevelFormat, Packer, Paragraph, TextRun } from 'docx';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { docxBytesToTiptapContent } from './docxContentMapper';
import { acceptTrackedChangesXml } from './docxTrackedChanges';

const REV = 'w:author="Reviewer" w:date="2026-01-01T00:00:00Z"';

const p = (inner: string) => `<w:p>${inner}</w:p>`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const li = (text: string, numId: number, ilvl = 0) =>
  p(
    `<w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}`,
  );

/**
 * A `.docx` whose body is `bodyXml`. The `docx` library defines two decimal
 * list instances (numId 2 and 3) so the hand-written numbering resolves.
 */
async function docxWithBody(bodyXml: string): Promise<Uint8Array> {
  const document = new Document({
    numbering: {
      config: [{ reference: 'num', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.' }] }],
    },
    sections: [
      {
        children: [
          new Paragraph({ numbering: { reference: 'num', level: 0 }, children: [new TextRun('x')] }),
          new Paragraph({
            numbering: { reference: 'num', level: 0, instance: 2 },
            children: [new TextRun('y')],
          }),
        ],
      },
    ],
  });
  const files = unzipSync(new Uint8Array(await Packer.toBuffer(document)));
  const xml = strFromU8(files['word/document.xml']!);
  const start = xml.indexOf('<w:body>') + '<w:body>'.length;
  const end = xml.indexOf('<w:sectPr');
  files['word/document.xml'] = strToU8(xml.slice(0, start) + bodyXml + xml.slice(end));
  return zipSync(files);
}

const textOf = (n: JSONContent): string =>
  typeof n.text === 'string' ? n.text : (n.content ?? []).map(textOf).join('');

const blocks = async (bodyXml: string) =>
  (await docxBytesToTiptapContent(await docxWithBody(bodyXml))).content ?? [];

const summary = (nodes: JSONContent[]) =>
  nodes.map((n) => ({
    type: n.type,
    ...(n.attrs?.start ? { start: n.attrs.start } : {}),
    text:
      n.type === 'orderedList' || n.type === 'bulletList'
        ? (n.content ?? []).map(textOf)
        : textOf(n),
  }));

describe('docx list grouping', () => {
  it('keeps two different Word lists separate', async () => {
    const out = await blocks(li('One', 2) + li('Two', 2) + li('Other one', 3));
    expect(summary(out)).toEqual([
      { type: 'orderedList', text: ['One', 'Two'] },
      { type: 'orderedList', text: ['Other one'] },
    ]);
  });

  it('continues numbering after an interrupting paragraph', async () => {
    const out = await blocks(li('A', 2) + li('B', 2) + p(run('Note')) + li('C', 2));
    expect(summary(out)).toEqual([
      { type: 'orderedList', text: ['A', 'B'] },
      { type: 'paragraph', text: 'Note' },
      { type: 'orderedList', start: 3, text: ['C'] },
    ]);
  });

  it('treats numId 0 as a plain paragraph', async () => {
    const off = p(
      `<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr></w:pPr>${run('Plain')}`,
    );
    const out = await blocks(li('A', 2) + off + li('B', 2));
    expect(summary(out)).toEqual([
      { type: 'orderedList', text: ['A'] },
      { type: 'paragraph', text: 'Plain' },
      { type: 'orderedList', start: 2, text: ['B'] },
    ]);
  });
});

describe('docx tracked changes', () => {
  it('ignores numbering that only exists in the previous paragraph properties', async () => {
    const removed = p(
      `<w:pPr><w:pPrChange w:id="1" ${REV}><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr></w:pPrChange></w:pPr>${run('Was numbered')}`,
    );
    const out = await blocks(removed);
    expect(summary(out)).toEqual([{ type: 'paragraph', text: 'Was numbered' }]);
  });

  it('imports moved text once, at its destination', async () => {
    const out = await blocks(
      p(`<w:moveFrom w:id="2" ${REV}>${run('Moved sentence. ')}</w:moveFrom>${run('Stays.')}`) +
        p(`<w:moveTo w:id="3" ${REV}>${run('Moved sentence.')}</w:moveTo>`),
    );
    const all = out.map(textOf).join('\n');
    expect(all.match(/Moved sentence\./g)).toHaveLength(1);
    expect(all).toContain('Stays.');
  });

  it('drops deletions and keeps insertions', async () => {
    const out = await blocks(
      p(
        `${run('Keep ')}<w:del w:id="4" ${REV}><w:r><w:delText>Gone </w:delText></w:r></w:del><w:ins w:id="5" ${REV}>${run('Added')}</w:ins>`,
      ),
    );
    expect(summary(out)).toEqual([{ type: 'paragraph', text: 'Keep Added' }]);
  });

  it('leaves range markers and documents without revisions untouched', () => {
    const marked = `<w:p><w:moveFromRangeStart w:id="1" w:name="m"/>${run('x')}<w:moveFromRangeEnd w:id="1"/></w:p>`;
    expect(acceptTrackedChangesXml(marked)).toBe(marked);
    const plain = p(run('No revisions'));
    expect(acceptTrackedChangesXml(plain)).toBe(plain);
  });
});
