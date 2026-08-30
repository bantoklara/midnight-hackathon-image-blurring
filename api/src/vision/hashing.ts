/**
 * Hashing of image blocks and the root commitment that goes on-chain.
 *
 * This is the heart of the proof. The on-chain claim is:
 *   "the root over every NON-authorized block of the published image equals the
 *    root over the same blocks of the original image"
 * which is exactly the statement 'everything outside the redactions is untouched'.
 *
 * CONSTRUCTION (a verifier must mirror this exactly)
 *
 *   leaf_i = SHA256("truemask:leaf:v1"   || u32be(cols,rows,blockSize,i) || blockBytes_i)
 *   lane_j = SHA256("truemask:lane:v1"   || u32be(cols,rows,blockSize,j) || leaf_i ‖ … )
 *              over preserved i with i % LANE_COUNT == j, ascending
 *   root   = SHA256(lane_0 ‖ lane_1 ‖ … ‖ lane_15)
 *   bitmapCommitment
 *          = SHA256("truemask:bitmap:v1" || u32be(cols,rows,blockSize,blockCount) || bitmap)
 *
 * The block index and the grid dimensions are bound into every leaf, so blocks
 * cannot be permuted and the image cannot be reframed or resized while still
 * matching. Domain tags keep the three preimage families disjoint.
 *
 * WHY LANES
 *   Compact unrolls every loop and `persistentHash` is expensive in-circuit, so the
 *   circuit cannot hash 8160 blocks. Reducing to a fixed LANE_COUNT vector off-circuit
 *   makes the circuit cost constant regardless of image size.
 *
 * WHY THE ROOT IS PLAIN SHA-256
 *   The circuit computes `persistentHash<Vector<16, Bytes<32>>>(lanes)`. That was
 *   verified — by executing the compiled circuit and comparing bytes — to be exactly
 *   SHA-256 over the 512 concatenated lane bytes, so this file can mirror it with
 *   WebCrypto and the browser never has to load the Compact WASM runtime just to
 *   hash an image. `foldLaneDigests` is pinned to the circuit by a regression test
 *   (contract/test/truemask.test.ts, "hash agreement"): if a compiler version ever
 *   changes that encoding, the test fails loudly instead of proofs failing silently.
 */

import type { BlockGrid, RgbaImage } from './types.js';
import { extractBlock } from './block-splitter.js';

/** Circuit vector width. Must equal the Vector<N, Bytes<32>> arity in truemask.compact. */
export const LANE_COUNT = 16;

const LEAF_DOMAIN = 'truemask:leaf:v1';
const LANE_DOMAIN = 'truemask:lane:v1';
const BITMAP_DOMAIN = 'truemask:bitmap:v1';

/** SHA-256 leaf for one block, domain-separated by its index and the grid dimensions. */
export async function hashBlock(
  grid: BlockGrid,
  blockIndex: number,
  blockBytes: Uint8Array,
): Promise<Uint8Array> {
  return sha256(
    concat(ascii(LEAF_DOMAIN), u32be(grid.cols, grid.rows, grid.blockSize, blockIndex), blockBytes),
  );
}

/** Blocks hashed per batch. Tunes throughput and UI responsiveness, never the output. */
const HASH_BATCH_SIZE = 256;

export interface LaneDigestOptions {
  /**
   * Called after each batch with (blocksHashed, totalBlocks). Supplying this also
   * makes the loop yield to the event loop between batches, so a browser tab can
   * repaint instead of freezing. Omit it in Node for maximum throughput.
   */
  onProgress?: (done: number, total: number) => void;
}

/**
 * Reduce every preserved (non-authorized) block to exactly LANE_COUNT digests.
 * Block i contributes to lane i % LANE_COUNT, in ascending index order.
 *
 * Blocks are hashed in batches rather than one awaited call at a time — a 12 MP
 * photo is ~47,600 blocks, and one sequential `await` each costs seconds of pure
 * promise scheduling. Batching changes only the scheduling: leaves still enter
 * their lane in ascending block order, so the bytes hashed are identical.
 * `api/src/test/integration.test.ts` pins that to the compiled circuit.
 */
