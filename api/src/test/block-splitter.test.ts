import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BLOCK_SIZE,
  blocksForBox,
  blocksForDetections,
  computeGrid,
  extractBlock,
  packAuthorizationBitmap,
  unpackAuthorizationBitmap,
} from '../vision/block-splitter.js';
import type { Detection } from '../vision/types.js';
import { makeImage } from './helpers.js';

describe('computeGrid', () => {
  it('uses the protocol block size by default', () => {
    expect(DEFAULT_BLOCK_SIZE).toBe(16);
    expect(computeGrid(64, 32)).toEqual({ blockSize: 16, cols: 4, rows: 2, blockCount: 8 });
  });

  it('rounds up so partial edge blocks are still covered', () => {
    // 65px wide needs a 5th column holding a single pixel of real data.
    expect(computeGrid(65, 33)).toEqual({ blockSize: 16, cols: 5, rows: 3, blockCount: 15 });
  });

  it('rejects non-positive or non-integer dimensions', () => {
    expect(() => computeGrid(0, 16)).toThrow(/width/);
    expect(() => computeGrid(16, -1)).toThrow(/height/);
    expect(() => computeGrid(16, 16, 0)).toThrow(/blockSize/);
    expect(() => computeGrid(16.5, 16)).toThrow(/width/);
  });
});

describe('extractBlock', () => {
  const grid = computeGrid(32, 32, 16);
  const image = makeImage(32, 32);

  it('always returns a full block, whatever the image dimensions', () => {
    for (let i = 0; i < grid.blockCount; i++) {
      expect(extractBlock(image, grid, i)).toHaveLength(16 * 16 * 4);
    }
  });

  it('extracts the correct pixels for an interior block', () => {
    // Block 1 is the top-right 16x16 quadrant, so its first pixel is image (16, 0).
    const block = extractBlock(image, grid, 1);
    const expectedOffset = (0 * 32 + 16) * 4;
    expect([...block.slice(0, 4)]).toEqual([...image.data.slice(expectedOffset, expectedOffset + 4)]);
  });

  it('zero-pads the right and bottom edges', () => {
    // 20x20 image at blockSize 16 -> 2x2 grid; block 1 has only 4 real columns.
    const small = makeImage(20, 20);
    const smallGrid = computeGrid(20, 20, 16);
    const block = extractBlock(small, smallGrid, 1);

    // First row: 4 real pixels then padding out to 16.
    expect([...block.slice(0, 16)]).toEqual([...small.data.slice(16 * 4, 20 * 4)]);
    expect([...block.slice(16, 64)]).toEqual(new Array(48).fill(0));
    // Rows past the image bottom are entirely padding.
    const bottom = extractBlock(small, smallGrid, 3);
    expect([...bottom.slice(4 * 16 * 4)]).toEqual(new Array(16 * 16 * 4 - 4 * 16 * 4).fill(0));
  });

  it('rejects an out-of-range index', () => {
    expect(() => extractBlock(image, grid, grid.blockCount)).toThrow(/out of range/);
    expect(() => extractBlock(image, grid, -1)).toThrow(/out of range/);
  });
});

describe('blocksForBox', () => {
  const grid = computeGrid(64, 64, 16); // 4x4 grid

  it('maps a box inside one block to that block', () => {
    expect(blocksForBox(grid, { x: 2, y: 2, width: 4, height: 4 })).toEqual([0]);
  });

  it('rounds OUTWARD so no sliver of a face is left unredacted', () => {
    // 15..17 straddles the boundary between block 0 and block 1.
    expect(blocksForBox(grid, { x: 15, y: 0, width: 2, height: 1 })).toEqual([0, 1]);
    // A box ending exactly on a boundary must not pull in the next block.
    expect(blocksForBox(grid, { x: 0, y: 0, width: 16, height: 16 })).toEqual([0]);
    // Fractional coordinates round outward on both sides.
    expect(blocksForBox(grid, { x: 15.9, y: 0, width: 0.2, height: 1 })).toEqual([0, 1]);
  });

  it('covers every block a multi-block box spans', () => {
    // x 0..32, y 0..32 -> the top-left 2x2 quadrant of a 4-wide grid.
    expect(blocksForBox(grid, { x: 0, y: 0, width: 32, height: 32 })).toEqual([0, 1, 4, 5]);
  });

  it('clamps to the grid instead of returning out-of-range indices', () => {
    const blocks = blocksForBox(grid, { x: -50, y: -50, width: 500, height: 500 });
    expect(blocks).toHaveLength(grid.blockCount);
    expect(Math.max(...blocks)).toBe(grid.blockCount - 1);
    expect(Math.min(...blocks)).toBe(0);
  });

  it('returns nothing for an empty box or one entirely off-image', () => {
    expect(blocksForBox(grid, { x: 0, y: 0, width: 0, height: 10 })).toEqual([]);
    expect(blocksForBox(grid, { x: 0, y: 0, width: 10, height: 0 })).toEqual([]);
    expect(blocksForBox(grid, { x: -100, y: 0, width: 50, height: 10 })).toEqual([]);
  });
});

describe('blocksForDetections', () => {
  const grid = computeGrid(64, 64, 16);
  const detection = (x: number, y: number, width: number, height: number): Detection => ({
    kind: 'face',
    confidence: 0.9,
    box: { x, y, width, height },
  });

  it('returns the sorted, de-duplicated union of overlapping detections', () => {
    const blocks = blocksForDetections(grid, [
      detection(0, 0, 32, 16),   // blocks 0, 1
      detection(16, 0, 32, 16),  // blocks 1, 2  -> 1 overlaps
      detection(48, 48, 8, 8),   // block 15
    ]);
    expect(blocks).toEqual([0, 1, 2, 15]);
  });

  it('returns nothing when there are no detections', () => {
    expect(blocksForDetections(grid, [])).toEqual([]);
  });
});

describe('authorization bitmap', () => {
  const grid = computeGrid(64, 64, 16); // 16 blocks -> 2 bytes

  it('packs LSB-first within each byte', () => {
    expect([...packAuthorizationBitmap(grid, [0])]).toEqual([0b0000_0001, 0]);
    expect([...packAuthorizationBitmap(grid, [7])]).toEqual([0b1000_0000, 0]);
    expect([...packAuthorizationBitmap(grid, [8])]).toEqual([0, 0b0000_0001]);
  });

  it('is exactly ceil(blockCount / 8) bytes', () => {
    expect(packAuthorizationBitmap(grid, [])).toHaveLength(2);
    expect(packAuthorizationBitmap(computeGrid(17, 17, 16), [])).toHaveLength(1); // 4 blocks
  });

  it('round-trips through unpack — this is what a verifier runs', () => {
    const authorized = [0, 3, 8, 15];
    expect(unpackAuthorizationBitmap(grid, packAuthorizationBitmap(grid, authorized))).toEqual(authorized);
  });

  it('rejects out-of-range indices and wrong-length bitmaps', () => {
    expect(() => packAuthorizationBitmap(grid, [16])).toThrow(/out of range/);
    expect(() => unpackAuthorizationBitmap(grid, new Uint8Array(3))).toThrow(/expected 2 bytes/);
  });
});
