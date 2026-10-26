/**
 * Detect ruled (bordered) tables from the line segments a digital PDF draws.
 *
 * Word / LaTeX / most report generators draw table borders as stroked lines or
 * thin filled rectangles. Those rulings give exact row and column boundaries,
 * which is far more reliable than inferring columns from text gaps: empty
 * cells, wrapped cell text and tight column spacing all survive. Merged cells
 * are recovered from missing interior borders.
 *
 * Coordinates are top-origin page units, matching `SpatialTextItem`.
 */

/** Horizontal ruling: constant `y`, spanning `x1..x2`. */
export interface HorizontalRuling {
  y: number;
  x1: number;
  x2: number;
}

/** Vertical ruling: constant `x`, spanning `y1..y2`. */
export interface VerticalRuling {
  x: number;
  y1: number;
  y2: number;
}

export interface PageRulings {
  horizontal: HorizontalRuling[];
  vertical: VerticalRuling[];
}

/** One grid cell; spans > 1 for merged cells. Indices are 0-based. */
export interface RuledCell {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
}

export interface RuledTable {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Row boundaries, top to bottom (`rowYs.length - 1` rows). */
  rowYs: number[];
  /** Column boundaries, left to right (`colXs.length - 1` columns). */
  colXs: number[];
  cells: RuledCell[];
}

/** Snap / intersection tolerance in page units (points). */
const RULING_TOLERANCE = 2;
/** Ignore specks shorter than this. */
const MIN_RULING_LENGTH = 4;
/** Minimum row / column band size so double borders do not create sliver rows. */
const MIN_BAND = 4;

function mergeHorizontal(segs: HorizontalRuling[]): HorizontalRuling[] {
  const sorted = segs
    .filter((s) => s.x2 - s.x1 >= MIN_RULING_LENGTH)
    .sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const out: HorizontalRuling[] = [];
  for (const seg of sorted) {
    const prev = out.find(
      (o) =>
        Math.abs(o.y - seg.y) <= RULING_TOLERANCE &&
        seg.x1 <= o.x2 + RULING_TOLERANCE &&
        seg.x2 >= o.x1 - RULING_TOLERANCE,
    );
    if (prev) {
      prev.x1 = Math.min(prev.x1, seg.x1);
      prev.x2 = Math.max(prev.x2, seg.x2);
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

function mergeVertical(segs: VerticalRuling[]): VerticalRuling[] {
  const sorted = segs
    .filter((s) => s.y2 - s.y1 >= MIN_RULING_LENGTH)
    .sort((a, b) => a.x - b.x || a.y1 - b.y1);
  const out: VerticalRuling[] = [];
  for (const seg of sorted) {
    const prev = out.find(
      (o) =>
        Math.abs(o.x - seg.x) <= RULING_TOLERANCE &&
        seg.y1 <= o.y2 + RULING_TOLERANCE &&
        seg.y2 >= o.y1 - RULING_TOLERANCE,
    );
    if (prev) {
      prev.y1 = Math.min(prev.y1, seg.y1);
      prev.y2 = Math.max(prev.y2, seg.y2);
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

function intersects(h: HorizontalRuling, v: VerticalRuling): boolean {
  return (
    v.x >= h.x1 - RULING_TOLERANCE &&
    v.x <= h.x2 + RULING_TOLERANCE &&
    h.y >= v.y1 - RULING_TOLERANCE &&
    h.y <= v.y2 + RULING_TOLERANCE
  );
}

function makeUnionFind(n: number): { find(i: number): number; union(a: number, b: number): void } {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  return {
    find,
    union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    },
  };
}

/** Collapse near-equal positions; drops bands thinner than {@link MIN_BAND}. */
function boundaries(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || v - last > MIN_BAND) out.push(v);
  }
  return out;
}

function hasVerticalBorder(
  verticals: VerticalRuling[],
  x: number,
  yTop: number,
  yBottom: number,
): boolean {
  const mid = (yTop + yBottom) / 2;
  return verticals.some(
    (v) =>
      Math.abs(v.x - x) <= RULING_TOLERANCE + MIN_BAND / 2 &&
      v.y1 <= mid + RULING_TOLERANCE &&
      v.y2 >= mid - RULING_TOLERANCE,
  );
}

function hasHorizontalBorder(
  horizontals: HorizontalRuling[],
  y: number,
  xLeft: number,
  xRight: number,
): boolean {
  const mid = (xLeft + xRight) / 2;
  return horizontals.some(
    (h) =>
      Math.abs(h.y - y) <= RULING_TOLERANCE + MIN_BAND / 2 &&
      h.x1 <= mid + RULING_TOLERANCE &&
      h.x2 >= mid - RULING_TOLERANCE,
  );
}

/**
 * Build cells for a grid, merging neighbours with no border between them.
 * Falls back to a plain grid when the merged regions are not rectangular
 * (broken or partial borders), so text is never mis-assigned to a ragged cell.
 */
function gridCells(
  rowYs: number[],
  colXs: number[],
  horizontals: HorizontalRuling[],
  verticals: VerticalRuling[],
): RuledCell[] {
  const rows = rowYs.length - 1;
  const cols = colXs.length - 1;
  const idx = (r: number, c: number) => r * cols + c;
  const uf = makeUnionFind(rows * cols);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && !hasVerticalBorder(verticals, colXs[c + 1]!, rowYs[r]!, rowYs[r + 1]!)) {
        uf.union(idx(r, c), idx(r, c + 1));
      }
      if (
        r + 1 < rows &&
        !hasHorizontalBorder(horizontals, rowYs[r + 1]!, colXs[c]!, colXs[c + 1]!)
      ) {
        uf.union(idx(r, c), idx(r + 1, c));
      }
    }
  }

  const regions = new Map<number, { r0: number; r1: number; c0: number; c1: number; n: number }>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const root = uf.find(idx(r, c));
      const reg = regions.get(root);
      if (!reg) {
        regions.set(root, { r0: r, r1: r, c0: c, c1: c, n: 1 });
      } else {
        reg.r0 = Math.min(reg.r0, r);
        reg.r1 = Math.max(reg.r1, r);
        reg.c0 = Math.min(reg.c0, c);
        reg.c1 = Math.max(reg.c1, c);
        reg.n += 1;
      }
    }
  }

  const merged: RuledCell[] = [];
  for (const reg of regions.values()) {
    const rowSpan = reg.r1 - reg.r0 + 1;
    const colSpan = reg.c1 - reg.c0 + 1;
    if (rowSpan * colSpan !== reg.n) {
      // Ragged region: ignore merges entirely.
      const plain: RuledCell[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) plain.push({ row: r, col: c, rowSpan: 1, colSpan: 1 });
      }
      return plain;
    }
    merged.push({ row: reg.r0, col: reg.c0, rowSpan, colSpan });
  }
  return merged.sort((a, b) => a.row - b.row || a.col - b.col);
}

