/**
 * TrueMask Contract — SMOKE TEST (not a security test)
 *
 * verify_redaction() in truemask.compact is currently a stub that always
 * returns `true` — it performs no real cryptographic verification that the
 * redacted image only differs from the original inside the declared boxes.
 * This test only confirms that the compiled circuit executes end-to-end with
 * mock witness data and that a successful call is reflected in ledger state.
 * It says nothing about the correctness of the eventual real
 * verify_redaction() implementation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  type BoundingBox,
  type Witnesses,
} from '../managed/truemask/contract/index.js';

type TruemaskPrivateState = {
  readonly originalImageHash: Uint8Array;
  readonly redactionBoxes: BoundingBox[];
};

const ZERO_BOX: BoundingBox = { x: 0n, y: 0n, width: 0n, height: 0n };

/** get_redaction_boxes() returns Vector<16, BoundingBox> — always pad/truncate to exactly 16. */
const toFixedBoxes = (boxes: BoundingBox[]): BoundingBox[] =>
  Array.from({ length: 16 }, (_, i) => boxes[i] ?? ZERO_BOX);

const createMockPrivateState = (
  originalImageHash: Uint8Array,
  boxes: BoundingBox[],
): TruemaskPrivateState => ({
  originalImageHash,
  redactionBoxes: toFixedBoxes(boxes),
});

/** Mock witnesses — stand in for the real journalist-side implementation. */
const mockWitnesses: Witnesses<TruemaskPrivateState> = {
  get_original_image_hash: ({ privateState }) => [privateState, privateState.originalImageHash],
  get_redaction_boxes: ({ privateState }) => [privateState, privateState.redactionBoxes],
};

describe('TrueMask contract smoke test (verify_redaction is a stub)', () => {
  let contract: Contract<TruemaskPrivateState>;

  beforeEach(() => {
    contract = new Contract<TruemaskPrivateState>(mockWitnesses);
  });

  it('runs verify_image end-to-end and records the redacted hash on the ledger', () => {
    const initialPrivateState = createMockPrivateState(
      new Uint8Array(32).fill(7), // mock "original image" hash — never disclosed on-chain
      [{ x: 10n, y: 10n, width: 50n, height: 50n }], // one mock redaction box, rest zero-padded
    );

    const constructorContext = createConstructorContext(initialPrivateState, sampleContractAddress());
    const constructorResult = contract.initialState(constructorContext);

    const contractAddress = sampleContractAddress();
    const circuitContext = createCircuitContext(
      contractAddress,
      constructorResult.currentZswapLocalState,
      constructorResult.currentContractState,
      constructorResult.currentPrivateState,
    );

    const redactedHash = new Uint8Array(32).fill(9); // sample published redacted-image hash

    let resultContext;
    expect(() => {
      const result = contract.impureCircuits.verify_image(circuitContext, redactedHash);
      resultContext = result.context;
    }).not.toThrow();

    const finalLedger = ledger(resultContext!.currentQueryContext.state);
    expect(finalLedger.verified_images.member(redactedHash)).toBe(true);
    expect(finalLedger.verified_images.lookup(redactedHash)).toBe(true);
  });
});
