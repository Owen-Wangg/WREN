/**
 * Tests asserting re-upload creates a NEW Draft rather than mutating the
 * existing one (task 18.6; Requirement 8.1).
 */
import { describe, expect, it } from 'vitest';

import { MockDraftService } from './mockDraftService';

function makeFile(name: string, contents: string): File {
  return new File([contents], name, { type: 'text/plain' });
}

describe('MockDraftService', () => {
  it('creates a new Draft (distinct id, incremented version) rather than mutating the prior Draft', async () => {
    const service = new MockDraftService();
    const documentId = 'doc-1';

    const firstDraft = await service.createDraft({
      documentId,
      file: makeFile('v1.docx', 'first version text'),
    });
    const secondDraft = await service.createDraft({
      documentId,
      file: makeFile('v2.docx', 'second version text with more words'),
    });

    expect(secondDraft.id).not.toBe(firstDraft.id);
    expect(secondDraft.versionNumber).toBe(firstDraft.versionNumber + 1);

    // The first Draft object itself must be untouched (immutability / no mutation).
    expect(firstDraft.versionNumber).toBe(1);
    expect(firstDraft.s3Key).toContain('v1.docx');
  });

  it('retains all prior Drafts after a re-upload', async () => {
    const service = new MockDraftService();
    const documentId = 'doc-1';

    await service.createDraft({ documentId, file: makeFile('v1.docx', 'one') });
    await service.createDraft({ documentId, file: makeFile('v2.docx', 'two') });

    const drafts = await service.getDrafts(documentId);
    expect(drafts).toHaveLength(2);
    expect(drafts.map((d) => d.versionNumber)).toEqual([1, 2]);
  });

  it('keeps Drafts for different Documents independent', async () => {
    const service = new MockDraftService();

    await service.createDraft({ documentId: 'doc-a', file: makeFile('a.docx', 'a') });
    await service.createDraft({ documentId: 'doc-b', file: makeFile('b.docx', 'b') });

    expect(await service.getDrafts('doc-a')).toHaveLength(1);
    expect(await service.getDrafts('doc-b')).toHaveLength(1);
  });
});
