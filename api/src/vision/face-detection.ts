/**
 * Face detection via MediaPipe Tasks Vision.
 *
 * BROWSER ONLY. MediaPipe needs WebAssembly, WebGL and (for the ImageData path)
 * a DOM `ImageData` constructor. Importing this module from Node-side code is
 * fine — nothing runs at import time — but calling `detectFaces()` there throws
 * a clear error rather than failing deep inside the WASM runtime.
 *
 * The detector and its WASM bundle are expensive to create, so they are built
 * once and cached for the lifetime of the page.
 *
 * Detection runs on the FULL-RESOLUTION image on purpose. Detecting on a
 * downscaled copy and scaling the boxes back up misses small faces in crowd
 * shots, which is exactly the case journalists care about.
 */

import type { Detection, RgbaImage } from './types.js';
import { toImageData } from './image-source.js';

/** Default MediaPipe WASM bundle. Pin a local copy for an offline/air-gapped build. */
const DEFAULT_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm';

/** BlazeFace short-range. Not bundled by npm — see api/src/vision/README.md. */
const DEFAULT_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

export interface FaceDetectorOptions {
  /** Minimum confidence to report a face. Default 0.5. */
  minConfidence?: number;
  /** URL or path to the .task/.tflite model file. */
  modelAssetPath?: string;
  /** Directory holding the MediaPipe WASM bundle. */
  wasmBasePath?: string;
}

type MediaPipeFaceDetector = {
  detect(image: object): { detections: MediaPipeDetection[] };
  close(): void;
};

interface MediaPipeDetection {
  categories: { score: number }[];
  boundingBox?: { originX: number; originY: number; width: number; height: number };
}

let cachedDetector: MediaPipeFaceDetector | null = null;
let cachedKey = '';

/** Detect every face in the image. Returns [] when none are found. */
export async function detectFaces(
  image: RgbaImage,
  options: FaceDetectorOptions = {},
): Promise<Detection[]> {
  const minConfidence = options.minConfidence ?? 0.5;
  const detector = await getFaceDetector(options);
  const { detections } = detector.detect(toImageData(image));

  const results: Detection[] = [];
  for (const detection of detections) {
    const box = detection.boundingBox;
    if (!box) continue;
    const confidence = detection.categories[0]?.score ?? 0;
    if (confidence < minConfidence) continue;

    results.push({
      kind: 'face',
      confidence,
      box: clampBox(
        { x: box.originX, y: box.originY, width: box.width, height: box.height },
        image,
      ),
    });
  }
  return results;
}

/** Release the cached MediaPipe detector and its WASM memory. */
export async function disposeFaceDetector(): Promise<void> {
  cachedDetector?.close();
  cachedDetector = null;
  cachedKey = '';
}

async function getFaceDetector(options: FaceDetectorOptions): Promise<MediaPipeFaceDetector> {
  const wasmBasePath = options.wasmBasePath ?? DEFAULT_WASM_BASE;
  const modelAssetPath = options.modelAssetPath ?? DEFAULT_MODEL;
  const key = `${wasmBasePath}|${modelAssetPath}`;

  if (cachedDetector && cachedKey === key) return cachedDetector;
  await disposeFaceDetector();

  // Imported lazily so this module stays importable (and tree-shakeable) in Node.
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(wasmBasePath);
  const detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: { modelAssetPath, delegate: 'GPU' },
    runningMode: 'IMAGE',
  });

  cachedDetector = detector as unknown as MediaPipeFaceDetector;
  cachedKey = key;
  return cachedDetector;
}

/** Keep boxes inside the image so downstream block mapping never goes out of range. */
function clampBox(
  box: { x: number; y: number; width: number; height: number },
  image: RgbaImage,
) {
  const x = Math.max(0, Math.min(box.x, image.width));
  const y = Math.max(0, Math.min(box.y, image.height));
  return {
    x,
    y,
    width: Math.max(0, Math.min(box.width, image.width - x)),
    height: Math.max(0, Math.min(box.height, image.height - y)),
  };
}
