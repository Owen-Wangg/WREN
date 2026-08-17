import { describe, expect, it } from 'vitest';

import { feedbackPath, isUsableDraftId } from './debriefApi';

describe('isUsableDraftId', () => {
  it('rejects the empty-debrief sentinel', () => {
    expect(isUsableDraftId('none')).toBe(false);
    expect(isUsableDraftId('NONE')).toBe(false);
    expect(isUsableDraftId('')).toBe(false);
    expect(isUsableDraftId(null)).toBe(false);
    expect(isUsableDraftId(undefined)).toBe(false);
  });

  it('accepts a real draft id', () => {
    expect(isUsableDraftId('536a86c8-953a-4749-8ecf-e359951d6f92')).toBe(true);
  });
});

describe('feedbackPath', () => {
  it('omits draftId=none so Postgres never sees a non-uuid', () => {
    expect(feedbackPath('doc-1', 'none')).toBe('/v1/documents/doc-1/feedback');
    expect(feedbackPath('doc-1')).toBe('/v1/documents/doc-1/feedback');
  });

  it('includes a real draft id', () => {
    const draftId = '536a86c8-953a-4749-8ecf-e359951d6f92';
    expect(feedbackPath('doc-1', draftId)).toBe(
      `/v1/documents/doc-1/feedback?draftId=${draftId}`,
    );
  });
});
