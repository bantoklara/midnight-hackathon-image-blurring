import type { Detection, RgbaImage } from "./types.js";
import { toImageData } from "./image-source.js";

let cachedHuman: any = null;

async function getHuman() {
  if (cachedHuman) return cachedHuman;
  const { Human } = await import("@vladmandic/human");

  cachedHuman = new Human({
    modelBasePath: "https://vladmandic.github.io/human-models/models",
    filter: { enabled: true, equalization: true }, // Enable histogram equalization for better face detection in varied lighting
    face: {
      enabled: true,
      // Stricter IOU threshold (0.3 instead of 0.1) to reduce duplicate/overlapping detections
      detector: {
        rotation: false,
        maxDetected: 100,
        iouThreshold: 0.3,
        minConfidence: 0.5,
      },
      mesh: { enabled: false },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false },
  });

  await cachedHuman.load();
  return cachedHuman;
}

export interface FaceDetectorOptions {
  minConfidence?: number;
  tiles?: number;
  tileOverlap?: number;
}

export async function detectFaces(
  image: RgbaImage,
  options: FaceDetectorOptions = {},
): Promise<Detection[]> {
  // Balanced confidence threshold: 0.5 catches more faces while filtering obvious false positives
  // This improved recall after users reported missing faces in crowd photos
  const minConfidence = options.minConfidence ?? 0.5;
  const human = await getHuman();

  const imageData = toImageData(image);
  const result = await human.detect(imageData);

  const found: Detection[] = [];

  for (const face of result.face) {
    if (face.score < minConfidence) continue;

    // Moderate shrinking (0.65 = 35% shrink) to capture complete face area including cheeks and chin
    // while still focusing on core identity features more than the raw detection box
    const originalWidth = face.boxRaw[2] * image.width;
    const originalHeight = face.boxRaw[3] * image.height;

    const shrinkFactor = 0.65;
    const newWidth = originalWidth * shrinkFactor;
    const newHeight = originalHeight * shrinkFactor;

    // Shift X and Y to keep the box centered
    const offsetX = (originalWidth - newWidth) / 2;
    const offsetY = (originalHeight - newHeight) / 2;

    // Filter out very small detections (likely false positives)
    // Lowered to 15px to catch distant/small faces in crowd scenes
    const minFaceSize = 15;
    if (newWidth < minFaceSize || newHeight < minFaceSize) continue;

    found.push({
      kind: "face",
      confidence: face.score,
      box: {
        x: Math.max(0, face.boxRaw[0] * image.width + offsetX),
        y: Math.max(0, face.boxRaw[1] * image.height + offsetY),
        width: newWidth,
        height: newHeight,
      },
    });
  }

  return found;
}

export async function disposeFaceDetector(): Promise<void> {
  cachedHuman = null;
}