/**
 * Find ruled tables on a page: connected groups of horizontal + vertical
 * rulings that form at least a 2-cell grid. A lone box (1×1) is a frame or
 * callout, not a table, and is ignored.
 */
export function detectRuledTables(rulings: PageRulings | undefined): RuledTable[] {
  if (!rulings) return [];
  const horizontals = mergeHorizontal(rulings.horizontal);
  const verticals = mergeVertical(rulings.vertical);
  if (horizontals.length < 2 || verticals.length < 2) return [];

  const n = horizontals.length + verticals.length;
  const uf = makeUnionFind(n);
  horizontals.forEach((h, hi) => {
    verticals.forEach((v, vi) => {
      if (intersects(h, v)) uf.union(hi, horizontals.length + vi);
    });
  });

  const groups = new Map<number, { h: HorizontalRuling[]; v: VerticalRuling[] }>();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, { h: [], v: [] });
    const g = groups.get(root)!;
    if (i < horizontals.length) g.h.push(horizontals[i]!);
    else g.v.push(verticals[i - horizontals.length]!);
  }

  const tables: RuledTable[] = [];
  for (const g of groups.values()) {
    if (g.h.length < 2 || g.v.length < 2) continue;
    const rowYs = boundaries(g.h.map((h) => h.y));
    const colXs = boundaries(g.v.map((v) => v.x));
    if (rowYs.length < 2 || colXs.length < 2) continue;
    if ((rowYs.length - 1) * (colXs.length - 1) < 2) continue;
    tables.push({
      top: rowYs[0]!,
      bottom: rowYs[rowYs.length - 1]!,
      left: colXs[0]!,
      right: colXs[colXs.length - 1]!,
      rowYs,
      colXs,
      cells: gridCells(rowYs, colXs, g.h, g.v),
    });
  }
  return tables.sort((a, b) => a.top - b.top || a.left - b.left);
}

/** Index of the band in `edges` containing `value`, or -1 when outside. */
export function bandIndex(edges: readonly number[], value: number): number {
  for (let i = 0; i + 1 < edges.length; i++) {
    if (value >= edges[i]! - RULING_TOLERANCE && value <= edges[i + 1]! + RULING_TOLERANCE) {
      return i;
    }
  }
  return -1;
}

/** Cell (origin) containing grid band `row`, `col`, honouring spans. */
export function cellAt(table: RuledTable, row: number, col: number): RuledCell | undefined {
  return table.cells.find(
    (c) => row >= c.row && row < c.row + c.rowSpan && col >= c.col && col < c.col + c.colSpan,
  );
}
