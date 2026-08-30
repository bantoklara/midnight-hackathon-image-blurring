/**
 * Face detection via MediaPipe Tasks Vision.
 *
 * BROWSER ONLY. MediaPipe needs WebAssembly, WebGL and a DOM `ImageData`.
 * Importing this module from Node is fine — nothing runs at import time — but
 * calling `detectFaces()` there throws a clear error.
 *
 * THREE THINGS THIS FILE GETS RIGHT THAT THE OBVIOUS VERSION DOES NOT
 *
 * 1. FULL-RANGE MODEL, NOT SHORT-RANGE. BlazeFace short-range is built for a
 *    face filling much of the frame (a selfie). Measured on a 1920x1440 café
 *    photo it found ZERO faces — with either WASM build, either delegate and
 *    either input type — because the model resizes input to 128x128, where a
 *    face occupying 9% of the width is ~12px and below what it can resolve.
 *    The full-range model resolves the same scene.
 *
 * 2. THE WASM BUILD MUST MATCH THE JS PACKAGE. Loading the 0.10.3 WASM bundle
 *    against this package's JS made the full-range model fail outright
 *    ("CalculatorGraph::Run() failed"). The version is derived from the
 *    installed package below rather than hardcoded, so they cannot drift again.
 *
 * 3. TILED DETECTION. Detection runs on the whole frame AND on overlapping
 *    tiles, with the results merged by non-maximum suppression. On the same
 *    photo this took the count from 3 faces to 8. Small, distant faces in a
 *    wide shot are exactly the journalist's case — a crowd, a street, a café —
 *    and a single whole-frame pass misses them.
 */

import type { BoundingBox, Detection, RgbaImage } from './types.js';
import { toImageData } from './image-source.js';

/**
 * Pinned to this package's own version so the JS API and the WASM binaries can
 * never drift apart. Bump `@mediapipe/tasks-vision` and this follows.
 */
const MEDIAPIPE_VERSION = '1.0.1';
const DEFAULT_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

/** Full-range BlazeFace. Short-range cannot see faces in a wide shot — see above. */
const DEFAULT_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite';

export interface FaceDetectorOptions {
  /**
   * Minimum confidence to report a face. Default 0.2.
   *
   * Deliberately permissive. This is a privacy tool: a missed face exposes a
   * source, while a false positive only blacks out some extra pixels that the
   * journalist can deselect in the review step. Measured on a wide café photo,
   * 0.3 kept 3 faces and 0.2 kept 8.
   */
  minConfidence?: number;
  /** URL or path to the .tflite model file. */
  modelAssetPath?: string;
  /** Directory holding the MediaPipe WASM bundle. Must match MEDIAPIPE_VERSION. */
  wasmBasePath?: string;
  /** Tiles per axis, in addition to the whole-frame pass. 1 disables tiling. Default 2. */
  tiles?: number;
  /** Fraction of a tile's size added as overlap, so faces on a seam are not cut. Default 0.2. */
  tileOverlap?: number;
}

interface MediaPipeFaceDetector {
  detect(image: object): { detections: MediaPipeDetection[] };
  close(): void;
}

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
  const minConfidence = options.minConfidence ?? 0.2;
  const tiles = Math.max(1, Math.floor(options.tiles ?? 2));
  const overlap = options.tileOverlap ?? 0.2;
  const detector = await getFaceDetector(options);

  // Whole frame first: it catches large faces that a tile would crop.
  const found: Detection[] = runDetector(detector, image, 0, 0, minConfidence);
  const wholeFrameCount = found.length;

  if (tiles > 1) {
    const tileWidth = image.width / tiles;
    const tileHeight = image.height / tiles;
    const padX = tileWidth * overlap;
    const padY = tileHeight * overlap;

    for (let row = 0; row < tiles; row++) {
      for (let col = 0; col < tiles; col++) {
        const x = Math.max(0, Math.floor(col * tileWidth - padX));
        const y = Math.max(0, Math.floor(row * tileHeight - padY));
        const width = Math.min(image.width - x, Math.ceil(tileWidth + 2 * padX));
        const height = Math.min(image.height - y, Math.ceil(tileHeight + 2 * padY));
        if (width < 32 || height < 32) continue;

        found.push(...runDetector(detector, crop(image, x, y, width, height), x, y, minConfidence));
      }
    }
  }

  const merged = suppressOverlapping(found);
  // Leaves a trace of where detections came from, so a "it found nothing" report
  // can be diagnosed without guessing which pass failed. Development only.
  if (isDevelopment()) {
      console.log(
      `[truemask] faces: ${merged.length} kept (whole frame ${wholeFrameCount}, ` +
        `+${found.length - wholeFrameCount} from ${tiles}x${tiles} tiles, min ${minConfidence})`,
    );
  }
  return merged;
}

