/**
 * Applies the actual pixel redaction to the authorized blocks.
 *
 * TODO(vision): implement.
 *
 * Responsibilities:
 *   - Given an image and the set of authorized blocks, produce a new ImageData
 *     where ONLY those blocks are modified and every other byte is untouched.
 *   - Support blackout, pixelate, and blur styles.
 *
 * Notes for whoever picks this up:
 *   - BLUR IS NOT SAFE and must not be the default. Gaussian blur and pixelation
 *     are both reversible enough to be attacked, and this app is used to protect
 *     sources. Default to solid blackout; if blur/pixelate are offered at all,
 *     the UI must warn that they are cosmetic, not secure.
 *   - Copy the source buffer and mutate only the authorized blocks. Do NOT redraw
 *     the whole image through a canvas filter — canvas re-encoding perturbs pixels
 *     outside the redacted regions, which silently breaks the preserved root and
 *     makes every proof fail.
 *   - For the same reason, the final export must be LOSSLESS (PNG). Saving as
 *     JPEG re-quantises every block and invalidates the proof.
 */

import type { BlockGrid } from './types.js';

export type RedactionStyle = 'blackout' | 'pixelate' | 'blur';

export interface RedactionOptions {
  /** Defaults to 'blackout' — the only style that is actually irreversible. */
  style?: RedactionStyle;
  /** Block size for 'pixelate', radius for 'blur'. Ignored for 'blackout'. */
  strength?: number;
}

/**
 * Return a copy of the image with only the authorized blocks modified.
 * Every byte outside those blocks must be bit-identical to the input.
 */
export function applyRedaction(
  _image: ImageData,
  _grid: BlockGrid,
  _authorizedBlocks: number[],
  _options?: RedactionOptions,
): ImageData {
  throw new Error('applyRedaction: not implemented yet');
}
