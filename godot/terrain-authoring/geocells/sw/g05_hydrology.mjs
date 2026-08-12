/**
 * Günbatımı Ustası / SW GeoCell G05 coast-hydrology measurement.
 *
 * G05 owns source pixels x=0..192, y=640..768, normalized
 * [0.0, 0.125] x [0.625, 0.75]. The immutable 96x64 owner-map surface mask
 * remains the semantic source. This authoring-only primitive derives a
 * continuous water-confidence field without changing shipped terrain.
 */
import { classifyReferenceBaseSurface } from '../../../../src/3d/world/worldReferenceSurfacePindexes.js';

export const G05_HYDROLOGY_POLICY = Object.freeze({
  id: 'gunbatimi-ustasi-g05-hydrology-2026-08-12-v1',
  sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
  geoCell: 'G05', gx: 0, gy: 5,
  pixelBounds: Object.freeze({ xMin: 0, xMax: 192, yMin: 640, yMax: 768 }),
  normalizedBounds: Object.freeze({ xMin: 0, xMax: 0.125, yMin: 0.625, yMax: 0.75 }),
  maskBounds: Object.freeze({ xMin: 0, xMax: 11, yMin: 40, yMax: 47 }),
  baseMaskWidth: 96, baseMaskHeight: 64, sourcePixelsPerMaskCell: 16,
});

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isWater = (surface) => surface === 'sea' || surface === 'lake' ? 1 : 0;
function sampleWaterAtMaskCell(cellX, cellY) {
  const x = clamp(cellX, 0, G05_HYDROLOGY_POLICY.baseMaskWidth - 1);
  const y = clamp(cellY, 0, G05_HYDROLOGY_POLICY.baseMaskHeight - 1);
  return isWater(classifyReferenceBaseSurface(
    (x + 0.5) / G05_HYDROLOGY_POLICY.baseMaskWidth,
    (y + 0.5) / G05_HYDROLOGY_POLICY.baseMaskHeight,
  ));
}

export function isInsideG05(nx, ny) {
  const b = G05_HYDROLOGY_POLICY.normalizedBounds;
  return nx >= b.xMin && nx <= b.xMax && ny >= b.yMin && ny <= b.yMax;
}

export function sampleG05WaterConfidence(nx, ny) {
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) throw new TypeError('normalized coordinates must be finite');
  if (!isInsideG05(nx, ny)) return null;
  const gx = nx * G05_HYDROLOGY_POLICY.baseMaskWidth - 0.5;
  const gy = ny * G05_HYDROLOGY_POLICY.baseMaskHeight - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
  const w00 = sampleWaterAtMaskCell(x0, y0), w10 = sampleWaterAtMaskCell(x0 + 1, y0);
  const w01 = sampleWaterAtMaskCell(x0, y0 + 1), w11 = sampleWaterAtMaskCell(x0 + 1, y0 + 1);
  const top = w00 + (w10 - w00) * tx;
  const bottom = w01 + (w11 - w01) * tx;
  return clamp(top + (bottom - top) * ty, 0, 1);
}

export function measureG05Hydrology() {
  const { xMin, xMax, yMin, yMax } = G05_HYDROLOGY_POLICY.maskBounds;
  let waterCells = 0, landCells = 0, boundaryEdges = 0, centreMismatches = 0;
  for (let y = yMin; y <= yMax; y += 1) for (let x = xMin; x <= xMax; x += 1) {
    const water = sampleWaterAtMaskCell(x, y);
    if (water) waterCells += 1; else landCells += 1;
    if (x < xMax && water !== sampleWaterAtMaskCell(x + 1, y)) boundaryEdges += 1;
    if (y < yMax && water !== sampleWaterAtMaskCell(x, y + 1)) boundaryEdges += 1;
    if (sampleG05WaterConfidence((x + 0.5) / 96, (y + 0.5) / 64) !== water) centreMismatches += 1;
  }
  const samplesX = 48, samplesY = 32, grid = [];
  let fractionalSamples = 0, confidenceChecksum = 2166136261;
  const b = G05_HYDROLOGY_POLICY.normalizedBounds;
  for (let sy = 0; sy <= samplesY; sy += 1) {
    const row = [];
    const ny = b.yMin + (b.yMax - b.yMin) * sy / samplesY;
    for (let sx = 0; sx <= samplesX; sx += 1) {
      const nx = b.xMin + (b.xMax - b.xMin) * sx / samplesX;
      const c = sampleG05WaterConfidence(nx, ny);
      if (c > 0 && c < 1) fractionalSamples += 1;
      confidenceChecksum ^= Math.round(c * 255);
      confidenceChecksum = Math.imul(confidenceChecksum, 16777619) >>> 0;
      row.push(c);
    }
    grid.push(row);
  }
  let maxAdjacentStep = 0;
  for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < grid[y].length; x += 1) {
    if (x + 1 < grid[y].length) maxAdjacentStep = Math.max(maxAdjacentStep, Math.abs(grid[y][x + 1] - grid[y][x]));
    if (y + 1 < grid.length) maxAdjacentStep = Math.max(maxAdjacentStep, Math.abs(grid[y + 1][x] - grid[y][x]));
  }
  return Object.freeze({ policyId: G05_HYDROLOGY_POLICY.id, geoCell: 'G05', baseCells: 96,
    waterCells, landCells, boundaryEdges, centreMismatches,
    refinedSamples: 1617, fractionalSamples, hardCellMaxStep: 1,
    maxAdjacentStep: Number(maxAdjacentStep.toFixed(8)), confidenceChecksum });
}
