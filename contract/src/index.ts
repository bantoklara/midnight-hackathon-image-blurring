/**
 * Compiled-contract entry point for the workspace.
 *
 * Wraps each compiled Compact contract together with its witness implementations
 * and its on-disk ZK assets, producing the `CompiledContract` value that
 * `deployContract`/`findDeployedContract` require.
 *
 * `managed/` is committed, so a fresh clone can build and run without installing
 * the Compact toolchain.
 */

import { CompiledContract } from '@midnight-ntwrk/compact-js';

export * as Leaderboard from '../managed/leaderboard/contract/index.js';
export { createWitnesses, setCustomName, createLeaderboardPrivateState } from './witnesses.js';
export type { LeaderboardPrivateState } from './witnesses.js';

export * as TrueMask from '../managed/truemask/contract/index.js';
export {
  createTrueMaskWitnesses,
  createTrueMaskPrivateState,
  stageRedactionWitness,
  clearRedactionWitness,
} from './truemask-witnesses.js';
export type { TrueMaskPrivateState } from './truemask-witnesses.js';
export { LANE_COUNT, DEFAULT_BLOCK_SIZE } from './truemask-constants.js';

import * as LeaderboardContract from '../managed/leaderboard/contract/index.js';
import * as TrueMaskContract from '../managed/truemask/contract/index.js';
import { createWitnesses } from './witnesses.js';
import { createTrueMaskWitnesses } from './truemask-witnesses.js';

export const CompiledLeaderboardContract = CompiledContract.make(
  'leaderboard',
  LeaderboardContract.Contract,
).pipe(
  CompiledContract.withWitnesses(createWitnesses()),
  CompiledContract.withCompiledFileAssets('./managed/leaderboard'),
);

/**
 * The TrueMask redaction-integrity contract.
 *
 * `withCompiledFileAssets` points at `./managed/truemask`, which holds the prover
 * and verifier keys for `submit_redaction` and `verify_integrity`.
 */
export const CompiledTrueMaskContract = CompiledContract.make(
  'truemask',
  TrueMaskContract.Contract,
).pipe(
  CompiledContract.withWitnesses(createTrueMaskWitnesses()),
  CompiledContract.withCompiledFileAssets('./managed/truemask'),
);

/**
 * PROTOCOL-CRITICAL. The canonical definition of the preserved root.
 *
 * `compute_preserved_root` is a pure circuit, so the compiler exposes it directly
 * to TypeScript — no context, no proof, no wallet. `api/src/vision/hashing.ts`
 * mirrors it with WebCrypto for speed and is pinned to this value by the
 * "hash agreement" test in `api/src/test/integration.test.ts`.
 *
 * If these two ever diverge, every proof silently stops verifying while the code
 * still appears to work. That test is the only thing standing between a compiler
 * change and that failure mode.
 */
export const { compute_preserved_root: computePreservedRootOnChainDefinition } =
  TrueMaskContract.pureCircuits;
