/**
 * Buzul Muhafızı / NW GeoCell G00 coast-hydrology refinement.
 *
 * G00 owns canonical source pixels x=0..192, y=0..128, normalized
 * [0, 0.125] x [0, 0.125]. The immutable 96x64 owner-map surface mask
 * remains the semantic source of truth. This authoring/QA primitive derives a
 * continuous water-confidence field between mask-cell centres so later visual
 * authoring can remove 16px staircase transitions without inventing geography.
 *
 * G00 is the literal NW corner cell (gx=0, gy=0) itself — deliberately deferred
 * by the three earlier NW cells (G01/G10/G11, which cover its three neighbours)
 * so this closes out the corner's first full 2x2 block. No other work in this
 * repo depends on completing it in any particular order; it was simply the one
 * remaining gap in that block.
 */

import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G00_HYDROLOGY_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g00-hydrology-2026-08-13-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G00',
  gx: 0,
  gy: 0,
  pixelBounds: Object.freeze({ xMin: 0, xMax: 192, yMin: 0, yMax: 128 }),
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0, yMax: 0.125 }),
  maskBounds: Object.freeze({ xMin: 0, xMax: 11, yMin: 0, yMax: 7 }),
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
  const x = clamp(cellX, 0, G00_HYDROLOGY_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G00_HYDROLOGY_POLICY.baseMaskHeight - 1);
  const nx = (x + 0.5) / G00_HYDROLOGY_POLICY.baseMaskWidth;
  const ny = (y + 0.5) / G00_HYDROLOGY_POLICY.baseMaskHeight;
  return isWater(classifyReferenceBaseSurface(nx, ny));
}

export function isInsideG00(normalizedX, normalizedY) {
  const { xMin, xMax, yMin, yMax } = G00_HYDROLOGY_POLICY.normalizedBounds;
  return normalizedX >= xMin && normalizedX <= xMax && normalizedY >= yMin && normalizedY <= yMax;
}

export function sampleG00WaterConfidence(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  if (!isInsideG00(normalizedX, normalizedY)) return null;

  const gridX = normalizedX * G00_HYDROLOGY_POLICY.baseMaskWidth - 0.5;
  const gridY = normalizedY * G00_HYDROLOGY_POLICY.baseMaskHeight - 0.5;
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

export function measureG00Hydrology() {
  const { xMin, xMax, yMin, yMax } = G00_HYDROLOGY_POLICY.maskBounds;
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
      const nx = (maskX + 0.5) / G00_HYDROLOGY_POLICY.baseMaskWidth;
      const ny = (maskY + 0.5) / G00_HYDROLOGY_POLICY.baseMaskHeight;
      if (sampleG00WaterConfidence(nx, ny) !== water) centreMismatches += 1;
    }
  }

  const samplesX = 48;
  const samplesY = 32;
  const grid = [];
  let fractionalSamples = 0;
  let confidenceChecksum = 2166136261;
  const bounds = G00_HYDROLOGY_POLICY.normalizedBounds;

  for (let sy = 0; sy <= samplesY; sy += 1) {
    const row = [];
    const ny = bounds.yMin + (bounds.yMax - bounds.yMin) * (sy / samplesY);
    for (let sx = 0; sx <= samplesX; sx += 1) {
      const nx = bounds.xMin + (bounds.xMax - bounds.xMin) * (sx / samplesX);
      const confidence = sampleG00WaterConfidence(nx, ny);
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
    policyId: G00_HYDROLOGY_POLICY.id,
    geoCell: 'G00',
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
