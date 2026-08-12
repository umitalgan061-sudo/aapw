/**
 * Buzul Muhafızı / NW GeoCell G00 hydrology refinement.
 *
 * G00 is the top-left 192x128 pixels of the canonical 1536x1024 owner map, i.e.
 * normalized [0, 0.125] x [0, 0.125]. The existing canonical 96x64 surface mask has
 * one sample per 16x16 source pixels; rendering that mask as hard cells creates a
 * staircase coastline. This module derives a continuous water-confidence field from
 * the immutable mask without changing any cell-centre semantic classification.
 *
 * It is intentionally data/math-only in this first NW unit: no terrain height, collider,
 * settlement, road or production material is mutated. A later integration unit may use
 * the confidence as a visual blend input after browser evidence proves the result.
 * @module world/worldReferenceGeoCellG00Hydrology
 */

import { classifyReferenceBaseSurface } from './worldReferenceSurfacePindexes.js';

export const G00_HYDROLOGY_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g00-hydrology-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G00',
  gx: 0,
  gy: 0,
  pixelBounds: Object.freeze({ xMin: 0, xMax: 192, yMin: 0, yMax: 128 }),
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0, yMax: 0.125 }),
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
  return normalizedX >= 0 && normalizedX <= 0.125 && normalizedY >= 0 && normalizedY <= 0.125;
}

/**
 * Returns a continuous 0..1 water confidence derived only from the canonical base mask.
 * At every base-mask cell centre the result is exactly the original binary water value.
 */
export function sampleG00WaterConfidence(normalizedX, normalizedY) {
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

/**
 * Measures the G00 base-mask coastline complexity and refinement continuity.
 * The score is evidence metadata; it is not a gameplay/runtime quality claim.
 */
export function measureG00Hydrology() {
  const cellsX = 12;
  const cellsY = 8;
  let waterCells = 0;
  let landCells = 0;
  let boundaryEdges = 0;
  let centreMismatches = 0;
  let confidenceChecksum = 2166136261;

  for (let y = 0; y < cellsY; y += 1) {
    for (let x = 0; x < cellsX; x += 1) {
      const maskX = x;
      const maskY = y;
      const water = sampleWaterAtMaskCell(maskX, maskY);
      if (water) waterCells += 1;
      else landCells += 1;
      if (x + 1 < cellsX && water !== sampleWaterAtMaskCell(maskX + 1, maskY)) boundaryEdges += 1;
      if (y + 1 < cellsY && water !== sampleWaterAtMaskCell(maskX, maskY + 1)) boundaryEdges += 1;
      const nx = (maskX + 0.5) / G00_HYDROLOGY_POLICY.baseMaskWidth;
      const ny = (maskY + 0.5) / G00_HYDROLOGY_POLICY.baseMaskHeight;
      const confidence = sampleG00WaterConfidence(nx, ny);
      if (confidence !== water) centreMismatches += 1;
    }
  }

  // 4x sub-cell deterministic checksum, useful for regression snapshots.
  for (let sy = 0; sy < cellsY * 4; sy += 1) {
    for (let sx = 0; sx < cellsX * 4; sx += 1) {
      const nx = (sx + 0.5) / (G00_HYDROLOGY_POLICY.baseMaskWidth * 4);
      const ny = (sy + 0.5) / (G00_HYDROLOGY_POLICY.baseMaskHeight * 4);
      const quantized = Math.round(sampleG00WaterConfidence(nx, ny) * 255);
      confidenceChecksum ^= quantized;
      confidenceChecksum = Math.imul(confidenceChecksum, 16777619) >>> 0;
    }
  }

  return Object.freeze({
    policyId: G00_HYDROLOGY_POLICY.id,
    geoCell: 'G00',
    baseCells: cellsX * cellsY,
    waterCells,
    landCells,
    boundaryEdges,
    centreMismatches,
    refinedSamples: cellsX * 4 * cellsY * 4,
    confidenceChecksum,
  });
}
