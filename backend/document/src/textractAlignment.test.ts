import type { Block } from '@aws-sdk/client-textract';

import { inferAlignment, type PageMetrics } from './textractAlignment';

function makeLine(left: number, width: number): Block {
  return {
    BlockType: 'LINE',
    Id: 'line-1',
    Text: 'test',
    Geometry: {
      BoundingBox: { Left: left, Width: width, Height: 0.02, Top: 0.1 },
      Polygon: [],
    },
  };
}

function metrics(): PageMetrics {
  return {
    pageNumber: 1,
    medianLineHeight: 0.02,
    medianWordWidth: 0.05,
    medianWordHeight: 0.015,
    baselineLeft: 0.1,
    contentBounds: { left: 0.1, right: 0.9, width: 0.8 },
    indentStep: 0.04,
    lineCount: 20,
  };
}

describe('inferAlignment', () => {
  it('does not treat a full-width left-aligned body line as centered', () => {
    // Equal ~0 margins — the old 4% rule called this center.
    const result = inferAlignment(makeLine(0.1, 0.8), metrics());
    expect(result.textAlign).toBeUndefined();
  });

  it('centers a short title with matching left and right margins', () => {
    // "Facts" style heading: ~0.35 left/right of an 0.8 content box.
    const result = inferAlignment(makeLine(0.35, 0.3), metrics());
    expect(result.textAlign).toBe('center');
  });

  it('leaves a short last line of a left-aligned paragraph as left', () => {
    const result = inferAlignment(makeLine(0.1, 0.28), metrics());
    expect(result.textAlign).toBeUndefined();
  });
});
