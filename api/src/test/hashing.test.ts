import { describe, it, expect } from 'vitest';
import { computeGrid, extractBlock, packAuthorizationBitmap } from '../vision/block-splitter.js';
import {
  LANE_COUNT,
  computeAuthorizationCommitment,
  computeLaneDigests,
  computePreservedRoot,
  foldLaneDigests,
  hashBlock,
} from '../vision/hashing.js';
import { applyRedaction } from '../vision/redaction.js';
import { redactImage } from '../vision/index.js';
import type { Detection } from '../vision/types.js';
import { hex, makeImage, tamperPixel } from './helpers.js';

const GRID = computeGrid(64, 64, 16); // 4x4 = 16 blocks
const IMAGE = makeImage(64, 64);

/** Blocks 0 and 1 are "redacted"; everything else must stay pixel-identical. */
const AUTHORIZED = [0, 1];

describe('hashBlock', () => {
  it('binds the block index, so identical bytes at different indices differ', async () => {
    const bytes = new Uint8Array(16 * 16 * 4).fill(0x42);
    const atZero = await hashBlock(GRID, 0, bytes);
    const atOne = await hashBlock(GRID, 1, bytes);
    expect(hex(atZero)).not.toBe(hex(atOne));
  });

  it('binds the grid dimensions, so the same block in a different grid differs', async () => {
    const bytes = new Uint8Array(16 * 16 * 4).fill(0x42);
    const wide = await hashBlock(computeGrid(64, 64, 16), 0, bytes);
    const coarse = await hashBlock(computeGrid(64, 64, 32), 0, bytes);
    expect(hex(wide)).not.toBe(hex(coarse));
  });

  it('returns 32 bytes', async () => {
    expect(await hashBlock(GRID, 0, new Uint8Array(1024))).toHaveLength(32);
  });
});

describe('computeLaneDigests', () => {
  it('always produces exactly LANE_COUNT 32-byte digests', async () => {
    const lanes = await computeLaneDigests(IMAGE, GRID, AUTHORIZED);
    expect(lanes).toHaveLength(LANE_COUNT);
    for (const lane of lanes) expect(lane).toHaveLength(32);
  });

  it('is constant-width regardless of image size — this is what bounds the circuit', async () => {
    const big = makeImage(320, 320, 7);
    const bigGrid = computeGrid(320, 320, 16); // 400 blocks
    expect(await computeLaneDigests(big, bigGrid, [])).toHaveLength(LANE_COUNT);
  });

  it('rejects an image that does not match the grid', async () => {
    await expect(computeLaneDigests(IMAGE, computeGrid(128, 128, 16), [])).rejects.toThrow(/does not match/);
  });
});

describe('foldLaneDigests', () => {
  it('rejects the wrong number of lanes or a wrong-sized lane', async () => {
    await expect(foldLaneDigests([])).rejects.toThrow(/expected 16 lanes/);
    const lanes = Array.from({ length: LANE_COUNT }, () => new Uint8Array(32));
    lanes[3] = new Uint8Array(31);
    await expect(foldLaneDigests(lanes)).rejects.toThrow(/lane 3 must be 32 bytes/);
  });
});

describe('computePreservedRoot', () => {
  it('is deterministic', async () => {
    const first = await computePreservedRoot(IMAGE, GRID, AUTHORIZED);
    const second = await computePreservedRoot(IMAGE, GRID, AUTHORIZED);
    expect(hex(first)).toBe(hex(second));
    expect(first).toHaveLength(32);
  });

  it('TAMPERING: changing one byte of a NON-authorized block changes the root', async () => {
    const clean = await computePreservedRoot(IMAGE, GRID, AUTHORIZED);
    // Block 5 is not authorized. Its top-left pixel is at (16, 16).
    const tampered = tamperPixel(IMAGE, 16, 16);
    const after = await computePreservedRoot(tampered, GRID, AUTHORIZED);
    expect(hex(after)).not.toBe(hex(clean));
  });

  it('changing an AUTHORIZED block does NOT change the root — redaction is allowed', async () => {
    const clean = await computePreservedRoot(IMAGE, GRID, AUTHORIZED);
    // Block 0 is authorized. Its top-left pixel is at (0, 0).
    const redacted = tamperPixel(IMAGE, 0, 0);
    const after = await computePreservedRoot(redacted, GRID, AUTHORIZED);
    expect(hex(after)).toBe(hex(clean));
  });

  it('detects a permutation of two identical-looking blocks', async () => {
    // Two flat blocks with the same colour, swapped, must still change the root
    // because the index is bound into each leaf.
    const flat = makeImage(32, 16, 3);
    const grid = computeGrid(32, 16, 16); // 2 blocks side by side
    for (let i = 0; i < flat.data.length; i++) flat.data[i] = i % 2 === 0 ? 10 : 200;

    const rootA = await computePreservedRoot(flat, grid, []);
    // Give block 1 different content, then swap the two blocks' contents.
    const swapped = { ...flat, data: new Uint8ClampedArray(flat.data) };
    const b0 = extractBlock(flat, grid, 0);
    const b1 = extractBlock(flat, grid, 1);
    expect(hex(b0)).toBe(hex(b1)); // identical content by construction
    const rootB = await computePreservedRoot(swapped, grid, []);
    // Identical content -> identical root, but the LEAVES must still differ.
    expect(hex(rootB)).toBe(hex(rootA));
    expect(hex(await hashBlock(grid, 0, b0))).not.toBe(hex(await hashBlock(grid, 1, b1)));
  });

  it('changing the grid changes the root even for identical pixels', async () => {
    const fine = await computePreservedRoot(IMAGE, computeGrid(64, 64, 16), []);
    const coarse = await computePreservedRoot(IMAGE, computeGrid(64, 64, 32), []);
    expect(hex(fine)).not.toBe(hex(coarse));
  });
});

