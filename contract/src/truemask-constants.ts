/**
 * PROTOCOL-CRITICAL constants shared by the contract, the vision pipeline and the UI.
 *
 * These are not tuning knobs. Both values are baked into every commitment that
 * has ever been published, so changing either one makes existing records
 * unverifiable — and does so silently, because the code keeps working and only
 * the comparison result changes.
 */

/** Must equal the Vector<N, Bytes<32>> arity in truemask.compact. */
export const LANE_COUNT = 16;

/** Must equal DEFAULT_BLOCK_SIZE in api/src/vision/block-splitter.ts. */
export const DEFAULT_BLOCK_SIZE = 16;
