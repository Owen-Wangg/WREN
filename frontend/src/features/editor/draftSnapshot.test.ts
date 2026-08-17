import { describe, expect, it } from 'vitest';

import {
  editorContentDiffersFromPersisted,
  segmentsNeedEngineSnapshot,
} from './draftSnapshot';

describe('segmentsNeedEngineSnapshot', () => {
  const segments = [
    { index: 0, text: 'First paragraph.' },
    { index: 1, text: 'Second paragraph.' },
  ];

  it('is true when no persisted segments exist', () => {
    expect(segmentsNeedEngineSnapshot(segments, undefined)).toBe(true);
    expect(segmentsNeedEngineSnapshot(segments, null)).toBe(true);
  });

  it('is false when persisted segments match the editor', () => {
    expect(segmentsNeedEngineSnapshot(segments, [...segments])).toBe(false);
  });

  it('is true when paragraph text drifted after a content-only autosave', () => {
    const stale = [
      { index: 0, text: 'First paragraph.' },
      { index: 1, text: 'Old second paragraph.' },
    ];
    expect(segmentsNeedEngineSnapshot(segments, stale)).toBe(true);
  });
});

describe('editorContentDiffersFromPersisted', () => {
  it('is true when either side is missing', () => {
    expect(editorContentDiffersFromPersisted('{}', null)).toBe(true);
    expect(editorContentDiffersFromPersisted(null, '{}')).toBe(true);
  });

  it('is false when JSON matches', () => {
    expect(editorContentDiffersFromPersisted('{"a":1}', '{"a":1}')).toBe(false);
  });
});
