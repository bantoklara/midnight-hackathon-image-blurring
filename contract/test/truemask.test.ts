/**
 * TrueMask contract tests — block/Merkle redaction-integrity scheme.
 *
 * These exercise the REAL compiled circuits through @midnight-ntwrk/compact-runtime,
 * not a hand-written mirror of the logic. Lane digests are synthetic here on
 * purpose, so a failure points at the contract rather than at the vision pipeline;
 * the vision-to-circuit integration (including the hash-agreement check that pins
 * the TypeScript root to `compute_preserved_root`) lives in
 * api/src/test/integration.test.ts.
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
  pureCircuits,
  type Witnesses,
} from '../managed/truemask/contract/index.js';

const LANE_COUNT = 16;

/** The private state the journalist's machine holds while proving. */
type TrueMaskPrivateState = {
  publishedLaneDigests: Uint8Array[];
  originalLaneDigests: Uint8Array[];
};

const lanes = (seed: number): Uint8Array[] =>
  Array.from({ length: LANE_COUNT }, (_, i) => new Uint8Array(32).fill((seed + i) & 0xff));

const bytes32 = (fill: number) => new Uint8Array(32).fill(fill);
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

const witnesses: Witnesses<TrueMaskPrivateState> = {
  get_published_lane_digests: ({ privateState }) => [privateState, privateState.publishedLaneDigests],
  get_original_lane_digests: ({ privateState }) => [privateState, privateState.originalLaneDigests],
};

/** Minimal harness: fresh contract + circuit context, with mutable private state. */
function newContract(privateState: TrueMaskPrivateState) {
  const contract = new Contract<TrueMaskPrivateState>(witnesses);
  const constructed = contract.initialState(
    createConstructorContext(privateState, sampleContractAddress()),
  );
  let context = createCircuitContext(
    sampleContractAddress(),
    constructed.currentZswapLocalState,
    constructed.currentContractState,
    constructed.currentPrivateState,
  );

  return {
    submit(
      redactedHash: Uint8Array,
      commitment: Uint8Array,
      cols: bigint,
      rows: bigint,
      blockSize: bigint,
    ) {
      const result = contract.impureCircuits.submit_redaction(
        context, redactedHash, commitment, cols, rows, blockSize,
      );
      context = result.context;
      return result;
    },
    verify(redactedHash: Uint8Array) {
      const result = contract.impureCircuits.verify_integrity(context, redactedHash);
      context = result.context;
      return result;
    },
    /** Simulate the verifier holding a DIFFERENT image than the one submitted. */
    setPublishedLanes(next: Uint8Array[]) {
      context.currentPrivateState.publishedLaneDigests = next;
    },
    state: () => ledger(context.currentQueryContext.state),
  };
}

describe('compute_preserved_root (pure circuit, callable from TypeScript)', () => {
  it('is exposed on pureCircuits and returns 32 bytes', () => {
    const root = pureCircuits.compute_preserved_root(lanes(0));
    expect(root).toHaveLength(32);
  });

  it('is deterministic and lane-order sensitive', () => {
    const a = pureCircuits.compute_preserved_root(lanes(0));
    expect(hex(pureCircuits.compute_preserved_root(lanes(0)))).toBe(hex(a));

    const reordered = lanes(0);
    [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
    expect(hex(pureCircuits.compute_preserved_root(reordered))).not.toBe(hex(a));
  });
});

describe('submit_redaction', () => {
  let harness: ReturnType<typeof newContract>;

  beforeEach(() => {
    harness = newContract({ publishedLaneDigests: lanes(1), originalLaneDigests: lanes(1) });
  });

  it('records the image when the published and original roots agree', () => {
    const redactedHash = bytes32(0xaa);
    const commitment = bytes32(0xbb);
    expect(() => harness.submit(redactedHash, commitment, 120n, 68n, 16n)).not.toThrow();

    const state = harness.state();
    expect(state.records.member(redactedHash)).toBe(true);

    const record = state.records.lookup(redactedHash);
    expect(hex(record.preserved_root)).toBe(hex(pureCircuits.compute_preserved_root(lanes(1))));
    expect(hex(record.authorization_commitment)).toBe(hex(commitment));
    expect(record.cols).toBe(120n);
    expect(record.rows).toBe(68n);
    expect(record.block_size).toBe(16n);
    expect(record.verified).toBe(false);
  });

  it('REJECTS a redaction that altered a region outside the authorized blocks', () => {
    // The published image's preserved blocks hash differently from the original's.
    const dishonest = newContract({
      publishedLaneDigests: lanes(1),
      originalLaneDigests: lanes(99),
    });
    expect(() => dishonest.submit(bytes32(0xaa), bytes32(0xbb), 4n, 4n, 16n))
      .toThrow(/altered a region outside the authorized blocks/);
    expect(dishonest.state().records.member(bytes32(0xaa))).toBe(false);
  });

  it('refuses to register the same image twice', () => {
    harness.submit(bytes32(0xaa), bytes32(0xbb), 4n, 4n, 16n);
    expect(() => harness.submit(bytes32(0xaa), bytes32(0xcc), 4n, 4n, 16n))
      .toThrow(/already registered/);
  });

  it('keeps records for different images separate', () => {
    harness.submit(bytes32(0x01), bytes32(0xb1), 4n, 4n, 16n);
    harness.submit(bytes32(0x02), bytes32(0xb2), 8n, 8n, 16n);
    const state = harness.state();
    expect(state.records.size()).toBe(2n);
    expect(hex(state.records.lookup(bytes32(0x01)).authorization_commitment)).toBe(hex(bytes32(0xb1)));
    expect(state.records.lookup(bytes32(0x02)).cols).toBe(8n);
  });
});

describe('verify_integrity', () => {
  let harness: ReturnType<typeof newContract>;
  const redactedHash = bytes32(0xaa);

  beforeEach(() => {
    harness = newContract({ publishedLaneDigests: lanes(1), originalLaneDigests: lanes(1) });
    harness.submit(redactedHash, bytes32(0xbb), 4n, 4n, 16n);
  });

  it('marks an untouched image verified', () => {
    expect(harness.state().records.lookup(redactedHash).verified).toBe(false);
    expect(() => harness.verify(redactedHash)).not.toThrow();

    const record = harness.state().records.lookup(redactedHash);
    expect(record.verified).toBe(true);
    // The rest of the record survives the update unchanged.
    expect(hex(record.authorization_commitment)).toBe(hex(bytes32(0xbb)));
    expect(record.cols).toBe(4n);
    expect(hex(record.preserved_root)).toBe(hex(pureCircuits.compute_preserved_root(lanes(1))));
  });

  it('TAMPERING: fails once a non-redacted region has been altered', () => {
    harness.setPublishedLanes(lanes(42)); // verifier holds a modified image
    expect(() => harness.verify(redactedHash))
      .toThrow(/integrity check failed: a non-redacted region was altered/);
    // And the record is NOT marked verified.
    expect(harness.state().records.lookup(redactedHash).verified).toBe(false);
  });

  it('fails for an image that was never registered', () => {
    expect(() => harness.verify(bytes32(0xff))).toThrow(/not registered/);
  });

  it('is idempotent for an honest image', () => {
    harness.verify(redactedHash);
    expect(() => harness.verify(redactedHash)).not.toThrow();
    expect(harness.state().records.lookup(redactedHash).verified).toBe(true);
  });
});
