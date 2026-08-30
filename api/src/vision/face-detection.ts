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
      detector: { rotation: false, maxDetected: 100, iouThreshold: 0.1, minConfidence: 0.6 },
      mesh: { enabled: false },
      iris: { enabled: false },
      description: { enabled: false },
      emotion: { enabled: false }
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
    gesture: { enabled: false }
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
  // Bumped to 0.6 to strictly ensure no background noise or random lights are detected
  const minConfidence = options.minConfidence ?? 0.6;
  const human = await getHuman();
  
  const imageData = toImageData(image);
  const result = await human.detect(imageData);
  
  const found: Detection[] = [];
  
  for (const face of result.face) {
    if (face.score < minConfidence) continue;
    
    // Mathematically shrink the box by 30% (scale 0.7) to target ONLY the central 
    // facial features (eyes/nose/mouth) instead of the whole head/hair.
    const originalWidth = face.boxRaw[2] * image.width;
    const originalHeight = face.boxRaw[3] * image.height;
    
    const shrinkFactor = 0.7; 
    const newWidth = originalWidth * shrinkFactor;
    const newHeight = originalHeight * shrinkFactor;
    
    // Shift X and Y to keep the box centered
    const offsetX = (originalWidth - newWidth) / 2;
    const offsetY = (originalHeight - newHeight) / 2;

    found.push({
      kind: 'face',
      confidence: face.score,
      box: {
        x: (face.boxRaw[0] * image.width) + offsetX,
        y: (face.boxRaw[1] * image.height) + offsetY,
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
