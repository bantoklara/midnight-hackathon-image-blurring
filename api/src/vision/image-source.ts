/**
 * Browser interop helpers.
 *
 * The pipeline works on plain `RgbaImage` buffers so it can run in a Node test
 * with no canvas. The detectors, however, are browser libraries that want a real
 * `ImageData` (MediaPipe) or a canvas (Tesseract). These helpers bridge the two
 * and fail with an actionable message when called outside a browser, instead of
 * throwing something opaque from inside a WASM module.
 */

import type { RgbaImage } from './types.js';

type ImageDataCtor = new (data: Uint8ClampedArray, width: number, height: number) => object;
type OffscreenCanvasCtor = new (width: number, height: number) => OffscreenCanvasLike;

interface OffscreenCanvasLike {
  getContext(contextId: '2d'): { putImageData(image: object, dx: number, dy: number): void } | null;
}

/** Wrap an RgbaImage as a real `ImageData` for MediaPipe. */
export function toImageData(image: RgbaImage): object {
  const ctor = (globalThis as { ImageData?: ImageDataCtor }).ImageData;
  if (!ctor) {
    throw new Error(
      'ImageData is unavailable — the MediaPipe detectors run in the browser only. ' +
        'From Node, pass detections in yourself via redactImage({ manualDetections }).',
    );
  }
  // Copy: ImageData takes ownership of the buffer's view, and callers reuse theirs.
  return new ctor(new Uint8ClampedArray(image.data), image.width, image.height);
}

/** Draw an RgbaImage onto an OffscreenCanvas for Tesseract, which cannot take ImageData. */
export function toCanvas(image: RgbaImage): OffscreenCanvasLike {
  const ctor = (globalThis as { OffscreenCanvas?: OffscreenCanvasCtor }).OffscreenCanvas;
  if (!ctor) {
    throw new Error(
      'OffscreenCanvas is unavailable — the OCR detector runs in the browser only. ' +
        'From Node, pass detections in yourself via redactImage({ manualDetections }).',
    );
  }
  const canvas = new ctor(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('could not acquire a 2d context for OCR');
  context.putImageData(toImageData(image), 0, 0);
  return canvas;
}
