/**
 * Property-based test: save/reload preserves footnotes exactly
 * (footnote-citation-support spec, Task 8.2).
 *
 * Feature: footnote-citation-support, Property 3: Save/reload preserves footnotes exactly
 *
 * For any valid TipTap document containing footnote nodes, saving it (via
 * `updateCurrentDraftContent` or `insertDraft`) and then reloading it
 * (`getCurrentDraft`) yields a document where every footnote has the same
 * `footnoteNumber`, `content` text, citation field values, and
 * document-order position as before the save.
 *
 * Validates: Requirements 2.2, 2.3, 8.1
 */
import type { Draft, FeedbackItem, Segment, TipTapDoc } from '@wren/types';
import fc from 'fast-check';

import type { DraftRepository, NewDraftInput } from './draftRepository';
import { createDraftRevision, selectCurrentDraft, highestVersionNumber } from './draftVersioning';
import { wrenProperty } from '../../../testing/typescript/property';

const PROPERTY = {
  number: 3,
  text: 'Save/reload preserves footnotes exactly',
};

/** Minimal in-memory DraftRepository (mirrors draftVersioning.test.ts's fake). */
class FakeDraftRepository implements DraftRepository {
  private readonly drafts: Draft[] = [];
  private nextId = 1;

  public async getHighestVersionNumber(documentId: string): Promise<number | null> {
    return highestVersionNumber(this.drafts.filter((d) => d.documentId === documentId));
  }

  public async insertDraft(input: NewDraftInput): Promise<Draft> {
    const draft: Draft = {
      id: `draft_${this.nextId}`,
      documentId: input.documentId,
      versionNumber: input.versionNumber,
      s3Key: input.s3Key,
      segments: input.segments.map((s) => ({ ...s })),
      wordCount: input.wordCount,
      createdAt: new Date(Date.UTC(2025, 0, this.nextId)).toISOString(),
      ...(input.content ? { content: input.content } : {}),
    };
    this.nextId += 1;
    this.drafts.push(draft);
    return draft;
  }

  public async getCurrentDraft(documentId: string): Promise<Draft | null> {
    return selectCurrentDraft(this.drafts.filter((d) => d.documentId === documentId));
  }

  public async updateCurrentDraftContent(
    documentId: string,
    content: TipTapDoc,
    wordCount: number,
  ): Promise<Draft | null> {
    const current = await this.getCurrentDraft(documentId);
    if (!current) return null;
    const updated: Draft = { ...current, content, wordCount };
    const idx = this.drafts.findIndex((d) => d.id === current.id);
    this.drafts[idx] = updated;
    return updated;
  }

  public async listFeedbackItems(_documentId: string): Promise<FeedbackItem[]> {
    return [];
  }
}

const citationFieldArb = fc.string({ minLength: 0, maxLength: 50 });

const footnoteAttrsArb = fc.record({
  footnoteNumber: fc.integer({ min: 1, max: 200 }),
  bodyText: fc.string({ minLength: 0, maxLength: 60 }),
  author: citationFieldArb,
  title: citationFieldArb,
  source: citationFieldArb,
  pinpoint: citationFieldArb,
  year: citationFieldArb,
});

function buildDocWithFootnotes(
  footnotes: ReadonlyArray<{
    footnoteNumber: number;
    bodyText: string;
    author: string;
    title: string;
    source: string;
    pinpoint: string;
    year: string;
  }>,
): TipTapDoc {
  return {
    type: 'doc',
    content: footnotes.map((fn, idx) => ({
      type: 'paragraph',
      content: [
        { type: 'text', text: `Paragraph ${idx}. ` },
        {
          type: 'footnote',
          attrs: {
            footnoteNumber: fn.footnoteNumber,
            content: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: fn.bodyText }] }],
            },
            author: fn.author,
            title: fn.title,
            source: fn.source,
            pinpoint: fn.pinpoint,
            year: fn.year,
          },
        },
      ],
    })),
  } as unknown as TipTapDoc;
}

describe('Property 3: save/reload preserves footnotes exactly', () => {
  it('insertDraft then getCurrentDraft round-trips footnote content exactly', async () => {
    const tag = await wrenProperty(
      PROPERTY,
      fc.asyncProperty(fc.array(footnoteAttrsArb, { minLength: 0, maxLength: 10 }), async (footnotes) => {
        const repo = new FakeDraftRepository();
        const content = buildDocWithFootnotes(footnotes);
        await createDraftRevision(
          { documentId: 'doc_1', segments: [{ index: 0, text: '' }] as Segment[], wordCount: 0, s3Key: 'k', content },
          repo,
        );
        const current = await repo.getCurrentDraft('doc_1');
        return JSON.stringify(current?.content) === JSON.stringify(content);
      }),
      { numRuns: 100 },
    );
    expect(tag).toContain('Property 3');
  });

  it('updateCurrentDraftContent (autosave) then getCurrentDraft round-trips footnote content exactly', async () => {
    await wrenProperty(
      PROPERTY,
      fc.asyncProperty(fc.array(footnoteAttrsArb, { minLength: 0, maxLength: 10 }), async (footnotes) => {
        const repo = new FakeDraftRepository();
        await createDraftRevision(
          { documentId: 'doc_1', segments: [{ index: 0, text: '' }] as Segment[], wordCount: 0, s3Key: 'k' },
          repo,
        );
        const content = buildDocWithFootnotes(footnotes);
        await repo.updateCurrentDraftContent('doc_1', content, 0);
        const current = await repo.getCurrentDraft('doc_1');
        return JSON.stringify(current?.content) === JSON.stringify(content);
      }),
      { numRuns: 100 },
    );
  });
});
