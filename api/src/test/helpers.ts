import type { RgbaImage } from '../vision/types.js';

/**
 * A deterministic, non-uniform test image. Every pixel differs from its
 * neighbours, so any block permutation or off-by-one in the splitter changes the
 * bytes and is caught by a hash comparison.
 */
export function makeImage(width: number, height: number, seed = 1): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed >>> 0;
  for (let i = 0; i < data.length; i++) {
    // xorshift32 — deterministic across runs and platforms.
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    data[i] = state & 0xff;
  }
  return { data, width, height };
}

/** A copy of `image` with a single byte of one pixel flipped. */
export function tamperPixel(image: RgbaImage, x: number, y: number): RgbaImage {
  const data = new Uint8ClampedArray(image.data);
  const offset = (y * image.width + x) * 4;
  data[offset] = data[offset]! ^ 0xff;
  return { data, width: image.width, height: image.height };
}

export const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
