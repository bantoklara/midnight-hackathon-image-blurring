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

### Use the FULL-RANGE face model, and keep the WASM version in step

Measured in a real browser on a 1920x1440 café photo:

| model | WASM | faces found |
|---|---|---|
| `blaze_face_short_range` | 0.10.3 or 1.0.1 | **0** |
| `blaze_face_full_range` | 0.10.3 | **fails** — `CalculatorGraph::Run() failed` |
| `blaze_face_full_range` | 1.0.1 (matching) | works |

Short-range BlazeFace resizes its input to 128x128, so a face occupying ~9% of a wide photo is ~12px
and below what the model can resolve. It is built for a face filling the frame. **Do not switch back
to it**, and do not let the WASM bundle version drift from the installed `@mediapipe/tasks-vision` —
the full-range model simply errors against the older runtime. `MEDIAPIPE_VERSION` in
`face-detection.ts` pins both together.

### Detection is tiled

`detectFaces()` runs on the whole frame *and* on 2x2 overlapping tiles, merging the results with
non-maximum suppression. On the same photo this went from 1 face (whole frame) to 4 raw detections,
and 3 -> 10 findings once the confidence floor was set appropriately. Small distant faces in a wide
shot — a crowd, a street, a café — are precisely the journalist's case, and a single whole-frame pass
misses them. 4x4 tiling was measured to be *worse* than 2x2: faces start landing on tile seams.

The confidence floor defaults to **0.2**, deliberately permissive. A missed face exposes a source; a
false positive only blacks out extra pixels the journalist can deselect in the review step.

`detectFaces()` pulls the MediaPipe WASM bundle and the model from a CDN by default. For an offline or air-gapped build, host both locally and pass `wasmBasePath` and
`modelAssetPath`. `detectText()` downloads Tesseract language data on first use.

There is **no licence-plate detector**. That category only ever existed as a hardcoded demo value in
the UI and has been removed; plates are covered incidentally when OCR reads the characters on them.

The UI runs the two detectors with `Promise.allSettled` rather than awaiting them together —
Tesseract is the more fragile of the two, and a failure there must not discard good face detections.

Both detectors are **browser-only** — they need WebAssembly, and OCR needs a canvas. Calling them
from Node throws with an actionable message. To run the pipeline headlessly, pass detections in via
`redactImage(image, { manualDetections })`, which is what `scripts/e2e-truemask.mjs` does.

## Performance

Hashing is proportional to pixel count: ~1,200 blocks for a 640x480 image, ~47,600 for a 12 MP phone
photo, and `redactImage()` hashes twice (original and published). Measured end to end: ~0.5 s, ~2.0 s
and ~8.6 s respectively.

`computeLaneDigests` hashes in batches of 256 instead of awaiting one block at a time, which roughly
halved the cost, and yields to the event loop between batches whenever `onProgress` is supplied so a
browser tab keeps painting. **The batching changes scheduling only** — leaves still enter their lane
in ascending block order, so the bytes hashed are identical, and the hash-agreement test proves it.

For genuinely large images the real fix is moving the pipeline into a Web Worker.
