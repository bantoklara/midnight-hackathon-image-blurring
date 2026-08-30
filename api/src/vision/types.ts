/**
 * Shared types for the TrueMask vision pipeline.
 *
 * These types are the contract between the vision pipeline (this folder) and
 * the ZK layer (contract/). Changing anything here means the Compact circuit
 * inputs must change too — coordinate with whoever owns contract/.
 */

/**
 * A raw RGBA image buffer.
 *
 * Structurally compatible with the browser's `ImageData`, so a real `ImageData`
 * can be passed anywhere this is expected. Declared structurally rather than as
 * `ImageData` because `api/` builds without the DOM lib (it is a Node target),
 * and because the pipeline must stay runnable from a Node test with no canvas.
 */
export interface RgbaImage {
  /** RGBA bytes, row-major, 4 bytes per pixel. Length must be width * height * 4. */
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Axis-aligned rectangle in pixel coordinates, origin at the top-left of the image. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What kind of sensitive element a detector found. */
export type DetectionKind = 'face' | 'text' | 'building';

/** A single sensitive element found by one of the detectors. */
export interface Detection {
  kind: DetectionKind;
  box: BoundingBox;
  /** Detector confidence in [0, 1]. The UI lets the journalist filter on this. */
  confidence: number;
  /** Populated by the OCR detector only — the recognised text, for review in the UI. */
  text?: string;
}

/**
 * The fixed grid the image is cut into before hashing.
 *
 * Block size is a protocol constant: the prover and the verifier must split the
 * image identically or the roots will never match. Do not make this user-configurable
 * without also encoding it into the on-chain record.
 */
export interface BlockGrid {
  blockSize: number;
  cols: number;
  rows: number;
  /** cols * rows — the number of blocks, and the length of the authorization bitmap. */
  blockCount: number;
}

/**
 * The full plan for redacting one image: which blocks change, and the root over
 * the blocks that must stay pixel-identical.
 */
export interface RedactionPlan {
  grid: BlockGrid;
  detections: Detection[];
  /** Indices (into the row-major grid) of every block a detection overlaps. */
  authorizedBlocks: number[];
  /** Bit i set means block i was authorized to change. Length = ceil(blockCount / 8). */
  authorizationBitmap: Uint8Array;
  /**
   * Hash of `authorizationBitmap` bound to the grid dimensions. This 32-byte value
   * is what goes on-chain — the bitmap itself does not fit (a Bytes<32> holds 256
   * bits, i.e. a 256x256 image at blockSize 16), so it is published beside the image.
   */
  authorizationCommitment: Uint8Array;
  /**
   * The LANE_COUNT lane digests the root is folded from. Handed to the circuit as
   * a witness; kept here so callers do not have to re-derive them.
   */
  laneDigests: Uint8Array[];
  /** Root over the blocks NOT in authorizedBlocks. This is what `submit_redaction` stores. */
  preservedRoot: Uint8Array;
}

/** Final output handed to the UI: the redacted image plus everything the circuit needs. */
export interface RedactionResult {
  redactedImage: RgbaImage;
  plan: RedactionPlan;
  /**
   * Lane digests over the ORIGINAL image's preserved blocks. Equal to
   * `plan.laneDigests` for an honest redaction — `submit_redaction` asserts exactly
   * that. Kept separate because the circuit takes them as a distinct witness.
   */
  originalLaneDigests: Uint8Array[];
}