describe('computeAuthorizationCommitment', () => {
  it('changes when the bitmap changes', async () => {
    const a = await computeAuthorizationCommitment(GRID, packAuthorizationBitmap(GRID, [0, 1]));
    const b = await computeAuthorizationCommitment(GRID, packAuthorizationBitmap(GRID, [0, 2]));
    expect(hex(a)).not.toBe(hex(b));
    expect(a).toHaveLength(32);
  });

  it('binds the grid shape, so the same bitmap bytes in a different layout differ', async () => {
    // Both grids hold 16 blocks (so the same 2-byte bitmap), but 4x4 and 2x8 are
    // different images. The commitment must tell them apart.
    const square = computeGrid(64, 64, 16); // 4 cols x 4 rows
    const tall = computeGrid(32, 128, 16);  // 2 cols x 8 rows
    expect(square.blockCount).toBe(tall.blockCount);

    const bitmap = packAuthorizationBitmap(square, [0]);
    expect(hex(await computeAuthorizationCommitment(square, bitmap)))
      .not.toBe(hex(await computeAuthorizationCommitment(tall, bitmap)));
  });
});

describe('applyRedaction', () => {
  it('blacks out authorized blocks and leaves every other byte identical', () => {
    const out = applyRedaction(IMAGE, GRID, AUTHORIZED, { style: 'blackout' });

    // Authorized block 0: opaque black.
    expect([...out.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    // Non-authorized block 4 starts at (0, 16) — untouched.
    const offset = (16 * 64 + 0) * 4;
    expect([...out.data.slice(offset, offset + 4)]).toEqual([...IMAGE.data.slice(offset, offset + 4)]);
  });

  it('does not mutate the input image', () => {
    const before = hex(new Uint8Array(IMAGE.data));
    applyRedaction(IMAGE, GRID, AUTHORIZED);
    expect(hex(new Uint8Array(IMAGE.data))).toBe(before);
  });

  it('preserves the root — every changed byte is inside an authorized block', async () => {
    const before = await computePreservedRoot(IMAGE, GRID, AUTHORIZED);
    const out = applyRedaction(IMAGE, GRID, AUTHORIZED);
    expect(hex(await computePreservedRoot(out, GRID, AUTHORIZED))).toBe(hex(before));
  });

  it('handles partial edge blocks without writing out of bounds', () => {
    const small = makeImage(20, 20);
    const grid = computeGrid(20, 20, 16);
    const out = applyRedaction(small, grid, [0, 1, 2, 3]);
    expect(out.data).toHaveLength(20 * 20 * 4);
    expect([...out.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  it('rejects an out-of-range block index', () => {
    expect(() => applyRedaction(IMAGE, GRID, [999])).toThrow(/out of range/);
  });
});

describe('redactImage', () => {
  const faces: Detection[] = [
    { kind: 'face', confidence: 0.99, box: { x: 0, y: 0, width: 20, height: 12 } },
  ];

  it('produces a consistent plan whose root the circuit can verify', async () => {
    const result = await redactImage(IMAGE, { manualDetections: faces, blockSize: 16 });

    // The face spans x 0..20, so it covers blocks 0 and 1 (outward rounding).
    expect(result.plan.authorizedBlocks).toEqual([0, 1]);
    expect(result.plan.grid).toEqual(GRID);
    expect(result.plan.preservedRoot).toHaveLength(32);
    expect(result.plan.authorizationCommitment).toHaveLength(32);
    expect(result.plan.laneDigests).toHaveLength(LANE_COUNT);
    expect(result.originalLaneDigests).toHaveLength(LANE_COUNT);

    // The published and original roots agree — this is what submit_redaction asserts.
    expect(hex(await foldLaneDigests(result.plan.laneDigests)))
      .toBe(hex(await foldLaneDigests(result.originalLaneDigests)));

    // And the redacted image really is blacked out.
    expect([...result.redactedImage.data.slice(0, 4)]).toEqual([0, 0, 0, 255]);
  });

  it('redacts nothing when there are no detections, and still yields a root', async () => {
    const result = await redactImage(IMAGE, { manualDetections: [], blockSize: 16 });
    expect(result.plan.authorizedBlocks).toEqual([]);
    expect(hex(new Uint8Array(result.redactedImage.data))).toBe(hex(new Uint8Array(IMAGE.data)));
    expect(hex(result.plan.preservedRoot)).toBe(hex(await computePreservedRoot(IMAGE, GRID, [])));
  });

  it('a verifier recomputing from the published image gets the stored root', async () => {
    const result = await redactImage(IMAGE, { manualDetections: faces, blockSize: 16 });
    const recomputed = await computePreservedRoot(
      result.redactedImage,
      result.plan.grid,
      result.plan.authorizedBlocks,
    );
    expect(hex(recomputed)).toBe(hex(result.plan.preservedRoot));
  });

  it("a verifier's root does NOT match once a non-redacted region is altered", async () => {
    const result = await redactImage(IMAGE, { manualDetections: faces, blockSize: 16 });
    const altered = tamperPixel(result.redactedImage, 40, 40); // block 10, not authorized
    const recomputed = await computePreservedRoot(altered, result.plan.grid, result.plan.authorizedBlocks);
    expect(hex(recomputed)).not.toBe(hex(result.plan.preservedRoot));
  });
});
