/**
 * Kızıl Ufuk / SE GeoCell G76 coast-hydrology refinement.
 *
 * G76 owns canonical source pixels x=1344..1536, y=768..896, normalized
 * [0.875, 1.0] x [0.75, 0.875]. The immutable 96x64 owner-map surface mask
 * remains the semantic source of truth. This authoring/QA primitive derives a
 * continuous water-confidence field between mask-cell centres so a later visual
 * pass can soften 16px staircase transitions without inventing geography.
 */

import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G76_HYDROLOGY_POLICY = Object.freeze({
  id: 'kizil-ufuk-g76-hydrology-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G76',
  gx: 7,
  gy: 6,
  pixelBounds: Object.freeze({ xMin: 1344, xMax: 1536, yMin: 768, yMax: 896 }),
  normalizedBounds: Object.freeze({ xMin: 0.875, xMax: 1.0, yMin: 0.75, yMax: 0.875 }),
  maskBounds: Object.freeze({ xMin: 84, xMax: 95, yMin: 48, yMax: 55 }),
  baseMaskWidth: 96,
  baseMaskHeight: 64,
  sourcePixelsPerMaskCell: 16,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isWater(surface) {
  return surface === 'sea' || surface === 'lake' ? 1 : 0;
}

function sampleWaterAtMaskCell(cellX, cellY) {
  const x = clamp(cellX, 0, G76_HYDROLOGY_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G76_HYDROLOGY_POLICY.baseMaskHeight - 1);
  const nx = (x + 0.5) / G76_HYDROLOGY_POLICY.baseMaskWidth;
  const ny = (y + 0.5) / G76_HYDROLOGY_POLICY.baseMaskHeight;
  return isWater(classifyReferenceBaseSurface(nx, ny));
}

export function isInsideG76(normalizedX, normalizedY) {
  const { xMin, xMax, yMin, yMax } = G76_HYDROLOGY_POLICY.normalizedBounds;
  return normalizedX >= xMin && normalizedX <= xMax && normalizedY >= yMin && normalizedY <= yMax;
}

export function sampleG76WaterConfidence(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  if (!isInsideG76(normalizedX, normalizedY)) return null;

  const gridX = normalizedX * G76_HYDROLOGY_POLICY.baseMaskWidth - 0.5;
  const gridY = normalizedY * G76_HYDROLOGY_POLICY.baseMaskHeight - 0.5;
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const w00 = sampleWaterAtMaskCell(x0, y0);
  const w10 = sampleWaterAtMaskCell(x0 + 1, y0);
  const w01 = sampleWaterAtMaskCell(x0, y0 + 1);
  const w11 = sampleWaterAtMaskCell(x0 + 1, y0 + 1);
  const top = w00 + (w10 - w00) * tx;
  const bottom = w01 + (w11 - w01) * tx;
  return clamp(top + (bottom - top) * ty, 0, 1);
}

export function measureG76Hydrology() {
  const { xMin, xMax, yMin, yMax } = G76_HYDROLOGY_POLICY.maskBounds;
  let waterCells = 0;
  let landCells = 0;
  let boundaryEdges = 0;
  let centreMismatches = 0;

  for (let maskY = yMin; maskY <= yMax; maskY += 1) {
    for (let maskX = xMin; maskX <= xMax; maskX += 1) {
      const water = sampleWaterAtMaskCell(maskX, maskY);
      if (water) waterCells += 1;
      else landCells += 1;
      if (maskX < xMax && water !== sampleWaterAtMaskCell(maskX + 1, maskY)) boundaryEdges += 1;
      if (maskY < yMax && water !== sampleWaterAtMaskCell(maskX, maskY + 1)) boundaryEdges += 1;
      const nx = (maskX + 0.5) / G76_HYDROLOGY_POLICY.baseMaskWidth;
      const ny = (maskY + 0.5) / G76_HYDROLOGY_POLICY.baseMaskHeight;
      if (sampleG76WaterConfidence(nx, ny) !== water) centreMismatches += 1;
    }
  }

  const samplesX = 48;
  const samplesY = 32;
  const grid = [];
  let fractionalSamples = 0;
  let confidenceChecksum = 2166136261;
  const bounds = G76_HYDROLOGY_POLICY.normalizedBounds;

  for (let sy = 0; sy <= samplesY; sy += 1) {
    const row = [];
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (sy / samplesY);
    for (let sx = 0; sx <= samplesX; sx += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (sx / samplesX);
      const confidence = sampleG76WaterConfidence(nx, ny);
      if (confidence > 0 && confidence < 1) fractionalSamples += 1;
      const quantized = Math.round(confidence * 255);
      confidenceChecksum ^= quantized;
      confidenceChecksum = Math.imul(confidenceChecksum, 16777619) >>> 0;
      row.push(confidence);
    }
    grid.push(row);
  }

  let maxAdjacentStep = 0;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (x + 1 < grid[y].length) maxAdjacentStep = Math.max(maxAdjacentStep, Math.abs(grid[y][x + 1] - grid[y][x]));
      if (y + 1 < grid.length) maxAdjacentStep = Math.max(maxAdjacentStep, Math.abs(grid[y + 1][x] - grid[y][x]));
    }
  }

  return Object.freeze({
    policyId: G76_HYDROLOGY_POLICY.id,
    geoCell: 'G76',
    baseCells: (xMax - xMin + 1) * (yMax - yMin + 1),
    waterCells,
    landCells,
    boundaryEdges,
    centreMismatches,
    refinedSamples: (samplesX + 1) * (samplesY + 1),
    fractionalSamples,
    hardCellMaxStep: 1,
    maxAdjacentStep: Number(maxAdjacentStep.toFixed(8)),
    confidenceChecksum,
  });
}
