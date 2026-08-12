/**
 * Buzul Muhafızı / NW GeoCell G02 coast-hydrology refinement.
 * G02 owns source pixels x=0..192, y=256..384 and canonical mask cells x=0..11, y=16..23.
 */
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G02_HYDROLOGY_POLICY = Object.freeze({
  id: 'buzul-muhafizi-g02-hydrology-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G02', gx: 0, gy: 2,
  pixelBounds: Object.freeze({ xMin: 0, xMax: 192, yMin: 256, yMax: 384 }),
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.25, yMax: 0.375 }),
  maskBounds: Object.freeze({ xMin: 0, xMax: 11, yMin: 16, yMax: 23 }),
  baseMaskWidth: 96, baseMaskHeight: 64, sourcePixelsPerMaskCell: 16,
});

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function isWater(surface) { return surface === 'sea' || surface === 'lake' ? 1 : 0; }
function sampleWaterAtMaskCell(cellX, cellY) {
  const x = clamp(cellX, 0, G02_HYDROLOGY_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G02_HYDROLOGY_POLICY.baseMaskHeight - 1);
  return isWater(classifyReferenceBaseSurface((x + 0.5) / 96, (y + 0.5) / 64));
}

export function isInsideG02(x, y) {
  const b = G02_HYDROLOGY_POLICY.normalizedBounds;
  return x >= b.xMin && x <= b.xMax && y >= b.yMin && y <= b.yMax;
}

export function sampleG02WaterConfidence(normalizedX, normalizedY) {
  if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY)) throw new TypeError('normalized coordinates must be finite');
  if (!isInsideG02(normalizedX, normalizedY)) return null;
  const gx = normalizedX * 96 - 0.5, gy = normalizedY * 64 - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
  const w00 = sampleWaterAtMaskCell(x0, y0), w10 = sampleWaterAtMaskCell(x0 + 1, y0);
  const w01 = sampleWaterAtMaskCell(x0, y0 + 1), w11 = sampleWaterAtMaskCell(x0 + 1, y0 + 1);
  const top = w00 + (w10 - w00) * tx, bottom = w01 + (w11 - w01) * tx;
  return clamp(top + (bottom - top) * ty, 0, 1);
}

export function measureG02Hydrology() {
  const { xMin, xMax, yMin, yMax } = G02_HYDROLOGY_POLICY.maskBounds;
  let waterCells = 0, landCells = 0, boundaryEdges = 0, centreMismatches = 0;
  for (let y = yMin; y <= yMax; y += 1) for (let x = xMin; x <= xMax; x += 1) {
    const water = sampleWaterAtMaskCell(x, y);
    water ? waterCells += 1 : landCells += 1;
    if (x < xMax && water !== sampleWaterAtMaskCell(x + 1, y)) boundaryEdges += 1;
    if (y < yMax && water !== sampleWaterAtMaskCell(x, y + 1)) boundaryEdges += 1;
    if (sampleG02WaterConfidence((x + 0.5) / 96, (y + 0.5) / 64) !== water) centreMismatches += 1;
  }
  const samplesX = 48, samplesY = 32, grid = []; let fractionalSamples = 0, confidenceChecksum = 2166136261;
  const b = G02_HYDROLOGY_POLICY.normalizedBounds;
  for (let sy = 0; sy <= samplesY; sy += 1) {
    const row = [], ny = b.yMin + (b.yMax - b.yMin) * sy / samplesY;
    for (let sx = 0; sx <= samplesX; sx += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * sx / samplesX, confidence = sampleG02WaterConfidence(nx, ny);
      if (confidence > 0 && confidence < 1) fractionalSamples += 1;
      confidenceChecksum ^= Math.round(confidence * 255); confidenceChecksum = Math.imul(confidenceChecksum, 16777619) >>> 0;
      row.push(confidence);
    }
    grid.push(row);
  }
  let maxAdjacentStep = 0;
  for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < grid[y].length; x += 1) {
    if (x + 1 < grid[y].length) maxAdjacentStep = Math.max(maxAdjacentStep, Math.abs(grid[y][x + 1] - grid[y][x]));
    if (y + 1 < grid.length) maxAdjacentStep = Math.max(maxAdjacentStep, Math.abs(grid[y + 1][x] - grid[y][x]));
  }
  return Object.freeze({ policyId: G02_HYDROLOGY_POLICY.id, geoCell: 'G02', baseCells: 96, waterCells, landCells, boundaryEdges,
    centreMismatches, refinedSamples: 1617, fractionalSamples, hardCellMaxStep: 1,
    maxAdjacentStep: Number(maxAdjacentStep.toFixed(8)), confidenceChecksum });
}
