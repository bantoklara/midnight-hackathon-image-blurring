import type { Detection, RgbaImage } from './types.js';
import { toImageData } from './image-source.js';

let cachedHuman: any = null;

async function getHuman() {
  if (cachedHuman) return cachedHuman;
  const { Human } = await import('@vladmandic/human');
  
  cachedHuman = new Human({
    modelBasePath: 'https://vladmandic.github.io/human-models/models',
    filter: { enabled: true, equalization: false },
    face: {
      enabled: true,
      detector: { rotation: false, maxDetected: 100, iouThreshold: 0.1, minConfidence: 0.5 },
      mesh: { enabled: false },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false }
    },
    body: {
      enabled: false, // Turned off because it generated massive false-positive boxes on crowds
    },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false }
  });
  
  // Pre-load the models
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
  // Increased default from 0.2 to 0.5 to stop false-positive hallucinations
  const minConfidence = options.minConfidence ?? 0.5;
  const human = await getHuman();
  
  const imageData = toImageData(image);
  const result = await human.detect(imageData);
  
  const found: Detection[] = [];
  
  for (const face of result.face) {
    if (face.score < minConfidence) continue;
    found.push({
      kind: 'face',
      confidence: face.score,
      box: {
        x: face.boxRaw[0] * image.width,
        y: face.boxRaw[1] * image.height,
        width: face.boxRaw[2] * image.width,
        height: face.boxRaw[3] * image.height,
      },
    });
  }

  return found;
}

export async function disposeFaceDetector(): Promise<void> {
  cachedHuman = null;
}
