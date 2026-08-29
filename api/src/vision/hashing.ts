/**
 * Hashing of image blocks and the root commitment that goes on-chain.
 *
 * TODO(vision): implement.
 *
 * This is the heart of the proof. The on-chain claim is:
 *   "the root over every NON-authorized block of the published image equals the
 *    root over the same blocks of the original image"
 * which is exactly the statement 'everything outside the redactions is untouched'.
 *
 * Responsibilities:
 *   - SHA-256 one block via crypto.subtle (no dependency needed).
 *   - Build a deterministic Merkle-style root over the preserved (non-authorized)
 *     blocks, with each leaf domain-separated by its block index so blocks cannot
 *     be reordered or swapped.
 *
 * Notes for whoever picks this up:
 *   - MUST MATCH THE CIRCUIT. contract/ hashes with Compact's `persistentHash`.
 *     Before building anything elaborate here, agree with the contract owner on
 *     ONE hash construction and mirror it exactly. A mismatch here is invisible
 *     until proofs start failing.
 *   - Include the block INDEX in each leaf preimage. Hashing bare pixel bytes
 *     lets an attacker permute identical-looking blocks without breaking the root.
 *   - Also bind the grid dimensions into the root, so an image cannot be reframed
 *     or resized while still matching.
 *   - crypto.subtle is async and available in browsers and Node 22+.
 */

import type { BlockGrid } from './types.js';

/** SHA-256 of one block's bytes, domain-separated by its index. */
export async function hashBlock(
  _blockBytes: Uint8Array,
  _blockIndex: number,
): Promise<Uint8Array> {
  throw new Error('hashBlock: not implemented yet');
}

/**
 * Root over every block NOT listed in authorizedBlocks.
 * This 32-byte value is what `submitRedaction` stores on-chain.
 */
export async function computePreservedRoot(
  _image: ImageData,
  _grid: BlockGrid,
  _authorizedBlocks: number[],
): Promise<Uint8Array> {
  throw new Error('computePreservedRoot: not implemented yet');
}
