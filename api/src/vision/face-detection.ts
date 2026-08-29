/**
 * Face detection via MediaPipe Tasks Vision.
 *
 * TODO(vision): implement.
 *
 * Responsibilities:
 *   - Lazily create and cache a MediaPipe `FaceDetector` (loading the WASM bundle
 *     and the .task model file is expensive — do it once, reuse it).
 *   - Run detection over an ImageData/HTMLCanvasElement and map MediaPipe's
 *     normalized output into our pixel-space `Detection[]` with kind 'face'.
 *   - Expose a confidence threshold so the journalist can trade recall for precision.
 *
 * Notes for whoever picks this up:
 *   - The model file (e.g. blaze_face_short_range.tflite) is NOT bundled by npm.
 *     Download it into truemask-ui/public/models/ and load it from there, or
 *     point at the Google CDN URL. See api/src/vision/README.md.
 *   - MediaPipe runs in the browser only (it needs WebAssembly + WebGL). Do not
 *     import this module from Node-side code.
 *   - Prefer detecting on the FULL-RESOLUTION image. Detecting on a downscaled
 *     copy and scaling boxes back up tends to miss small faces in crowd shots,
 *     which is exactly the case journalists care about.
 */

import type { Detection } from './types.js';

export interface FaceDetectorOptions {
  /** Minimum confidence to report a face. Default around 0.5. */
  minConfidence?: number;
  /** URL or path to the .task/.tflite model file. */
  modelAssetPath?: string;
}

/** Detect every face in the image. Returns [] when none are found. */
export async function detectFaces(
  _image: ImageData,
  _options?: FaceDetectorOptions,
): Promise<Detection[]> {
  throw new Error('detectFaces: not implemented yet');
}

/** Release the cached MediaPipe detector and its WASM memory. */
export async function disposeFaceDetector(): Promise<void> {
  throw new Error('disposeFaceDetector: not implemented yet');
}
