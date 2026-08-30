# Vision Pipeline

Turns a photo into (a) a publishable redacted image and (b) the values the ZK circuit stores
on-chain. Nothing here submits anything — it produces inputs, and `api/src/index.ts` (`TrueMaskAPI`)
submits them.

## The claim we are proving

> Every block of the published image that was **not** authorized for redaction is pixel-identical to
> the same block of the original.

The original image never leaves the journalist's machine. Only the root, a commitment to the bitmap,
and the grid dimensions go on-chain.

## Interface with `contract/`

This is the contract between the vision owner and the contract owner. Neither side changes it alone.

| Value | Type | Meaning |
|---|---|---|
| `preservedRoot` | `Uint8Array(32)` → `Bytes<32>` | Root over all NON-authorized blocks |
| `authorizationCommitment` | `Uint8Array(32)` → `Bytes<32>` | Hash of the bitmap, bound to the grid |
| `grid.cols` / `rows` / `blockSize` | `number` → `Uint<32>` | Public, so a verifier can rebuild the grid |
| `laneDigests` | `Uint8Array[16]` → `Vector<16, Bytes<32>>` | Witness input to both circuits |

All produced by `redactImage()` in `index.ts`.

## The hash construction

```
leaf_i  = SHA256("truemask:leaf:v1"   || u32be(cols,rows,blockSize,i) || blockBytes_i)
lane_j  = SHA256("truemask:lane:v1"   || u32be(cols,rows,blockSize,j) || leaf_i ‖ …)
             over preserved i with i % 16 == j, ascending
root    = SHA256(lane_0 ‖ … ‖ lane_15)
bitmapC = SHA256("truemask:bitmap:v1" || u32be(cols,rows,blockSize,blockCount) || bitmap)
```

## Resolved design decisions

Three questions were open in the original scaffold. They are now settled — do not re-litigate them
without changing the contract too.

### 1. The bitmap goes on-chain as a commitment, not literally

A `Bytes<32>` holds 256 bits, i.e. a 256×256 image at `blockSize 16`. A 1920×1080 photo needs 8160
blocks. So the ledger stores `authorizationCommitment` (32 bytes) plus the grid dimensions, and the
**full bitmap is published alongside the image**. A verifier rebuilds the grid from the dimensions,
unpacks the bitmap, and re-derives the commitment to confirm it matches.

### 2. The root is plain SHA-256, and that is verified, not assumed

The circuit computes `persistentHash<Vector<16, Bytes<32>>>(lanes)`. That was checked — by executing
the compiled circuit and comparing bytes — to be exactly SHA-256 over the 512 concatenated lane
bytes. So `hashing.ts` mirrors it with WebCrypto and the browser never loads the Compact WASM runtime
just to hash an image.

This is pinned by `api/src/test/integration.test.ts` ("hash agreement"), which asserts
`foldLaneDigests(lanes) === pureCircuits.compute_preserved_root(lanes)`. If a compiler version
changes the encoding, that test fails instead of proofs silently never verifying.

### 3. Blur is not offered at all

`RedactionStyle` is `'blackout' | 'pixelate'`. Blur was removed from the type rather than left as a
tempting option: it is reversible enough to attack, and this app protects sources. `pixelate` is
retained for cosmetic use and the UI must say it is not secure. **`blackout` is the default.**

## Rules that are easy to get wrong

1. **The block size is a protocol constant** (`DEFAULT_BLOCK_SIZE`, 16). Prover and verifier must
   split identically or roots never match. Changing it invalidates every record already on-chain.
2. **Bind the index and grid dimensions into every leaf.** Hashing bare pixel bytes would let
   identical-looking blocks be permuted without breaking the root. Already done — see the
   construction above.
3. **Pad edge blocks with zero bytes.** When the dimensions are not a multiple of `blockSize`, the
   last row/column is zero-padded out to a full block. A verifier must do the same.
4. **Round detection boxes OUTWARD to block edges.** Rounding inward leaves a sliver of an
   unredacted face at the boundary.
5. **Export lossless PNG only.** JPEG re-quantises every block and invalidates the proof.
6. **Never re-encode the whole image through a canvas filter.** `applyRedaction` copies the buffer and
   mutates only authorized blocks. `redactImage()` self-checks this by comparing the root before and
   after redaction and throwing if they differ.
7. **Recognised OCR text is sensitive.** Fine to show in the UI for review, never on-chain, never in
   a log.

## Setup note — models

`detectFaces()` pulls the MediaPipe WASM bundle and the BlazeFace short-range model from a CDN by
default. For an offline or air-gapped build, host both locally and pass `wasmBasePath` and
`modelAssetPath`. `detectText()` downloads Tesseract language data on first use.

Both detectors are **browser-only** — they need WebAssembly, and OCR needs a canvas. Calling them
from Node throws with an actionable message. To run the pipeline headlessly, pass detections in via
`redactImage(image, { manualDetections })`, which is what `scripts/e2e-truemask.mjs` does.
