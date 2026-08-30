/**
 * Applies the actual pixel redaction to the authorized blocks.
 *
 * INVARIANT: every byte outside the authorized blocks is bit-identical to the
 * input. The buffer is copied and only authorized blocks are mutated — the image
 * is never redrawn through a canvas filter, because canvas re-encoding perturbs
 * pixels outside the redacted regions and silently breaks the preserved root.
 * For the same reason the caller MUST export lossless PNG; JPEG re-quantises
 * every block and invalidates the proof.
 *
 * BLUR IS DELIBERATELY NOT OFFERED. Gaussian blur and (to a lesser extent)
 * pixelation are reversible enough to be attacked, and this app exists to protect
 * sources. `blackout` is the default and the only style that is actually
 * irreversible; `pixelate` is kept for cosmetic use only and the UI must say so.
 */

import type { BlockGrid, RgbaImage } from './types.js';

export type RedactionStyle = 'blackout' | 'pixelate';

export interface RedactionOptions {
  /** Defaults to 'blackout' — the only style that is actually irreversible. */
  style?: RedactionStyle;
  /**
   * Mosaic cell size in pixels for 'pixelate'. Defaults to the block size, i.e.
   * one flat colour per block. Ignored for 'blackout'.
   */
  strength?: number;
}

/**
 * Return a copy of the image with only the authorized blocks modified.
 * Every byte outside those blocks is bit-identical to the input.
 */
export function applyRedaction(
  image: RgbaImage,
  grid: BlockGrid,
  authorizedBlocks: number[],
  options: RedactionOptions = {},
): RgbaImage {
  const expected = image.width * image.height * 4;
  if (image.data.length !== expected) {
    throw new Error(
      `applyRedaction: image buffer is ${image.data.length} bytes, expected ${expected}`,
    );
  }

  const style = options.style ?? 'blackout';
  const data = new Uint8ClampedArray(image.data); // copy; untouched bytes stay identical
  const output: RgbaImage = { data, width: image.width, height: image.height };

  for (const blockIndex of authorizedBlocks) {
    if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= grid.blockCount) {
      throw new Error(
        `applyRedaction: block index ${blockIndex} is out of range for ${grid.blockCount} blocks`,
      );
    }
    const region = blockRegion(image, grid, blockIndex);
    if (region.width <= 0 || region.height <= 0) continue; // fully in the padded margin

    if (style === 'blackout') {
      fillOpaqueBlack(output, region);
    } else {
      pixelate(output, region, options.strength ?? grid.blockSize);
    }
  }

  return output;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The on-image pixel rectangle of a block, clipped to the image bounds. */
function blockRegion(image: RgbaImage, grid: BlockGrid, blockIndex: number): Region {
  const x = (blockIndex % grid.cols) * grid.blockSize;
  const y = Math.floor(blockIndex / grid.cols) * grid.blockSize;
  return {
    x,
    y,
    width: Math.min(grid.blockSize, image.width - x),
    height: Math.min(grid.blockSize, image.height - y),
  };
}

/** Solid black, fully opaque — irreversible. */
function fillOpaqueBlack(image: RgbaImage, region: Region): void {
  for (let row = 0; row < region.height; row++) {
    let offset = ((region.y + row) * image.width + region.x) * 4;
    for (let col = 0; col < region.width; col++) {
      image.data[offset] = 0;
      image.data[offset + 1] = 0;
      image.data[offset + 2] = 0;
      image.data[offset + 3] = 255;
      offset += 4;
    }
  }
}

/** Mosaic: replace each cell with its mean colour. Cosmetic only — reversible enough to attack. */
function pixelate(image: RgbaImage, region: Region, cellSize: number): void {
  const cell = Math.max(1, Math.floor(cellSize));
  for (let cellY = 0; cellY < region.height; cellY += cell) {
    for (let cellX = 0; cellX < region.width; cellX += cell) {
      const width = Math.min(cell, region.width - cellX);
      const height = Math.min(cell, region.height - cellY);

      let r = 0, g = 0, b = 0, a = 0;
      for (let row = 0; row < height; row++) {
        let offset = ((region.y + cellY + row) * image.width + region.x + cellX) * 4;
        for (let col = 0; col < width; col++) {
          r += image.data[offset]!;
          g += image.data[offset + 1]!;
          b += image.data[offset + 2]!;
          a += image.data[offset + 3]!;
          offset += 4;
        }
      }

      const count = width * height;
      const mean = [Math.round(r / count), Math.round(g / count), Math.round(b / count), Math.round(a / count)];
      for (let row = 0; row < height; row++) {
        let offset = ((region.y + cellY + row) * image.width + region.x + cellX) * 4;
        for (let col = 0; col < width; col++) {
          image.data[offset] = mean[0]!;
          image.data[offset + 1] = mean[1]!;
          image.data[offset + 2] = mean[2]!;
          image.data[offset + 3] = mean[3]!;
          offset += 4;
        }
      }
    }
  }
}
