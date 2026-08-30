import { CompiledContract } from '@midnight-ntwrk/compact-js';

export * as TrueMask from '../managed/truemask/contract/index.js';
export {
  createTrueMaskWitnesses,
  createTrueMaskPrivateState,
  stageRedactionWitness,
  clearRedactionWitness,
} from './truemask-witnesses.js';
export type { TrueMaskPrivateState } from './truemask-witnesses.js';
export { LANE_COUNT, DEFAULT_BLOCK_SIZE } from './truemask-constants.js';

import * as TrueMaskContract from '../managed/truemask/contract/index.js';
import { createTrueMaskWitnesses } from './truemask-witnesses.js';

export const CompiledTrueMaskContract = CompiledContract.make(
  'truemask',
  TrueMaskContract.Contract,
).pipe(
  CompiledContract.withWitnesses(createTrueMaskWitnesses()),
  CompiledContract.withCompiledFileAssets('./managed/truemask'),
);

/**
 * `compute_preserved_root` is a pure circuit, so the compiler exposes it directly
 * to TypeScript — no context, no proof, no wallet. This is the canonical
 * definition of the root; `api/src/vision/hashing.ts` mirrors it with WebCrypto
 * and is pinned to it by api/src/test/integration.test.ts.
 */
export const { compute_preserved_root: computePreservedRootOnChainDefinition } =
  TrueMaskContract.pureCircuits;

