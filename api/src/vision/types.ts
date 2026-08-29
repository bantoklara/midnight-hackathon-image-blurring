/**
 * Shared types for the TrueMask vision pipeline.
 *
 * These types are the contract between the vision pipeline (this folder) and
 * the ZK layer (contract/). Changing anything here means the Compact circuit
 * inputs must change too — coordinate with whoever owns contract/.
 */

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
  /** Merkle-style root over the blocks NOT in authorizedBlocks. This is what goes on-chain. */
  preservedRoot: Uint8Array;
}

/** Final output handed to the UI: the redacted image plus everything the circuit needs. */
export interface RedactionResult {
  redactedImage: ImageData;
  plan: RedactionPlan;
}
