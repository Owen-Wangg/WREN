/**
 * Grid detection and ruling extraction. End-to-end runs through real pdf.js
 * live in digitalPdfExtract.test.ts (one pdf.js-loading suite per worker).
 */
import { rulingsFromOperatorList } from './digitalPdfExtract';
import { detectRuledTables, type PageRulings } from './pdfRuledTables';

/** Full grid of rulings for the given boundaries. */
function gridRulings(rowYs: number[], colXs: number[]): PageRulings {
  const left = colXs[0]!;
  const right = colXs[colXs.length - 1]!;
  const top = rowYs[0]!;
  const bottom = rowYs[rowYs.length - 1]!;
  return {
    horizontal: rowYs.map((y) => ({ y, x1: left, x2: right })),
    vertical: colXs.map((x) => ({ x, y1: top, y2: bottom })),
  };
}

describe('detectRuledTables', () => {
  it('builds a plain grid from a fully ruled table', () => {
    const [table, ...rest] = detectRuledTables(gridRulings([100, 120, 140], [50, 150, 250, 350]));
    expect(rest).toHaveLength(0);
    expect(table).toMatchObject({ top: 100, bottom: 140, left: 50, right: 350 });
    expect(table!.cells).toHaveLength(6);
    expect(table!.cells.every((c) => c.rowSpan === 1 && c.colSpan === 1)).toBe(true);
  });

  it('merges cells where an interior border is missing', () => {
    const rulings = gridRulings([100, 120, 140], [50, 150, 250]);
    // Header row has no divider between its two columns.
    rulings.vertical = [
      { x: 50, y1: 100, y2: 140 },
      { x: 150, y1: 120, y2: 140 },
      { x: 250, y1: 100, y2: 140 },
    ];
    const [table] = detectRuledTables(rulings);
    expect(table!.cells).toEqual([
      { row: 0, col: 0, rowSpan: 1, colSpan: 2 },
      { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
      { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
    ]);
  });

  it('joins border segments drawn per cell and ignores a lone frame', () => {
    const perCell: PageRulings = {
      horizontal: [
        { y: 100, x1: 50, x2: 150 },
        { y: 100, x1: 150, x2: 250 },
        { y: 130, x1: 50, x2: 150 },
        { y: 130, x1: 150.5, x2: 250 },
        // A separate 1×1 callout box lower down.
        { y: 400, x1: 50, x2: 300 },
        { y: 450, x1: 50, x2: 300 },
      ],
      vertical: [
        { x: 50, y1: 100, y2: 130 },
        { x: 150, y1: 100, y2: 130 },
        { x: 250, y1: 100, y2: 130 },
        { x: 50, y1: 400, y2: 450 },
        { x: 300, y1: 400, y2: 450 },
      ],
    };
    const tables = detectRuledTables(perCell);
    expect(tables).toHaveLength(1);
    expect(tables[0]!.colXs).toEqual([50, 150, 250]);
  });
});

describe('rulingsFromOperatorList', () => {
  const ops = { save: 1, restore: 2, transform: 3, constructPath: 91, stroke: 20, fill: 22 };

  it('reads stroked lines and thin filled rects in top-origin coordinates', () => {
    const rulings = rulingsFromOperatorList(
      {
        fnArray: [91, 91, 91],
        argsArray: [
          // stroke: moveTo(10, 700) lineTo(200, 700)
          [20, [new Float32Array([0, 10, 700, 1, 200, 700])], null],
          // fill: 1pt-wide vertical bar from y=600..700 at x=50
          [22, [new Float32Array([0, 50, 600, 1, 51, 600, 1, 51, 700, 1, 50, 700, 3])], null],
          // fill: large shaded rect → ignored
          [22, [new Float32Array([0, 0, 0, 1, 100, 0, 1, 100, 100, 1, 0, 100, 3])], null],
        ],
      },
      ops,
      792,
    );
    expect(rulings.horizontal).toEqual([{ y: 92, x1: 10, x2: 200 }]);
    expect(rulings.vertical).toEqual([{ x: 50.5, y1: 92, y2: 192 }]);
  });
});
