/**
 * Kızıl Ufuk / SE GeoCell G75 Coast/Hydrology Terrain3D contract.
 *
 * G75 addresses canonical source pixels x=1344..1536, y=640..768. The immutable
 * owner-map surface classifier remains semantic truth. G75 and its one-cell guard
 * band are uniform canonical dry land, so this unit must not invent coastline.
 * Instead it exports a clamped halo and a continuous Terrain3D height probe so the
 * pinned backend can persist and bake a seam-free dry hydrology foundation.
 */
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G75_HYDROLOGY_POLICY = Object.freeze({
  id: 'kizil-ufuk-g75-terrain3d-hydrology-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G75',
  gx: 7,
  gy: 5,
  pixelBounds: Object.freeze({ xMin: 1344, xMax: 1536, yMin: 640, yMax: 768 }),
  normalizedBounds: Object.freeze({ xMin: 0.875, xMax: 1, yMin: 0.625, yMax: 0.75 }),
  maskBounds: Object.freeze({ xMin: 84, xMax: 95, yMin: 40, yMax: 47 }),
  haloBounds: Object.freeze({ xMin: 83, xMax: 96, yMin: 39, yMax: 48 }),
  baseMaskWidth: 96,
  baseMaskHeight: 64,
  sourcePixelsPerMaskCell: 16,
  terrain3dRegionSize: 256,
  dryHeightMeters: 0.75,
  waterHeightMeters: -6.0,
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const isWater = (surface) => surface === 'sea' || surface === 'lake' ? 1 : 0;

export function sampleG75MaskWater(cellX, cellY) {
  const x = clamp(cellX, 0, G75_HYDROLOGY_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G75_HYDROLOGY_POLICY.baseMaskHeight - 1);
  return isWater(classifyReferenceBaseSurface(
    (x + 0.5) / G75_HYDROLOGY_POLICY.baseMaskWidth,
    (y + 0.5) / G75_HYDROLOGY_POLICY.baseMaskHeight,
  ));
}

export function isInsideG75(normalizedX, normalizedY) {
  const { xMin, xMax, yMin, yMax } = G75_HYDROLOGY_POLICY.normalizedBounds;
  return normalizedX >= xMin && normalizedX <= xMax && normalizedY >= yMin && normalizedY <= yMax;
}

export function sampleG75WaterConfidence(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) {
    throw new TypeError('normalized coordinates must be finite');
  }
  if (!isInsideG75(normalizedX, normalizedY)) return null;
  const gridX = normalizedX * G75_HYDROLOGY_POLICY.baseMaskWidth - 0.5;
  const gridY = normalizedY * G75_HYDROLOGY_POLICY.baseMaskHeight - 0.5;
  const x0 = Math.floor(gridX);
  const y0 = Math.floor(gridY);
  const tx = gridX - x0;
  const ty = gridY - y0;
  const w00 = sampleG75MaskWater(x0, y0);
  const w10 = sampleG75MaskWater(x0 + 1, y0);
  const w01 = sampleG75MaskWater(x0, y0 + 1);
  const w11 = sampleG75MaskWater(x0 + 1, y0 + 1);
  const top = w00 + (w10 - w00) * tx;
  const bottom = w01 + (w11 - w01) * tx;
  return clamp(top + (bottom - top) * ty, 0, 1);
}

export function buildG75Terrain3DProbe() {
  const h = G75_HYDROLOGY_POLICY.haloBounds;
  const rows = [];
  for (let y = h.yMin; y <= h.yMax; y += 1) {
    const row = [];
    for (let x = h.xMin; x <= h.xMax; x += 1) row.push(sampleG75MaskWater(x, y));
    rows.push(row);
  }
  return {
    policyId: G75_HYDROLOGY_POLICY.id,
    sourceMapSha256: G75_HYDROLOGY_POLICY.sourceMapSha256,
    normalizedBounds: G75_HYDROLOGY_POLICY.normalizedBounds,
    haloOrigin: { x: h.xMin, y: h.yMin },
    width: h.xMax - h.xMin + 1,
    height: h.yMax - h.yMin + 1,
    baseMaskWidth: G75_HYDROLOGY_POLICY.baseMaskWidth,
    baseMaskHeight: G75_HYDROLOGY_POLICY.baseMaskHeight,
    terrain3dRegionSize: G75_HYDROLOGY_POLICY.terrain3dRegionSize,
    dryHeightMeters: G75_HYDROLOGY_POLICY.dryHeightMeters,
    waterHeightMeters: G75_HYDROLOGY_POLICY.waterHeightMeters,
    rows,
  };
}

export function measureG75Hydrology() {
  const b = G75_HYDROLOGY_POLICY.maskBounds;
  let waterCells = 0;
  let landCells = 0;
  let boundaryEdges = 0;
  let centreMismatches = 0;
  for (let y = b.yMin; y <= b.yMax; y += 1) {
    for (let x = b.xMin; x <= b.xMax; x += 1) {
      const water = sampleG75MaskWater(x, y);
      if (water) waterCells += 1;
      else landCells += 1;
      if (x < b.xMax && water !== sampleG75MaskWater(x + 1, y)) boundaryEdges += 1;
      if (y < b.yMax && water !== sampleG75MaskWater(x, y + 1)) boundaryEdges += 1;
      if (sampleG75WaterConfidence((x + 0.5) / 96, (y + 0.5) / 64) !== water) centreMismatches += 1;
    }
  }

  const samplesX = 48;
  const samplesY = 32;
  const grid = [];
  let fractionalSamples = 0;
  let confidenceChecksum = 2166136261;
  const n = G75_HYDROLOGY_POLICY.normalizedBounds;
  for (let sy = 0; sy <= samplesY; sy += 1) {
    const row = [];
    const ny = n.yMin + (n.yMax - n.yMin) * (sy / samplesY);
    for (let sx = 0; sx <= samplesX; sx += 1) {
      const nx = n.xMin + (n.xMax - n.xMin) * (sx / samplesX);
      const confidence = sampleG75WaterConfidence(nx, ny);
      if (confidence > 0 && confidence < 1) fractionalSamples += 1;
      confidenceChecksum ^= Math.round(confidence * 255);
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
    policyId: G75_HYDROLOGY_POLICY.id,
    geoCell: 'G75',
    baseCells: 96,
    waterCells,
    landCells,
    boundaryEdges,
    centreMismatches,
    refinedSamples: 1617,
    fractionalSamples,
    hardCellMaxStep: 0,
    maxAdjacentStep: Number(maxAdjacentStep.toFixed(8)),
    confidenceChecksum,
  });
}
