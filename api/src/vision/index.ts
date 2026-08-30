/**
 * TrueMask vision pipeline — public entry point.
 *
 * Pipeline order:
 *   1. detectFaces() + detectText()          -> Detection[]
 *   2. computeGrid() + blocksForDetections() -> authorized block indices
 *   3. packAuthorizationBitmap()             -> bitmap (published beside the image)
 *      computeAuthorizationCommitment()      -> the Bytes<32> that goes on-chain
 *   4. computeLaneDigests()                  -> 16 lane digests over the UNTOUCHED blocks
 *   5. applyRedaction()                      -> the publishable image
 *   6. foldLaneDigests()                     -> the 32-byte preserved root
 *
 * The journalist reviews step 1's output in the UI and can add or remove regions
 * before steps 2-6 run. Everything from step 2 on is deterministic: the verifier
 * re-runs steps 2, 4 and 6 on the published image and compares roots.
 *
 * Nothing here submits anything. `redactImage()` returns exactly the values
 * `TrueMaskAPI.submitRedaction()` needs, and that is where Midnight is touched.
 */

export * from './types.js';
export * from './face-detection.js';
export * from './ocr.js';
export * from './block-splitter.js';
export * from './hashing.js';
export * from './redaction.js';
export * from './image-source.js';

import type { Detection, DetectionKind, RedactionResult, RgbaImage } from './types.js';
import type { RedactionOptions } from './redaction.js';
import { applyRedaction } from './redaction.js';
import { blocksForDetections, computeGrid, packAuthorizationBitmap } from './block-splitter.js';
import { computeAuthorizationCommitment, computeLaneDigests, foldLaneDigests } from './hashing.js';
import { detectFaces } from './face-detection.js';
import { detectText } from './ocr.js';

export interface RedactImageOptions extends RedactionOptions {
  /** Override the protocol block size. Only for tests — see block-splitter.ts. */
  blockSize?: number;
  /**
   * Regions the journalist added or removed by hand in the UI. When provided,
   * these REPLACE the automatic detections rather than adding to them, so the
   * operator always has the final say over what gets redacted.
   *
   * Also the way to run the pipeline from Node: the detectors are browser-only,
   * so passing detections in skips them entirely.
   */
  manualDetections?: Detection[];
  /** Which automatic detectors to run. Ignored when `manualDetections` is given. */
  detectors?: DetectionKind[];
  /** Minimum detector confidence in [0, 1]. */
  minConfidence?: number;
}

/**
 * Run the full pipeline: detect, plan, hash, redact.
 * Returns the publishable image plus everything `submit_redaction` needs.
 */
export async function redactImage(
  image: RgbaImage,
  options: RedactImageOptions = {},
): Promise<RedactionResult> {
  const detections = options.manualDetections ?? (await autoDetect(image, options));

  const grid = computeGrid(image.width, image.height, options.blockSize);
  const authorizedBlocks = blocksForDetections(grid, detections);
  const authorizationBitmap = packAuthorizationBitmap(grid, authorizedBlocks);
  const authorizationCommitment = await computeAuthorizationCommitment(grid, authorizationBitmap);

  // Hash the preserved blocks of the original BEFORE redacting...
  const originalLaneDigests = await computeLaneDigests(image, grid, authorizedBlocks);
  const redactedImage = applyRedaction(image, grid, authorizedBlocks, options);
  // ...and of the published image after, so the two can be compared.
  const laneDigests = await computeLaneDigests(redactedImage, grid, authorizedBlocks);

  const originalRoot = await foldLaneDigests(originalLaneDigests);
  const preservedRoot = await foldLaneDigests(laneDigests);

  // This is the same equality `submit_redaction` asserts in-circuit. Catching it
  // here means a redaction bug surfaces as a local error instead of a failed proof.
  if (!bytesEqual(originalRoot, preservedRoot)) {
    throw new Error(
      'redactImage: redaction changed a byte outside the authorized blocks — refusing to ' +
        'produce a record that cannot be verified. This is a bug in applyRedaction.',
    );
  }

  return {
    redactedImage,
    originalLaneDigests,
    plan: {
      grid,
      detections,
      authorizedBlocks,
      authorizationBitmap,
      authorizationCommitment,
      laneDigests,
      preservedRoot,
    },
  };
}

async function autoDetect(image: RgbaImage, options: RedactImageOptions): Promise<Detection[]> {
  const detectors = options.detectors ?? ['face', 'text'];
  const detections: Detection[] = [];
  if (detectors.includes('face')) {
    detections.push(...(await detectFaces(image, { minConfidence: options.minConfidence })));
  }
  if (detectors.includes('text')) {
    detections.push(...(await detectText(image, { minConfidence: options.minConfidence })));
  }
  return detections;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
