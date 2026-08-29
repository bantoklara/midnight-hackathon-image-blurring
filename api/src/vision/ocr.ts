/**
 * Text detection (signs, documents, badges, licence plates) via Tesseract.js.
 *
 * TODO(vision): implement.
 *
 * Responsibilities:
 *   - Spin up and reuse a Tesseract worker (worker startup downloads language
 *     data and takes seconds — never create one per image).
 *   - Recognise text and return WORD-level bounding boxes as `Detection[]` with
 *     kind 'text', carrying the recognised string in `Detection.text`.
 *   - Filter out low-confidence noise, which Tesseract produces a lot of on
 *     photographs (as opposed to clean scans).
 *
 * Notes for whoever picks this up:
 *   - Use word-level boxes, not paragraph/line boxes. Line boxes over-redact
 *     badly on photos and will blur half the picture.
 *   - Tesseract is slow on large images. Consider capping the longest edge
 *     (~1600px) for the OCR pass only, then scaling boxes back to full
 *     resolution — unlike faces, text large enough to be legible survives this.
 *   - Recognised text is SENSITIVE. It is fine to show it in the UI for review,
 *     but it must never be sent on-chain or into a log.
 */

import type { Detection } from './types.js';

export interface OcrOptions {
  /** Tesseract language code(s), e.g. 'eng' or 'eng+spa'. Default 'eng'. */
  language?: string;
  /** Minimum per-word confidence in [0, 1] to report. Default around 0.6. */
  minConfidence?: number;
}

/** Detect text regions in the image. Returns [] when none are found. */
export async function detectText(
  _image: ImageData,
  _options?: OcrOptions,
): Promise<Detection[]> {
  throw new Error('detectText: not implemented yet');
}

/** Terminate the cached Tesseract worker. */
export async function disposeOcrWorker(): Promise<void> {
  throw new Error('disposeOcrWorker: not implemented yet');
}
