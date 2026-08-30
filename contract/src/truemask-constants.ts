/**
 * Protocol constants shared by the contract, the vision pipeline and the UI.
 * Changing either value invalidates every record already on-chain.
 */

/** Must equal the Vector<N, Bytes<32>> arity in truemask.compact. */
export const LANE_COUNT = 16;

/** Must equal DEFAULT_BLOCK_SIZE in api/src/vision/block-splitter.ts. */
export const DEFAULT_BLOCK_SIZE = 16;