export async function computeLaneDigests(
  image: RgbaImage,
  grid: BlockGrid,
  authorizedBlocks: number[],
  options: LaneDigestOptions = {},
): Promise<Uint8Array[]> {
  assertImageMatchesGrid(image, grid);
  const authorized = new Set(authorizedBlocks);
  const lanes: Uint8Array[][] = Array.from({ length: LANE_COUNT }, () => []);

  const preserved: number[] = [];
  for (let index = 0; index < grid.blockCount; index++) {
    if (!authorized.has(index)) preserved.push(index);
  }

  for (let start = 0; start < preserved.length; start += HASH_BATCH_SIZE) {
    const batch = preserved.slice(start, start + HASH_BATCH_SIZE);
    const leaves = await Promise.all(
      batch.map((index) => hashBlock(grid, index, extractBlock(image, grid, index))),
    );
    // Appended in ascending block order, which is what defines each lane's preimage.
    batch.forEach((index, offset) => lanes[index % LANE_COUNT]!.push(leaves[offset]!));

    if (options.onProgress) {
      options.onProgress(Math.min(start + HASH_BATCH_SIZE, preserved.length), preserved.length);
      await yieldToEventLoop();
    }
  }

  return Promise.all(
    lanes.map((leaves, lane) =>
      sha256(concat(ascii(LANE_DOMAIN), u32be(grid.cols, grid.rows, grid.blockSize, lane), ...leaves)),
    ),
  );
}

/** Hand the main thread back so a browser can paint between batches. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Fold lane digests into the 32-byte root.
 *
 * Mirrors `compute_preserved_root` in truemask.compact. Kept synchronous and
 * dependency-free on purpose — see the note at the top of this file.
 */
export async function foldLaneDigests(laneDigests: Uint8Array[]): Promise<Uint8Array> {
  if (laneDigests.length !== LANE_COUNT) {
    throw new Error(`foldLaneDigests: expected ${LANE_COUNT} lanes, got ${laneDigests.length}`);
  }
  for (const [lane, digest] of laneDigests.entries()) {
    if (digest.length !== 32) {
      throw new Error(`foldLaneDigests: lane ${lane} must be 32 bytes, got ${digest.length}`);
    }
  }
  return sha256(concat(...laneDigests));
}

/**
 * Root over every block NOT listed in authorizedBlocks.
 * This 32-byte value is what `submit_redaction` stores on-chain.
 */
export async function computePreservedRoot(
  image: RgbaImage,
  grid: BlockGrid,
  authorizedBlocks: number[],
  options: LaneDigestOptions = {},
): Promise<Uint8Array> {
  return foldLaneDigests(await computeLaneDigests(image, grid, authorizedBlocks, options));
}

/**
 * Commitment to the authorization bitmap, bound to the grid dimensions.
 * The bitmap itself is too large for a Bytes<32> ledger field on any real photo,
 * so this goes on-chain and the bitmap is published alongside the image.
 */
export async function computeAuthorizationCommitment(
  grid: BlockGrid,
  authorizationBitmap: Uint8Array,
): Promise<Uint8Array> {
  return sha256(
    concat(
      ascii(BITMAP_DOMAIN),
      u32be(grid.cols, grid.rows, grid.blockSize, grid.blockCount),
      authorizationBitmap,
    ),
  );
}

// --- primitives -------------------------------------------------------------

interface SubtleLike {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
}

/** WebCrypto, from the browser or Node 22+. Resolved lazily so importing is side-effect free. */
function subtle(): SubtleLike {
  const host = globalThis as { crypto?: { subtle?: SubtleLike } };
  if (!host.crypto?.subtle) {
    throw new Error(
      'WebCrypto (crypto.subtle) is unavailable. TrueMask needs a browser or Node 22+.',
    );
  }
  return host.crypto.subtle;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Big-endian u32 encoding, so the preimage byte layout is unambiguous across platforms. */
function u32be(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((value, index) => {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(`u32be: ${value} is not a uint32`);
    }
    view.setUint32(index * 4, value, false);
  });
  return out;
}

function assertImageMatchesGrid(image: RgbaImage, grid: BlockGrid): void {
  const expected = image.width * image.height * 4;
  if (image.data.length !== expected) {
    throw new Error(
      `image buffer is ${image.data.length} bytes, expected ${expected} for ${image.width}x${image.height} RGBA`,
    );
  }
  if (grid.cols !== Math.ceil(image.width / grid.blockSize) ||
      grid.rows !== Math.ceil(image.height / grid.blockSize)) {
    throw new Error(
      `grid ${grid.cols}x${grid.rows} @${grid.blockSize} does not match a ${image.width}x${image.height} image`,
    );
  }
}
