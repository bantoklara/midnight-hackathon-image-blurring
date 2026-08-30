/**
 * TrueMask end-to-end trace — no browser, no wallet, no devnet.
 *
 *   node testing/e2e-truemask.mjs
 *
 * Walks the entire chain on a synthesised photo and asserts each link:
 *
 *   pixels -> detections -> block grid -> authorized blocks -> blackout redaction
 *          -> per-block leaf hashes -> lane digests -> preserved root
 *          -> submit_redaction (real compiled circuit) -> ledger state
 *          -> verify_integrity (clean)   == passes
 *          -> verify_integrity (tampered) == fails
 *
 * The detectors themselves (MediaPipe, Tesseract) are browser-only, so detections
 * are supplied directly here — everything downstream of them is what this checks.
 */

import assert from 'node:assert/strict';
import {
  createConstructorContext,
  createCircuitContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  pureCircuits,
} from '../contract/managed/truemask/contract/index.js';
import {
  computeLaneDigests,
  foldLaneDigests,
  redactImage,
  computeGrid,
  unpackAuthorizationBitmap,
} from '../api/dist/vision/index.js';

const PROOF_SERVER = process.env.PROOF_SERVER_URI ?? 'http://localhost:6300';

let step = 0;
const ok = (msg, detail) => console.log(`  ✓ [${++step}] ${msg}${detail ? `  ${detail}` : ''}`);
const hex = (b) => Buffer.from(b).toString('hex');
const short = (b) => `${hex(b).slice(0, 16)}…`;

/** A deterministic stand-in for a journalist's photo. */
function makePhoto(width, height, seed = 1) {
  const data = new Uint8ClampedArray(width * height * 4);
  let s = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    data[i] = s & 0xff;
  }
  return { data, width, height };
}

function tamper(image, x, y) {
  const data = new Uint8ClampedArray(image.data);
  const o = (y * image.width + x) * 4;
  data[o] ^= 0xff;
  return { data, width: image.width, height: image.height };
}

console.log('\nTrueMask end-to-end trace\n' + '='.repeat(60));

// ---------------------------------------------------------------- 1. the photo
const original = makePhoto(320, 240, 7);
ok('decoded a 320x240 RGBA photo', `${original.data.length} bytes`);

// ------------------------------------------------- 2. detections (browser-side)
const detections = [
  { kind: 'face', confidence: 0.98, box: { x: 40, y: 30, width: 64, height: 64 } },
  { kind: 'text', confidence: 0.87, text: 'RUA DO PORTO 42', box: { x: 200, y: 180, width: 96, height: 22 } },
];
ok('detections supplied', `${detections.length} regions (browser detectors are exercised in the UI)`);

// ------------------------------------- 3-6. grid, redaction, hashing, the root
const redaction = await redactImage(original, { manualDetections: detections, style: 'blackout' });
const { grid, authorizedBlocks, authorizationBitmap, authorizationCommitment, preservedRoot } =
  redaction.plan;

ok('built the block grid', `${grid.cols}x${grid.rows} @${grid.blockSize}px = ${grid.blockCount} blocks`);
ok('mapped detections to blocks', `${authorizedBlocks.length} authorized, ${grid.blockCount - authorizedBlocks.length} preserved`);

assert.deepEqual(unpackAuthorizationBitmap(grid, authorizationBitmap), authorizedBlocks);
ok('authorization bitmap round-trips', `${authorizationBitmap.length} bytes -> ${short(authorizationCommitment)}`);

// Redaction must be irreversible AND surgical.
const firstBlock = authorizedBlocks[0];
const bx = (firstBlock % grid.cols) * grid.blockSize;
const by = Math.floor(firstBlock / grid.cols) * grid.blockSize;
const pixel = (by * original.width + bx) * 4;
assert.deepEqual([...redaction.redactedImage.data.slice(pixel, pixel + 4)], [0, 0, 0, 255]);
ok('authorized blocks are opaque black', 'irreversible — not blur, not pixelation');

