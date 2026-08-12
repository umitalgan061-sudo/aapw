import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { classifyReferenceBaseSurface } from '../src/3d/world/worldReferenceSurfacePindexes.js';
import { sampleG27WaterConfidence } from '../godot/terrain-authoring/geocells/sw/g27_hydrology.mjs';
import {
  G27_SOURCE_COAST_POLICY,
  getG27SourceLandMaskBytes,
  isG27SourceLandPixel,
  measureG27SourceMask,
  sampleG27SourceWaterConfidence,
} from '../godot/terrain-authoring/geocells/sw/g27_source_mask.mjs';

assert.equal(G27_SOURCE_COAST_POLICY.geoCell, 'G27');
assert.equal(G27_SOURCE_COAST_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
assert.equal(G27_SOURCE_COAST_POLICY.cropRgbSha256, '2e08d9cc3dfc56f0c3e946018a479873c71e0f37a5e20f22ada81c7995578cbe');
assert.equal(G27_SOURCE_COAST_POLICY.packedLandMaskSha256, '091b3bc1537781637bc61d2ff243f97bcdab42bc85bb768d18ee017fce8500cd');
assert.equal(G27_SOURCE_COAST_POLICY.width, 192);
assert.equal(G27_SOURCE_COAST_POLICY.height, 128);
assert.deepEqual(G27_SOURCE_COAST_POLICY.pixelBounds, { xMin: 384, xMax: 576, yMin: 896, yMax: 1024 });

const packedBytes = getG27SourceLandMaskBytes();
assert.equal(packedBytes.byteLength, 3072, '192x128 one-bit mask must occupy exactly 3072 bytes');
assert.equal(
  crypto.createHash('sha256').update(packedBytes).digest('hex'),
  G27_SOURCE_COAST_POLICY.packedLandMaskSha256,
  'persisted G27 source-mask bytes changed',
);

const sourceMetrics = measureG27SourceMask();
assert.deepEqual(sourceMetrics, {
  geoCell: 'G27',
  sourcePixels: 24576,
  landPixels: 5042,
  waterPixels: 19534,
  boundaryEdges: 947,
  checksum: 2221216717,
});

let hardMismatchPixels = 0;
let bilinearMismatchPixels = 0;
let sourceSamplerMismatchPixels = 0;
let oldWaterIntersection = 0;
let oldWaterUnion = 0;
let oldLandIntersection = 0;
let oldLandUnion = 0;

for (let py = 0; py < G27_SOURCE_COAST_POLICY.height; py += 1) {
  for (let px = 0; px < G27_SOURCE_COAST_POLICY.width; px += 1) {
    const sourceWater = !isG27SourceLandPixel(px, py);
    const normalizedX = (G27_SOURCE_COAST_POLICY.pixelBounds.xMin + px + 0.5) / 1536;
    const normalizedY = (G27_SOURCE_COAST_POLICY.pixelBounds.yMin + py + 0.5) / 1024;

    const hardSurface = classifyReferenceBaseSurface(normalizedX, normalizedY);
    const hardWater = hardSurface === 'sea' || hardSurface === 'lake';
    if (hardWater !== sourceWater) hardMismatchPixels += 1;

    const bilinearWater = sampleG27WaterConfidence(normalizedX, normalizedY) >= 0.5;
    if (bilinearWater !== sourceWater) bilinearMismatchPixels += 1;

    const sourceConfidence = sampleG27SourceWaterConfidence(normalizedX, normalizedY);
    const sourceSampleWater = sourceConfidence >= 0.5;
    if (sourceSampleWater !== sourceWater) sourceSamplerMismatchPixels += 1;

    if (bilinearWater && sourceWater) oldWaterIntersection += 1;
    if (bilinearWater || sourceWater) oldWaterUnion += 1;
    if (!bilinearWater && !sourceWater) oldLandIntersection += 1;
    if (!bilinearWater || !sourceWater) oldLandUnion += 1;
  }
}

assert.equal(hardMismatchPixels, 2742, 'hard 96x64 G27 source error fingerprint changed');
assert.equal(bilinearMismatchPixels, 2572, 'coarse bilinear G27 source error fingerprint changed');
assert.ok(bilinearMismatchPixels < hardMismatchPixels, 'coarse bilinear pass must remain better than hard-cell rendering');
assert.equal(sourceSamplerMismatchPixels, 0, 'source-resolution sampler must preserve every source pixel centre');
assert.equal(oldWaterIntersection, 19174);
assert.equal(oldWaterUnion, 21746);
assert.equal(oldLandIntersection, 2830);
assert.equal(oldLandUnion, 5402);

const result = Object.freeze({
  geoCell: 'G27',
  sourcePixels: sourceMetrics.sourcePixels,
  semanticResolutionUplift: sourceMetrics.sourcePixels / 96,
  sourceLandPixels: sourceMetrics.landPixels,
  sourceWaterPixels: sourceMetrics.waterPixels,
  sourceBoundaryEdges: sourceMetrics.boundaryEdges,
  hardMismatchPixels,
  bilinearMismatchPixels,
  sourceSamplerMismatchPixels,
  hardPixelAccuracy: (sourceMetrics.sourcePixels - hardMismatchPixels) / sourceMetrics.sourcePixels,
  bilinearPixelAccuracy: (sourceMetrics.sourcePixels - bilinearMismatchPixels) / sourceMetrics.sourcePixels,
  sourceSamplerPixelAccuracy: 1,
  bilinearWaterIoU: oldWaterIntersection / oldWaterUnion,
  bilinearLandIoU: oldLandIntersection / oldLandUnion,
  sourceWaterIoU: 1,
  sourceLandIoU: 1,
  packedMaskSha256: G27_SOURCE_COAST_POLICY.packedLandMaskSha256,
  sourceMaskChecksum: sourceMetrics.checksum,
});

assert.equal(result.semanticResolutionUplift, 256);
assert.ok(result.bilinearPixelAccuracy > result.hardPixelAccuracy);
assert.ok(result.sourceSamplerPixelAccuracy > result.bilinearPixelAccuracy);
assert.ok(result.sourceWaterIoU > result.bilinearWaterIoU);
assert.ok(result.sourceLandIoU > result.bilinearLandIoU);

console.log(JSON.stringify(result, null, 2));
console.log('SW_G27_SOURCE_FIDELITY_OK');
