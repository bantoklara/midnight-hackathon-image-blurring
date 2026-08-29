/**
 * Splits an image into the fixed grid used for hashing, and maps detections
 * onto the set of grid blocks they touch.
 *
 * TODO(vision): implement.
 *
 * Responsibilities:
 *   - Compute the `BlockGrid` for an image at the protocol block size.
 *   - Extract the raw bytes of block i (row-major) for hashing.
 *   - Map a `Detection[]` to the sorted, de-duplicated set of block indices that
 *     any detection overlaps — these are the blocks authorized to change.
 *   - Pack that index set into the compact `authorizationBitmap`.
 *
 * Notes for whoever picks this up:
 *   - THE BLOCK SIZE IS A PROTOCOL CONSTANT. The prover and verifier must split
 *     identically or roots never match. If you change DEFAULT_BLOCK_SIZE you
 *     invalidate every record already on-chain.
 *   - Images whose dimensions are not a multiple of blockSize need a defined
 *     padding rule (pad the last row/column with zero bytes). Pick one, write it
 *     down in README.md, and make the verifier follow it exactly.
 *   - Round detection boxes OUTWARD to block edges. Rounding inward leaves a
 *     sliver of an unredacted face at the block boundary.
 */

import type { BlockGrid, BoundingBox, Detection } from './types.js';

/** Protocol constant. Changing this invalidates all existing on-chain records. */
export const DEFAULT_BLOCK_SIZE = 16;

/** Compute the grid for the given image dimensions. */
export function computeGrid(
  _width: number,
  _height: number,
  _blockSize: number = DEFAULT_BLOCK_SIZE,
): BlockGrid {
  throw new Error('computeGrid: not implemented yet');
}

/** Extract the RGBA bytes of one block, in row-major order, for hashing. */
export function extractBlock(
  _image: ImageData,
  _grid: BlockGrid,
  _blockIndex: number,
): Uint8Array {
  throw new Error('extractBlock: not implemented yet');
}

/** Block indices touched by a box, rounded outward to block edges. */
export function blocksForBox(_grid: BlockGrid, _box: BoundingBox): number[] {
  throw new Error('blocksForBox: not implemented yet');
}

/** Sorted, de-duplicated union of the blocks touched by every detection. */
export function blocksForDetections(
  _grid: BlockGrid,
  _detections: Detection[],
): number[] {
  throw new Error('blocksForDetections: not implemented yet');
}

/** Pack block indices into a bitmap: bit i set means block i may change. */
export function packAuthorizationBitmap(
  _grid: BlockGrid,
  _authorizedBlocks: number[],
): Uint8Array {
  throw new Error('packAuthorizationBitmap: not implemented yet');
}