// The invariant that makes the proof work: EVERY differing byte must lie inside
// an authorized block. Counting equal bytes would not catch a stray write.
const authorizedSet = new Set(authorizedBlocks);
let changed = 0;
for (let i = 0; i < original.data.length; i++) {
  if (original.data[i] === redaction.redactedImage.data[i]) continue;
  changed++;
  const px = (i / 4) | 0;
  const block = Math.floor((px / original.width | 0) / grid.blockSize) * grid.cols
              + Math.floor((px % original.width) / grid.blockSize);
  assert.ok(authorizedSet.has(block), `byte ${i} changed outside an authorized block (${block})`);
}
ok('every changed byte lies inside an authorized block',
   `${changed} bytes changed, 0 outside the redactions`);

ok('computed the preserved root', short(preservedRoot));

// The TypeScript root MUST equal what the circuit computes, or nothing verifies.
assert.equal(hex(await foldLaneDigests(redaction.plan.laneDigests)),
             hex(pureCircuits.compute_preserved_root(redaction.plan.laneDigests)));
ok('TS root == compiled circuit root', 'prover and verifier cannot disagree');

// --------------------------------------------------------- 7. the real circuit
const privateState = {
  published: redaction.plan.laneDigests,
  original: redaction.originalLaneDigests,
};
const contract = new Contract({
  get_published_lane_digests: ({ privateState: ps }) => [ps, ps.published],
  get_original_lane_digests: ({ privateState: ps }) => [ps, ps.original],
});
const constructed = contract.initialState(
  createConstructorContext(privateState, sampleContractAddress()),
);
let context = createCircuitContext(
  sampleContractAddress(),
  constructed.currentZswapLocalState,
  constructed.currentContractState,
  constructed.currentPrivateState,
);

const pngLikeBytes = new Uint8Array(redaction.redactedImage.data);
const redactedHash = new Uint8Array(await crypto.subtle.digest('SHA-256', pngLikeBytes));

context = contract.impureCircuits.submit_redaction(
  context,
  redactedHash,
  authorizationCommitment,
  BigInt(grid.cols),
  BigInt(grid.rows),
  BigInt(grid.blockSize),
).context;

const record = ledger(context.currentQueryContext.state).records.lookup(redactedHash);
assert.equal(hex(record.preserved_root), hex(preservedRoot));
assert.equal(record.verified, false);
ok('submit_redaction executed on the real circuit', `record stored, root ${short(record.preserved_root)}`);

// ------------------------------------------- 8. an editor verifies the picture
const editorLanes = await computeLaneDigests(redaction.redactedImage, grid, authorizedBlocks);
context.currentPrivateState.published = editorLanes;
context = contract.impureCircuits.verify_integrity(context, redactedHash).context;
assert.equal(ledger(context.currentQueryContext.state).records.lookup(redactedHash).verified, true);
ok('verify_integrity PASSES on the untouched published image');

// ------------------------------------------- 9. someone edits the photo
const doctored = tamper(redaction.redactedImage, 300, 220); // far from both redactions
context.currentPrivateState.published = await computeLaneDigests(doctored, grid, authorizedBlocks);
let rejected = false;
try {
  contract.impureCircuits.verify_integrity(context, redactedHash);
} catch (err) {
  rejected = /a non-redacted region was altered/.test(String(err));
}
assert.ok(rejected, 'verify_integrity should have rejected the doctored image');
ok('verify_integrity FAILS on a single altered pixel', 'one byte at (300, 220)');

// ------------------------------------ 10. redacted areas may still be repainted
context.currentPrivateState.published = await computeLaneDigests(
  tamper(redaction.redactedImage, bx, by), grid, authorizedBlocks,
);
contract.impureCircuits.verify_integrity(context, redactedHash);
ok('repainting INSIDE a redaction still verifies', 'redaction is allowed to change those blocks');

// ------------------------------------------------- 11. infrastructure reachable
try {
  const res = await fetch(`${PROOF_SERVER}/health`, { signal: AbortSignal.timeout(5000) });
  ok('proof server reachable', `${PROOF_SERVER} -> ${(await res.text()).trim()}`);
} catch {
  console.log(`  ! [${++step}] proof server NOT reachable at ${PROOF_SERVER} — start it with`);
  console.log('        docker compose -f proof-server/docker-compose.yml up -d');
}

console.log('\n' + '='.repeat(60));
console.log('All local links verified against the real compiled circuits.');
console.log('Not covered here (needs Lace + a node + an indexer): wallet signing,');
console.log('ZK proof generation for a real transaction, and on-chain submission.');
console.log('');
