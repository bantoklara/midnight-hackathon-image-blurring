/**
 * Text detection (signs, documents, badges, licence plates) via Tesseract.js.
 *
 * BROWSER ONLY, same as face-detection.ts — Tesseract's `ImageLike` does not
 * accept a raw `ImageData`, so the image is drawn onto an OffscreenCanvas first.
 *
 * The worker downloads language data and takes seconds to start, so it is created
 * once and cached. Word-level boxes are used deliberately: line and paragraph
 * boxes over-redact badly on photographs and would black out half the picture.
 *
 * RECOGNISED TEXT IS SENSITIVE. It is carried on `Detection.text` so the
 * journalist can review it in the UI. It must never go on-chain and never into a
 * log — the circuit only ever sees block hashes.
 */

import type { Detection, RgbaImage } from "./types.js";
import { toCanvas } from "./image-source.js";

/** Tesseract is slow on large images; text large enough to read survives this cap.
 * Increased from 1600 to 2000 to capture smaller but still readable text better. */
const OCR_MAX_EDGE = 2000;

export interface OcrOptions {
  /** Tesseract language code(s), e.g. 'eng' or 'eng+spa'. Default 'eng'. */
  language?: string;
  /** Minimum per-word confidence in [0, 1] to report. Default 0.6. */
  minConfidence?: number;
  /**
   * Minimum recognised characters for a word to count. Default 3.
   * Tesseract emits a lot of one- and two-character junk on photographs
   * (a digit off a cup, a fragment of a logo). Those are not location clues,
   * and surfacing them as "sensitive text" trains the journalist to ignore
   * the findings list.
   */
  minLength?: number;
}

interface TesseractWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface TesseractWorker {
  recognize(
    image: unknown,
    options?: unknown,
    output?: { blocks?: boolean },
  ): Promise<{ data: { blocks: TesseractBlock[] | null } }>;
  terminate(): Promise<unknown>;
}

interface TesseractBlock {
  paragraphs: { lines: { words: TesseractWord[] }[] }[];
}

let cachedWorker: TesseractWorker | null = null;
let cachedLanguage = "";

/** Detect text regions in the image. Returns [] when none are found. */
export async function detectText(
  image: RgbaImage,
  options: OcrOptions = {},
): Promise<Detection[]> {
  // Increased to 0.7 for better accuracy, reducing OCR noise and false positives
  const minConfidence = options.minConfidence ?? 0.7;
  // Require at least 4 characters to reduce single-character false positives
  const minLength = options.minLength ?? 4;
  const worker = await getWorker(options.language ?? "eng");

  // Tesseract reads the canvas at its own resolution; boxes come back in that
  // space, so record the scale and map every box back to full resolution.
  const scale = Math.min(1, OCR_MAX_EDGE / Math.max(image.width, image.height));
  const source = scale < 1 ? downscale(image, scale) : image;

  const { data } = await worker.recognize(toCanvas(source), undefined, {
    blocks: true,
  });

  const results: Detection[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const confidence = word.confidence / 100; // Tesseract reports 0..100
          if (confidence < minConfidence) continue;
          const text = word.text.trim();
          // Count letters and digits only, so "4." or "|~" never qualifies.
          if (text.replace(/[^\p{L}\p{N}]/gu, "").length < minLength) continue;

          const inverse = scale < 1 ? 1 / scale : 1;
          const x = word.bbox.x0 * inverse;
          const y = word.bbox.y0 * inverse;
          results.push({
            kind: "text",
            confidence,
            text,
            box: {
              x,
              y,
              width: Math.max(
                0,
                Math.min(
                  (word.bbox.x1 - word.bbox.x0) * inverse,
                  image.width - x,
                ),
              ),
              height: Math.max(
                0,
                Math.min(
                  (word.bbox.y1 - word.bbox.y0) * inverse,
                  image.height - y,
                ),
              ),
            },
          });
        }
      }
    }
  }
  return results;
}

/** Terminate the cached Tesseract worker. */
export async function disposeOcrWorker(): Promise<void> {
  await cachedWorker?.terminate();
  cachedWorker = null;
  cachedLanguage = "";
}

async function getWorker(language: string): Promise<TesseractWorker> {
  if (cachedWorker && cachedLanguage === language) return cachedWorker;
  await disposeOcrWorker();

  const { createWorker } = await import("tesseract.js");
  cachedWorker = (await createWorker(language)) as unknown as TesseractWorker;
  cachedLanguage = language;
  return cachedWorker;
}

/** Nearest-neighbour downscale. Only ever feeds OCR — never the hashed image. */
function downscale(image: RgbaImage, scale: number): RgbaImage {
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor(x / scale));
      const from = (sourceY * image.width + sourceX) * 4;
      const to = (y * width + x) * 4;
      data[to] = image.data[from]!;
      data[to + 1] = image.data[from + 1]!;
      data[to + 2] = image.data[from + 2]!;
      data[to + 3] = image.data[from + 3]!;
    }
  }
  return { data, width, height };
}
