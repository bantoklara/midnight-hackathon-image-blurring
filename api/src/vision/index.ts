/**
 * TrueMask vision pipeline — public entry point.
 *
 * Pipeline order:
 *   1. detectFaces() + detectText()      -> Detection[]
 *   2. computeGrid() + blocksForDetections() -> authorized block indices
 *   3. packAuthorizationBitmap()         -> bitmap for the on-chain record
 *   4. computePreservedRoot()            -> 32-byte root of the UNTOUCHED blocks
 *   5. applyRedaction()                  -> the publishable image
 *
 * The journalist reviews step 1's output in the UI and can add or remove regions
 * before steps 2-5 run. Everything from step 2 on must be deterministic: the
 * verifier re-runs steps 2 and 4 on the published image and compares roots.
 *
 * TODO(vision): implement redactImage() once the individual steps land.
 */

export * from './types.js';
export * from './face-detection.js';
export * from './ocr.js';
export * from './block-splitter.js';
export * from './hashing.js';
export * from './redaction.js';

import type { Detection, RedactionResult } from './types.js';
import type { RedactionOptions } from './redaction.js';

export interface RedactImageOptions extends RedactionOptions {
  /** Override the protocol block size. Only for tests — see block-splitter.ts. */
  blockSize?: number;
  /**
   * Regions the journalist added or removed by hand in the UI. When provided,
   * these REPLACE the automatic detections rather than adding to them, so the
   * operator always has the final say over what gets redacted.
   */
  manualDetections?: Detection[];
}

/**
 * Run the full pipeline: detect, plan, hash, redact.
 * Returns the publishable image plus everything `submitRedaction` needs.
 */
export async function redactImage(
  _image: ImageData,
  _options?: RedactImageOptions,
): Promise<RedactionResult> {
  throw new Error('redactImage: not implemented yet');
}
