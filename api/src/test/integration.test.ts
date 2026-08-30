/**
 * Vision pipeline <-> compiled circuit integration.
 *
 * The single most important guarantee in TrueMask is that the prover and the
 * verifier hash identically. `hashing.ts` computes the root with WebCrypto so the
 * browser never has to load the Compact WASM runtime; the contract computes it
 * with `persistentHash<Vector<16, Bytes<32>>>`. The first test below pins those
 * two together. If a compiler version ever changes that encoding, this fails
 * loudly here instead of showing up later as proofs that silently never verify.
 */
import { describe, it, expect } from 'vitest';
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
} from '../../../contract/managed/truemask/contract/index.js';
import { redactImage } from '../vision/index.js';
import { computeLaneDigests, foldLaneDigests, LANE_COUNT } from '../vision/hashing.js';
import type { Detection } from '../vision/types.js';
import { hex, makeImage, tamperPixel } from './helpers.js';

type PrivateState = { published: Uint8Array[]; original: Uint8Array[] };

const witnesses: Witnesses<PrivateState> = {
  get_published_lane_digests: ({ privateState }) => [privateState, privateState.published],
  get_original_lane_digests: ({ privateState }) => [privateState, privateState.original],
};

function newContract(privateState: PrivateState) {
  const contract = new Contract<PrivateState>(witnesses);
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
    submit: (h: Uint8Array, c: Uint8Array, cols: bigint, rows: bigint, bs: bigint) => {
      const r = contract.impureCircuits.submit_redaction(context, h, c, cols, rows, bs);
      context = r.context;
    },
    verify: (h: Uint8Array) => {
      const r = contract.impureCircuits.verify_integrity(context, h);
      context = r.context;
    },
    setPublished: (lanes: Uint8Array[]) => { context.currentPrivateState.published = lanes; },
    state: () => ledger(context.currentQueryContext.state),
  };
}

describe('hash agreement: TypeScript root == compiled circuit root', () => {
  it('matches for a fixed vector', async () => {
    const lanes = Array.from({ length: LANE_COUNT }, (_, j) => new Uint8Array(32).fill(j));
    expect(hex(await foldLaneDigests(lanes)))
      .toBe(hex(pureCircuits.compute_preserved_root(lanes)));
  });

  it('matches for lanes derived from a real image', async () => {
    const image = makeImage(96, 96, 11);
    const lanes = await computeLaneDigests(image, { blockSize: 16, cols: 6, rows: 6, blockCount: 36 }, [0, 7]);
    expect(hex(await foldLaneDigests(lanes)))
      .toBe(hex(pureCircuits.compute_preserved_root(lanes)));
  });

  it('matches across many random vectors', async () => {
    for (let round = 0; round < 25; round++) {
      const lanes = Array.from({ length: LANE_COUNT }, () => {
        const lane = new Uint8Array(32);
        for (let i = 0; i < 32; i++) lane[i] = Math.floor(Math.random() * 256);
        return lane;
      });
      expect(hex(await foldLaneDigests(lanes)))
        .toBe(hex(pureCircuits.compute_preserved_root(lanes)));
    }
  });
});

describe('end-to-end: photo -> redaction -> circuit -> verification', () => {
  const faces: Detection[] = [
    { kind: 'face', confidence: 0.97, box: { x: 10, y: 10, width: 40, height: 40 } },
    { kind: 'text', confidence: 0.81, text: 'STREET SIGN', box: { x: 100, y: 80, width: 50, height: 14 } },
  ];

  async function publishAndRegister() {
    const original = makeImage(160, 128, 5);
    const result = await redactImage(original, { manualDetections: faces, blockSize: 16 });

    const harness = newContract({
      published: result.plan.laneDigests,
      original: result.originalLaneDigests,
    });

    // The published-image hash is the ledger key. Any 32-byte digest of the PNG works.
    const redactedHash = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new Uint8Array(result.redactedImage.data)),
    );

    harness.submit(
      redactedHash,
      result.plan.authorizationCommitment,
      BigInt(result.plan.grid.cols),
      BigInt(result.plan.grid.rows),
      BigInt(result.plan.grid.blockSize),
    );
    return { original, result, harness, redactedHash };
  }

  it('registers the redaction with the root the vision pipeline computed', async () => {
    const { result, harness, redactedHash } = await publishAndRegister();

    const record = harness.state().records.lookup(redactedHash);
    expect(hex(record.preserved_root)).toBe(hex(result.plan.preservedRoot));
    expect(hex(record.authorization_commitment)).toBe(hex(result.plan.authorizationCommitment));
    expect(record.cols).toBe(10n); // 160 / 16
    expect(record.rows).toBe(8n);  // 128 / 16
    expect(record.verified).toBe(false);
    expect(result.plan.authorizedBlocks.length).toBeGreaterThan(0);
  });

  it('verifies when the editor recomputes from the published image', async () => {
    const { result, harness, redactedHash } = await publishAndRegister();

    // The editor has ONLY the published image and the published bitmap.
    const editorLanes = await computeLaneDigests(
      result.redactedImage,
      result.plan.grid,
      result.plan.authorizedBlocks,
    );
    harness.setPublished(editorLanes);

    expect(() => harness.verify(redactedHash)).not.toThrow();
    expect(harness.state().records.lookup(redactedHash).verified).toBe(true);
  });

  it('FAILS when a single pixel outside the redactions was altered', async () => {
    const { result, harness, redactedHash } = await publishAndRegister();

    // (150, 120) is in the bottom-right, well away from both detections.
    const altered = tamperPixel(result.redactedImage, 150, 120);
    const editorLanes = await computeLaneDigests(
      altered,
      result.plan.grid,
      result.plan.authorizedBlocks,
    );
    harness.setPublished(editorLanes);

    expect(() => harness.verify(redactedHash))
      .toThrow(/integrity check failed: a non-redacted region was altered/);
    expect(harness.state().records.lookup(redactedHash).verified).toBe(false);
  });

  it('still verifies when the redacted pixels themselves are changed further', async () => {
    const { result, harness, redactedHash } = await publishAndRegister();

    // Repainting inside an authorized block is exactly what redaction is allowed to do.
    const firstAuthorized = result.plan.authorizedBlocks[0]!;
    const x = (firstAuthorized % result.plan.grid.cols) * 16;
    const y = Math.floor(firstAuthorized / result.plan.grid.cols) * 16;
    const repainted = tamperPixel(result.redactedImage, x, y);

    harness.setPublished(
      await computeLaneDigests(repainted, result.plan.grid, result.plan.authorizedBlocks),
    );
    expect(() => harness.verify(redactedHash)).not.toThrow();
  });
});
