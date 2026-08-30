/**
 * Witness implementations for truemask.compact.
 *
 * The circuits take the redaction lane digests as private inputs. They are
 * produced by the vision pipeline (`api/src/vision`) on the journalist's machine
 * and never leave it — only the folded 32-byte root is written on-chain.
 */

import { LANE_COUNT } from './truemask-constants.js';

export type TrueMaskPrivateState = {
  /** Lane digests over the preserved blocks of the PUBLISHED image. */
  readonly publishedLaneDigests: Uint8Array[];
  /** Lane digests over the same blocks of the ORIGINAL image. Never stored. */
  readonly originalLaneDigests: Uint8Array[];
};

/** All-zero lanes. A real call must stage the digests before submitting. */
export const createTrueMaskPrivateState = (
  publishedLaneDigests: Uint8Array[] = emptyLanes(),
  originalLaneDigests: Uint8Array[] = emptyLanes(),
): TrueMaskPrivateState => ({
  publishedLaneDigests: assertLanes(publishedLaneDigests, 'publishedLaneDigests'),
  originalLaneDigests: assertLanes(originalLaneDigests, 'originalLaneDigests'),
});

/**
 * Digests for the call about to be made.
 *
 * Mirrors the `setCustomName` pattern already used by the leaderboard contract:
 * the private state stored by the provider is per-contract, but the lane digests
 * are per-image, so they are staged immediately before each circuit call.
 */
let staged: TrueMaskPrivateState | null = null;

export const stageRedactionWitness = (
  publishedLaneDigests: Uint8Array[],
  originalLaneDigests: Uint8Array[] = publishedLaneDigests,
): void => {
  staged = createTrueMaskPrivateState(publishedLaneDigests, originalLaneDigests);
};

export const clearRedactionWitness = (): void => {
  staged = null;
};

export const createTrueMaskWitnesses = () => ({
  get_published_lane_digests: ({
    privateState,
  }: {
    privateState: TrueMaskPrivateState;
  }): [TrueMaskPrivateState, Uint8Array[]] => [
    privateState,
    (staged ?? privateState).publishedLaneDigests,
  ],
  get_original_lane_digests: ({
    privateState,
  }: {
    privateState: TrueMaskPrivateState;
  }): [TrueMaskPrivateState, Uint8Array[]] => [
    privateState,
    (staged ?? privateState).originalLaneDigests,
  ],
});

function emptyLanes(): Uint8Array[] {
  return Array.from({ length: LANE_COUNT }, () => new Uint8Array(32));
}

/**
 * The Compact runtime rejects a badly shaped witness with a low-level type error.
 * Failing here instead gives a message that names the actual problem.
 */
function assertLanes(lanes: Uint8Array[], label: string): Uint8Array[] {
  if (lanes.length !== LANE_COUNT) {
    throw new Error(`${label}: expected ${LANE_COUNT} lane digests, got ${lanes.length}`);
  }
  for (const [index, lane] of lanes.entries()) {
    if (lane.length !== 32) {
      throw new Error(`${label}: lane ${index} must be 32 bytes, got ${lane.length}`);
    }
  }
  return lanes;
}
