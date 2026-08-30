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
      detector: { rotation: false, maxDetected: 100, iouThreshold: 0.2, minConfidence: 0.2 },
      mesh: { enabled: false },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false }
    },
    body: {
      enabled: true, // Detects full people to redact bodies if necessary
      maxDetected: 100,
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
  const minConfidence = options.minConfidence ?? 0.2;
  const human = await getHuman();
  
  const imageData = toImageData(image);
  // Human.detect supports ImageData natively in the browser.
  const result = await human.detect(imageData);
  
  const found: Detection[] = [];
  
  // Extract faces
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

  // Extract bodies as well (user wanted other sensitive information, like body figures/clothing)
  for (const body of result.body) {
    if (body.score < minConfidence) continue;
    found.push({
      kind: 'face', // We map it to 'face' here so the UI keeps working without changing TrueMaskApp types.
      confidence: body.score,
      box: {
        x: body.boxRaw[0] * image.width,
        y: body.boxRaw[1] * image.height,
        width: body.boxRaw[2] * image.width,
        height: body.boxRaw[3] * image.height,
      },
    });
  }

  return found;
}

export async function disposeFaceDetector(): Promise<void> {
  cachedHuman = null;
}
