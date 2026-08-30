export async function sha256(value: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", value);

  const hashArray = Array.from(new Uint8Array(hashBuffer));

  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  return sha256(buffer);
}

export function shortHash(hash: string): string {
  if (!hash) return "";

  return `${hash.slice(0, 12)}...${hash.slice(-8)}`;
}

/**
 * Decode an image URL into raw RGBA pixels.
 *
 * The pixels returned here are what gets hashed, so this must not go through any
 * canvas filter — `drawImage` + `getImageData` is a straight decode.
 */
export async function loadRgbaImage(url: string): Promise<ImageData> {
  const img = new window.Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("could not decode the selected image"));
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("could not acquire a 2d context");

  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Encode RGBA pixels as a LOSSLESS PNG.
 *
 * PNG is mandatory: JPEG re-quantises every block, which changes bytes outside
 * the redacted regions and makes the preserved root — and therefore the proof —
 * fail for everyone who checks it.
 */
export async function rgbaToPngBlob(image: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire a 2d context");

  // Copy into a fresh, non-shared buffer: ImageData requires a plain ArrayBuffer,
  // and the pipeline's buffers are typed as ArrayBufferLike.
  const pixels = new Uint8ClampedArray(image.data.length);
  pixels.set(image.data);
  ctx.putImageData(new ImageData(pixels, image.width, image.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("could not encode the redacted image as PNG");
  return blob;
}

/** SHA-256 of raw bytes, as a Uint8Array — the form the contract takes. */
export async function sha256Bytes(bytes: ArrayBuffer): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