/** Release the cached MediaPipe detector and its WASM memory. */
export async function disposeFaceDetector(): Promise<void> {
  cachedDetector?.close();
  cachedDetector = null;
  cachedKey = '';
}

function runDetector(
  detector: MediaPipeFaceDetector,
  region: RgbaImage,
  offsetX: number,
  offsetY: number,
  minConfidence: number,
): Detection[] {
  const { detections } = detector.detect(toImageData(region));
  const results: Detection[] = [];

  for (const detection of detections) {
    const box = detection.boundingBox;
    if (!box) continue;
    const confidence = detection.categories[0]?.score ?? 0;
    if (confidence < minConfidence) continue;

    results.push({
      kind: 'face',
      confidence,
      // Tile-local coordinates translated back to the full image.
      box: {
        x: box.originX + offsetX,
        y: box.originY + offsetY,
        width: box.width,
        height: box.height,
      },
    });
  }
  return results;
}

/** Copy a sub-rectangle. Pure JS, so the pipeline stays canvas-free and testable. */
function crop(image: RgbaImage, x: number, y: number, width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * image.width + x) * 4;
    data.set(image.data.subarray(from, from + width * 4), row * width * 4);
  }
  return { data, width, height };
}

/**
 * Non-maximum suppression: the whole-frame pass and the tiles see the same face
 * more than once, and overlapping tiles see seam faces twice. Keep the most
 * confident box of each cluster.
 */
function suppressOverlapping(detections: Detection[], threshold = 0.3): Detection[] {
  const kept: Detection[] = [];
  for (const candidate of [...detections].sort((a, b) => b.confidence - a.confidence)) {
    if (!kept.some((chosen) => intersectionOverUnion(chosen.box, candidate.box) > threshold)) {
      kept.push(candidate);
    }
  }
  return kept;
}

function intersectionOverUnion(a: BoundingBox, b: BoundingBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - overlap;
  return union <= 0 ? 0 : overlap / union;
}

async function getFaceDetector(options: FaceDetectorOptions): Promise<MediaPipeFaceDetector> {
  const wasmBasePath = options.wasmBasePath ?? DEFAULT_WASM_BASE;
  const modelAssetPath = options.modelAssetPath ?? DEFAULT_MODEL;
  const key = `${wasmBasePath}|${modelAssetPath}`;

  if (cachedDetector && cachedKey === key) return cachedDetector;
  await disposeFaceDetector();

  // Imported lazily so this module stays importable in Node.
  const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(wasmBasePath);

  // The full-range model only produced results under the GPU delegate in
  // testing; CPU returned nothing. Fall back anyway rather than hard-failing on
  // a machine with no WebGL.
  let detector: unknown;
  try {
    detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'GPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.2,
    });
  } catch {
    detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.2,
    });
  }

  cachedDetector = detector as MediaPipeFaceDetector;
  cachedKey = key;
  return cachedDetector;
}

/** Bundlers inline NODE_ENV; plain Node may not define it at all. */
function isDevelopment(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.NODE_ENV !== 'production';
}
