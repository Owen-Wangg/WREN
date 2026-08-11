/**
 * Textract Block Indexer — efficient lookup and relationship traversal utilities.
 *
 * Provides:
 * - Map<Id, Block> lookup for all blocks
 * - WORD blocks per LINE via relationship links
 * - CELL blocks per TABLE
 * - Generic helper to retrieve child blocks by relationship type
 */
import type { Block } from '@aws-sdk/client-textract';

/**
 * Pre-computed block index for efficient lookups and relationship traversal.
 */
export interface BlockIndex {
  /** All blocks keyed by their Id. */
  readonly byId: ReadonlyMap<string, Block>;

  /** WORD blocks for each LINE block Id (via CHILD relationship). */
  readonly wordsPerLine: ReadonlyMap<string, Block[]>;

  /** CELL blocks for each TABLE block Id (via CHILD relationship). */
  readonly cellsPerTable: ReadonlyMap<string, Block[]>;
}

/**
 * Retrieve Ids from a block's Relationships array filtered by relationship type.
 *
 * Textract blocks have a `Relationships` array where each entry has a `Type`
 * (e.g. "CHILD", "MERGED_CELL", "ANSWER") and an `Ids` array of referenced block Ids.
 */
export function getRelationshipIds(
  block: Block,
  relationshipType: string,
): string[] {
  const ids: string[] = [];
  for (const rel of block.Relationships ?? []) {
    if (rel.Type === relationshipType && rel.Ids?.length) {
      ids.push(...rel.Ids);
    }
  }
  return ids;
}

/**
 * Retrieve child blocks (CHILD relationship) from the given block,
 * resolved against the block-by-Id map.
 */
export function getChildBlocks(
  block: Block,
  byId: ReadonlyMap<string, Block>,
): Block[] {
  const childIds = getRelationshipIds(block, 'CHILD');
  const children: Block[] = [];
  for (const id of childIds) {
    const child = byId.get(id);
    if (child) children.push(child);
  }
  return children;
}

/**
 * Retrieve child blocks filtered to a specific BlockType.
 */
export function getChildBlocksByType(
  block: Block,
  byId: ReadonlyMap<string, Block>,
  blockType: string,
): Block[] {
  return getChildBlocks(block, byId).filter((b) => b.BlockType === blockType);
}

/**
 * Retrieve blocks by a specific relationship type (e.g. "CHILD", "MERGED_CELL"),
 * resolved against the block-by-Id map.
 */
export function getBlocksByRelationship(
  block: Block,
  byId: ReadonlyMap<string, Block>,
  relationshipType: string,
): Block[] {
  const ids = getRelationshipIds(block, relationshipType);
  const resolved: Block[] = [];
  for (const id of ids) {
    const child = byId.get(id);
    if (child) resolved.push(child);
  }
  return resolved;
}

/**
 * Build a comprehensive block index from a Textract block array.
 *
 * Indexes:
 * - All blocks by Id
 * - WORD children per LINE block (for inline formatting inference)
 * - CELL children per TABLE block (for table formatting)
 */
export function buildBlockIndex(blocks: readonly Block[]): BlockIndex {
  const byId = new Map<string, Block>();
  for (const block of blocks) {
    if (block.Id) {
      byId.set(block.Id, block);
    }
  }

  const wordsPerLine = new Map<string, Block[]>();
  const cellsPerTable = new Map<string, Block[]>();

  for (const block of blocks) {
    if (!block.Id) continue;

    if (block.BlockType === 'LINE') {
      const wordIds = getRelationshipIds(block, 'CHILD');
      const words: Block[] = [];
      for (const id of wordIds) {
        const child = byId.get(id);
        if (child && child.BlockType === 'WORD') {
          words.push(child);
        }
      }
      wordsPerLine.set(block.Id, words);
    }

    if (block.BlockType === 'TABLE') {
      const childIds = getRelationshipIds(block, 'CHILD');
      const cells: Block[] = [];
      for (const id of childIds) {
        const child = byId.get(id);
        if (
          child &&
          (child.BlockType === 'CELL' || child.BlockType === 'MERGED_CELL')
        ) {
          cells.push(child);
        }
      }
      cellsPerTable.set(block.Id, cells);
    }
  }

  return { byId, wordsPerLine, cellsPerTable };
}
