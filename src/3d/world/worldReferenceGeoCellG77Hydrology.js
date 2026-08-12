/**
 * Kızıl Ufuk / SE GeoCell G77 hydrology refinement.
 *
 * G77 is the south-east 192x128 pixels of the canonical 1536x1024 owner map:
 * normalized [0.875, 1] x [0.875, 1]. The persisted 96x64 canonical water mask
 * has one sample per 16x16 source pixels. Rendering those samples as hard cells
 * produces visible coastline stairs, so this module derives a continuous water
 * confidence field while preserving the exact semantic value at every source
 * mask-cell centre.
 *
 * This first SE unit is deliberately data/math-only. It does not mutate terrain
 * height, collider, settlements, roads, HTerrain data or runtime materials.
 * @module world/worldReferenceGeoCellG77Hydrology
 */

import { classifyReferenceWaterCell } from './worldReferenceWaterMask.js';

export const G77_HYDROLOGY_POLICY = Object.freeze({
  id: 'kizil-ufuk-g77-hydrology-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G77',
  gx: 7,
  gy: 7,
  pixelBounds: Object.freeze({ xMin: 1344, xMax: 1536, yMin: 896, yMax: 1024 }),
  normalizedBounds: Object.freeze({ xMin: 0.875, xMax: 1, yMin: 0.875, yMax: 1 }),
  baseMaskWidth: 96,
  baseMaskHeight: 64,
  maskCellBounds: Object.freeze({ xMin: 84, xMax: 96, yMin: 56, yMax: 64 }),
  sourcePixelsPerMaskCell: 16,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function isWaterBody(surface) {
  return surface === 'sea' || surface === 'lake' ? 1 : 0;
}

function sampleWaterAtMaskCell(cellX, cellY) {
  const x = clamp(cellX, 0, G77_HYDROLOGY_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G77_HYDROLOGY_POLICY.baseMaskHeight - 1);
  return isWaterBody(classifyReferenceWaterCell(x, y));
}

export function isInsideG77(normalizedX, normalizedY) {
  const { normalizedBounds } = G77_HYDROLOGY_POLICY;
  return normalizedX >= normalizedBounds.xMin && normalizedX <= normalizedBounds.xMax
    && normalizedY >= normalizedBounds.yMin && normalizedY <= normalizedBounds.yMax;
}

/**
 * Continuous 0..1 water confidence derived only from the immutable canonical mask.
 * Every canonical mask-cell centre remains exactly 0 or 1, matching the source mask.
 */
export function sampleG77WaterConfidence(normalizedX, normalizedY) {
  if (!isInsideG77(normalizedX, normalizedY)) return null;

  const gridX = normalizedX * G77_HYDROLOGY_POLICY.baseMaskWidth - 0.5;
  const gridY = normalizedY * G77_HYDROLOGY_POLICY.baseMaskHeight - 0.5;
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

/**
 * Deterministic evidence metadata for the G77 coastline field.
 */
export function measureG77Hydrology() {
  const { maskCellBounds } = G77_HYDROLOGY_POLICY;
  const cellsX = maskCellBounds.xMax - maskCellBounds.xMin;
  const cellsY = maskCellBounds.yMax - maskCellBounds.yMin;
  let waterCells = 0;
  let landCells = 0;
  let seaCells = 0;
  let lakeCells = 0;
  let boundaryEdges = 0;
  let centreMismatches = 0;
  let confidenceChecksum = 2166136261;

  for (let y = 0; y < cellsY; y += 1) {
    for (let x = 0; x < cellsX; x += 1) {
      const maskX = maskCellBounds.xMin + x;
      const maskY = maskCellBounds.yMin + y;
      const body = classifyReferenceWaterCell(maskX, maskY);
      const water = isWaterBody(body);
      if (water) waterCells += 1;
      else landCells += 1;
      if (body === 'sea') seaCells += 1;
      if (body === 'lake') lakeCells += 1;

      if (x + 1 < cellsX && water !== sampleWaterAtMaskCell(maskX + 1, maskY)) boundaryEdges += 1;
      if (y + 1 < cellsY && water !== sampleWaterAtMaskCell(maskX, maskY + 1)) boundaryEdges += 1;

      const nx = (maskX + 0.5) / G77_HYDROLOGY_POLICY.baseMaskWidth;
      const ny = (maskY + 0.5) / G77_HYDROLOGY_POLICY.baseMaskHeight;
      const confidence = sampleG77WaterConfidence(nx, ny);
      if (confidence !== water) centreMismatches += 1;
    }
  }

  // 4x sub-cell deterministic regression fingerprint over only G77.
  for (let sy = 0; sy < cellsY * 4; sy += 1) {
    for (let sx = 0; sx < cellsX * 4; sx += 1) {
      const nx = (maskCellBounds.xMin * 4 + sx + 0.5) / (G77_HYDROLOGY_POLICY.baseMaskWidth * 4);
      const ny = (maskCellBounds.yMin * 4 + sy + 0.5) / (G77_HYDROLOGY_POLICY.baseMaskHeight * 4);
      const quantized = Math.round(sampleG77WaterConfidence(nx, ny) * 255);
      confidenceChecksum ^= quantized;
      confidenceChecksum = Math.imul(confidenceChecksum, 16777619) >>> 0;
    }
  }

  return Object.freeze({
    policyId: G77_HYDROLOGY_POLICY.id,
    geoCell: 'G77',
    baseCells: cellsX * cellsY,
    waterCells,
    landCells,
    seaCells,
    lakeCells,
    boundaryEdges,
    centreMismatches,
    refinedSamples: cellsX * 4 * cellsY * 4,
    confidenceChecksum,
  });
}
