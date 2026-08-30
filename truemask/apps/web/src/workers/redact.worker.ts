import { computeGrid, blocksForDetections, packAuthorizationBitmap } from "truemask-api/dist/vision/block-splitter.js";
import { computeAuthorizationCommitment, computeLaneDigests, foldLaneDigests } from "truemask-api/dist/vision/hashing.js";
import { applyRedaction } from "truemask-api/dist/vision/redaction.js";

self.onmessage = async (e: MessageEvent) => {
  try {
    const { image, detections } = e.data;
    const options = { style: "blackout" as const };
    
    const grid = computeGrid(image.width, image.height, undefined);
    const authorizedBlocks = blocksForDetections(grid, detections);
    const authorizationBitmap = packAuthorizationBitmap(grid, authorizedBlocks);
    const authorizationCommitment = await computeAuthorizationCommitment(grid, authorizationBitmap);

    const pass = (offset: number) => ({
      onProgress: (done: number, total: number) => 
        self.postMessage({ type: "progress", done: offset * total + done, total: 2 * total })
    });

    const originalLaneDigests = await computeLaneDigests(image, grid, authorizedBlocks, pass(0));
    const redactedImage = applyRedaction(image, grid, authorizedBlocks, options);
    const laneDigests = await computeLaneDigests(redactedImage, grid, authorizedBlocks, pass(1));
    const originalRoot = await foldLaneDigests(originalLaneDigests);
    const preservedRoot = await foldLaneDigests(laneDigests);

    // Byte equality check
    let equal = originalRoot.length === preservedRoot.length;
    for (let i = 0; equal && i < originalRoot.length; i++) {
      if (originalRoot[i] !== preservedRoot[i]) equal = false;
    }
    if (!equal) {
      throw new Error("redactImage: redaction changed a byte outside the authorized blocks");
    }

    const redaction = {
      redactedImage,
      originalLaneDigests,
      plan: {
        grid,
        detections,
        authorizedBlocks,
        authorizationBitmap,
        authorizationCommitment,
        laneDigests,
        preservedRoot,
      },
    };

    self.postMessage({ type: "done", redaction });
  } catch (error: unknown) {
    self.postMessage({ type: "error", error: (error as Error).message });
  }
};
