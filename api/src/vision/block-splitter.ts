/**
 * Splits an image into the fixed grid used for hashing, and maps detections
 * onto the set of grid blocks they touch.
 *
 * THE BLOCK SIZE IS A PROTOCOL CONSTANT. The prover and verifier must split
 * identically or roots never match. Changing DEFAULT_BLOCK_SIZE invalidates every
 * record already on-chain.
 *
 * PADDING RULE (must be mirrored by any verifier): when the image dimensions are
 * not a multiple of blockSize, the last column/row of blocks is zero-padded out to
 * a full blockSize x blockSize RGBA buffer. Padding bytes are 0x00, including alpha.
 *
 * ROUNDING RULE: detection boxes round OUTWARD to block edges. Rounding inward
 * would leave a sliver of an unredacted face at the block boundary.
 */

import type { BlockGrid, BoundingBox, Detection, RgbaImage } from './types.js';

/** Protocol constant. Changing this invalidates all existing on-chain records. */
export const DEFAULT_BLOCK_SIZE = 16;

/** Compute the grid for the given image dimensions. */
export function computeGrid(
  width: number,
  height: number,
  blockSize: number = DEFAULT_BLOCK_SIZE,
): BlockGrid {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`computeGrid: width must be a positive integer, got ${width}`);
  }
  if (!Number.isInteger(height) || height <= 0) {
    throw new Error(`computeGrid: height must be a positive integer, got ${height}`);
  }
  if (!Number.isInteger(blockSize) || blockSize <= 0) {
    throw new Error(`computeGrid: blockSize must be a positive integer, got ${blockSize}`);
  }

  const cols = Math.ceil(width / blockSize);
  const rows = Math.ceil(height / blockSize);
  return { blockSize, cols, rows, blockCount: cols * rows };
}

/**
 * Extract the RGBA bytes of one block, in row-major order, for hashing.
 * Always returns exactly blockSize * blockSize * 4 bytes, zero-padded at the
 * right and bottom edges per the padding rule above.
 */
export function extractBlock(
  image: RgbaImage,
  grid: BlockGrid,
  blockIndex: number,
): Uint8Array {
  assertBlockIndex(grid, blockIndex);

  const { blockSize, cols } = grid;
  const originX = (blockIndex % cols) * blockSize;
  const originY = Math.floor(blockIndex / cols) * blockSize;

  // Zero-filled, so any row/column past the image edge is left as padding.
  const out = new Uint8Array(blockSize * blockSize * 4);
  const copyablePixels = Math.min(blockSize, image.width - originX);
  if (copyablePixels <= 0) return out;

  for (let row = 0; row < blockSize; row++) {
    const sourceY = originY + row;
    if (sourceY >= image.height) break;
    const sourceStart = (sourceY * image.width + originX) * 4;
    out.set(
      image.data.subarray(sourceStart, sourceStart + copyablePixels * 4),
      row * blockSize * 4,
    );
  }
  return out;
}

/**
 * Block indices touched by a box, rounded outward to block edges.
 * Returns [] for an empty box or one entirely outside the image.
 */
export function blocksForBox(grid: BlockGrid, box: BoundingBox): number[] {
  const { blockSize, cols, rows } = grid;
  if (!(box.width > 0) || !(box.height > 0)) return [];

  // Half-open pixel span [left, right), rounded outward to whole pixels.
  const left = Math.floor(box.x);
  const top = Math.floor(box.y);
  const right = Math.ceil(box.x + box.width);
  const bottom = Math.ceil(box.y + box.height);
  if (right <= 0 || bottom <= 0) return [];

  const firstCol = Math.max(0, Math.floor(left / blockSize));
  const firstRow = Math.max(0, Math.floor(top / blockSize));
  const lastCol = Math.min(cols - 1, Math.ceil(right / blockSize) - 1);
  const lastRow = Math.min(rows - 1, Math.ceil(bottom / blockSize) - 1);
  if (lastCol < firstCol || lastRow < firstRow) return [];

  const indices: number[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      indices.push(row * cols + col);
    }
  }
  return indices;
}

/** Sorted, de-duplicated union of the blocks touched by every detection. */
export function blocksForDetections(
  grid: BlockGrid,
  detections: Detection[],
): number[] {
  const seen = new Set<number>();
  for (const detection of detections) {
    for (const index of blocksForBox(grid, detection.box)) seen.add(index);
  }
  return [...seen].sort((a, b) => a - b);
}

/**
 * Pack block indices into a bitmap: bit i set means block i may change.
 * Bit order is LSB-first within each byte — block i lives at
 * `bitmap[i >> 3] & (1 << (i & 7))`. A verifier MUST use the same order.
 */
export function packAuthorizationBitmap(
  grid: BlockGrid,
  authorizedBlocks: number[],
): Uint8Array {
  const bitmap = new Uint8Array(Math.ceil(grid.blockCount / 8));
  for (const index of authorizedBlocks) {
    assertBlockIndex(grid, index);
    bitmap[index >> 3] |= 1 << (index & 7);
  }
  return bitmap;
}

/** Inverse of packAuthorizationBitmap — what a verifier runs on the published bitmap. */
export function unpackAuthorizationBitmap(
  grid: BlockGrid,
  bitmap: Uint8Array,
): number[] {
  const expectedLength = Math.ceil(grid.blockCount / 8);
  if (bitmap.length !== expectedLength) {
    throw new Error(
      `unpackAuthorizationBitmap: expected ${expectedLength} bytes for ${grid.blockCount} blocks, got ${bitmap.length}`,
    );
  }
  const indices: number[] = [];
  for (let index = 0; index < grid.blockCount; index++) {
    if ((bitmap[index >> 3]! & (1 << (index & 7))) !== 0) indices.push(index);
  }
  return indices;
}

function assertBlockIndex(grid: BlockGrid, blockIndex: number): void {
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= grid.blockCount) {
    throw new Error(
      `block index ${blockIndex} is out of range for a ${grid.cols}x${grid.rows} grid (${grid.blockCount} blocks)`,
    );
  }
}
