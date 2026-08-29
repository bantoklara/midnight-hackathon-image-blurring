# Vision Pipeline

Turns a photo into (a) a publishable redacted image and (b) the two values the ZK
circuit stores on-chain. Nothing here talks to Midnight directly — it produces
inputs, and `api/src/index.ts` submits them.

## The claim we are proving

> Every block of the published image that was **not** authorized for redaction is
> pixel-identical to the same block of the original.

The original image never leaves the journalist's machine. Only the root and the
bitmap go on-chain.

## Interface with `contract/`

This is the contract between the vision owner and the contract owner. Neither
side changes it alone.

| Value | Type | Meaning |
|---|---|---|
| `preservedRoot` | `Uint8Array(32)` → `Bytes<32>` | Root over all NON-authorized blocks |
| `authorizationBitmap` | `Uint8Array` → `Bytes<32>` | Bit `i` set = block `i` was allowed to change |

Both are produced by `redactImage()` in `index.ts`.

## Rules that are easy to get wrong

1. **The block size is a protocol constant** (`DEFAULT_BLOCK_SIZE`, currently 16).
   Prover and verifier must split identically or roots never match. Changing it
   invalidates every record already on-chain.
2. **The hash construction must mirror the circuit exactly.** `contract/` uses
   Compact's `persistentHash`. Agree on one construction before writing either
   side — a mismatch is invisible until proofs start failing.
3. **Bind the index and the grid dimensions into the hash.** Hashing bare pixel
   bytes lets identical-looking blocks be permuted without breaking the root.
4. **Export lossless PNG only.** JPEG re-quantises every block and invalidates
   the proof.
5. **Never re-encode the whole image through a canvas filter.** Copy the buffer
   and mutate only authorized blocks, or pixels outside the redactions shift and
   silently break the root.
6. **Blackout, not blur.** Blur and pixelation are reversible enough to be
   attacked. This app protects sources; the default must be irreversible.
7. **Recognised OCR text is sensitive.** Fine to show in the UI for review, never
   on-chain and never in a log.

## Bitmap size limit

A `Bytes<32>` bitmap holds 256 blocks — a 16×16 grid of blocks, i.e. only a
256×256 image at `blockSize = 16`. Real photos need far more. Before implementing,
decide with the contract owner:

- raise the block size so the count fits (coarse redactions), **or**
- commit to the bitmap by hash and pass the full bitmap as a witness, **or**
- store the bitmap as a `Bytes<32>` root over a second Merkle tree.

The scaffolded types assume the bitmap stays a plain byte array on this side; only
the on-chain representation is in question.

## Setup note — MediaPipe model file

`@mediapipe/tasks-vision` does not ship the model. Download a face detector
`.task`/`.tflite` (e.g. `blaze_face_short_range`) into
`truemask-ui/public/models/` and pass its path as `modelAssetPath`, or point
at the Google CDN URL. Both MediaPipe and Tesseract.js are browser-only — do not
import them from Node-side code.
